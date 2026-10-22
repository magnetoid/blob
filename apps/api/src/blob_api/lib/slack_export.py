"""Reading a Slack export (ADR 0042): the zip Slack's "Export data" page gives an admin.

Pure — a path in, plain data out. Nothing here touches the database, the network or any
file but the zip it is handed, so the preview and the import job share it and the tests
build an export in memory.

The layout, as Slack's "How to read Slack data exports" describes it: reference files at
the top (`users.json`, `channels.json`, and in an export of everything also `groups.json`
for private channels, `dms.json` and `mpims.json`), and one folder per conversation —
named for the channel, or for the conversation's id when it has no name — holding one
JSON array of messages per day it was spoken in, `YYYY-MM-DD.json`. A zip somebody
unpacked and packed again usually gains a folder around all of it; the root is wherever
`users.json` is.

A zip is read in place, member by member, never unpacked: a name in it is only ever a
key to look up, so a `../` in one cannot write anywhere. What it may cost is bounded
before anything is decompressed — no member over `MAX_MEMBER_BYTES`, none that expands
more than `MAX_RATIO` times — because the declared sizes are the only defence a zip bomb
leaves.
"""

from __future__ import annotations

import dataclasses
import json
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any

#: One day of one conversation, or one reference file, unpacked. Slack's own busiest
#: channels write a few megabytes a day; this is two orders above that.
MAX_MEMBER_BYTES = 256 * 1024 * 1024
#: JSON compresses well — ten to one is ordinary — but not a thousand to one.
MAX_RATIO = 200
#: A day file's name. Anything else in a conversation's folder is not Slack's.
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}\.json$")


class ExportError(Exception):
    """The zip cannot be imported, in words an admin can act on."""


@dataclass(frozen=True)
class SlackUser:
    id: str
    #: What the person is called: Slack's display name, else their real name, else the
    #: handle — the order Slack's own client uses.
    name: str
    real_name: str | None
    email: str | None
    title: str | None
    timezone: str | None
    deleted: bool
    is_bot: bool


@dataclass(frozen=True)
class SlackConversation:
    id: str
    #: Blob's word for it: `public`, `private`, `dm` or `group_dm`.
    kind: str
    name: str | None
    created: int
    creator: str | None
    archived: bool
    members: tuple[str, ...]
    topic: str | None
    purpose: str | None
    #: Its folder in the zip, relative to the export's root; None when it has none,
    #: which is a conversation nobody spoke in.
    folder: str | None = None
    #: Its day files' names, oldest first.
    days: tuple[str, ...] = field(default_factory=tuple)


@dataclass
class SlackExport:
    """An opened export. Close it with `close()` or use it as a context manager."""

    zf: zipfile.ZipFile
    root: str
    users: dict[str, SlackUser]
    conversations: list[SlackConversation]

    def messages(self, conversation: SlackConversation, day: str) -> list[dict[str, Any]]:
        """One day of one conversation, as Slack wrote it. Rows that are not objects are
        left out rather than refused: one odd line is not a reason to lose a day."""
        if conversation.folder is None:
            return []
        data = _read_json(self.zf, f"{self.root}{conversation.folder}/{day}")
        if not isinstance(data, list):
            raise ExportError(f"{conversation.folder}/{day} is not a list of messages.")
        return [row for row in data if isinstance(row, dict)]

    def close(self) -> None:
        self.zf.close()

    def __enter__(self) -> SlackExport:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def open_export(path: str) -> SlackExport:
    """Open and check a Slack export, reading only its reference files."""
    try:
        zf = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise ExportError(
            "That file is not a zip. Upload the file Slack's export page gave you."
        ) from exc
    try:
        _check_sizes(zf)
        root = _root(zf)
        users = _users(_reference(zf, root, "users.json", required=True))
        conversations: list[SlackConversation] = []
        for filename, kind in (
            ("channels.json", "public"),
            ("groups.json", "private"),
            ("dms.json", "dm"),
            ("mpims.json", "group_dm"),
        ):
            for row in _reference(zf, root, filename, required=filename == "channels.json"):
                parsed = _conversation(row, kind)
                if parsed is not None:
                    conversations.append(parsed)
        conversations = _with_folders(zf, root, conversations)
    except Exception:
        zf.close()
        raise
    return SlackExport(zf=zf, root=root, users=users, conversations=conversations)


def _check_sizes(zf: zipfile.ZipFile) -> None:
    for info in zf.infolist():
        if info.is_dir():
            continue
        if info.file_size > MAX_MEMBER_BYTES:
            raise ExportError(f"{info.filename} is too large to be part of a Slack export.")
        if info.compress_size and info.file_size / info.compress_size > MAX_RATIO:
            raise ExportError(f"{info.filename} expands further than a Slack export does.")


def _root(zf: zipfile.ZipFile) -> str:
    """The folder `users.json` is in: the top, or one folder down for a zip that was
    unpacked and packed again."""
    candidates = [
        name for name in zf.namelist() if name == "users.json" or name.endswith("/users.json")
    ]
    if not candidates:
        raise ExportError("This is not a Slack export: it has no users.json.")
    shallowest = min(candidates, key=lambda name: name.count("/"))
    if shallowest.count("/") > 1:
        raise ExportError("This is not a Slack export: its users.json is folders deep.")
    return shallowest[: -len("users.json")]


def _read_json(zf: zipfile.ZipFile, name: str) -> Any:
    try:
        with zf.open(name) as handle:
            # Read one byte past the cap: a member whose header lied about its size is
            # caught here rather than trusted.
            raw = handle.read(MAX_MEMBER_BYTES + 1)
    except KeyError as exc:
        raise ExportError(f"{name} is missing from the export.") from exc
    except (zipfile.BadZipFile, OSError, NotImplementedError) as exc:
        raise ExportError(f"{name} could not be read from the zip.") from exc
    if len(raw) > MAX_MEMBER_BYTES:
        raise ExportError(f"{name} is too large to be part of a Slack export.")
    try:
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ExportError(f"{name} is not valid JSON.") from exc


def _reference(
    zf: zipfile.ZipFile, root: str, filename: str, *, required: bool
) -> list[dict[str, Any]]:
    name = f"{root}{filename}"
    if name not in zf.NameToInfo:
        if required:
            raise ExportError(f"This is not a Slack export: it has no {filename}.")
        return []
    data = _read_json(zf, name)
    if not isinstance(data, list):
        raise ExportError(f"{filename} is not a list.")
    return [row for row in data if isinstance(row, dict)]


def _text(value: Any) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _users(rows: list[dict[str, Any]]) -> dict[str, SlackUser]:
    users: dict[str, SlackUser] = {}
    for row in rows:
        user_id = _text(row.get("id"))
        if user_id is None:
            continue
        raw_profile = row.get("profile")
        profile: dict[str, Any] = raw_profile if isinstance(raw_profile, dict) else {}
        real_name = _text(profile.get("real_name")) or _text(row.get("real_name"))
        handle = _text(row.get("name"))
        email = _text(profile.get("email"))
        users[user_id] = SlackUser(
            id=user_id,
            name=_text(profile.get("display_name")) or real_name or handle or user_id,
            real_name=real_name,
            email=email.lower() if email and "@" in email else None,
            title=_text(profile.get("title")),
            timezone=_text(row.get("tz")),
            deleted=bool(row.get("deleted")),
            is_bot=bool(row.get("is_bot")) or user_id == "USLACKBOT",
        )
    return users


def _conversation(row: dict[str, Any], kind: str) -> SlackConversation | None:
    conversation_id = _text(row.get("id"))
    if conversation_id is None:
        return None
    members = row.get("members")
    if kind == "dm" and not members:
        # dms.json carries `members`; an older export names the other person alone.
        members = [m for m in (row.get("user"),) if m]

    def _value(key: str) -> str | None:
        nested = row.get(key)
        return _text(nested.get("value")) if isinstance(nested, dict) else None

    created = row.get("created")
    return SlackConversation(
        id=conversation_id,
        kind=kind,
        name=_text(row.get("name")) if kind in ("public", "private", "group_dm") else None,
        created=created if isinstance(created, int) and created > 0 else 0,
        creator=_text(row.get("creator")),
        archived=bool(row.get("is_archived")),
        members=tuple(m for m in (members or []) if isinstance(m, str)),
        topic=_value("topic"),
        purpose=_value("purpose"),
    )


def _with_folders(
    zf: zipfile.ZipFile, root: str, conversations: list[SlackConversation]
) -> list[SlackConversation]:
    """Find each conversation's folder — by name, else by id — and its days."""
    days: dict[str, list[str]] = {}
    for name in zf.namelist():
        if not name.startswith(root):
            continue
        rest = name[len(root) :]
        folder, slash, day = rest.partition("/")
        if slash and _DAY.match(day):
            days.setdefault(folder, []).append(day)
    found: list[SlackConversation] = []
    for conversation in conversations:
        found_in: str | None = next(
            (
                candidate
                for candidate in (conversation.name, conversation.id)
                if candidate is not None and candidate in days
            ),
            None,
        )
        found.append(
            dataclasses.replace(
                conversation,
                folder=found_in,
                days=tuple(sorted(days[found_in])) if found_in else (),
            )
        )
    return found
