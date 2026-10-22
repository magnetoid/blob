"""A Slack export built in memory, for the reader's tests and the import's.

The shape is the one Slack's "How to read Slack data exports" describes: reference files
at the top, a folder per conversation — the channel's name, or the conversation's id —
and one JSON array of messages per day.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path
from typing import Any


def user(
    slack_id: str,
    name: str,
    *,
    email: str | None = None,
    display: str | None = None,
    deleted: bool = False,
    bot: bool = False,
) -> dict[str, Any]:
    profile: dict[str, Any] = {"real_name": name, "display_name": display or ""}
    if email:
        profile["email"] = email
    return {
        "id": slack_id,
        "name": name.lower().replace(" ", "."),
        "real_name": name,
        "deleted": deleted,
        "is_bot": bot,
        "tz": "Europe/Belgrade",
        "profile": profile,
    }


def channel(
    slack_id: str,
    name: str,
    members: list[str],
    *,
    archived: bool = False,
    created: int = 1_600_000_000,
) -> dict[str, Any]:
    return {
        "id": slack_id,
        "name": name,
        "created": created,
        "creator": members[0] if members else None,
        "is_archived": archived,
        "members": members,
        "topic": {"value": f"{name} topic"},
        "purpose": {"value": f"What {name} is for"},
    }


def message(slack_user: str, ts: str, text: str, **extra: Any) -> dict[str, Any]:
    return {"type": "message", "user": slack_user, "text": text, "ts": ts, **extra}


def build_export(
    path: Path,
    *,
    users: list[dict[str, Any]],
    channels: list[dict[str, Any]],
    groups: list[dict[str, Any]] | None = None,
    dms: list[dict[str, Any]] | None = None,
    mpims: list[dict[str, Any]] | None = None,
    days: dict[str, dict[str, list[Any]]] | None = None,
    wrap: str = "",
    extra: dict[str, bytes] | None = None,
) -> Path:
    """Write the zip and say where. `days` maps a folder to {"YYYY-MM-DD": [messages]};
    `wrap` puts all of it one folder down, as a re-zipped export has it."""
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{wrap}users.json", json.dumps(users))
        zf.writestr(f"{wrap}channels.json", json.dumps(channels))
        for filename, rows in (("groups.json", groups), ("dms.json", dms), ("mpims.json", mpims)):
            if rows is not None:
                zf.writestr(f"{wrap}{filename}", json.dumps(rows))
        for folder, by_day in (days or {}).items():
            for day, rows in by_day.items():
                zf.writestr(f"{wrap}{folder}/{day}.json", json.dumps(rows))
        for name, data in (extra or {}).items():
            zf.writestr(f"{wrap}{name}", data)
    return path
