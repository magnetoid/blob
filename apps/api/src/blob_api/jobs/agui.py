"""Running an AG-UI agent when somebody mentions it.

A person @-mentions an app's bot in a channel that bot has joined. This POSTs the
surrounding conversation to the app's AG-UI endpoint as a standard `RunAgentInput`,
reads the event stream back, and writes whatever the agent said as ordinary messages
from that bot, in the place it was addressed.

It never raises. An arq retry would re-run the agent — new tokens, new latency, possibly
a different answer — so every failure is caught, recorded on the plugin, and told to the
person who asked. The same reasoning as `plugins/delivery.py`: an app that misbehaves
degrades itself and nothing else.

No transaction is ever open across the HTTP call. The session that reads the history is
closed before the agent is contacted, and each message the agent produces commits on its
own, so a failure on the third answer cannot roll back the first two.

This module is the dispatcher: claim the message, decide whose authority the run is on
and which agents it reached, and run each of them. `agui_admission.py` holds the
deciding, `agui_outcome.py` one agent's run from start to what it left behind, and
`agui_stream.py` the live card and the Stop button.
"""

from __future__ import annotations

import asyncio
import logging
from functools import partial

from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.redis import redis
from ..plugins import agui, decisions
from ..plugins.streams import Listener, stream_run
from ..realtime import hub
from ..services import agent_access, agent_chains
from ..services import agent_runs as agent_run_service
from ..services import messages as message_service
from ..services import policies as policy_service
from ..services.serialize import message_event
from ..services.workspace_settings import parse as parse_settings
from .agui_admission import listeners_for, personal_agent_for
from .agui_outcome import refuse, run_one

log = logging.getLogger("blob.jobs.agui")


async def _claim(message_id: str) -> bool:
    """Best-effort lease so a duplicate enqueue does not pay for the same run twice.

    The unique index on `client_msg_id` is what actually prevents duplicate rows. This
    only saves tokens, so failing open is correct: if Redis is unavailable the run
    still happens and still cannot double-post.
    """
    try:
        claimed = await redis.set(f"agui:run:{message_id}", "1", nx=True, ex=300)
        return bool(claimed)
    except Exception:
        log.warning("could not take the agui run lease", exc_info=True)
        return True


async def handle_agui_run(message_id: str, parent_run_id: str | None = None) -> None:
    try:
        await _run(message_id, parent_run_id)
    except Exception:
        # Nothing above this catches, and an arq retry would re-run the agent.
        log.warning("agui run failed for %s", message_id, exc_info=True)


async def expire_agent_decisions() -> int:
    """Decisions nobody made in time: mark the runs, take the buttons off their cards."""
    async with transaction() as (session, after):
        expired = await agent_run_service.expire_waiting(session)
        for row in expired:
            channel_id = row["channel_id"]
            if row["decision_message_id"]:
                stored = row["interrupt"] if isinstance(row["interrupt"], dict) else {}
                decision = agui.decision_of(stored.get("items"))
                settled = await message_service.replace_blocks(
                    session, row["decision_message_id"], decisions.expired_blocks(decision)
                )
                if settled is not None:
                    after.add(
                        partial(
                            hub.to_channel, channel_id, message_event("message.updated", settled)
                        )
                    )
            after.add(
                partial(
                    hub.to_channel,
                    channel_id,
                    {
                        "t": "agent_run.finished",
                        "runId": row["id"],
                        "channelId": channel_id,
                        "status": "expired",
                        "error": None,
                        "postCount": 0,
                    },
                )
            )
    return len(expired)


async def _run(message_id: str, parent_run_id: str | None = None) -> None:
    if not await _claim(message_id):
        return

    agents_enabled = True
    async with session_scope() as session:
        trigger = (
            await session.execute(
                text(
                    """
                    SELECT id, workspace_id, channel_id, author_id, kind, plugin_id,
                           client_msg_id, thread_root_id, mention_user_ids, deleted_at
                      FROM messages WHERE id = :id
                    """
                ),
                {"id": message_id},
            )
        ).first()
        if not trigger or trigger.deleted_at or trigger.kind == "system":
            return

        # Who is asking, and on whose authority. A person's message roots a chain; an
        # agent's reply may extend one by a hop, on the person's authority; a person's
        # answer to a decision resumes the run that asked. Anything else — above all a
        # bot's message with no parent run, which is how the bot API posts — starts
        # nothing: there is no person behind it to run on the authority of. ADR 0013.
        chain: agent_chains.Chain | None
        resume_bot: str | None = None
        if trigger.kind == "user" and parent_run_id is None:
            chain = agent_chains.root(trigger)
        elif trigger.kind == "user" and parent_run_id is not None:
            resumed = await agent_chains.resume_of(
                session, parent_run_id=parent_run_id, trigger=trigger
            )
            if resumed is None:
                return
            chain, resume_bot = resumed
        elif trigger.kind == "bot" and parent_run_id is not None:
            chain = await agent_chains.child_of(
                session, parent_run_id=parent_run_id, trigger=trigger
            )
            if chain is None:
                return
        else:
            return

        # A resume runs the one agent that asked, whatever else the answer mentions.
        mentioned = [resume_bot] if resume_bot else list(trigger.mention_user_ids or [])
        listeners = (
            await listeners_for(
                session, workspace_id=trigger.workspace_id, mention_user_ids=mentioned
            )
            if mentioned
            else []
        )

        # A DM with the built-in agent is addressed by the room rather than by a mention:
        # there is nobody else in it, so making people type `@Blob` at a wall would be
        # ceremony. Slack's own assistant works this way and so does every DM anyone has
        # ever sent, which is the point — this is the Slack reflex, not a new one.
        #
        # Only for a person's own message. An agent's reply in a two-member room is never
        # a trigger here, which is what keeps two built-in agents from talking to each
        # other for ever in a DM that happens to hold them both.
        if chain.is_root:
            personal = await personal_agent_for(
                session, workspace_id=trigger.workspace_id, channel_id=trigger.channel_id
            )
            if personal and all(known.plugin_id != personal.plugin_id for known in listeners):
                # Deduped because mentioning it *inside* its own DM is a thing people do
                # out of habit, and it must not answer twice for one message.
                listeners = [*listeners, personal]

        if not listeners:
            return

        # Whose agent is it? An agent with no owner is the workspace's and answers anyone;
        # an owned one answers its owner and whoever they have lent it to. Asked of the
        # person the chain runs on — at a hop that is the person at the root, not the
        # agent whose reply did the mentioning, so an agent everyone can talk to does not
        # become a way to command one only its owner may.
        #
        # A refusal is silence, deliberately. Telling the room "that is not your agent"
        # would make an owned agent's existence, and its owner, discoverable by anyone who
        # guessed a name — and the mention itself is already visible to everybody, so the
        # person who tried can see perfectly well that nothing happened.
        allowed_bots = await agent_access.commandable_by(
            session,
            workspace_id=trigger.workspace_id,
            actor_id=chain.initiated_by_user_id,
            channel_id=trigger.channel_id,
            bot_user_ids=[known.bot_user_id for known in listeners],
        )
        for known in [k for k in listeners if k.bot_user_id not in allowed_bots]:
            log.info(
                "agui: %s may not command agent %s in %s",
                chain.initiated_by_user_id,
                known.plugin_id,
                trigger.channel_id,
            )
        listeners = [known for known in listeners if known.bot_user_id in allowed_bots]
        if not listeners:
            return

        policy = await policy_service.effective_for(session, trigger.workspace_id)
        max_depth = policy.agent_chain_max_depth
        if chain.depth > 0:
            admitted = await agent_chains.admit(
                session,
                chain,
                candidates=[(known.plugin_id, known.bot_user_id) for known in listeners],
                max_depth=max_depth,
            )
            listeners = [known for known in listeners if known.bot_user_id in admitted]
            if not listeners:
                return

        rows = (
            await session.execute(
                text("SELECT id, display_name FROM users WHERE id = ANY(cast(:ids AS uuid[]))"),
                {"ids": [trigger.author_id, chain.initiated_by_user_id]},
            )
        ).fetchall()
        display = {str(row.id): row.display_name for row in rows}
        asker = display.get(str(trigger.author_id)) or "someone"
        on_behalf_of = display.get(chain.initiated_by_user_id) if chain.depth > 0 else None
        channel_name = (
            await session.execute(
                text("SELECT name FROM channels WHERE id = :id"), {"id": trigger.channel_id}
            )
        ).scalar_one_or_none()

        settings_row = (
            await session.execute(
                text("SELECT settings FROM workspace_settings WHERE workspace_id = :ws"),
                {"ws": trigger.workspace_id},
            )
        ).fetchone()
        agents_enabled = parse_settings(
            settings_row.settings if settings_row else None
        ).agents_enabled

    if not agents_enabled:
        # The kill switch is workspace-wide: every mentioned agent is refused, none is
        # called, and the run log is how "I mentioned it and nothing happened" is answered.
        async with transaction() as (session, after):
            for known in listeners:
                await refuse(
                    session,
                    after,
                    known,
                    workspace_id=trigger.workspace_id,
                    channel_id=trigger.channel_id,
                    thread_root_id=trigger.thread_root_id,
                    trigger_id=trigger.id,
                    trigger_user_id=trigger.author_id,
                    reason="Agents are turned off for this server.",
                )
        return

    # Concurrent, not sequential: with a 120-second ceiling per run, a message that
    # mentions three agents used to answer in worst-case six minutes, and one hung
    # agent delayed every other agent's reply to the same message. `_run_one` already
    # contains each failure — an exception there posts the apology and returns.
    await asyncio.gather(
        *(
            run_one(
                listener,
                workspace_id=trigger.workspace_id,
                channel_id=trigger.channel_id,
                thread_root_id=trigger.thread_root_id,
                trigger_id=trigger.id,
                trigger_user_id=trigger.author_id,
                asker=asker,
                channel_name=channel_name or "a conversation",
                chain=chain,
                max_depth=max_depth,
                on_behalf_of=on_behalf_of,
            )
            for listener in listeners
        ),
        return_exceptions=True,
    )


__all__ = ["Listener", "expire_agent_decisions", "handle_agui_run", "listeners_for", "stream_run"]
