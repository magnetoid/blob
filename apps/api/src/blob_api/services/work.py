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

**A lifecycle, since M2 · A10.** Publishing an artifact whose title and kind the work
already has makes its next version, whoever publishes it — a person, an app, an agent's
`blob.artifact` event — so an agent iterating on a change needs nothing new from AG-UI.
Each artifact can be discussed in a thread of the work channel, shared by its versions,
and each version can be approved or sent back with a note; sending back an agent's work
mentions the agent in that thread, on the reviewer's authority, so the next version is a
message away. Finishing posts what was made and what was approved, in the work channel
and back where the work started.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request, conflict, forbidden, message_gone, not_found
from ..lib.ids import new_id
from ..plugins.registry import MENTIONABLE_AGENT
from ..schemas.base import CamelModel, require_iso
from . import agent_access
from . import channels as channel_service
from . import messages as message_service

ArtifactKind = Literal["diff", "html", "markdown"]
ARTIFACT_KINDS: tuple[str, ...] = ("diff", "html", "markdown")

TITLE_MAX = 200
#: An artifact is something to review, not a repository.
ARTIFACT_BODY_MAX = 200_000
NOTE_MAX = 2_000
Verdict = Literal["approved", "changes"]
#: What an artifact is called where people read about it.
KIND_WORDS = {"diff": "change", "html": "page", "markdown": "document"}
#: How much of the starting message the work channel quotes back.
EXCERPT_MAX = 600

_SLUG = re.compile(r"[^a-z0-9]+")


class Work(CamelModel):
    id: str
    channel_id: str
    root_message_id: str | None = None
    root_channel_id: str | None = None
    title: str
    #: Open until somebody closes it; there is no third state, and the client renders
    #: the tabs from this.
    status: Literal["open", "done"]
    created_by: str | None = None
    created_at: str
    done_by: str | None = None
    done_at: str | None = None
    artifact_count: int = 0


def work_event(work: Work) -> dict[str, Any]:
    """`work.updated`: the record changed — an artifact landed, or it finished. One
    builder for the three places that say so: a person's request, an app's call and an
    agent's run."""
    return {
        "t": "work.updated",
        "workId": work.id,
        "channelId": work.channel_id,
        "status": work.status,
        "artifactCount": work.artifact_count,
    }


class Review(CamelModel):
    user_id: str
    verdict: Verdict
    note: str | None = None
    at: str


class Artifact(CamelModel):
    id: str
    work_id: str
    run_id: str | None = None
    kind: str
    title: str
    body: str
    author_user_id: str | None = None
    created_at: str
    #: 1, then one more each time the same title and kind is published again.
    version: int = 1
    supersedes_id: str | None = None
    #: The message whose thread discusses it — shared by all its versions — once somebody
    #: has started one.
    review_root_id: str | None = None
    #: Verdicts on this version, newest first.
    reviews: list[Review] = []


@dataclass(slots=True)
class Started:
    work: Work
    channel_id: str
    #: Everyone in the new channel, for the `channel.created` fan-out.
    member_ids: list[str]


#: Artifacts, not versions: a change published three times is one thing to look at.
_WORK_SELECT = """
    SELECT w.id, w.channel_id, w.root_message_id, w.root_channel_id, w.title, w.status,
           w.created_by, w.created_at, w.done_by, w.done_at,
           (SELECT count(DISTINCT (a.kind, lower(a.title)))
              FROM work_artifacts a WHERE a.work_id = w.id) AS artifact_count
      FROM work_items w
"""
_ARTIFACT_COLUMNS = """
    id, work_id, run_id, kind, title, body, author_user_id, created_at, version,
    supersedes_id, review_root_id
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


def _artifact(row: Any, reviews: list[Review] | None = None) -> Artifact:
    return Artifact(
        id=str(row.id),
        work_id=str(row.work_id),
        run_id=str(row.run_id) if row.run_id else None,
        kind=row.kind,
        title=row.title,
        body=row.body,
        author_user_id=str(row.author_user_id) if row.author_user_id else None,
        created_at=require_iso(row.created_at),
        version=int(row.version),
        supersedes_id=str(row.supersedes_id) if row.supersedes_id else None,
        review_root_id=str(row.review_root_id) if row.review_root_id else None,
        reviews=reviews or [],
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
    """Every version of everything published, oldest first, each with its verdicts."""
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {_ARTIFACT_COLUMNS}
                  FROM work_artifacts WHERE work_id = :w ORDER BY created_at, id
                """
            ),
            {"w": work_id},
        )
    ).fetchall()
    verdicts = (
        await session.execute(
            text(
                """
                SELECT r.artifact_id, r.user_id, r.verdict, r.note, r.updated_at
                  FROM work_reviews r
                  JOIN work_artifacts a ON a.id = r.artifact_id
                 WHERE a.work_id = :w
                 ORDER BY r.updated_at DESC
                """
            ),
            {"w": work_id},
        )
    ).fetchall()
    by_artifact: dict[str, list[Review]] = {}
    for verdict in verdicts:
        by_artifact.setdefault(str(verdict.artifact_id), []).append(
            Review(
                user_id=str(verdict.user_id),
                verdict=verdict.verdict,
                note=verdict.note,
                at=require_iso(verdict.updated_at),
            )
        )
    return [_artifact(row, by_artifact.get(str(row.id))) for row in rows]


async def _artifact_in(session: AsyncSession, work_id: str, artifact_id: str) -> Any:
    row = (
        await session.execute(
            text(
                f"""
                SELECT {_ARTIFACT_COLUMNS}
                  FROM work_artifacts WHERE id = :id AND work_id = :w
                """
            ),
            {"id": artifact_id, "w": work_id},
        )
    ).fetchone()
    if row is None:
        raise not_found("There is no artifact by that id in this work.")
    return row


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
        raise message_gone()
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
        raise message_gone()

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
    after: Any,
    *,
    workspace_id: str,
    work_id: str,
    kind: str,
    title: str,
    body: str,
    author_user_id: str | None,
    run_id: str | None = None,
    author_plugin_id: str | None = None,
) -> Artifact:
    """Put something made into the work. Validated here, whoever made it.

    `author_plugin_id` says the author is an agent or an app — its bot — so what Blob
    posts in its name is posted as the bot's (`kind="bot"`) and sets nothing going: a
    bot's own words never start a run, and a version announced in a followed work channel
    must not either.

    The same title and kind as something already published makes its next version: the
    work row is locked first so two publishes cannot both be "v2". When its thread has
    been started, the author says so there, so the people reviewing it see it arrive.
    """
    if kind not in ARTIFACT_KINDS:
        raise bad_request(f"An artifact is one of {', '.join(ARTIFACT_KINDS)}.", code="bad_kind")
    title = title.strip()
    if not title or len(title) > TITLE_MAX:
        raise bad_request(f"An artifact needs a title of at most {TITLE_MAX} characters.")
    if not body.strip():
        raise bad_request("An artifact needs a body.")
    if len(body.encode("utf-8")) > ARTIFACT_BODY_MAX:
        raise bad_request("An artifact is at most 200 KiB.", code="too_large")
    work = (
        await session.execute(
            text("SELECT status, channel_id FROM work_items WHERE id = :id FOR UPDATE"),
            {"id": work_id},
        )
    ).fetchone()
    if work is None:
        raise not_found("There is no work by that id.")
    if work.status != "open":
        raise conflict("That work is done; nothing more can be published into it.", "work_done")

    latest = (
        await session.execute(
            text(
                """
                SELECT id, version, review_root_id FROM work_artifacts
                 WHERE work_id = :w AND kind = :kind AND lower(title) = lower(:title)
                 ORDER BY version DESC LIMIT 1
                """
            ),
            {"w": work_id, "kind": kind, "title": title},
        )
    ).fetchone()
    artifact_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO work_artifacts
                   (id, work_id, run_id, kind, title, body, author_user_id, version,
                    supersedes_id, review_root_id)
            VALUES (:id, :w, cast(:run AS uuid), :kind, :title, :body, cast(:author AS uuid),
                    :version, cast(:supersedes AS uuid), cast(:thread AS uuid))
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
            "version": int(latest.version) + 1 if latest else 1,
            "supersedes": str(latest.id) if latest else None,
            "thread": str(latest.review_root_id) if latest and latest.review_root_id else None,
        },
    )
    artifact = _artifact(await _artifact_in(session, work_id, artifact_id))
    if artifact.review_root_id and author_user_id:
        await _post(
            session,
            after,
            workspace_id=workspace_id,
            channel_id=str(work.channel_id),
            author_id=author_user_id,
            body=f"Published v{artifact.version} of **{_plain(artifact.title)}**.",
            key=f"work-artifact:{artifact.id}:published",
            thread_root_id=artifact.review_root_id,
            as_plugin=author_plugin_id,
        )
    return artifact


def _plain(title: str) -> str:
    """A title inside a sentence Blob writes: on one line, with no markdown of its own."""
    return " ".join(title.replace("*", "").replace("`", "").split())


async def _post(
    session: AsyncSession,
    after: Any,
    *,
    workspace_id: str,
    channel_id: str,
    author_id: str,
    body: str,
    key: str,
    thread_root_id: str | None = None,
    mention_user_ids: list[str] | None = None,
    as_plugin: str | None = None,
) -> str:
    """A message Blob composes for somebody — mentioning exactly whom it says, and nobody a
    title or a note happens to name. `as_plugin` is a bot author's plugin: the message is
    then the bot's, as `post_as_bot` would post it, and starts no run (ADR 0013)."""
    result = await message_service.send(
        session,
        workspace_id=workspace_id,
        channel_id=channel_id,
        author_id=author_id,
        body=body,
        client_msg_id=key,
        thread_root_id=thread_root_id,
        mention_user_ids=mention_user_ids or [],
        kind="bot" if as_plugin else "user",
        plugin_id=as_plugin,
    )
    await message_service.announce(
        session,
        after,
        result,
        workspace_id=workspace_id,
        channel_id=channel_id,
        start_agent_runs=as_plugin is None,
    )
    return str(result.message.id)


async def discuss(
    session: AsyncSession,
    after: Any,
    *,
    work: Work,
    artifact_id: str,
    user_id: str,
    workspace_id: str,
) -> str:
    """The thread an artifact is discussed in, started by the first person to ask for it:
    a message of theirs in the work channel naming it, shared by every version."""
    row = await _artifact_in(session, work.id, artifact_id)
    if row.review_root_id:
        return str(row.review_root_id)
    word = KIND_WORDS.get(row.kind, "artifact")
    root_id = await _post(
        session,
        after,
        workspace_id=workspace_id,
        channel_id=work.channel_id,
        author_id=user_id,
        body=f"Discussing the {word} **{_plain(row.title)}** (v{row.version}).",
        key=f"work-artifact:{artifact_id}:discussion",
    )
    await session.execute(
        text(
            """
            UPDATE work_artifacts SET review_root_id = :root
             WHERE work_id = :w AND kind = :kind AND lower(title) = lower(:title)
               AND review_root_id IS NULL
            """
        ),
        {"root": root_id, "w": work.id, "kind": row.kind, "title": row.title},
    )
    return root_id


async def review(
    session: AsyncSession,
    after: Any,
    *,
    work: Work,
    artifact_id: str,
    user_id: str,
    workspace_id: str,
    verdict: str,
    note: str | None,
) -> Artifact:
    """A person's verdict on one version, said in its thread. Sending back an agent's work
    mentions the agent there — on the reviewer's authority, the way any message of theirs
    would — so it can publish the next version; sending back a person's work mentions
    them. An approval reaches a person, and never sets an agent going."""
    if verdict not in ("approved", "changes"):
        raise bad_request("A verdict is approved or changes.", code="invalid_input")
    note = (note or "").strip() or None
    if verdict == "changes" and not note:
        raise bad_request("Say what should change.", code="invalid_input")
    if note and len(note) > NOTE_MAX:
        raise bad_request(f"A note is at most {NOTE_MAX} characters.", code="invalid_input")
    if work.status != "open":
        raise conflict("That work is done.", "work_done")
    row = await _artifact_in(session, work.id, artifact_id)
    await session.execute(
        text(
            """
            INSERT INTO work_reviews (id, artifact_id, user_id, verdict, note)
            VALUES (:id, :a, :u, :verdict, :note)
            ON CONFLICT (artifact_id, user_id) DO UPDATE
               SET verdict = EXCLUDED.verdict, note = EXCLUDED.note, updated_at = now()
            """
        ),
        {"id": new_id(), "a": artifact_id, "u": user_id, "verdict": verdict, "note": note},
    )
    thread = await discuss(
        session,
        after,
        work=work,
        artifact_id=artifact_id,
        user_id=user_id,
        workspace_id=workspace_id,
    )
    author = None
    if row.author_user_id and str(row.author_user_id) != user_id:
        author = (
            await session.execute(
                text("SELECT id, kind, display_name FROM users WHERE id = :id"),
                {"id": row.author_user_id},
            )
        ).fetchone()
    reach: list[str] = []
    address = ""
    if author is not None and (verdict == "changes" or author.kind == "human"):
        reach = [str(author.id)]
        address = f"@{author.display_name} — "
    said = (
        f"Approved v{row.version}."
        if verdict == "approved"
        else f"Changes requested on v{row.version}:"
    )
    body = f"{address}{said}" + (f"\n\n{note}" if note else "")
    await _post(
        session,
        after,
        workspace_id=workspace_id,
        channel_id=work.channel_id,
        author_id=user_id,
        body=body,
        key=f"work-review:{artifact_id}:{new_id()}",
        thread_root_id=thread,
        mention_user_ids=reach,
    )
    return next(item for item in await artifacts(session, work.id) if item.id == artifact_id)


def closing_summary(found: list[Artifact]) -> str:
    """What the work made and where review left it, in a sentence or three."""
    latest: dict[tuple[str, str], Artifact] = {}
    for artifact in found:
        key = (artifact.kind, artifact.title.lower())
        if key not in latest or artifact.version > latest[key].version:
            latest[key] = artifact
    if not latest:
        return "Nothing was published."
    counts: dict[str, int] = {}
    for artifact in latest.values():
        word = KIND_WORDS.get(artifact.kind, "artifact")
        counts[word] = counts.get(word, 0) + 1
    made = ", ".join(f"{n} {word}{'s' if n != 1 else ''}" for word, n in sorted(counts.items()))
    approved = [a for a in latest.values() if any(r.verdict == "approved" for r in a.reviews)]
    returned = [a for a in latest.values() if any(r.verdict == "changes" for r in a.reviews)]
    unreviewed = [a for a in latest.values() if not a.reviews]

    def names(items: list[Artifact]) -> str:
        return ", ".join(f"{_plain(a.title)} (v{a.version})" for a in items)

    parts = [f"{made[0].upper()}{made[1:]}."]
    if approved:
        parts.append(f"Approved: {names(approved)}.")
    if returned:
        parts.append(f"Changes still requested: {names(returned)}.")
    if unreviewed:
        parts.append(f"Not reviewed: {names(unreviewed)}.")
    return " ".join(parts)


async def finish(
    session: AsyncSession,
    after: Any,
    *,
    work_id: str,
    workspace_id: str,
    user_id: str,
    is_admin: bool,
) -> Work:
    """Mark the assignment done, say what came of it, and archive its channel.

    The person who started it or an admin. Archiving is otherwise admin-only, and stays
    so for ordinary channels; a work channel is the starter's to close because it was the
    starter's to open. The summary goes into the work channel before it closes and into
    the thread the work started from, so the people who asked for it hear how it ended.
    """
    work = await get(session, work_id, workspace_id)
    if work.status != "open":
        raise conflict("That work is already done.", "work_done")
    if work.created_by != user_id and not is_admin:
        raise forbidden("Only the person who started this, or an admin, can finish it.")
    summary = closing_summary(await artifacts(session, work_id))
    await _post(
        session,
        after,
        workspace_id=workspace_id,
        channel_id=work.channel_id,
        author_id=user_id,
        body=f"Done: **{_plain(work.title)}**. {summary}",
        key=f"work:{work_id}:done",
    )
    if work.root_message_id and work.root_channel_id:
        origin = await message_service.by_id(session, work.root_message_id)
        if origin is not None and not origin.deleted_at:
            await _post(
                session,
                after,
                workspace_id=workspace_id,
                channel_id=work.root_channel_id,
                author_id=user_id,
                body=f"Finished **{_plain(work.title)}**. {summary}",
                key=f"work:{work_id}:done-origin",
                thread_root_id=origin.thread_root_id or work.root_message_id,
            )
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
    """The agents to bring, as (plugin, bot user, name). Refuses one the starter may not
    command, or one that cannot be asked anything at all.

    Whether the starter may command it is `agent_access.MAY_COMMAND`, asked for a channel
    that does not exist yet — the rule a hop follows ([[0013]]), applied at the moment the
    channel is made, with a loan that covers everywhere counting as it will once the
    channel exists. The alternative, letting anyone put anyone's agent into a room and
    then having every mention of it refused silently, would be a channel that looks
    staffed and is not — and an agent with no way to be reached (no AG-UI address, no
    socket) is the same room by another route, so it is refused here too, as the picker
    already leaves it out.
    """
    if not plugin_ids:
        return []
    rows = (
        await session.execute(
            text(
                f"""
                SELECT p.id, u.id AS bot_user_id, u.display_name,
                       {agent_access.MAY_COMMAND} AS may_command,
                       {MENTIONABLE_AGENT} AS reachable
                  FROM plugins p JOIN users u ON u.bot_plugin_id = p.id
                 WHERE p.workspace_id = :ws AND p.status = 'enabled'
                   AND p.id = ANY(cast(:ids AS uuid[]))
                   AND u.deactivated_at IS NULL
                """
            ),
            {"ws": workspace_id, "ids": plugin_ids, "actor_id": user_id, "channel_id": None},
        )
    ).fetchall()
    found = {str(row.id): row for row in rows}
    missing = [pid for pid in plugin_ids if pid not in found]
    if missing:
        raise not_found("One of those agents is not installed here.")
    bots: list[dict[str, str]] = []
    for pid in plugin_ids:
        row = found[pid]
        if not row.may_command:
            raise forbidden(f"{row.display_name} is not yours to bring.")
        if not row.reachable:
            raise bad_request(f"{row.display_name} cannot be asked anything here.")
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
