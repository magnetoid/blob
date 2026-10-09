"""Print a password-reset link for an address, for whoever runs the server.

The way back for an account no admin may unlock — the owner's, a server
administrator's, anybody's with accounts in several workspaces (`services/admin`) — on
a server that cannot send mail. Whoever can open a shell in the app container is
already past every gate a link would cross. Inside the container:

    python -m blob_api.reset_link someone@example.com

It is the same link "Forgot password" would have emailed: an hour of life, used once.
"""

from __future__ import annotations

import asyncio
import sys

from .config import settings
from .db.engine import transaction
from .services import accounts as account_service


async def mint(email: str) -> str | None:
    """A reset link for the account a sign-in with `email` lands in, or None."""
    async with transaction() as (session, _):
        token = await account_service.begin_password_reset(session, email.strip().lower())
    return f"{settings.PUBLIC_URL}/reset/{token}" if token else None


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m blob_api.reset_link <email>", file=sys.stderr)
        return 2
    url = asyncio.run(mint(argv[1]))
    if url is None:
        print("No active account has that address.", file=sys.stderr)
        return 1
    print(url)
    print("Good for an hour, and only once.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
