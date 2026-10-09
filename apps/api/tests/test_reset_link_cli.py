"""The operator's way back in: `python -m blob_api.reset_link <email>`.

An owner or a server administrator can no longer be unlocked by a workspace admin, so on
a server without mail this is the only path left — and it has to hand over a link that
actually works.
"""

from __future__ import annotations

from blob_api import reset_link
from blob_api.config import settings

from .helpers import Client, sign_up


async def test_it_prints_a_link_that_resets_the_owner(client: Client) -> None:
    await sign_up(client, "Owner")
    url = await reset_link.mint("  Owner@Example.com ")
    assert url is not None and url.startswith(f"{settings.PUBLIC_URL}/reset/")

    used = await client.fork().post(
        "/api/auth/reset-password",
        {"token": url.rsplit("/", 1)[1], "password": "a-new-password-here"},
    )
    assert used.status == 200, used.body


async def test_an_address_nobody_holds_gets_nothing(client: Client) -> None:
    await sign_up(client, "Owner")
    assert await reset_link.mint("nobody@example.com") is None


def test_it_needs_exactly_one_address() -> None:
    assert reset_link.main(["reset_link"]) == 2
