"""The agent Blob runs itself, as an AG-UI server that never leaves the process.

Blob has spoken AG-UI since the agent work started, always as the **client** — Blob asks,
somebody else's server answers. That was the right direction and it left one thing
missing: a workspace with nothing installed had no agent at all. The plumbing was
agent-native and the product was not.

This closes it in the cheapest way the existing design allows: a fourth
runtime that *is* an AG-UI server, implemented as a coroutine yielding the same
SCREAMING_SNAKE events an external agent would send over the wire. Everything downstream
is untouched and works the first time — `Fold` seals messages the same way, the 12k split
and the ten-message cap still apply, `agent_runs` records it, the run log shows it, and
the bot posting the answer is a real `users` row exactly as every other bot is. The only
thing that changes is where the bytes come from.

**It is a plugin, not a special case.** The built-in agent installs through the same
registry, holds the same scopes, has a bot with a real display name people can mention,
and can be disabled by an admin like anything else. A built-in agent that bypassed the
permission system would be the one agent nobody could control, which is precisely
backwards for the one that ships turned on.

**No tools yet, deliberately.** `build_run_input` sends `tools: []` and says why: offering
frontend tools means Blob executing work on an agent's say-so. That reasoning holds for
this agent too — it will get tools, and they will be scoped through `plugin_grants` like
every other capability, rather than granted implicitly for being ours.
"""

from __future__ import annotations

import textwrap
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from ..lib import llm
from ..lib.ids import new_id

#: How the built-in agent is spelled in `plugins.runtime`.
RUNTIME = "builtin"

#: Slug of the workspace-wide agent. One per workspace, seeded on creation.
WORKSPACE_SLUG = "blob-agent"


@dataclass(slots=True)
class Persona:
    """Who this agent is. The one thing that differs between built-in agents.

    A workspace agent and a person's own agent run identical code down to the byte; they
    differ in name, in what they are told they are for, and — once personal agents land —
    in whose eyes they see the workspace through. Keeping that difference in data rather
    than in branches is what stops the second one being a fork of the first.
    """

    name: str
    workspace_name: str
    #: Set for a personal agent: the display name of the person it belongs to.
    owner_name: str | None = None


def system_prompt(persona: Persona, *, channel_name: str) -> str:
    """What the agent is told before it sees a word of the conversation.

    Written as house rules rather than personality. The failure modes worth spending
    instructions on are the ones that make an agent unpleasant to share a channel with:
    answering at essay length in a room where everyone else writes two lines, restating
    the question before answering it, and claiming to have done things it cannot do —
    it has no tools, so "I've filed that" is always a lie and always the first thing a
    chat model reaches for.
    """
    who = (
        f"You are {persona.name}, {persona.owner_name}'s own assistant "
        f"in the {persona.workspace_name} workspace."
        if persona.owner_name
        else f"You are {persona.name}, an assistant in the {persona.workspace_name} workspace."
    )
    return textwrap.dedent(
        f"""\
        {who} You are talking in #{channel_name}, a group chat, and you were mentioned by
        name. Everyone can see what you write.

        How to write here:
        - Be brief. Match the length of the room — usually a sentence or two. Long answers
          are for when someone asks for depth, not for every question.
        - Answer first. Do not restate the question or open with pleasantries.
        - Plain prose. Reach for a short list only when the answer really is a list, and
          never use a heading in a chat message.
        - Say "I don't know" when you don't. A guess offered confidently costs the team
          more than an admission.

        What you can and cannot do:
        - You can read the recent conversation above and answer from it and from what you
          know.
        - You cannot send messages elsewhere, create channels, edit anything, call other
          services or take any action in this workspace. You have no tools. Never say you
          have done something, filed something, scheduled something or looked something
          up — if it needs doing, say who should do it.
        - Several people are talking. Each message is prefixed with who wrote it. Your own
          earlier replies are unprefixed.
        """
    ).strip()


def turns_from(messages: Sequence[Mapping[str, Any]]) -> list[llm.Turn]:
    """AG-UI `Message[]` as model turns, with the speaker kept in the text.

    `to_agui_messages` already made the decision that matters: the listening bot is
    `assistant` and everyone else — people and other apps' bots alike — is `user` with a
    name. That is also true of the model's view, so the mapping is direct.

    The name is folded into the content rather than sent as a separate field because
    `_collapse` merges consecutive same-role turns to satisfy Anthropic's alternation
    rule, and a merged turn has nowhere to put two names. Prefixing survives the merge.
    """
    turns: list[llm.Turn] = []
    for message in messages:
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        if message.get("role") == "assistant":
            turns.append(llm.Turn(role="assistant", content=content))
        else:
            name = message.get("name")
            speaker = name if isinstance(name, str) and name else "someone"
            turns.append(llm.Turn(role="user", content=f"{speaker}: {content}"))
    return turns


def _context_value(run_input: Mapping[str, Any], description: str) -> str:
    for item in run_input.get("context") or []:
        if isinstance(item, Mapping) and item.get("description") == description:
            value = item.get("value")
            if isinstance(value, str):
                return value
    return ""


async def stream(run_input: Mapping[str, Any], persona: Persona) -> AsyncIterator[dict[str, Any]]:
    """Run the agent, yielding AG-UI events.

    The event sequence is the one an external agent would send, because the fold on the
    other side is the same fold. `RUN_ERROR` rather than a raised exception for a model
    that refuses: it is the protocol's own way to say "this run failed, here is why", and
    it lands in `agent_runs.error` through the path already built for external agents.
    """
    thread_id = str(run_input.get("threadId") or "")
    run_id = str(run_input.get("runId") or new_id())
    yield {"type": "RUN_STARTED", "threadId": thread_id, "runId": run_id}

    messages = run_input.get("messages")
    turns = turns_from(messages if isinstance(messages, list) else [])
    prompt = system_prompt(
        persona, channel_name=_context_value(run_input, "channel") or "a channel"
    )

    message_id = new_id()
    started = False
    try:
        async for delta in llm.stream_reply(system=prompt, turns=turns):
            if not delta:
                continue
            if not started:
                # Held until the first token so that a model which fails immediately
                # produces a clean RUN_ERROR rather than an empty message followed by one.
                started = True
                yield {
                    "type": "TEXT_MESSAGE_START",
                    "messageId": message_id,
                    "role": "assistant",
                }
            yield {"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": delta}
    except llm.LlmError as error:
        if started:
            # Part of an answer already exists. Seal it and report the failure alongside,
            # rather than discarding what the model did manage to say.
            yield {"type": "TEXT_MESSAGE_END", "messageId": message_id}
        yield {"type": "RUN_ERROR", "message": str(error)}
        return

    if started:
        yield {"type": "TEXT_MESSAGE_END", "messageId": message_id}
    # A model that streamed nothing at all is a finished run with no reply, which
    # `_run_one` already treats as a legitimate answer and posts nothing for.
    yield {"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id}


__all__ = ["RUNTIME", "WORKSPACE_SLUG", "Persona", "stream", "system_prompt", "turns_from"]
