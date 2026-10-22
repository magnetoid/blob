"""What a Slack import writes (ADR 0042): people, conversations, messages and what hangs
off them, and the settling a conversation needs once its history is in.

**Written, not sent.** Nothing here goes through `messages.send`, `announce` or
`notify`: a message from 2019 must not page anybody, start an agent, unfurl a link or
reach an app. So whatever `send` keeps up as a side effect is kept up here by hand, once
per conversation — a thread's counters, the channel's newest message, everybody's place.

**Twice is once.** Each message's id comes from its conversation and its Slack `ts`
(`lib/ids.id_at`), its `client_msg_id` is `slack:<conversation>:<ts>`, and every insert
skips a row that is there already, so a step that runs again — a deploy restarted the
worker halfway — writes nothing a second time.

**Placeholders.** Somebody with no account here arrives as a deactivated row marked
`placeholder`: no password, no handle, named on their old messages and nowhere else. An
invitation to their address is how they get it back (`services/signup`).
"""

from __future__ import annotations

import re
import zoneinfo
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..lib.ids import id_at, new_id
from ..lib.slack_export import SlackConversation, SlackUser
from ..lib.slack_markup import attachments_text, slack_emoji, to_markdown
from .audit import Actor
from .channels import dm_key
from .messages import FACEPILE_LIMIT, IN_CHANNEL_HISTORY, STILL_SHOWN

#: Addresses for the accounts the export gave none: reserved by RFC 2606, so nothing is
#: ever delivered to one and no invitation can be sent to it.
NO_ADDRESS_DOMAIN = "slack-import.invalid"
#: Blob's longest display name and channel name (`schemas/requests`).
MAX_NAME = 40
MAX_CHANNEL_NAME = 64
#: What Slack writes into a conversation that is not something anybody said.
SKIPPED_SUBTYPES = frozenset(
    {
        "channel_join",
        "channel_leave",
        "channel_topic",
        "channel_purpose",
        "channel_name",
        "channel_archive",
        "channel_unarchive",
        "channel_convert_to_private",
        "channel_convert_to_public",
        "channel_canvas_updated",
        "group_join",
        "group_leave",
        "group_topic",
        "group_purpose",
        "group_name",
        "group_archive",
        "group_unarchive",
        "bot_add",
        "bot_remove",
        "bot_enable",
        "bot_disable",
        "pinned_item",
        "unpinned_item",
        "reminder_add",
        "reminder_delete",
        "message_changed",
        "message_deleted",
        "message_replied",
        "joiner_notification",
        "app_conversation_join",
        "app_conversation_leave",
        "sh_room_created",
        "huddle_thread",
        "ekm_access_denied",
        "file_comment",
        "file_mention",
    }
)
#: Kept as said, a reply sent to the channel too being one.
_ALSO_IN_CHANNEL = frozenset({"thread_broadcast", "reply_broadcast"})
_CHANNEL_NAME = re.compile(r"[^a-z0-9\-_]+")


# ─── ids and times ───────────────────────────────────────────────────────────────────


def ts_parts(ts: str) -> tuple[int, int]:
    """Slack's `ts` — seconds, a dot, microseconds — as milliseconds and the rest."""
    seconds, _, fraction = ts.partition(".")
    micros = int((fraction + "000000")[:6]) if fraction.isdigit() else 0
    return int(seconds) * 1000 + micros // 1000, micros % 1000


def ts_time(ts: str) -> datetime:
    ms, rest = ts_parts(ts)
    return datetime.fromtimestamp(ms / 1000, tz=UTC).replace(microsecond=(ms % 1000) * 1000 + rest)


def message_id(workspace_id: str, conversation: str, ts: str) -> str:
    ms, rest = ts_parts(ts)
    return id_at(ms, rest, f"{workspace_id}:{conversation}:{ts}".encode())


def attachment_id(workspace_id: str, conversation: str, ts: str, file_id: str) -> str:
    ms, rest = ts_parts(ts)
    return id_at(ms, rest, f"{workspace_id}:{conversation}:{ts}:file:{file_id}".encode())


def conversation_id(workspace_id: str, conversation: SlackConversation) -> str:
    return id_at(
        max(conversation.created, 0) * 1000,
        0,
        f"{workspace_id}:conversation:{conversation.id}".encode(),
    )


def client_msg_id(conversation: str, ts: str) -> str:
    return f"slack:{conversation}:{ts}"


def no_address(slack_id: str) -> str:
    local = re.sub(r"[^a-z0-9]+", "-", slack_id.lower()).strip("-")
    return f"slack-{local}@{NO_ADDRESS_DOMAIN}"


def _timezone(value: str | None) -> str:
    if not value:
        return "UTC"
    try:
        zoneinfo.ZoneInfo(value)
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        return "UTC"
    return value


# ─── people ──────────────────────────────────────────────────────────────────────────


@dataclass
class People:
    """Slack id → Blob account, and what a step learned about who is who."""

    ids: dict[str, str] = field(default_factory=dict)
    #: Accounts that are apps: their messages are an app's, and they are in no channel.
    bots: set[str] = field(default_factory=set)
    created: int = 0
    matched: int = 0


@dataclass(frozen=True)
class _Wanted:
    slack_id: str
    email: str
    name: str
    full_name: str | None
    title: str | None
    timezone: str
    bot: bool
    #: Somebody an admin could invite: a person, with a real address, not deleted in Slack.
    invitable: bool


def _wanted(user: SlackUser) -> _Wanted:
    real = user.email is not None and not user.is_bot
    return _Wanted(
        slack_id=user.id,
        email=user.email if real and user.email else no_address(user.id),
        name=user.name[:MAX_NAME],
        full_name=user.real_name,
        title=user.title,
        timezone=_timezone(user.timezone),
        bot=user.is_bot,
        invitable=real and not user.deleted,
    )


async def load_people(session: AsyncSession, import_id: str) -> People:
    rows = (
        await session.execute(
            text(
                """
                SELECT p.slack_id, p.user_id, u.kind
                  FROM import_people p JOIN users u ON u.id = p.user_id
                 WHERE p.import_id = :id
                """
            ),
            {"id": import_id},
        )
    ).fetchall()
    people = People()
    for row in rows:
        people.ids[row.slack_id] = str(row.user_id)
        if row.kind == "bot":
            people.bots.add(str(row.user_id))
    return people


async def map_people(
    session: AsyncSession,
    *,
    workspace_id: str,
    import_id: str,
    users: list[SlackUser],
    people: People,
) -> None:
    """Find or make an account for each of `users`, and remember which is whose.

    By address: somebody already here is themselves, a placeholder from an earlier import
    of the same team is that placeholder again, and everybody else is a new placeholder.
    """
    wanted = [_wanted(user) for user in users if user.id not in people.ids]
    if not wanted:
        return
    existing = {
        row.email.lower(): row
        for row in (
            await session.execute(
                text(
                    """
                    SELECT id, email, kind, placeholder FROM users
                     WHERE workspace_id = :ws AND email = ANY(cast(:emails AS citext[]))
                    """
                ),
                {"ws": workspace_id, "emails": [w.email for w in wanted]},
            )
        ).fetchall()
    }
    fresh = [w for w in wanted if w.email.lower() not in existing]
    if fresh:
        await session.execute(
            text(
                """
                INSERT INTO users
                  (id, workspace_id, email, display_name, full_name, title, timezone, role,
                   kind, deactivated_at, placeholder)
                VALUES (:id, :ws, :email, :name, :full_name, :title, :timezone, 'member',
                        :kind, now(), true)
                ON CONFLICT (workspace_id, email) DO NOTHING
                """
            ),
            [
                {
                    "id": new_id(),
                    "ws": workspace_id,
                    "email": w.email,
                    "name": w.name,
                    "full_name": w.full_name,
                    "title": w.title,
                    "timezone": w.timezone,
                    "kind": "bot" if w.bot else "human",
                }
                for w in fresh
            ],
        )
        for row in (
            await session.execute(
                text(
                    """
                    SELECT id, email, kind, placeholder FROM users
                     WHERE workspace_id = :ws AND email = ANY(cast(:emails AS citext[]))
                    """
                ),
                {"ws": workspace_id, "emails": [w.email for w in fresh]},
            )
        ).fetchall():
            existing[row.email.lower()] = row
    links = []
    for w in wanted:
        account = existing.get(w.email.lower())
        if account is None:
            continue
        created = any(f.slack_id == w.slack_id for f in fresh)
        people.ids[w.slack_id] = str(account.id)
        if account.kind == "bot":
            people.bots.add(str(account.id))
        if created:
            people.created += 1
        else:
            people.matched += 1
        links.append(
            {
                "import": import_id,
                "slack": w.slack_id,
                "user": str(account.id),
                "created": created,
                "invitable": w.invitable and bool(account.placeholder),
            }
        )
    if links:
        await session.execute(
            text(
                """
                INSERT INTO import_people (import_id, slack_id, user_id, created, invitable)
                VALUES (:import, :slack, :user, :created, :invitable)
                ON CONFLICT DO NOTHING
                """
            ),
            links,
        )


def stranger(slack_id: str, message: dict[str, Any]) -> SlackUser:
    """Somebody a message names who is not in `users.json` — a guest from another team
    in a shared channel, an app — described by what the message says about them."""
    profile = message.get("user_profile")
    bot = message.get("bot_profile")
    name = None
    if isinstance(profile, dict):
        name = profile.get("display_name") or profile.get("real_name") or profile.get("name")
    if not name and isinstance(bot, dict):
        name = bot.get("name")
    if not name:
        name = message.get("username")
    return SlackUser(
        id=slack_id,
        name=str(name).strip()[:MAX_NAME] if isinstance(name, str) and name.strip() else slack_id,
        real_name=None,
        email=None,
        title=None,
        timezone=None,
        deleted=False,
        is_bot=slack_id.startswith("B:"),
    )


# ─── conversations ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Placed:
    slack_id: str
    channel_id: str
    created: bool
    position: int


def channel_name(name: str) -> str:
    """Slack's channel name as one Blob takes: lowercase, letters, digits, `-` and `_`,
    starting with a letter or digit, sixty-four at most."""
    cleaned = _CHANNEL_NAME.sub("-", name.lower()).strip("-_")
    return cleaned[:MAX_CHANNEL_NAME].rstrip("-_") or "imported"


async def _taken_names(session: AsyncSession, workspace_id: str) -> dict[str, str]:
    rows = (
        await session.execute(
            text(
                """
                SELECT id, lower(name) AS name, kind FROM channels
                 WHERE workspace_id = :ws AND kind IN ('public', 'private')
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchall()
    return {row.name: f"{row.kind}:{row.id}" for row in rows}


def _free(base: str, taken: dict[str, str]) -> str:
    for suffix in range(1, 100):
        tail = "-slack" if suffix == 1 else f"-slack-{suffix}"
        candidate = f"{base[: MAX_CHANNEL_NAME - len(tail)]}{tail}"
        if candidate not in taken:
            return candidate
    return f"{base[:40]}-{new_id()[-8:]}"


async def place_conversations(
    session: AsyncSession,
    *,
    workspace_id: str,
    import_id: str,
    conversations: list[SlackConversation],
    people: People,
    fallback_creator: str,
) -> list[Placed]:
    """Find or make the conversation each Slack one becomes, with its members.

    A public channel whose name is taken by a public channel here merges into it; a
    private one, or a public one whose name a private channel here holds, takes the name
    with `-slack` after it. A direct or group message is found by its members, as opening
    one is (`channels.dm_key`)."""
    taken = await _taken_names(session, workspace_id)
    placed: list[Placed] = []
    for position, conversation in enumerate(conversations):
        members = [people.ids[m] for m in conversation.members if m in people.ids]
        creator = (people.ids.get(conversation.creator) if conversation.creator else None) or (
            members[0] if members else fallback_creator
        )
        new_channel = conversation_id(workspace_id, conversation)
        created = False
        if conversation.kind in ("dm", "group_dm"):
            everyone = sorted(set(members))
            if not everyone:
                continue
            key = dm_key(everyone)
            row = (
                await session.execute(
                    text("SELECT id FROM channels WHERE workspace_id = :ws AND dm_key = :key"),
                    {"ws": workspace_id, "key": key},
                )
            ).fetchone()
            if row is not None:
                channel = str(row.id)
            else:
                channel = new_channel
                created = await _insert_channel(
                    session,
                    channel_id=channel,
                    workspace_id=workspace_id,
                    kind="group_dm" if len(everyone) > 2 else "dm",
                    name=None,
                    dm=key,
                    conversation=conversation,
                    creator=creator,
                )
            await _add_members(session, workspace_id, channel, everyone, conversation)
        else:
            base = channel_name(conversation.name or conversation.id)
            holder = taken.get(base)
            if (
                conversation.kind == "public"
                and holder is not None
                and holder.startswith("public:")
            ):
                channel = holder.split(":", 1)[1]
            else:
                exists = (
                    await session.execute(
                        text("SELECT id, name FROM channels WHERE id = :id AND workspace_id = :ws"),
                        {"id": new_channel, "ws": workspace_id},
                    )
                ).fetchone()
                if exists is not None:
                    # An earlier import of this export made it: the same channel again.
                    channel = str(exists.id)
                else:
                    name = base if holder is None else _free(base, taken)
                    channel = new_channel
                    created = await _insert_channel(
                        session,
                        channel_id=channel,
                        workspace_id=workspace_id,
                        kind=conversation.kind,
                        name=name,
                        dm=None,
                        conversation=conversation,
                        creator=creator,
                    )
                    taken[name] = f"{conversation.kind}:{channel}"
            humans = [m for m in members if m not in people.bots]
            await _add_members(session, workspace_id, channel, humans, conversation)
        placed.append(Placed(conversation.id, channel, created, position))
    if placed:
        await session.execute(
            text(
                """
                INSERT INTO import_conversations
                  (import_id, slack_id, channel_id, created, position)
                VALUES (:import, :slack, :channel, :created, :position)
                ON CONFLICT DO NOTHING
                """
            ),
            [
                {
                    "import": import_id,
                    "slack": p.slack_id,
                    "channel": p.channel_id,
                    "created": p.created,
                    "position": p.position,
                }
                for p in placed
            ],
        )
    return placed


async def _insert_channel(
    session: AsyncSession,
    *,
    channel_id: str,
    workspace_id: str,
    kind: str,
    name: str | None,
    dm: str | None,
    conversation: SlackConversation,
    creator: str,
) -> bool:
    created_at = (
        datetime.fromtimestamp(conversation.created, tz=UTC)
        if conversation.created > 0
        else datetime.now(UTC)
    )
    row = (
        await session.execute(
            text(
                """
                INSERT INTO channels
                  (id, workspace_id, kind, name, topic, description, created_by, dm_key,
                   created_at, archived_at)
                VALUES (:id, :ws, :kind, :name, :topic, :description, :creator, :dm,
                        :created_at, CASE WHEN :archived THEN now() END)
                ON CONFLICT DO NOTHING
                RETURNING id
                """
            ),
            {
                "id": channel_id,
                "ws": workspace_id,
                "kind": kind,
                "name": name,
                "topic": (conversation.topic or None) and conversation.topic[:250],
                "description": (conversation.purpose or None) and conversation.purpose[:2000],
                "creator": creator,
                "dm": dm,
                "created_at": created_at,
                "archived": conversation.archived,
            },
        )
    ).fetchone()
    return row is not None


async def _add_members(
    session: AsyncSession,
    workspace_id: str,
    channel_id: str,
    user_ids: list[str],
    conversation: SlackConversation,
) -> None:
    """Members straight in, placeholders included — `channels.add_members` refuses a
    deactivated account, rightly, for anybody but an import. Scoped to the workspace in
    the statement itself, as that function is."""
    if not user_ids:
        return
    joined = (
        datetime.fromtimestamp(conversation.created, tz=UTC)
        if conversation.created > 0
        else datetime.now(UTC)
    )
    await session.execute(
        text(
            """
            INSERT INTO channel_members (channel_id, user_id, joined_at)
            SELECT :channel, u.id, :joined FROM users u
             WHERE u.id = ANY(cast(:ids AS uuid[])) AND u.workspace_id = :ws
            ON CONFLICT DO NOTHING
            """
        ),
        {"channel": channel_id, "ids": user_ids, "ws": workspace_id, "joined": joined},
    )


async def placed_conversations(session: AsyncSession, import_id: str) -> list[Placed]:
    rows = (
        await session.execute(
            text(
                """
                SELECT slack_id, channel_id, created, position FROM import_conversations
                 WHERE import_id = :id ORDER BY position
                """
            ),
            {"id": import_id},
        )
    ).fetchall()
    return [Placed(r.slack_id, str(r.channel_id), r.created, r.position) for r in rows]


# ─── messages ────────────────────────────────────────────────────────────────────────


@dataclass
class FileNote:
    """A Slack file on a message: copied (an attachment id), or a line saying why not."""

    attachment_id: str | None = None
    line: str | None = None


@dataclass
class Row:
    id: str
    channel_id: str
    author_id: str | None
    kind: str
    body: str
    thread_ts: str | None
    ts: str
    also_in_channel: bool
    mention_user_ids: list[str]
    client_msg_id: str
    created_at: datetime
    edited_at: datetime | None
    pinned: bool
    deleted: bool
    reactions: list[tuple[str, str]]
    files: list[dict[str, Any]]
    thread_root_id: str | None = None


def author_of(message: dict[str, Any]) -> str | None:
    """Whose message it is: its person, else its app (`bot_id`)."""
    user = message.get("user")
    if isinstance(user, str) and user:
        return user
    bot = message.get("bot_id")
    return f"B:{bot}" if isinstance(bot, str) and bot else None


def to_row(
    message: dict[str, Any],
    *,
    workspace_id: str,
    conversation: str,
    channel_id: str,
    people: People,
    names: dict[str, str],
    channels: dict[str, str],
) -> Row | None:
    """One Slack message as the row it becomes, or None for what is not one."""
    ts = message.get("ts")
    if not isinstance(ts, str) or not re.fullmatch(r"\d+(\.\d+)?", ts):
        return None
    subtype = message.get("subtype")
    if message.get("hidden") or subtype in SKIPPED_SUBTYPES:
        return None
    deleted = subtype == "tombstone"
    slack_author = author_of(message)
    author = people.ids.get(slack_author) if slack_author else None
    said = message.get("text")
    raw = said if isinstance(said, str) else ""
    if not raw.strip():
        raw = attachments_text(message.get("attachments"))
    converted = to_markdown(
        raw,
        person=names.get,
        channel=channels.get,
        emoji=slack_emoji,
    )
    body = "" if deleted else converted.body
    files = [f for f in message.get("files") or [] if isinstance(f, dict)]
    if not body and not files and not deleted:
        return None
    thread_ts = message.get("thread_ts")
    reply_to = thread_ts if isinstance(thread_ts, str) and thread_ts != ts else None
    edited = message.get("edited")
    edited_ts = edited.get("ts") if isinstance(edited, dict) else None
    reactions: list[tuple[str, str]] = []
    for reaction in message.get("reactions") or []:
        if not isinstance(reaction, dict) or not isinstance(reaction.get("name"), str):
            continue
        emoji = slack_emoji(reaction["name"]) or f":{reaction['name'].split('::')[0]}:"
        for reactor in reaction.get("users") or []:
            reactor_id = people.ids.get(reactor) if isinstance(reactor, str) else None
            if reactor_id and (emoji, reactor_id) not in reactions:
                reactions.append((emoji, reactor_id))
    pinned_to = message.get("pinned_to")
    return Row(
        id=message_id(workspace_id, conversation, ts),
        channel_id=channel_id,
        author_id=author,
        kind="bot" if author in people.bots else "user",
        body=body,
        thread_ts=reply_to,
        ts=ts,
        also_in_channel=reply_to is not None and subtype in _ALSO_IN_CHANNEL,
        mention_user_ids=list(
            dict.fromkeys(people.ids[m] for m in converted.mentioned if m in people.ids)
        ),
        client_msg_id=client_msg_id(conversation, ts),
        created_at=ts_time(ts),
        edited_at=ts_time(edited_ts)
        if isinstance(edited_ts, str) and edited_ts[:1].isdigit()
        else None,
        pinned=isinstance(pinned_to, list) and conversation in pinned_to,
        deleted=deleted,
        reactions=reactions,
        files=files,
    )


async def existing_ids(session: AsyncSession, ids: list[str]) -> set[str]:
    if not ids:
        return set()
    rows = (
        await session.execute(
            text("SELECT id FROM messages WHERE id = ANY(cast(:ids AS uuid[]))"),
            {"ids": ids},
        )
    ).fetchall()
    return {str(row.id) for row in rows}


async def write_rows(
    session: AsyncSession,
    *,
    workspace_id: str,
    conversation: str,
    rows: list[Row],
    notes: dict[str, list[FileNote]],
) -> int:
    """Insert `rows` — oldest first, so a thread's root is in before its replies — with
    their reactions and files. How many were new."""
    if not rows:
        return 0
    rows = sorted(rows, key=lambda row: ts_parts(row.ts))
    roots = {message_id(workspace_id, conversation, row.thread_ts) for row in rows if row.thread_ts}
    have = await existing_ids(session, list(roots))
    here = {row.id for row in rows}
    for row in rows:
        if row.thread_ts:
            root = message_id(workspace_id, conversation, row.thread_ts)
            # A reply whose root is not in the export — deleted before it was made, or
            # older than its first day — stands on its own rather than hanging off nothing.
            row.thread_root_id = root if root in have or root in here else None
            if row.thread_root_id is None:
                row.also_in_channel = False
        lines = [note.line for note in notes.get(row.id, []) if note.line]
        if lines:
            row.body = "\n".join([row.body, *lines]).strip() if row.body else "\n".join(lines)
    inserted = (
        await session.execute(
            text(
                """
                INSERT INTO messages
                  (id, workspace_id, channel_id, author_id, kind, body, thread_root_id,
                   also_in_channel, mention_user_ids, client_msg_id, created_at, edited_at,
                   pinned_at, deleted_at)
                SELECT r.id, r.workspace_id, r.channel_id, r.author_id, r.kind, r.body,
                       r.thread_root_id, r.also_in_channel, cast(r.mentions AS uuid[]),
                       r.client_msg_id, r.created_at, r.edited_at, r.pinned_at, r.deleted_at
                  FROM unnest(
                  cast(:ids AS uuid[]), cast(:wss AS uuid[]), cast(:channels AS uuid[]),
                  cast(:authors AS uuid[]), cast(:kinds AS text[]), cast(:bodies AS text[]),
                  cast(:roots AS uuid[]), cast(:alsos AS boolean[]), cast(:mentions AS text[]),
                  cast(:clients AS text[]), cast(:created AS timestamptz[]),
                  cast(:edited AS timestamptz[]), cast(:pinned AS timestamptz[]),
                  cast(:deleted AS timestamptz[])
                ) AS r(id, workspace_id, channel_id, author_id, kind, body, thread_root_id,
                       also_in_channel, mentions, client_msg_id, created_at, edited_at,
                       pinned_at, deleted_at)
                ON CONFLICT DO NOTHING
                RETURNING id
                """
            ),
            {
                "ids": [r.id for r in rows],
                "wss": [workspace_id] * len(rows),
                "channels": [r.channel_id for r in rows],
                "authors": [r.author_id for r in rows],
                "kinds": [r.kind for r in rows],
                "bodies": [r.body for r in rows],
                "roots": [r.thread_root_id for r in rows],
                "alsos": [r.also_in_channel for r in rows],
                "mentions": ["{" + ",".join(r.mention_user_ids) + "}" for r in rows],
                "clients": [r.client_msg_id for r in rows],
                "created": [r.created_at for r in rows],
                "edited": [r.edited_at for r in rows],
                "pinned": [r.created_at if r.pinned else None for r in rows],
                "deleted": [r.created_at if r.deleted else None for r in rows],
            },
        )
    ).fetchall()
    reactions = [
        {"message": row.id, "emoji": emoji, "user": user, "at": row.created_at}
        for row in rows
        for emoji, user in row.reactions
    ]
    if reactions:
        await session.execute(
            text(
                """
                INSERT INTO reactions (message_id, emoji, user_id, created_at)
                SELECT :message, :emoji, u.id, :at FROM users u
                 WHERE u.id = :user AND u.workspace_id = :ws
                ON CONFLICT DO NOTHING
                """
            ),
            [{**reaction, "ws": workspace_id} for reaction in reactions],
        )
    attached = [
        {"attachment": note.attachment_id, "message": message, "ws": workspace_id}
        for message, row_notes in notes.items()
        for note in row_notes
        if note.attachment_id
    ]
    if attached:
        await session.execute(
            text(
                """
                UPDATE attachments SET message_id = :message
                 WHERE id = :attachment AND workspace_id = :ws AND message_id IS NULL
                """
            ),
            attached,
        )
    return len(inserted)


async def existing_attachments(session: AsyncSession, ids: list[str]) -> set[str]:
    if not ids:
        return set()
    rows = (
        await session.execute(
            text(
                """
                SELECT id FROM attachments
                 WHERE id = ANY(cast(:ids AS uuid[])) AND uploaded_at IS NOT NULL
                """
            ),
            {"ids": ids},
        )
    ).fetchall()
    return {str(row.id) for row in rows}


async def record_attachment(
    session: AsyncSession,
    *,
    attachment_id: str,
    workspace_id: str,
    uploader_id: str,
    object_key: str,
    thumb_key: str | None,
    filename: str,
    mime: str,
    size_bytes: int,
    width: int | None,
    height: int | None,
    created_at: datetime,
) -> None:
    """A copied file's row, uploaded and not yet on its message — the step's transaction
    puts it there with the message."""
    await session.execute(
        text(
            """
            INSERT INTO attachments
              (id, workspace_id, uploader_id, object_key, thumb_key, filename, mime,
               size_bytes, width, height, uploaded_at, created_at)
            VALUES (:id, :ws, :uploader, :key, :thumb, :filename, :mime, :size, :width,
                    :height, now(), :created_at)
            ON CONFLICT DO NOTHING
            """
        ),
        {
            "id": attachment_id,
            "ws": workspace_id,
            "uploader": uploader_id,
            "key": object_key,
            "thumb": thumb_key,
            "filename": filename,
            "mime": mime,
            "size": size_bytes,
            "width": width,
            "height": height,
            "created_at": created_at,
        },
    )


# ─── settling ────────────────────────────────────────────────────────────────────────


async def settle(session: AsyncSession, channel_id: str, *, created: bool) -> None:
    """What `send` would have kept up, once, for a conversation whose history is in: each
    thread's counters, the channel's newest message, and everybody's place in it — at the
    newest message when the import made the conversation, and untouched where it merged
    into one people were already reading."""
    await session.execute(
        text(
            """
            UPDATE messages r
               SET reply_count = s.n, last_reply_at = s.last, reply_user_ids = s.faces
              FROM (
                SELECT t.root, t.n, t.last,
                       coalesce((
                         SELECT array_agg(f.author_id ORDER BY f.first)
                           -- An id's text sorts as the id does: fixed-width hex.
                           FROM (SELECT author_id, min(id::text) AS first FROM messages
                                  WHERE thread_root_id = t.root AND deleted_at IS NULL
                                    AND author_id IS NOT NULL
                                  GROUP BY author_id ORDER BY 2 LIMIT :facepile) f
                       ), '{}') AS faces
                  FROM (SELECT thread_root_id AS root, count(*)::int AS n,
                               max(created_at) AS last
                          FROM messages
                         WHERE channel_id = :channel AND thread_root_id IS NOT NULL
                           AND deleted_at IS NULL
                         GROUP BY thread_root_id) t
              ) s
             WHERE r.id = s.root AND r.channel_id = :channel
            """
        ),
        {"channel": channel_id, "facepile": FACEPILE_LIMIT},
    )
    await session.execute(
        text(
            f"""
            UPDATE channels c
               SET last_message_id = (
                     SELECT m.id FROM messages m
                      WHERE m.channel_id = c.id AND {IN_CHANNEL_HISTORY} AND {STILL_SHOWN}
                      ORDER BY m.id DESC LIMIT 1)
             WHERE c.id = :channel
            """
        ),
        {"channel": channel_id},
    )
    await session.execute(
        text(
            """
            INSERT INTO read_states (user_id, channel_id, last_read_message_id)
            SELECT cm.user_id, cm.channel_id, c.last_message_id
              FROM channel_members cm JOIN channels c ON c.id = cm.channel_id
             WHERE cm.channel_id = :channel
            ON CONFLICT (user_id, channel_id) DO UPDATE
               SET last_read_message_id = EXCLUDED.last_read_message_id, mention_count = 0
             WHERE :created
            """
        ),
        {"channel": channel_id, "created": created},
    )


# ─── people who came over ────────────────────────────────────────────────────────────


async def invitable(session: AsyncSession, workspace_id: str, import_id: str) -> list[Any]:
    """Who this import brought over that nobody has claimed: still placeholders, with a
    real address, people not apps, not deleted in Slack."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT u.id, u.display_name, u.email,
                           EXISTS (SELECT 1 FROM invites i
                                    WHERE i.workspace_id = u.workspace_id
                                      AND i.email = u.email AND i.accepted_at IS NULL
                                      AND i.revoked_at IS NULL AND i.expires_at > now()
                           ) AS invited
                      FROM import_people p
                      JOIN users u ON u.id = p.user_id
                     WHERE p.import_id = :import AND p.invitable AND u.placeholder
                       AND u.workspace_id = :ws
                     ORDER BY lower(u.display_name), u.id
                    """
                ),
                {"import": import_id, "ws": workspace_id},
            )
        ).fetchall()
    )


async def invite(
    session: AsyncSession,
    actor: Actor,
    *,
    workspace_id: str,
    import_id: str,
    user_ids: list[str],
    inviter_name: str,
) -> list[dict[str, str]]:
    """An invitation to each of these placeholders' addresses, and the mail to send for
    each. Accepting one turns the placeholder into the account (`services/signup`)."""
    from . import signup as signup_service

    wanted = set(user_ids)
    jobs: list[dict[str, str]] = []
    for person in await invitable(session, workspace_id, import_id):
        if str(person.id) not in wanted:
            continue
        token, _expires, workspace_name = await signup_service.create_invite(
            session, actor, email=person.email, role="member", expires_in_days=14
        )
        jobs.append(
            {
                "to": person.email,
                "inviter": inviter_name,
                "url": f"{settings.PUBLIC_URL}/join/{token}",
                "workspace": workspace_name,
            }
        )
    return jobs
