"""Identifiers.

Every primary key is a UUIDv7: time-ordered, so `ORDER BY id` is chronological and
"is there anything newer than what I've read?" is a string comparison rather than a
timestamp join. This is the one schema decision that cannot be retrofitted cheaply.
"""

from __future__ import annotations

import secrets

import uuid_utils


def new_id() -> str:
    return str(uuid_utils.uuid7())


def new_token(nbytes: int = 32) -> str:
    """URL-safe opaque token for sessions, invites, resets and webhooks."""
    return secrets.token_urlsafe(nbytes)
