"""Shared test utilities: an ASGI client, a clean database, and signed-in users."""

from __future__ import annotations

import asyncio
import subprocess
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

import asyncpg
import httpx

from blob_api.config import settings
from blob_api.main import app

API_DIR = Path(__file__).resolve().parent.parent

PASSWORD = "correct-horse-battery"


def _alembic(*args: str) -> None:
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-m", "alembic", *args],
        cwd=API_DIR,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(f"alembic {' '.join(args)} failed:\n{result.stderr}")


def migrate_test_db() -> None:
    """Bring the test database to head, once per session.

    A database created by the old TypeScript runner already has the baseline schema, so
    it is stamped rather than migrated — the same cutover path production takes.
    """
    has_alembic, has_baseline = asyncio.run(_inspect_schema())
    if has_baseline and not has_alembic:
        _alembic("stamp", "0001")
    _alembic("upgrade", "head")


async def _inspect_schema() -> tuple[bool, bool]:
    dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn)
    try:
        has_alembic = await conn.fetchval(
            "SELECT to_regclass('public.alembic_version') IS NOT NULL"
        )
        has_baseline = await conn.fetchval("SELECT to_regclass('public.users') IS NOT NULL")
        return bool(has_alembic), bool(has_baseline)
    finally:
        await conn.close()


@dataclass(slots=True)
class Response:
    status: int
    body: Any


class Client:
    """A thin wrapper so tests read like the TypeScript suite they were ported from."""

    def __init__(self, http: httpx.AsyncClient) -> None:
        self._http = http
        self.user_id: str = ""
        self.display_name: str = ""

    async def request(self, method: str, url: str, body: Any = None) -> Response:
        response = await self._http.request(
            method, url, json=body if body is not None else None
        )
        try:
            payload = response.json() if response.content else None
        except ValueError:
            payload = response.text
        return Response(status=response.status_code, body=payload)

    async def get(self, url: str) -> Response:
        return await self.request("GET", url)

    async def post(self, url: str, body: Any = None) -> Response:
        return await self.request("POST", url, body)

    async def patch(self, url: str, body: Any = None) -> Response:
        return await self.request("PATCH", url, body)

    async def put(self, url: str, body: Any = None) -> Response:
        return await self.request("PUT", url, body)

    async def delete(self, url: str, body: Any = None) -> Response:
        return await self.request("DELETE", url, body)

    def fork(self) -> Client:
        """A second client sharing no cookies — a different browser, same server."""
        return Client(
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            )
        )


@asynccontextmanager
async def build_client() -> AsyncIterator[Client]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http:
        yield Client(http)


async def sign_up(
    client: Client,
    display_name: str,
    *,
    invite_token: str | None = None,
    email: str | None = None,
) -> Client:
    """Sign up and leave the session cookie on the client's jar."""
    address = email or f"{display_name.lower().replace(' ', '.')}@example.com"
    state = await client.get("/api/auth/state")
    needs_setup = bool(state.body["needsSetup"])

    response = await client.post(
        "/api/auth/signup",
        {
            "email": address,
            "password": PASSWORD,
            "displayName": display_name,
            "workspaceName": "Test Workspace" if needs_setup else None,
            "inviteToken": invite_token,
        },
    )
    if response.status >= 400:
        raise AssertionError(f"signup failed for {display_name}: {response.body}")

    client.user_id = response.body["user"]["id"]
    client.display_name = display_name
    return client


async def invite_and_sign_up(owner: Client, display_name: str, role: str = "member") -> Client:
    """Mint an invite as the owner, then accept it on a fresh client."""
    invite = await owner.post("/api/invites", {"expiresInDays": 1, "role": role})
    token = invite.body["url"].split("/join/")[1]
    joiner = owner.fork()
    return await sign_up(joiner, display_name, invite_token=token)


def client_msg_id() -> str:
    return f"test-{uuid4()}"


async def send_message(
    client: Client, channel_id: str, body: str, **extra: Any
) -> Response:
    payload: dict[str, Any] = {"body": body, "clientMsgId": client_msg_id(), **extra}
    return await client.post(f"/api/channels/{channel_id}/messages", payload)
