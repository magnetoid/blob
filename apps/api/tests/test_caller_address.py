"""Which address a request is attributed to, and why it is not the one uvicorn reports.

`X-Forwarded-For` is append-only and the caller writes the first entry. uvicorn, told
`--forwarded-allow-ips "*"`, reads that first entry — so `request.client.host` is a value
the caller chooses. Blob keyed its login, signup and password-reset limits on it, which
made all three bypassable by varying one header, and stamped it into the audit log.

Everything here is about counting from the right instead.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.lib import caller
from blob_api.lib.rate_limit import LIMITS, Limit, rate_key
from blob_api.lib.redis import redis

from .helpers import PASSWORD, Client, sign_up


class _Connection:
    """The two things `client_ip` reads, and nothing else."""

    def __init__(self, forwarded: str | None, peer: str | None = "10.0.0.9") -> None:
        self.headers = {"x-forwarded-for": forwarded} if forwarded else {}
        self.client = type("Peer", (), {"host": peer})() if peer else None


class TestCountingFromTheRight:
    def test_one_proxy_takes_the_entry_it_appended(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 0)
        # nginx sends "<what the caller wrote>, <the caller's real address>".
        assert caller.client_ip(_Connection("1.2.3.4, 203.0.113.7")) == "203.0.113.7"

    def test_two_layers_step_past_the_inner_one(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The reference deployment: nginx in front of Coolify's Traefik."""
        monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 1)
        # nginx appends the caller, then Traefik appends nginx.
        chain = "1.2.3.4, 203.0.113.7, 127.0.0.1"
        assert caller.client_ip(_Connection(chain)) == "203.0.113.7"

    def test_the_made_up_entry_is_never_reached(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The bug: the leftmost entry is the one the caller invented."""
        monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 1)
        for invented in ("1.2.3.4", "not-an-address", "::1", ""):
            chain = f"{invented}, 203.0.113.7, 127.0.0.1" if invented else "203.0.113.7, 127.0.0.1"
            assert caller.client_ip(_Connection(chain)) == "203.0.113.7"

    def test_a_chain_shorter_than_configured_falls_back_to_the_peer(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A request that did not come through the proxy has nothing to trust in it.

        Reaching left here is how a direct caller — one that got past the network, or a
        health check inside the compose network — would get to choose its own address.
        """
        monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 1)
        assert caller.client_ip(_Connection("1.2.3.4")) == "10.0.0.9"
        assert caller.client_ip(_Connection(None)) == "10.0.0.9"

    def test_no_header_and_no_peer_is_none_not_a_crash(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 0)
        assert caller.client_ip(_Connection(None, peer=None)) is None
        assert caller.client_key(_Connection(None, peer=None)) == caller.UNKNOWN

    def test_something_that_is_not_an_address_is_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`audit_events.ip` is an `inet`. Without this the caller chooses whether it 500s."""
        monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 0)
        assert caller.client_ip(_Connection("' OR 1=1 --", peer=None)) is None
        assert caller.client_ip(_Connection("localhost", peer=None)) is None
        assert caller.client_key(_Connection("nonsense", peer=None)) == caller.UNKNOWN
        # A real address still comes through, in either notation.
        assert caller.client_ip(_Connection("2001:db8::1")) == "2001:db8::1"

    def test_a_negative_setting_cannot_reach_off_the_end(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", -3)
        assert caller.client_ip(_Connection("1.2.3.4, 203.0.113.7")) == "203.0.113.7"


@pytest_asyncio.fixture
async def founded(client: Client) -> Client:
    await sign_up(client, "Owner")
    return client


class TestTheLimitCannotBeShakenOff:
    async def test_the_bucket_is_the_caller_not_the_header_they_wrote(
        self, founded: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """One caller, five invented leftmost entries, one bucket.

        Under the test transport the peer address is constant, so the *old* code would
        also have collapsed these into one bucket — for the wrong reason. What makes this
        discriminate is the key itself: it has to be the entry the proxy vouched for.
        """
        monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 1)
        original = LIMITS["login"]
        LIMITS["login"] = Limit(3, 900)
        try:
            for attempt in range(4):
                await founded._http.post(
                    "/api/auth/login",
                    json={"email": "owner@example.com", "password": "wrong-on-purpose"},
                    headers={"x-forwarded-for": f"9.9.9.{attempt}, 203.0.113.7, 127.0.0.1"},
                )
            # The limiter's own key names the address it counted against.
            assert await redis.exists(rate_key("login", "203.0.113.7"))
            assert not await redis.exists(rate_key("login", "9.9.9.0"))
        finally:
            LIMITS["login"] = original
            await redis.delete(rate_key("login", "203.0.113.7"))

    async def test_a_different_caller_still_gets_their_own_bucket(
        self, founded: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The limit must key on the caller, not collapse everybody into one."""
        monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 1)
        original = LIMITS["login"]
        LIMITS["login"] = Limit(2, 900)
        try:
            for _ in range(3):
                await founded._http.post(
                    "/api/auth/login",
                    json={"email": "owner@example.com", "password": "wrong"},
                    headers={"x-forwarded-for": "1.1.1.1, 198.51.100.4, 127.0.0.1"},
                )
            # Somebody else entirely, behind the same proxies.
            answer = await founded._http.post(
                "/api/auth/login",
                json={"email": "owner@example.com", "password": PASSWORD},
                headers={"x-forwarded-for": "1.1.1.1, 198.51.100.99, 127.0.0.1"},
            )
            assert answer.status_code == 200, answer.text
        finally:
            LIMITS["login"] = original


class TestTheAuditLogRecordsSomethingTrue:
    async def test_the_address_stamped_is_the_one_the_proxy_vouched_for(
        self, founded: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 1)
        answer = await founded._http.post(
            "/api/invites",
            json={"role": "member"},
            headers={"x-forwarded-for": "6.6.6.6, 203.0.113.42, 127.0.0.1"},
        )
        assert answer.status_code == 200, answer.text

        async with SessionFactory() as session:
            stamped = (
                await session.execute(text("SELECT ip FROM audit_events ORDER BY id DESC LIMIT 1"))
            ).scalar_one()
        assert str(stamped) == "203.0.113.42", "the forensic column must not be attacker-chosen"


def test_no_route_reads_the_client_address_directly() -> None:
    """The guard that keeps this fixed.

    `request.client.host` is spoofable while the image runs with a wildcard
    `--forwarded-allow-ips`, which it must, because that is also what carries
    `X-Forwarded-Proto` and therefore HSTS. So the rule is a rule about call sites, and a
    rule about call sites needs something that reads them.
    """
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "src" / "blob_api"
    offenders = []
    for path in root.rglob("*.py"):
        if path.name == "caller.py":
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if ".client.host" in line and not line.lstrip().startswith("#"):
                offenders.append(f"{path.relative_to(root)}:{number}")
    assert not offenders, (
        "these read the peer address directly; use lib/caller.client_ip so the value "
        f"cannot be chosen by the caller: {offenders}"
    )
