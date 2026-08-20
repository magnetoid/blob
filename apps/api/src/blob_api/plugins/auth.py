"""Authenticating an app calling back into the API.

Apps present a bearer token; people present a session cookie. They are separate paths on
purpose — a bot token that could be swapped for a session would make every scope
meaningless, and a session that could call the app API would let a compromised browser
tab act with an app's grants.

Two rules hold everywhere below:

* **Only an `enabled` plugin can do anything.** Disabled, failed, or waiting for review
  all mean the same thing at this boundary. That is what lets `plugin_grants` hold the
  scopes an update requested without those scopes taking effect before approval.
* **A bot's access is its bot user's access.** Channel checks run through the same
  `assert_channel_access` a person goes through, against the bot's own row, so private
  channels are already correct here with no new code and no second implementation to
  keep in step.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy import text

from ..db.engine import SessionFactory
from ..lib.auth import hash_token
from ..lib.errors import AppError, forbidden, unauthorized
from .manifest import SCOPES


@dataclass(slots=True)
class BotCaller:
    plugin_id: str
    workspace_id: str
    slug: str
    name: str
    #: The plugin's bot user. Everything it does is attributed here.
    user_id: str
    scopes: frozenset[str]

    def has(self, scope: str) -> bool:
        return scope in self.scopes


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    prefix = "bearer "
    if header[: len(prefix)].lower() != prefix:
        return None
    token = header[len(prefix) :].strip()
    return token or None


async def current_bot(request: Request) -> BotCaller:
    token = _bearer(request)
    if token is None:
        raise unauthorized("This endpoint needs an app token.")

    async with SessionFactory() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT t.id AS token_id, p.id AS plugin_id, p.workspace_id, p.slug,
                           p.name, p.status, u.id AS user_id
                      FROM bot_tokens t
                      JOIN plugins p ON p.id = t.plugin_id
                      LEFT JOIN users u ON u.bot_plugin_id = p.id
                     WHERE t.token_hash = :hash AND t.revoked_at IS NULL
                    """
                ),
                {"hash": hash_token(token)},
            )
        ).fetchone()

        if row is None:
            raise unauthorized("That app token is not valid.")
        if row.status != "enabled":
            # One message for disabled, failed and needs_review alike: which one it is
            # is the workspace's business, not the caller's.
            raise forbidden("That app is not enabled.")
        if row.user_id is None:
            raise forbidden("That app has no bot user.")

        scopes = {
            grant.scope
            for grant in (
                await session.execute(
                    text("SELECT scope FROM plugin_grants WHERE plugin_id = :id"),
                    {"id": row.plugin_id},
                )
            ).fetchall()
        }

        # Last-used is worth a write: it is how an admin tells a live app from one that
        # was installed and forgotten.
        await session.execute(
            text("UPDATE bot_tokens SET last_used_at = now() WHERE id = :id"),
            {"id": row.token_id},
        )
        await session.commit()

    return BotCaller(
        plugin_id=row.plugin_id,
        workspace_id=row.workspace_id,
        slug=row.slug,
        name=row.name,
        user_id=row.user_id,
        scopes=frozenset(scopes),
    )


def requires(scope: str) -> BotCaller:
    """Dependency asserting one scope: `bot: BotCaller = requires("messages:write")`.

    Annotated as returning the value it resolves to rather than the marker object, which
    is FastAPI's own convention and what makes call sites type-check.
    """
    if scope not in SCOPES:
        raise RuntimeError(f"unknown scope {scope}")

    async def check(bot: BotCaller = Depends(current_bot)) -> BotCaller:
        if not bot.has(scope):
            raise AppError(
                403,
                "missing_scope",
                f"This app was not granted the {scope} permission.",
            )
        return bot

    return Depends(check)
