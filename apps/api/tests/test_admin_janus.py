"""The console reading and changing Janus itself.

Janus runs beside Blob in the same stack, and everything about *what it is* — the model
it answers as, the provider behind it, the toolsets it may use — lives in Janus's own
files, reachable only through the API it exposes to Blob at `JANUS_API_SERVER_KEY`. These
pin the Blob half of that: one composed overview, one forwarded change, one restart.

The rule this file exists to hold is the one about keys. **A provider key's value appears
in no Blob response body and in no audit row, ever.** It passes through `PUT
/api/admin/janus/config` to Janus and is gone. `PLANTED` is seeded into both directions —
the value Blob sends, and a value the fake Janus *echoes back* in a field outside its own
mask — and every assertion here is that it appears nowhere Blob writes or answers.

Janus is faked with an `httpx.MockTransport` through `janus_console.open_client`, the seam
that exists for exactly this (see `lib/llm.open_client`'s docstring for why it is a name
this module owns rather than `httpx.AsyncClient` itself). The JSON is the shape Janus
0.17.0 actually serves — `magnetoid/janus`'s `gateway/platforms/api_config.py`.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory, engine
from blob_api.services import janus_console

from .helpers import Client, invite_and_sign_up, sign_up, workspace_id_of

#: Stands in for a provider key. Distinctive so that a single `in` against a serialised
#: body is a real assertion: if this string is anywhere Blob wrote, the rule is broken.
PLANTED = "sk-planted-never-echo-9f3c7a21"

#: The other way a credential reaches this code: written by hand into `config.yaml`, which
#: the Advanced tab reads and writes as text. Janus returns that file verbatim.
INLINE = "sk-raw-inline-7c4e91b2"

API_KEY = "janus-api-server-key-2f8d"
AGUI_URL = "http://janus:8642/v1/agui"


def config_body() -> dict[str, Any]:
    """`GET /v1/config` as Janus 0.17.0 serves it — plus one thing it never would.

    `providers[0].key` carries a `value` alongside `set` and `tail`. Janus's mask means
    that cannot happen; Blob narrows the object anyway, because "the other side promised"
    is not a defence for a secret, and a future Janus adding a field here must not be able
    to turn Blob into the thing that published it.
    """
    return {
        "object": "janus.config",
        "version": "0.17.0",
        "model": {
            "default": "deepseek-v4-pro",
            "provider": "deepseek",
            "base_url": "https://api.deepseek.com/v1",
        },
        "agent": {
            "max_turns": 60,
            "reasoning_effort": "medium",
            "gateway_timeout": 1800,
            "personality": "helpful",
        },
        "personalities": ["concise", "helpful", "technical"],
        "toolsets": {"available": ["janus-cli", "web"], "enabled": ["janus-cli"], "error": None},
        "providers": [
            {
                "id": "deepseek",
                "name": "DeepSeek",
                "env": "DEEPSEEK_API_KEY",
                "key": {"set": True, "tail": "a4f2", "value": PLANTED},
            },
            {
                "id": "openai-api",
                "name": "OpenAI API",
                "env": "OPENAI_API_KEY",
                "key": {"set": False},
            },
        ],
        "models": {
            "provider": "deepseek",
            "ids": ["deepseek-flash", "deepseek-v4-pro"],
            "reason": None,
        },
        "raw": "model:\n  default: deepseek-v4-pro\n",
        "restart_pending": False,
    }


APPLIED_BODY = {
    "applied": {"model": {"default": "deepseek-flash"}, "api_keys": ["DEEPSEEK_API_KEY"]},
    "warnings": [
        {"severity": "warning", "message": "toolset 'web' has no key", "hint": "janus config set"}
    ],
    "restarting": True,
    "drain_timeout_seconds": 180.0,
}

GET_BODIES: dict[str, dict[str, Any]] = {
    "/health": {"status": "ok", "platform": "janus-agent"},
    "/v1/capabilities": {
        "object": "janus.api_server.capabilities",
        "platform": "janus-agent",
        "model": "janus-agent",
        "auth": {"type": "bearer", "required": True},
        "runtime": {"mode": "server_agent", "tool_execution": "server"},
        "features": {"run_submission": True},
    },
    "/v1/skills": {
        "object": "list",
        "data": [{"name": "brainstorming", "description": "Explore intent", "category": "work"}],
    },
    "/v1/toolsets": {
        "object": "list",
        "platform": "api_server",
        "data": [
            {
                "name": "janus-cli",
                "label": "Janus CLI",
                "description": "Janus's own commands",
                "enabled": True,
                "configured": True,
                "tools": ["janus_config"],
            }
        ],
    },
}


class FakeJanus:
    """Every request Blob made, and what Janus answered.

    Assertions are on `seen` — the requests the fake received — rather than on a mock of
    Blob's own call, so a test proves what went over the wire.
    """

    def __init__(self) -> None:
        self.seen: list[httpx.Request] = []
        #: Paths that raise a transport error instead of answering at all.
        self.unreachable: set[str] = set()
        #: Paths that answer with this status instead of their body.
        self.statuses: dict[str, int] = {}
        #: The body a `statuses` entry answers with, when the default will not do.
        self.status_bodies: dict[str, dict[str, Any]] = {}
        self.put_status = 200
        self.put_body: dict[str, Any] = APPLIED_BODY
        #: The config body to serve, so a test can plant something in the file's text.
        self.config: dict[str, Any] = config_body()
        #: How many database connections were checked out of the pool at the moment Blob
        #: asked. Janus's `/v1/config` makes a live provider call of its own, so a read
        #: can take ten seconds — holding a connection across it would spend the pool on
        #: waiting. The fan-out has to happen with the pool untouched.
        self.pool_in_use: list[int] = []

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        self.pool_in_use.append(engine.pool.checkedout())
        path = request.url.path
        if path in self.unreachable:
            raise httpx.ConnectError("connection refused", request=request)
        if request.method == "PUT" and path == "/v1/config":
            return httpx.Response(self.put_status, json=self.put_body)
        if path in self.statuses:
            body = self.status_bodies.get(path, {"error": {"message": "nope"}})
            return httpx.Response(self.statuses[path], json=body)
        if path == "/v1/config":
            return httpx.Response(200, json=self.config)
        return httpx.Response(200, json=GET_BODIES[path])


@pytest.fixture
def janus(monkeypatch: pytest.MonkeyPatch) -> FakeJanus:
    """Janus running beside us, faked at the transport.

    `conftest.py` forces the settings off for the whole suite, so a test that wants Janus
    reachable asks for this. All three settings, because the page is configured only when
    the agent is installed *and* the API has a bearer.
    """
    monkeypatch.setattr(settings, "JANUS_AGUI_URL", AGUI_URL)
    monkeypatch.setattr(settings, "JANUS_SIGNING_SECRET", "shared-with-the-container")
    monkeypatch.setattr(settings, "JANUS_API_SERVER_KEY", API_KEY)
    fake = FakeJanus()
    monkeypatch.setattr(
        janus_console, "open_client", lambda: httpx.AsyncClient(transport=fake.transport())
    )
    return fake


@pytest.fixture
def janus_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """Nothing beside us. Forced rather than assumed: a developer's own `.env` may name a
    key, and `conftest.py` only blanks the URL and the secret."""
    monkeypatch.setattr(settings, "JANUS_API_SERVER_KEY", None)


async def audit_rows(action: str) -> list[dict[str, Any]]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT action, metadata::text AS metadata FROM audit_events WHERE action = :a"
                ),
                {"a": action},
            )
        ).fetchall()
    return [{"action": row.action, "metadata": row.metadata} for row in rows]


class TestApiBase:
    def test_the_api_base_is_the_agui_origin(self, janus: FakeJanus) -> None:
        # Derived, never a second setting: it is the same server by construction, and a
        # second URL is a second thing to get wrong.
        assert janus_console.api_base() == "http://janus:8642"

    def test_configured_needs_all_three(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "JANUS_AGUI_URL", AGUI_URL)
        monkeypatch.setattr(settings, "JANUS_SIGNING_SECRET", "secret")
        monkeypatch.setattr(settings, "JANUS_API_SERVER_KEY", None)
        assert janus_console.configured() is False
        monkeypatch.setattr(settings, "JANUS_API_SERVER_KEY", API_KEY)
        assert janus_console.configured() is True


class TestRedaction:
    """The rule for a credential written into `config.yaml` by hand.

    Blob's own, not Janus's: Janus returns the file as written, which is right for the
    thing that owns it, and Blob is the only reader that puts it on a web page.
    """

    def test_only_the_value_goes(self) -> None:
        raw = (
            "model:\n"
            "  default: deepseek-v4-pro   # not a secret\n"
            "custom_providers:\n"
            "  house:\n"
            f'    api_key: "{INLINE}"\n'
            "telegram:\n"
            f"  bot_token: {INLINE}\n"
        )
        out = janus_console.redact_secrets(raw)
        assert INLINE not in out
        assert '    api_key: "«redacted»"\n' in out
        assert "  bot_token: «redacted»\n" in out
        # Everything that is not a credential is the operator's file, untouched.
        assert "  default: deepseek-v4-pro   # not a secret\n" in out

    def test_a_commented_out_key_is_still_a_key(self) -> None:
        # How somebody keeps the old key around while trying a new one. On a web page it
        # is as much a credential as the live line.
        out = janus_console.redact_secrets(f"# api_key: {INLINE}\n")
        assert INLINE not in out
        assert out == "# api_key: «redacted»\n"

    def test_a_value_too_short_to_be_a_credential_is_not_a_scrub_needle(self) -> None:
        # Redacted from the file all the same — that costs nothing — but not turned into
        # a needle: "TODO" appearing in an error message is not a leak, and replacing it
        # would mangle the sentence an operator has to read.
        assert janus_console.secret_values_in("api_key: TODO\n") == ()
        assert janus_console.redact_secrets("api_key: TODO\n") == "api_key: «redacted»\n"

    def test_a_file_with_no_credentials_comes_back_byte_for_byte(self) -> None:
        raw = "model:\n  default: deepseek-v4-pro\nagent:\n  max_turns: 60\n"
        assert janus_console.redact_secrets(raw) == raw
        assert janus_console.secret_values_in(raw) == ()

    def test_an_environment_reference_is_not_a_credential(self) -> None:
        # `${VAR}` is Janus's documented way of keeping a key *out* of the file
        # (website/docs/user-guide/configuration.md). Redacting it would show a
        # placeholder for something that was never secret and, worse, make the file
        # unsaveable — see `TestUpdate` for that half.
        raw = (
            "auxiliary:\n"
            "  vision:\n"
            "    api_key: ${GOOGLE_API_KEY}\n"
            "delegation:\n"
            '  api_key: "${HOST}:${PORT}"\n'
        )
        assert janus_console.redact_secrets(raw) == raw
        assert janus_console.secret_values_in(raw) == ()

    def test_a_bare_dollar_name_is_not_a_reference(self) -> None:
        # The same docs: "Only the `${VAR}` syntax is supported — bare `$VAR` is not
        # expanded." So `$SOMETHING` is a literal string Janus would send as the key,
        # which makes it a credential like any other.
        out = janus_console.redact_secrets("api_key: $GOOGLE_API_KEY\n")
        assert out == "api_key: «redacted»\n"

    def test_a_reference_with_a_literal_beside_it_is_still_a_credential(self) -> None:
        # Half a reference and half a value: the literal half is exactly where a key
        # would hide.
        out = janus_console.redact_secrets(f"api_key: ${{PREFIX}}{INLINE}\n")
        assert INLINE not in out
        assert out == "api_key: «redacted»\n"

    def test_an_empty_or_absent_value_is_left_alone(self) -> None:
        for raw in ('api_key: ""\n', "api_key: ''\n", "api_key:\n", "api_key: \n"):
            assert janus_console.redact_secrets(raw) == raw
            assert janus_console.secret_values_in(raw) == ()

    def test_yaml_s_ways_of_writing_nothing_are_left_alone(self) -> None:
        for raw in ("api_key: null\n", "api_key: ~\n", "api_key: Null\n"):
            assert janus_console.redact_secrets(raw) == raw
            assert janus_console.secret_values_in(raw) == ()

    def test_an_empty_key_does_not_swallow_the_line_below_it(self) -> None:
        # The line rule stops at the newline. Before it did not, and `api_key:` with
        # nothing after it redacted the *next* line and turned `base_url:` into a scrub
        # needle — which then rewrote every `base_url:` in Janus's answers to `***`.
        raw = "custom_providers:\n  house:\n    api_key:\n    base_url: https://house.example/v1\n"
        assert janus_console.redact_secrets(raw) == raw
        assert janus_console.secret_values_in(raw) == ()

    def test_a_key_in_a_sequence_item_is_redacted(self) -> None:
        raw = f"providers:\n  - id: house\n  - api_key: {INLINE}\n"
        out = janus_console.redact_secrets(raw)
        assert INLINE not in out
        assert "  - api_key: «redacted»\n" in out
        assert janus_console.secret_values_in(raw) == (INLINE,)

    def test_a_hash_inside_a_value_belongs_to_the_value(self) -> None:
        # YAML starts a comment at `#` only after whitespace, so `sk-ab#cd` is one
        # scalar. Stopping at the `#` left `#cd` — the tail of a key — on the page.
        out = janus_console.redact_secrets("api_key: sk-ab#cd-9f3c7a21\n")
        assert out == "api_key: «redacted»\n"
        assert janus_console.secret_values_in("api_key: sk-ab#cd-9f3c7a21\n") == (
            "sk-ab#cd-9f3c7a21",
        )

    def test_a_real_comment_after_a_value_survives(self) -> None:
        out = janus_console.redact_secrets(f"api_key: {INLINE}   # from the dashboard\n")
        assert INLINE not in out
        assert out == "api_key: «redacted»   # from the dashboard\n"

    def test_the_other_spellings_of_the_same_key_are_keys_too(self) -> None:
        # Janus's own file writes `api_key`, but a `custom_providers` block is copied out
        # of whatever the provider's own documentation shows, and both of these are how
        # real SDKs spell it. A spelling the pattern misses is a live key on a web page.
        for line in (f"  api-key: {INLINE}\n", f"  apiKey: {INLINE}\n"):
            out = janus_console.redact_secrets(line)
            assert INLINE not in out
            assert out == line.replace(INLINE, "«redacted»")
            assert janus_console.secret_values_in(line) == (INLINE,)


class TestOverview:
    async def test_it_composes_the_five_routes_and_blobs_own_facts(
        self, janus: FakeJanus, client: Client
    ) -> None:
        founder = await sign_up(client, "Founder")

        body = (await founder.get("/api/admin/janus")).body
        assert body["health"]["data"] == {"status": "ok", "platform": "janus-agent"}
        assert body["health"]["error"] is None
        assert body["capabilities"]["data"]["platform"] == "janus-agent"
        assert body["config"]["data"]["model"]["default"] == "deepseek-v4-pro"
        assert body["skills"]["data"]["data"][0]["name"] == "brainstorming"
        assert body["toolsets"]["data"]["data"][0]["name"] == "janus-cli"
        # Blob's own half of the page: where the agent is and whether it can be signed to.
        assert body["aguiUrl"] == AGUI_URL
        assert body["secretSet"] is True

        # Bearer on every one of them, and the five asked for concurrently.
        assert sorted(request.url.path for request in janus.seen) == [
            "/health",
            "/v1/capabilities",
            "/v1/config",
            "/v1/skills",
            "/v1/toolsets",
        ]
        assert {request.headers["authorization"] for request in janus.seen} == {f"Bearer {API_KEY}"}

    async def test_one_failing_route_degrades_only_its_own_tile(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # "Fail toward the workspace staying up", one tile down: the page still shows the
        # model and the health while the skills list is unavailable.
        janus.unreachable.add("/v1/skills")
        founder = await sign_up(client, "Founder")

        body = (await founder.get("/api/admin/janus")).body
        assert body["skills"]["data"] is None
        assert "ConnectError" in body["skills"]["error"]
        assert body["health"]["data"] is not None
        assert body["config"]["data"]["version"] == "0.17.0"

    async def test_a_rejected_bearer_names_the_setting_that_is_wrong(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # One value in the operator's `.env` reaches Blob as JANUS_API_SERVER_KEY and the
        # service as API_SERVER_KEY, and they drift the day somebody rotates one. A bare
        # "401" would leave that as a number to look up.
        janus.statuses["/v1/config"] = 401
        founder = await sign_up(client, "Founder")

        body = (await founder.get("/api/admin/janus")).body
        assert body["config"]["data"] is None
        assert body["config"]["error"] == "Janus rejected JANUS_API_SERVER_KEY."
        assert API_KEY not in json.dumps(body)
        assert body["health"]["data"] is not None

    async def test_a_key_value_never_reaches_the_overview(
        self, janus: FakeJanus, client: Client
    ) -> None:
        founder = await sign_up(client, "Founder")

        response = await founder.get("/api/admin/janus")
        assert PLANTED not in json.dumps(response.body)
        # The mask itself survives: presence and the tail are the whole of what a page
        # may say about a key.
        deepseek = response.body["config"]["data"]["providers"][0]
        assert deepseek["key"] == {"set": True, "tail": "a4f2"}
        assert response.body["config"]["data"]["providers"][1]["key"] == {"set": False}

    async def test_a_managed_install_says_so_on_the_read_tile_too(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # `is_managed()` refuses the read as well as the write, and "Janus answered 409."
        # is a number to look up. The `PUT` path already answers in Janus's words.
        janus.statuses["/v1/config"] = 409
        janus.status_bodies["/v1/config"] = {"error": "configuration is managed"}
        founder = await sign_up(client, "Founder")

        body = (await founder.get("/api/admin/janus")).body
        assert body["config"]["data"] is None
        assert body["config"]["error"] == "configuration is managed"

    async def test_a_managed_install_with_nothing_to_say_still_says_something(
        self, janus: FakeJanus, client: Client
    ) -> None:
        janus.statuses["/v1/config"] = 409
        janus.status_bodies["/v1/config"] = {}
        founder = await sign_up(client, "Founder")

        body = (await founder.get("/api/admin/janus")).body
        assert body["config"]["error"] == "Janus's configuration is managed elsewhere."

    async def test_a_key_written_into_the_file_is_redacted_out_of_raw(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # Janus returns config.yaml verbatim, and a `custom_providers` entry carries its
        # own `api_key`. Blob is the only thing that shows that file to a browser, so Blob
        # is where it stops.
        janus.config = {
            **config_body(),
            "raw": (
                "model:\n"
                "  default: deepseek-v4-pro\n"
                "custom_providers:\n"
                "  house:\n"
                f"    api_key: {INLINE}\n"
                "    base_url: https://house.example/v1\n"
                "# a comment that must survive\n"
            ),
        }
        founder = await sign_up(client, "Founder")

        raw = (await founder.get("/api/admin/janus")).body["config"]["data"]["raw"]
        assert INLINE not in raw
        assert INLINE[-4:] not in raw
        assert "    api_key: «redacted»\n" in raw
        # Only the value goes. The rest is the operator's file, byte for byte.
        assert raw == janus.config["raw"].replace(INLINE, "«redacted»")

    async def test_no_database_connection_is_held_while_janus_is_asked(
        self, janus: FakeJanus, client: Client
    ) -> None:
        founder = await sign_up(client, "Founder")

        assert (await founder.get("/api/admin/janus")).status == 200
        # Five requests, none of them made while this request held a connection. Janus's
        # own `/v1/config` budgets ten seconds for a live provider call, and a pool of
        # thirty spent on waiting for that is how one slow provider takes the workspace
        # down with it.
        assert janus.pool_in_use == [0, 0, 0, 0, 0]

    async def test_installs_lists_the_seeded_row_and_not_a_persons_own(
        self, janus: FakeJanus, client: Client
    ) -> None:
        founder = await sign_up(client, "Founder")
        here = await workspace_id_of(founder)

        # A second workspace whose `janus` row belongs to a person, and a third whose row
        # is a container agent. Both wear the slug; neither is the agent this server runs.
        owned = (await founder.post("/api/admin/instance/workspaces", {"name": "Owned"})).body["id"]
        containered = (
            await founder.post("/api/admin/instance/workspaces", {"name": "Containered"})
        ).body["id"]
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text(
                        """
                        UPDATE plugins SET owner_user_id =
                          (SELECT id FROM users WHERE workspace_id = :ws AND role = 'owner'
                            LIMIT 1)
                         WHERE workspace_id = :ws AND slug = 'janus'
                        """
                    ),
                    {"ws": owned},
                )
                await session.execute(
                    text(
                        "UPDATE plugins SET runtime = 'container', source_repo = 'a/b'"
                        " WHERE workspace_id = :ws AND slug = 'janus'"
                    ),
                    {"ws": containered},
                )

        installs = (await founder.get("/api/admin/janus")).body["installs"]
        assert [row["workspaceName"] for row in installs] == ["Test Workspace"]
        row = installs[0]
        assert row["workspaceId"] == here
        assert row["isThisWorkspace"] is True
        assert row["status"] == "enabled"
        # #general and #random, joined at seeding.
        assert row["channelCount"] == 2
        assert row["runsLastWeek"] == 0

    async def test_a_workspace_admin_who_does_not_run_the_server_is_refused(
        self, janus: FakeJanus, client: Client
    ) -> None:
        founder = await sign_up(client, "Founder")
        admin = await invite_and_sign_up(founder, "Admin", role="admin")

        assert (await admin.get("/api/admin/janus")).status == 403
        assert (await admin.put("/api/admin/janus/config", {"raw": "model: {}"})).status == 403
        assert (await admin.post("/api/admin/janus/restart")).status == 403

    async def test_every_route_says_so_when_janus_is_not_in_this_stack(
        self, janus_off: None, client: Client
    ) -> None:
        founder = await sign_up(client, "Founder")

        for response in (
            await founder.get("/api/admin/janus"),
            await founder.put("/api/admin/janus/config", {"raw": "model: {}"}),
            await founder.post("/api/admin/janus/restart"),
        ):
            assert response.status == 400
            assert response.body["error"]["code"] == "janus_not_configured"

    async def test_the_agent_without_the_api_key_is_still_not_configured(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The agent answers mentions on the signing secret alone; this page needs the
        # bearer as well, and says which half is missing rather than pretending nothing
        # is running.
        monkeypatch.setattr(settings, "JANUS_AGUI_URL", AGUI_URL)
        monkeypatch.setattr(settings, "JANUS_SIGNING_SECRET", "shared")
        monkeypatch.setattr(settings, "JANUS_API_SERVER_KEY", None)
        founder = await sign_up(client, "Founder")

        response = await founder.get("/api/admin/janus")
        assert response.status == 400
        assert response.body["error"]["code"] == "janus_not_configured"


class TestUpdate:
    async def test_it_forwards_exactly_the_fields_it_was_given(
        self, janus: FakeJanus, client: Client
    ) -> None:
        founder = await sign_up(client, "Founder")

        response = await founder.put(
            "/api/admin/janus/config",
            {
                "model": {"default": "deepseek-flash"},
                "apiKeys": {"DEEPSEEK_API_KEY": PLANTED},
                "restart": True,
            },
        )
        assert response.status == 200
        # Janus's own answer, carried through: the page reports what landed.
        assert response.body["applied"] == APPLIED_BODY["applied"]
        assert response.body["warnings"][0]["message"] == "toolset 'web' has no key"
        assert response.body["restarting"] is True
        assert response.body["drainTimeoutSeconds"] == 180.0
        # The success path is a Blob response like any other, and the rule is every one.
        assert PLANTED not in json.dumps(response.body)

        put = janus.seen[-1]
        assert put.method == "PUT"
        assert put.url.path == "/v1/config"
        assert put.headers["authorization"] == f"Bearer {API_KEY}"
        # snake_case at the boundary, and *only* what was asked for: a field the caller
        # left out must not arrive as null and clear a setting.
        assert json.loads(put.content) == {
            "model": {"default": "deepseek-flash"},
            "api_keys": {"DEEPSEEK_API_KEY": PLANTED},
            "restart": True,
        }
        # One request, and no connection checked out while it was in flight. The route
        # opens a transaction around the whole handler, but nothing touches the session
        # until the audit row is written — which is *after* Janus answers, on purpose. A
        # `PUT` costs Janus a file write and a restart, so this is the twelve seconds the
        # pool must not be spent on.
        assert janus.pool_in_use == [0]

    async def test_toolsets_and_raw_go_through_untouched(
        self, janus: FakeJanus, client: Client
    ) -> None:
        founder = await sign_up(client, "Founder")

        await founder.put("/api/admin/janus/config", {"toolsets": ["janus-cli", "web"]})
        assert json.loads(janus.seen[-1].content) == {"toolsets": ["janus-cli", "web"]}

        await founder.put(
            "/api/admin/janus/config", {"raw": "model:\n  default: x\n", "restart": False}
        )
        assert json.loads(janus.seen[-1].content) == {
            "raw": "model:\n  default: x\n",
            "restart": False,
        }

    async def test_a_raw_carrying_a_real_key_is_forwarded_as_written(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # Redaction is what the *overview* does to the file on the way out. On the way in
        # a real key is the operator's to write, and Blob does not touch it.
        raw = f"custom_providers:\n  house:\n    api_key: {INLINE}\n"
        founder = await sign_up(client, "Founder")

        response = await founder.put("/api/admin/janus/config", {"raw": raw})
        assert response.status == 200
        assert json.loads(janus.seen[-1].content) == {"raw": raw}

    async def test_a_file_that_keeps_its_keys_in_the_environment_still_saves(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # The keyless config Janus documents. Redacting `${GOOGLE_API_KEY}` made the
        # Advanced tab unsaveable: the page showed a placeholder for a reference that was
        # never secret, and saving it back was refused with advice — "put the key back" —
        # that is wrong in exactly this case, because there is no key to put back.
        raw = "auxiliary:\n  vision:\n    api_key: ${GOOGLE_API_KEY}\n"
        janus.config = {**config_body(), "raw": raw}
        founder = await sign_up(client, "Founder")

        shown = (await founder.get("/api/admin/janus")).body["config"]["data"]["raw"]
        assert shown == raw

        response = await founder.put("/api/admin/janus/config", {"raw": shown})
        assert response.status == 200
        assert json.loads(janus.seen[-1].content) == {"raw": raw}

    async def test_a_key_too_short_to_be_one_is_not_a_scrub_needle(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # `OLLAMA_API_KEY=none` is what a local model wants. Forwarded untouched — what
        # counts as a key is Janus's to judge — but not used as a needle, or every "none"
        # in Janus's own words comes back as `***`.
        janus.put_body = {
            "applied": {"api_keys": ["OLLAMA_API_KEY"]},
            "warnings": [
                {"severity": "warning", "message": "none of the toolsets have keys", "hint": ""}
            ],
            "restarting": False,
            "drain_timeout_seconds": 0.0,
        }
        founder = await sign_up(client, "Founder")

        response = await founder.put(
            "/api/admin/janus/config", {"apiKeys": {"OLLAMA_API_KEY": "none"}}
        )
        assert response.status == 200
        assert response.body["warnings"][0]["message"] == "none of the toolsets have keys"
        # Still sent as written: Blob does not decide what is a usable key.
        assert json.loads(janus.seen[-1].content) == {"api_keys": {"OLLAMA_API_KEY": "none"}}

    async def test_a_key_echoed_as_a_dict_key_is_scrubbed_too(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # `_scrub_tree` walked values and not keys, and `_masked_applied` then published
        # the keys of `applied.api_keys` as names.
        janus.put_body = {
            "applied": {"api_keys": {PLANTED: "written"}},
            "warnings": [{"severity": "warning", "message": "ok", "hint": PLANTED}],
            "restarting": False,
            "drain_timeout_seconds": 0.0,
        }
        founder = await sign_up(client, "Founder")

        response = await founder.put(
            "/api/admin/janus/config", {"apiKeys": {"DEEPSEEK_API_KEY": PLANTED}}
        )
        assert response.status == 200
        assert PLANTED not in json.dumps(response.body)

    async def test_a_raw_that_still_holds_the_placeholder_never_reaches_janus(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # The other half of redaction. Saving the text the page showed would write the
        # placeholder into config.yaml as the key, and the next run would fail with a
        # credential that is a word.
        founder = await sign_up(client, "Founder")

        response = await founder.put(
            "/api/admin/janus/config",
            {"raw": "custom_providers:\n  house:\n    api_key: «redacted»\n"},
        )
        assert response.status == 400
        assert response.body["error"]["code"] == "janus_raw_redacted"
        assert response.body["error"]["message"] == (
            "The file still holds a redacted key. Put the key back, or move it to the environment."
        )
        assert janus.seen == []
        assert await audit_rows("janus.config_changed") == []

    async def test_a_key_inline_in_the_submitted_raw_does_not_come_back_in_the_error(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # PyYAML quotes the line it choked on, and Janus relays its text. That line can be
        # the one holding a key, which `apiKeys`-only scrubbing would never have seen.
        raw = f"custom_providers:\n  house:\n    api_key: {INLINE}\n  broken: [1, 2\n"
        janus.put_status = 400
        janus.put_body = {
            "error": (
                "raw is not valid YAML: while parsing a flow sequence\n"
                '  in "<unicode string>", line 4, column 12\n'
                f"    api_key: {INLINE}\n"
                "expected ',' or ']', but got '<stream end>'"
            )
        }
        founder = await sign_up(client, "Founder")

        response = await founder.put("/api/admin/janus/config", {"raw": raw})
        assert response.status == 400
        assert response.body["error"]["code"] == "janus_refused"
        serialised = json.dumps(response.body)
        assert INLINE not in serialised
        assert INLINE[-4:] not in serialised
        # The parse error is still worth reading — that is why it is relayed at all.
        assert "raw is not valid YAML" in response.body["error"]["message"]

    async def test_a_key_inline_in_raw_is_scrubbed_from_the_issues_too(
        self, janus: FakeJanus, client: Client
    ) -> None:
        raw = f"custom_providers:\n  house:\n    api_key: {INLINE}\n"
        janus.put_status = 400
        janus.put_body = {
            "error": "invalid config",
            "issues": [
                {
                    "severity": "error",
                    "message": f"custom_providers.house: {INLINE} is not a provider",
                    "hint": f"remove {INLINE}",
                }
            ],
        }
        founder = await sign_up(client, "Founder")

        response = await founder.put("/api/admin/janus/config", {"raw": raw})
        assert response.status == 400
        assert INLINE not in json.dumps(response.body)
        assert "is not a provider" in response.body["error"]["detail"]["issues"][0]["message"]

    async def test_the_audit_row_names_the_key_and_carries_no_value(
        self, janus: FakeJanus, client: Client
    ) -> None:
        founder = await sign_up(client, "Founder")

        await founder.put(
            "/api/admin/janus/config",
            {
                "agent": {"reasoning_effort": "high"},
                "apiKeys": {"DEEPSEEK_API_KEY": PLANTED},
            },
        )

        rows = await audit_rows("janus.config_changed")
        assert len(rows) == 1
        metadata = json.loads(rows[0]["metadata"])
        assert metadata["fields"] == ["agent", "apiKeys"]
        assert metadata["apiKeys"] == ["DEEPSEEK_API_KEY"]
        assert PLANTED not in rows[0]["metadata"]

    async def test_nothing_is_audited_when_janus_refuses(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # The log says what happened, not what was attempted: a row reading
        # "config changed" for a change Janus never wrote is worse than no row.
        janus.put_status = 400
        janus.put_body = {"error": "empty body"}
        founder = await sign_up(client, "Founder")

        await founder.put("/api/admin/janus/config", {"model": {"default": "x"}})
        assert await audit_rows("janus.config_changed") == []

    async def test_a_refusal_comes_back_as_the_first_issue(
        self, janus: FakeJanus, client: Client
    ) -> None:
        janus.put_status = 400
        janus.put_body = {
            "error": "invalid config",
            "issues": [
                {
                    "severity": "error",
                    "message": "model must be a mapping",
                    "hint": "model.default",
                },
                {"severity": "warning", "message": "and another thing", "hint": ""},
            ],
        }
        founder = await sign_up(client, "Founder")

        response = await founder.put("/api/admin/janus/config", {"raw": "model: 3\n"})
        assert response.status == 400
        assert response.body["error"]["code"] == "janus_refused"
        assert response.body["error"]["message"] == "model must be a mapping"
        # The whole list travels, so the editor can show every issue beside the text.
        assert response.body["error"]["detail"]["issues"] == janus.put_body["issues"]

    async def test_a_refusal_with_no_issues_carries_janus_s_own_words(
        self, janus: FakeJanus, client: Client
    ) -> None:
        janus.put_status = 400
        janus.put_body = {"error": "raw cannot be combined with model, agent or toolsets"}
        founder = await sign_up(client, "Founder")

        response = await founder.put(
            "/api/admin/janus/config", {"raw": "a: 1", "model": {"default": "x"}}
        )
        assert response.status == 400
        assert response.body["error"]["code"] == "janus_refused"
        assert response.body["error"]["message"] == (
            "raw cannot be combined with model, agent or toolsets"
        )

    async def test_a_managed_install_is_refused_in_janus_s_words(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # 409: a NixOS or systemd-managed Janus owns its own config and a page that let
        # you edit it would be lying.
        janus.put_status = 409
        janus.put_body = {"error": "configuration is managed"}
        founder = await sign_up(client, "Founder")

        response = await founder.put("/api/admin/janus/config", {"model": {"default": "x"}})
        assert response.status == 400
        assert response.body["error"]["code"] == "janus_refused"
        assert response.body["error"]["message"] == "configuration is managed"

    async def test_a_refusal_that_echoes_the_key_does_not_relay_it(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # Belt and braces on the error path. Janus never echoes a value; a proxy or a
        # future release might, and the one place a key Blob is *holding* could escape is
        # a message built out of somebody else's answer.
        janus.put_status = 400
        janus.put_body = {"error": f"DEEPSEEK_API_KEY: {PLANTED} is not ASCII"}
        founder = await sign_up(client, "Founder")

        response = await founder.put(
            "/api/admin/janus/config", {"apiKeys": {"DEEPSEEK_API_KEY": PLANTED}}
        )
        assert response.status == 400
        assert PLANTED not in json.dumps(response.body)
        assert "DEEPSEEK_API_KEY" in response.body["error"]["message"]

    async def test_janus_not_answering_is_its_own_code(
        self, janus: FakeJanus, client: Client
    ) -> None:
        janus.unreachable.add("/v1/config")
        founder = await sign_up(client, "Founder")

        response = await founder.put("/api/admin/janus/config", {"model": {"default": "x"}})
        assert response.status == 400
        assert response.body["error"]["code"] == "janus_unreachable"
        assert response.body["error"]["message"] == "Janus did not answer."

    async def test_a_rejected_bearer_reads_as_unreachable(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # A 401 means JANUS_API_SERVER_KEY does not match the service's. That is an
        # operator fact for the log, not a distinction the page can act on differently.
        janus.put_status = 401
        janus.put_body = {"error": {"message": "Invalid API key"}}
        founder = await sign_up(client, "Founder")

        response = await founder.put("/api/admin/janus/config", {"model": {"default": "x"}})
        assert response.status == 400
        assert response.body["error"]["code"] == "janus_unreachable"

    async def test_an_empty_change_is_refused_before_it_is_sent(
        self, janus: FakeJanus, client: Client
    ) -> None:
        founder = await sign_up(client, "Founder")

        response = await founder.put("/api/admin/janus/config", {})
        assert response.status == 400
        # Blob's own refusal, not Janus's: `janus_refused` means Janus saw this and said
        # no, and a code that lies about who refused sends the next reader to the wrong
        # logs.
        assert response.body["error"]["code"] == "janus_empty_change"
        assert response.body["error"]["message"] == "Nothing to change."
        assert janus.seen == []

    async def test_a_success_body_that_echoes_a_key_does_not_relay_it(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # The 200 is a Blob response like any other. It was the one Janus answer going
        # out unscrubbed, which made the rule depend on Janus keeping its promise.
        janus.put_body = {
            "applied": {"api_keys": {"DEEPSEEK_API_KEY": PLANTED}},
            "warnings": [
                {
                    "severity": "warning",
                    "message": f"DEEPSEEK_API_KEY was already {PLANTED}",
                    "hint": "",
                }
            ],
            "restarting": False,
            "drain_timeout_seconds": 180.0,
        }
        founder = await sign_up(client, "Founder")

        response = await founder.put(
            "/api/admin/janus/config", {"apiKeys": {"DEEPSEEK_API_KEY": PLANTED}}
        )
        assert response.status == 200
        assert PLANTED not in json.dumps(response.body)
        # `applied.api_keys` is a list of names on Janus's side. Anything shaped like a
        # name-to-value map is narrowed to the names.
        assert response.body["applied"]["api_keys"] == ["DEEPSEEK_API_KEY"]
        assert "DEEPSEEK_API_KEY was already ***" in response.body["warnings"][0]["message"]
        assert PLANTED not in json.dumps(await audit_rows("janus.config_changed"))

    async def test_a_malformed_address_is_unreachable_rather_than_a_crash(
        self, janus: FakeJanus, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A JANUS_AGUI_URL with no scheme leaves `api_base()` with nothing to build on.
        # That is an operator's typo in an env file, and it must read as "Janus did not
        # answer", not as a 500 with a stack trace in the log.
        monkeypatch.setattr(settings, "JANUS_AGUI_URL", "//janus:8642/v1/agui")
        founder = await sign_up(client, "Founder")

        response = await founder.put("/api/admin/janus/config", {"model": {"default": "x"}})
        assert response.status == 400
        assert response.body["error"]["code"] == "janus_unreachable"

    async def test_a_junk_drain_timeout_is_read_as_no_timeout(
        self, janus: FakeJanus, client: Client
    ) -> None:
        # `_applied` promises to read Janus's body defensively; a number that arrived as
        # a word used to be the one field that took the promise back.
        janus.put_body = {
            "applied": {},
            "warnings": [],
            "restarting": True,
            "drain_timeout_seconds": "about three minutes",
        }
        founder = await sign_up(client, "Founder")

        response = await founder.put("/api/admin/janus/config", {"model": {"default": "x"}})
        assert response.status == 200
        assert response.body["drainTimeoutSeconds"] == 0.0


class TestRestart:
    async def test_restart_asks_for_one_and_writes_nothing(
        self, janus: FakeJanus, client: Client
    ) -> None:
        janus.put_body = {
            "applied": {},
            "warnings": [],
            "restarting": True,
            "drain_timeout_seconds": 180.0,
        }
        founder = await sign_up(client, "Founder")

        response = await founder.post("/api/admin/janus/restart")
        assert response.status == 200
        assert response.body["restarting"] is True
        assert response.body["applied"] == {}
        # A restart-only body: "apply what is already on disk" is a real request, and the
        # one Janus answers with `applied: {}`.
        assert json.loads(janus.seen[-1].content) == {"restart": True}

        rows = await audit_rows("janus.restarted")
        assert len(rows) == 1

    async def test_restart_reports_a_janus_that_is_not_there(
        self, janus: FakeJanus, client: Client
    ) -> None:
        janus.unreachable.add("/v1/config")
        founder = await sign_up(client, "Founder")

        response = await founder.post("/api/admin/janus/restart")
        assert response.status == 400
        assert response.body["error"]["code"] == "janus_unreachable"
