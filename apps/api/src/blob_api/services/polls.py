"""Polls (ADR 0041): a message whose text is the question, with options and votes beside it.

The question is the message's body, so everything that reads messages reads it. A `polls`
row holds the options and how they may be chosen; a `poll_votes` row is one person's choice
of one option. Who chose what is part of the message as everyone reads it — the same as
who reacted with what — unless the poll is anonymous, when only counts ever leave here,
and a person's own choice is asked for on its own (`mine`).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request, forbidden

MIN_OPTIONS = 2
MAX_OPTIONS = 10
MAX_OPTION_CHARS = 120

#: The poll beside a message `m`, as every reader sees it: its options in order, how many
#: chose each, and — unless it is anonymous — who, oldest choice first. Folded into
#: `MESSAGE_SELECT` the way reactions are, so a message and its poll are one read.
POLL_FRAGMENT = """
  (SELECT json_build_object(
            'multiple', p.multiple,
            'anonymous', p.anonymous,
            'closedAt', p.closed_at,
            'voters', (SELECT count(DISTINCT v.user_id) FROM poll_votes v
                        WHERE v.message_id = p.message_id),
            'options', (
              SELECT json_agg(json_build_object(
                       'id', o.option ->> 'id',
                       'text', o.option ->> 'text',
                       'count', (SELECT count(*) FROM poll_votes v
                                  WHERE v.message_id = p.message_id
                                    AND v.option_id = o.option ->> 'id'),
                       'voterIds', CASE WHEN p.anonymous THEN NULL ELSE (
                         SELECT COALESCE(json_agg(v.user_id ORDER BY v.created_at), '[]'::json)
                           FROM poll_votes v
                          WHERE v.message_id = p.message_id
                            AND v.option_id = o.option ->> 'id') END
                     ) ORDER BY o.position)
                FROM jsonb_array_elements(p.options) WITH ORDINALITY AS o(option, position)))
     FROM polls p WHERE p.message_id = m.id) AS poll
"""


@dataclass(frozen=True, slots=True)
class PollDraft:
    """A poll as it was asked for, checked."""

    options: tuple[str, ...]
    multiple: bool
    anonymous: bool

    def stored_options(self) -> list[dict[str, str]]:
        """The options with the ids votes name them by: short, stable, in order."""
        return [{"id": f"o{index}", "text": text_} for index, text_ in enumerate(self.options, 1)]


def checked(options: list[str], *, multiple: bool, anonymous: bool) -> PollDraft:
    """The options a poll may be asked with: two to ten, each a short line, no two alike."""
    cleaned = [" ".join(option.split()) for option in options]
    if len(cleaned) < MIN_OPTIONS or len(cleaned) > MAX_OPTIONS:
        raise bad_request(
            f"A poll has {MIN_OPTIONS} to {MAX_OPTIONS} options.", code="invalid_input"
        )
    if any(not option for option in cleaned):
        raise bad_request("An option needs some words.", code="invalid_input")
    if any(len(option) > MAX_OPTION_CHARS for option in cleaned):
        raise bad_request(
            f"Keep each option to {MAX_OPTION_CHARS} characters.", code="invalid_input"
        )
    if len({option.casefold() for option in cleaned}) != len(cleaned):
        raise bad_request("Two options say the same thing.", code="invalid_input")
    return PollDraft(options=tuple(cleaned), multiple=multiple, anonymous=anonymous)


async def attach(
    session: AsyncSession, *, message_id: str, workspace_id: str, draft: PollDraft
) -> None:
    """Ask the poll beside the message just stored."""
    await session.execute(
        text(
            """
            INSERT INTO polls (message_id, workspace_id, options, multiple, anonymous)
            VALUES (:message, :ws, cast(:options AS jsonb), :multiple, :anonymous)
            ON CONFLICT (message_id) DO NOTHING
            """
        ),
        {
            "message": message_id,
            "ws": workspace_id,
            "options": json.dumps(draft.stored_options()),
            "multiple": draft.multiple,
            "anonymous": draft.anonymous,
        },
    )


async def _poll(session: AsyncSession, message_id: str, *, lock: bool = False) -> Any:
    return (
        await session.execute(
            text(
                "SELECT p.message_id, p.options, p.multiple, p.anonymous, p.closed_at,"
                " m.author_id, m.deleted_at"
                " FROM polls p JOIN messages m ON m.id = p.message_id"
                " WHERE p.message_id = :message" + (" FOR UPDATE OF p" if lock else "")
            ),
            {"message": message_id},
        )
    ).first()


async def is_poll(session: AsyncSession, message_id: str) -> bool:
    return bool(
        (
            await session.execute(
                text("SELECT EXISTS (SELECT 1 FROM polls WHERE message_id = :message)"),
                {"message": message_id},
            )
        ).scalar_one()
    )


async def vote(
    session: AsyncSession, *, message_id: str, user_id: str, option_ids: list[str]
) -> None:
    """Make this person's choice these options, replacing what they chose before. None at
    all withdraws it. Access to the conversation is the caller's to have checked."""
    poll = await _poll(session, message_id, lock=True)
    if poll is None or poll.deleted_at is not None:
        raise bad_request("That message has no poll.", code="not_a_poll")
    if poll.closed_at is not None:
        raise bad_request("This poll is closed.", code="poll_closed")
    known = {str(option["id"]) for option in poll.options}
    chosen = list(dict.fromkeys(option_ids))
    if any(option not in known for option in chosen):
        raise bad_request("That is not one of the poll's options.", code="invalid_input")
    if len(chosen) > 1 and not poll.multiple:
        raise bad_request("This poll takes one choice.", code="invalid_input")
    await session.execute(
        text("DELETE FROM poll_votes WHERE message_id = :message AND user_id = :user"),
        {"message": message_id, "user": user_id},
    )
    for option in chosen:
        await session.execute(
            text(
                "INSERT INTO poll_votes (message_id, option_id, user_id)"
                " VALUES (:message, :option, :user)"
            ),
            {"message": message_id, "option": option, "user": user_id},
        )


async def close(session: AsyncSession, *, message_id: str, by: str, is_admin: bool) -> None:
    """Close the poll: the author's to do, or an admin's. Closing a closed poll is a no-op."""
    poll = await _poll(session, message_id, lock=True)
    if poll is None or poll.deleted_at is not None:
        raise bad_request("That message has no poll.", code="not_a_poll")
    if str(poll.author_id) != by and not is_admin:
        raise forbidden("Only whoever asked the poll, or an admin, can close it.")
    await session.execute(
        text(
            "UPDATE polls SET closed_at = now(), closed_by = :by"
            " WHERE message_id = :message AND closed_at IS NULL"
        ),
        {"message": message_id, "by": by},
    )


async def mine(session: AsyncSession, *, message_id: str, user_id: str) -> list[str]:
    """This person's own choice — the one thing an anonymous poll tells only them."""
    rows = (
        await session.execute(
            text(
                "SELECT option_id FROM poll_votes WHERE message_id = :message AND user_id = :user"
                " ORDER BY created_at"
            ),
            {"message": message_id, "user": user_id},
        )
    ).fetchall()
    return [str(row.option_id) for row in rows]


__all__ = [
    "MAX_OPTIONS",
    "MAX_OPTION_CHARS",
    "MIN_OPTIONS",
    "POLL_FRAGMENT",
    "PollDraft",
    "attach",
    "checked",
    "close",
    "is_poll",
    "mine",
    "vote",
]
