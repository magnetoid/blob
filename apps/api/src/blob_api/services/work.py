"""Work channels: a conversation becomes a place to build something, with agents in it.

A thread is where a piece of work gets decided and a poor place for the work itself: an
agent asked to build something answers at length, its diffs scroll past, a preview has
nowhere to live, and the people who should review it are reading #general. Starting work
from a message spins a private channel for that one assignment, carries the message and a
link to it forward, brings the named agents along, and gives the team tabs beside the
conversation for what the agents make — the plan, the changes, a preview.

Three rules shape it:

- **It is an ordinary private channel with a record attached.** Everything a channel can
  do — threads, mentions, Stop, `/allow`, archiving, search — works unchanged, and the
  `work_items` row is what makes the client draw the tabs. No fifth channel kind.
- **The agents come on the starter's authority.** An agent that only its owner may command
  cannot be brought into somebody else's work channel, for the same reason a hop cannot
  reach it ([[0013]]). The kickoff message that mentions them is the starter's own, so the
  chain it roots is theirs.
- **Artifacts are data.** A diff is text drawn with colours; a page is text shown in a
  sandboxed frame only after a person asks for it; a document is markdown rendered by the
  same renderer messages use. Nothing an agent publishes is executed by Blob ([[0007]]).

Finishing the assignment archives its channel — the history stays searchable, and the
channel list stays a list of things still happening.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request, conflict, forbidden, not_found
from ..lib.ids import new_id
from ..schemas.base import CamelModel, require_iso
from . import channels as channel_service
from . import messages as message_service

ArtifactKind = Literal["diff", "html", "markdown"]
ARTIFACT_KINDS: tuple[str, ...] = ("diff", "html", "markdown")

TITLE_MAX = 200
#: An artifact is something to review, not a repository.
ARTIFACT_BODY_MAX = 200_000
#: How much of the starting message the work channel quotes back.
EXCERPT_MAX = 600

_SLUG = re.compile(r"[^a-z0-9]+")


class Work(CamelModel):
    id: str
    channel_id: str
    root_message_id: str | None = None
    root_channel_id: str | None = None
    title: str
    status: str
    created_by: str | None = None
    created_at: str
    done_by: str | None = None
    done_at: str | None = None
    artifact_count: int = 0


class Artifact(CamelModel):
    id: str
    work_id: str
    run_id: str | None = None
    kind: str
    title: str
    body: str
    author_user_id: str | None = None
    created_at: str


@dataclass(slots=True)
class Started:
    work: Work
    channel_id: str
    #: Everyone in the new channel, for the `channel.created` fan-out.
    member_ids: list[str]


_WORK_SELECT = """
    SELECT w.id, w.channel_id, w.root_message_id, w.root_channel_id, w.title, w.status,
           w.created_by, w.created_at, w.done_by, w.done_at,
           (SELECT count(*) FROM work_artifacts a WHERE a.work_id = w.id) AS artifact_count
      FROM work_items w
"""


def _work(row: Any) -> Work:
    return Work(
        id=str(row.id),
        channel_id=str(row.channel_id),
        root_message_id=str(row.root_message_id) if row.root_message_id else None,
        root_channel_id=str(row.root_channel_id) if row.root_channel_id else None,
        title=row.title,
        status=row.status,
        created_by=str(row.created_by) if row.created_by else None,
        created_at=require_iso(row.created_at),
        done_by=str(row.done_by) if row.done_by else None,
        done_at=require_iso(row.done_at) if row.done_at else None,
        artifact_count=int(row.artifact_count or 0),
    )


def _artifact(row: Any) -> Artifact:
    return Artifact(
        id=str(row.id),
        work_id=str(row.work_id),
        run_id=str(row.run_id) if row.run_id else None,
        kind=row.kind,
        title=row.title,
        body=row.body,
        author_user_id=str(row.author_user_id) if row.author_user_id else None,
        created_at=require_iso(row.created_at),
    )


async def by_channel(session: AsyncSession, channel_id: str) -> Work | None:
    row = (
        await session.execute(text(_WORK_SELECT + " WHERE w.channel_id = :c"), {"c": channel_id})
    ).fetchone()
    return None if row is None else _work(row)


async def get(session: AsyncSession, work_id: str, workspace_id: str) -> Work:
    row = (
        await session.execute(
            text(_WORK_SELECT + " WHERE w.id = :id AND w.workspace_id = :ws"),
            {"id": work_id, "ws": workspace_id},
        )
    ).fetchone()
    if row is None:
        raise not_found("There is no work by that id.")
    return _work(row)


async def artifacts(session: AsyncSession, work_id: str) -> list[Artifact]:
    rows = (
        await session.execute(
            text(
                """
                SELECT id, work_id, run_id, kind, title, body, author_user_id, created_at
                  FROM work_artifacts WHERE work_id = :w ORDER BY created_at, id
                """
            ),
            {"w": work_id},
        )
    ).fetchall()
    return [_artifact(row) for row in rows]


async def start(
    session: AsyncSession,
    after: Any,
    *,
    workspace_id: str,
    user_id: str,
    root_message_id: str,
    title: str,
    agent_plugin_ids: list[str],
    public_url: str,
) -> Started:
    """Spin a channel for the assignment, seed it with where it came from, bring the agents.

    Four writes, all in the caller's transaction: the channel, the work row, two messages
    in the new channel (the quoted origin, then the kickoff that mentions the agents), and
    a link back in the source thread. The kickoff goes through `announce`, so mentioning
    the agents roots a chain on the starter's authority exactly as a typed message would.
    """
    title = title.strip()
    if not title:
        raise bad_request("Give the work a title.")
    if len(title) > TITLE_MAX:
        raise bad_request(f"A title is at most {TITLE_MAX} characters.")

    root = await message_service.by_id(session, root_message_id)
    if root is None or root.deleted_at:
        raise not_found("That message is gone.")
    # Starting from a message you can see, in a channel you are in.
    await channel_service.assert_channel_access(
        session, user_id, root.channel_id, require_member=True
    )
    source = (
        await session.execute(
            text("SELECT name, kind FROM channels WHERE id = :id AND workspace_id = :ws"),
            {"id": root.channel_id, "ws": workspace_id},
        )
    ).fetchone()
    if source is None:
        raise not_found("That message is gone.")

    bots = await _bots_for(session, workspace_id, user_id, agent_plugin_ids)

    members = [user_id]
    if root.author_id and root.author_id != user_id:
        author = (
            await session.execute(
                text(
                    "SELECT kind FROM users WHERE id = :id AND workspace_id = :ws "
                    "AND deactivated_at IS NULL"
                ),
                {"id": root.author_id, "ws": workspace_id},
            )
        ).fetchone()
        if author is not None and author.kind == "human":
            members.append(root.author_id)
    members.extend(bot["bot_user_id"] for bot in bots)

    name = await _free_name(
        session, workspace_id, f"work-{_SLUG.sub('-', title.lower()).strip('-')[:40]}"
    )
    channel_id = await channel_service.create_channel(
        session,
        workspace_id=workspace_id,
        created_by=user_id,
        name=name,
        kind="private",
        topic=title[:250],
        extra_member_ids=members[1:],
    )

    work_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO work_items
              (id, workspace_id, channel_id, root_message_id, root_channel_id, title, created_by)
            VALUES (:id, :ws, :channel, :root, :root_channel, :title, :by)
            """
        ),
        {
            "id": work_id,
            "ws": workspace_id,
            "channel": channel_id,
            "root": root_message_id,
            "root_channel": root.channel_id,
            "title": title,
            "by": user_id,
        },
    )

    # Where it came from, quoted, so the channel reads on its own.
    source_label = f"#{source.name}" if source.name else "a direct message"
    excerpt = root.body if len(root.body) <= EXCERPT_MAX else root.body[:EXCERPT_MAX] + "…"
    quoted = "\n".join(f"> {line}" for line in excerpt.splitlines()) or "> (an attachment)"
    origin = await message_service.send(
        session,
        workspace_id=workspace_id,
        channel_id=channel_id,
        author_id=user_id,
        body=f"Started from {source_label}:\n\n{quoted}\n\n{public_url}/m/{root_message_id}",
        client_msg_id=f"work:{work_id}:origin",
    )
    await message_service.announce(
        session, after, origin, workspace_id=workspace_id, channel_id=channel_id
    )

    if bots:
        # The kickoff. A person's message mentioning the agents, which roots a chain on
        # their authority — the same thing typing it would do.
        mentions = " ".join(f"@{bot['name']}" for bot in bots)
        kickoff = await message_service.send(
            session,
            workspace_id=workspace_id,
            channel_id=channel_id,
            author_id=user_id,
            body=f"{mentions} {title}",
            client_msg_id=f"work:{work_id}:kickoff",
        )
        await message_service.announce(
            session, after, kickoff, workspace_id=workspace_id, channel_id=channel_id
        )

    # And a way forward from where it started, in the thread under that message.
    link = await message_service.send(
        session,
        workspace_id=workspace_id,
        channel_id=root.channel_id,
        author_id=user_id,
        body=f"Started work on this in #{name}: {public_url}/c/{channel_id}",
        client_msg_id=f"work:{work_id}:link",
        thread_root_id=root.thread_root_id or root_message_id,
    )
    await message_service.announce(
        session, after, link, workspace_id=workspace_id, channel_id=root.channel_id
    )

    work = await get(session, work_id, workspace_id)
    return Started(work=work, channel_id=channel_id, member_ids=members)


async def publish(
    session: AsyncSession,
    *,
    work_id: str,
    kind: str,
    title: str,
    body: str,
    author_user_id: str | None,
    run_id: str | None = None,
) -> Artifact:
    """Put something made into the work. Validated here, whoever made it."""
    if kind not in ARTIFACT_KINDS:
        raise bad_request(f"An artifact is one of {', '.join(ARTIFACT_KINDS)}.", code="bad_kind")
    title = title.strip()
    if not title or len(title) > TITLE_MAX:
        raise bad_request(f"An artifact needs a title of at most {TITLE_MAX} characters.")
    if not body.strip():
        raise bad_request("An artifact needs a body.")
    if len(body.encode("utf-8")) > ARTIFACT_BODY_MAX:
        raise bad_request("An artifact is at most 200 KiB.", code="too_large")
    status = (
        await session.execute(text("SELECT status FROM work_items WHERE id = :id"), {"id": work_id})
    ).scalar_one_or_none()
    if status is None:
        raise not_found("There is no work by that id.")
    if status != "open":
        raise conflict("That work is done; nothing more can be published into it.", "work_done")

    artifact_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO work_artifacts (id, work_id, run_id, kind, title, body, author_user_id)
            VALUES (:id, :w, cast(:run AS uuid), :kind, :title, :body, cast(:author AS uuid))
            """
        ),
        {
            "id": artifact_id,
            "w": work_id,
            "run": run_id,
            "kind": kind,
            "title": title,
            "body": body,
            "author": author_user_id,
        },
    )
    row = (
        await session.execute(
            text(
                "SELECT id, work_id, run_id, kind, title, body, author_user_id, created_at "
                "FROM work_artifacts WHERE id = :id"
            ),
            {"id": artifact_id},
        )
    ).fetchone()
    return _artifact(row)


async def finish(
    session: AsyncSession, *, work_id: str, workspace_id: str, user_id: str, is_admin: bool
) -> Work:
    """Mark the assignment done and archive its channel.

    The person who started it or an admin. Archiving is otherwise admin-only, and stays
    so for ordinary channels; a work channel is the starter's to close because it was the
    starter's to open.
    """
    work = await get(session, work_id, workspace_id)
    if work.status != "open":
        raise conflict("That work is already done.", "work_done")
    if work.created_by != user_id and not is_admin:
        raise forbidden("Only the person who started this, or an admin, can finish it.")
    await session.execute(
        text(
            """
            UPDATE work_items SET status = 'done', done_by = :by, done_at = now()
             WHERE id = :id
            """
        ),
        {"id": work_id, "by": user_id},
    )
    await session.execute(
        text("UPDATE channels SET archived_at = COALESCE(archived_at, now()) WHERE id = :id"),
        {"id": work.channel_id},
    )
    return await get(session, work_id, workspace_id)


async def _bots_for(
    session: AsyncSession, workspace_id: str, user_id: str, plugin_ids: list[str]
) -> list[dict[str, str]]:
    """The agents to bring, as (plugin, bot user, name). Refuses one the starter may not command.

    Unowned agents are everybody's; an owned one comes only if it is the starter's. That is
    the rule a hop follows ([[0013]]), applied at the moment the channel is made — the
    alternative, letting anyone put anyone's agent into a room and then having every
    mention of it refused silently, would be a channel that looks staffed and is not.
    """
    if not plugin_ids:
        return []
    rows = (
        await session.execute(
            text(
                """
                SELECT p.id, p.owner_user_id, u.id AS bot_user_id, u.display_name
                  FROM plugins p JOIN users u ON u.bot_plugin_id = p.id
                 WHERE p.workspace_id = :ws AND p.status = 'enabled'
                   AND p.id = ANY(cast(:ids AS uuid[]))
                   AND u.deactivated_at IS NULL
                """
            ),
            {"ws": workspace_id, "ids": plugin_ids},
        )
    ).fetchall()
    found = {str(row.id): row for row in rows}
    missing = [pid for pid in plugin_ids if pid not in found]
    if missing:
        raise not_found("One of those agents is not installed here.")
    bots: list[dict[str, str]] = []
    for pid in plugin_ids:
        row = found[pid]
        if row.owner_user_id is not None and str(row.owner_user_id) != user_id:
            raise forbidden(f"{row.display_name} is not yours to bring.")
        bots.append(
            {"plugin_id": pid, "bot_user_id": str(row.bot_user_id), "name": row.display_name}
        )
    return bots


async def _free_name(session: AsyncSession, workspace_id: str, base: str) -> str:
    base = base if len(base) >= 6 else "work-item"
    taken = {
        str(r.name)
        for r in (
            await session.execute(
                text("SELECT name FROM channels WHERE workspace_id = :ws AND name LIKE :like"),
                {"ws": workspace_id, "like": f"{base}%"},
            )
        ).fetchall()
    }
    if base not in taken:
        return base
    for n in range(2, 200):
        candidate = f"{base}-{n}"
        if candidate not in taken:
            return candidate
    raise conflict("Too many work channels share that name.", "channel_exists")


__all__ = [
    "ARTIFACT_BODY_MAX",
    "ARTIFACT_KINDS",
    "Artifact",
    "Started",
    "Work",
    "artifacts",
    "by_channel",
    "finish",
    "get",
    "publish",
    "start",
]
