"""The agent terminal: 600 lines guarding an SSH key, previously guarded by nothing.

Three tiers. The pure guards (size clamping, key parsing, host-key handling) run with no
I/O at all. `resolve` runs against the database, because what it decides — whose agent,
which policy — is database-shaped. The audit bracket runs against a fake shell, because
what matters there is the record, not the PTY.
"""

from __future__ import annotations

import asyncssh
import pytest
from sqlalchemy import text as sql

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.lib.errors import AppError
from blob_api.plugins import shell
from blob_api.services import agent_shell as agent_shell_service
from blob_api.services.audit import Actor

from .helpers import Client, allow_policy, workspace_id_of
from .test_agent_hosting import (  # noqa: F401  (fixtures)
    Runner,
    _resolve_the_example_host,
    hosted,
    install,
    owner_who_may_host,
)

# ─── the pure guards ──────────────────────────────────────────────────────────


class TestClampSize:
    def test_garbage_becomes_the_default(self) -> None:
        assert shell.clamp_size("not-a-number", None) == (80, 24)
        assert shell.clamp_size({}, []) == (80, 24)

    def test_out_of_range_is_pinned_not_refused(self) -> None:
        # A tab minimised to zero columns is a resize, not an attack; dropping the
        # session over it would be absurd. But the browser is not a trusted source of
        # small integers, so the range is enforced.
        assert shell.clamp_size(0, 100_000) == (shell.MIN_COLS, shell.MAX_ROWS)
        assert shell.clamp_size(-5, -5) == (shell.MIN_COLS, shell.MIN_ROWS)

    def test_a_reasonable_window_passes_through(self) -> None:
        assert shell.clamp_size(120, 30) == (120, 30)
        assert shell.clamp_size("120", "30") == (120, 30)


def _fresh_key_text() -> str:
    return asyncssh.generate_private_key("ssh-ed25519").export_private_key().decode()


class TestClientKey:
    def test_a_key_with_real_newlines_is_read(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "AGENT_SHELL_KEY", _fresh_key_text())
        assert shell._client_key() is not None

    def test_a_key_with_escaped_newlines_is_read(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # A private key pasted into a dashboard env field arrives with literal \n about
        # half the time. This exact mistake corrupted the live server's env once.
        escaped = _fresh_key_text().strip().replace("\n", "\\n")
        monkeypatch.setattr(settings, "AGENT_SHELL_KEY", escaped)
        assert shell._client_key() is not None

    def test_missing_reads_as_disabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "AGENT_SHELL_KEY", None)
        with pytest.raises(AppError) as caught:
            shell._client_key()
        assert caught.value.code == "shell_disabled"

    def test_garbage_is_a_config_error_not_a_request_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "AGENT_SHELL_KEY", "not a key at all")
        with pytest.raises(AppError) as caught:
            shell._client_key()
        assert caught.value.code == "shell_bad_key"
        assert caught.value.status_code == 500


class TestKnownHosts:
    def test_a_bare_type_key_pair_gets_the_host_prepended(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        public = asyncssh.generate_private_key("ssh-ed25519").export_public_key().decode().strip()
        monkeypatch.setattr(settings, "AGENT_SHELL_HOST", "agents.test")
        monkeypatch.setattr(settings, "AGENT_SHELL_PORT", 22)
        monkeypatch.setattr(settings, "AGENT_SHELL_HOST_KEY", public)
        assert shell._known_hosts() is not None

    def test_a_nondefault_port_uses_the_bracket_form(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # known_hosts writes `[host]:2222` for non-default ports; a line written for 22
        # does not match a connection to 2222, and the failure would read as an attack.
        public = asyncssh.generate_private_key("ssh-ed25519").export_public_key().decode().strip()
        monkeypatch.setattr(settings, "AGENT_SHELL_HOST", "agents.test")
        monkeypatch.setattr(settings, "AGENT_SHELL_PORT", 2222)
        monkeypatch.setattr(settings, "AGENT_SHELL_HOST_KEY", public)
        known = shell._known_hosts()
        assert known.match("[agents.test]:2222", "", 2222)[0]

    def test_missing_reads_as_disabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "AGENT_SHELL_HOST_KEY", "")
        with pytest.raises(AppError) as caught:
            shell._known_hosts()
        assert caught.value.code == "shell_disabled"


class TestCurrentShell:
    def test_off_is_a_normal_state_with_a_name(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "AGENT_SHELL", "disabled")
        with pytest.raises(AppError) as caught:
            shell.current_shell()
        assert caught.value.code == "shell_disabled"

    def test_partially_configured_is_still_off(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # A host without a host key would mean connecting unverified. There is no
        # partially-on: any missing half leaves the feature off.
        monkeypatch.setattr(settings, "AGENT_SHELL", "ssh")
        monkeypatch.setattr(settings, "AGENT_SHELL_HOST", "agents.test")
        monkeypatch.setattr(settings, "AGENT_SHELL_KEY", "something")
        monkeypatch.setattr(settings, "AGENT_SHELL_HOST_KEY", None)
        with pytest.raises(AppError) as caught:
            shell.current_shell()
        assert caught.value.code == "shell_disabled"


# ─── who may open one ─────────────────────────────────────────────────────────


def _enable_shell(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "AGENT_SHELL", "ssh")
    monkeypatch.setattr(settings, "AGENT_SHELL_HOST", "agents.test")
    monkeypatch.setattr(settings, "AGENT_SHELL_KEY", _fresh_key_text())
    monkeypatch.setattr(
        settings,
        "AGENT_SHELL_HOST_KEY",
        asyncssh.generate_private_key("ssh-ed25519").export_public_key().decode().strip(),
    )


async def _actor_for(owner: Client) -> Actor:
    return Actor(id=owner.user_id, workspace_id=await workspace_id_of(owner))


class TestResolve:
    async def test_a_hosted_agent_resolves_to_its_deployment(
        self,
        client: Client,
        hosted: Runner,  # noqa: F811
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _enable_shell(monkeypatch)
        owner = await owner_who_may_host(client)
        plugin_id = await install(owner)

        target = await agent_shell_service.resolve(await _actor_for(owner), plugin_id)
        assert target.plugin_id == plugin_id
        assert target.deployment_id

    async def test_an_unhosted_agent_has_no_terminal(
        self,
        client: Client,
        hosted: Runner,  # noqa: F811
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _enable_shell(monkeypatch)
        owner = await owner_who_may_host(client)
        plugin_id = await install(owner)
        async with SessionFactory() as session, session.begin():
            await session.execute(
                sql("UPDATE plugins SET deployment_id = NULL WHERE id = :id"),
                {"id": plugin_id},
            )

        with pytest.raises(AppError) as caught:
            await agent_shell_service.resolve(await _actor_for(owner), plugin_id)
        assert caught.value.code == "not_hosted"

    async def test_the_hosting_policy_gates_the_terminal_too(
        self,
        client: Client,
        hosted: Runner,  # noqa: F811
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Choosing what code runs in a container and getting inside it are the same
        # privilege; the check runs when the terminal opens, not when the console
        # loaded, so a policy flipped an hour ago holds.
        _enable_shell(monkeypatch)
        owner = await owner_who_may_host(client)
        plugin_id = await install(owner)
        await allow_policy(await workspace_id_of(owner), may_host_agents=False)

        with pytest.raises(AppError) as caught:
            await agent_shell_service.resolve(await _actor_for(owner), plugin_id)
        assert caught.value.code == "policy_forbidden"

    async def test_an_unconfigured_server_answers_before_touching_the_database(
        self,
        client: Client,
        hosted: Runner,  # noqa: F811
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "AGENT_SHELL", "disabled")
        owner = await owner_who_may_host(client)
        plugin_id = await install(owner)
        with pytest.raises(AppError) as caught:
            await agent_shell_service.resolve(await _actor_for(owner), plugin_id)
        assert caught.value.code == "shell_disabled"


# ─── the audit bracket ────────────────────────────────────────────────────────


class _FakeSession:
    exit_status: int | None = None

    async def read(self) -> bytes:
        return b""

    async def write(self, data: bytes) -> None: ...

    def resize(self, cols: int, rows: int) -> None: ...

    async def close(self) -> None: ...


class _FakeShell:
    async def open(self, deployment_id: str, *, cols: int, rows: int) -> _FakeSession:
        return _FakeSession()


class _RefusingShell:
    async def open(self, deployment_id: str, *, cols: int, rows: int) -> _FakeSession:
        raise AppError(502, "shell_refused", "no")


async def _audit_actions(workspace_id: str) -> list[str]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                sql(
                    """
                    SELECT action FROM audit_events
                     WHERE workspace_id = :ws AND action LIKE 'plugin.shell%'
                     ORDER BY id
                    """
                ),
                {"ws": workspace_id},
            )
        ).fetchall()
    return [row.action for row in rows]


class TestAuditBracket:
    async def test_open_and_close_are_both_recorded(
        self,
        client: Client,
        hosted: Runner,  # noqa: F811
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _enable_shell(monkeypatch)
        owner = await owner_who_may_host(client)
        plugin_id = await install(owner)
        actor = await _actor_for(owner)
        target = await agent_shell_service.resolve(actor, plugin_id)

        monkeypatch.setattr(shell, "current_shell", lambda: _FakeShell())
        monkeypatch.setattr(agent_shell_service.shell, "current_shell", lambda: _FakeShell())
        async with agent_shell_service.open_session(actor, target, cols=80, rows=24):
            pass

        assert await _audit_actions(actor.workspace_id) == [
            "plugin.shell_opened",
            "plugin.shell_closed",
        ]

    async def test_a_session_that_never_opens_still_leaves_its_record(
        self,
        client: Client,
        hosted: Runner,  # noqa: F811
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # The open is written before the PTY exists, deliberately: the sessions worth a
        # record are the ones that did not end tidily, and an open with no matching
        # close is that record.
        _enable_shell(monkeypatch)
        owner = await owner_who_may_host(client)
        plugin_id = await install(owner)
        actor = await _actor_for(owner)
        target = await agent_shell_service.resolve(actor, plugin_id)

        monkeypatch.setattr(agent_shell_service.shell, "current_shell", lambda: _RefusingShell())
        with pytest.raises(AppError):
            async with agent_shell_service.open_session(actor, target, cols=80, rows=24):
                pass  # pragma: no cover

        assert "plugin.shell_opened" in await _audit_actions(actor.workspace_id)


class TestResolveFromADm:
    """`/cli` names the agent by who the conversation is with, not by plugin id.

    The extra step is one column — `users.bot_plugin_id` — and everything after it is
    `resolve`, which is the point: a terminal opened from a DM must be gated by the
    checks a terminal opened from the console is, not by a second copy of them.
    """

    async def test_a_bot_user_resolves_to_the_agent_behind_it(
        self,
        client: Client,
        hosted: Runner,  # noqa: F811
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _enable_shell(monkeypatch)
        owner = await owner_who_may_host(client)
        plugin_id = await install(owner)
        async with SessionFactory() as session:
            bot_user_id = (
                await session.execute(
                    sql("SELECT id FROM users WHERE bot_plugin_id = :id"),
                    {"id": plugin_id},
                )
            ).scalar_one()

        target = await agent_shell_service.resolve_for_bot_user(
            await _actor_for(owner), str(bot_user_id)
        )

        assert target.plugin_id == plugin_id

    async def test_a_person_is_not_an_agent(
        self,
        client: Client,
        hosted: Runner,  # noqa: F811
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _enable_shell(monkeypatch)
        owner = await owner_who_may_host(client)
        await install(owner)

        with pytest.raises(AppError) as caught:
            await agent_shell_service.resolve_for_bot_user(await _actor_for(owner), owner.user_id)

        assert caught.value.code == "not_hosted"

    async def test_an_unhosted_agent_still_has_no_terminal_from_a_dm(
        self,
        client: Client,
        hosted: Runner,  # noqa: F811
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # The path a DM takes must not be a way around the gate the console honours.
        _enable_shell(monkeypatch)
        owner = await owner_who_may_host(client)
        plugin_id = await install(owner)
        async with SessionFactory() as session, session.begin():
            await session.execute(
                sql("UPDATE plugins SET deployment_id = NULL WHERE id = :id"),
                {"id": plugin_id},
            )
            bot_user_id = (
                await session.execute(
                    sql("SELECT id FROM users WHERE bot_plugin_id = :id"),
                    {"id": plugin_id},
                )
            ).scalar_one()

        with pytest.raises(AppError) as caught:
            await agent_shell_service.resolve_for_bot_user(
                await _actor_for(owner), str(bot_user_id)
            )

        assert caught.value.code == "not_hosted"

    async def test_an_agent_in_another_workspace_is_not_found(
        self,
        client: Client,
        hosted: Runner,  # noqa: F811
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # The workspace boundary is inside the statement, so a real bot id asked for by
        # somebody outside its workspace answers the same way a made-up one does.
        _enable_shell(monkeypatch)
        owner = await owner_who_may_host(client)
        plugin_id = await install(owner)
        async with SessionFactory() as session:
            bot_user_id = (
                await session.execute(
                    sql("SELECT id FROM users WHERE bot_plugin_id = :id"),
                    {"id": plugin_id},
                )
            ).scalar_one()

        elsewhere = Actor(id=owner.user_id, workspace_id="01a05500-0000-7000-8000-000000000000")

        with pytest.raises(AppError) as caught:
            await agent_shell_service.resolve_for_bot_user(elsewhere, str(bot_user_id))

        assert caught.value.code == "not_hosted"
