# Janus in the Blob Stack — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Janus as an opt-in service inside Blob's own Compose stack, seeded into every workspace at boot, reachable only on the internal network — so `@Janus` works with nothing registered by hand and no public hostname.

**Architecture:** One Compose service under `profiles: ["janus"]` on the existing `blob-agents` network, with no published port. A new `services/janus_agent.py` mirrors the existing `services/workspace_agent.py`: at boot it ensures a `plugins` row exists per workspace with `runtime: "external"` and `agui_url` pointing at the internal service name. The signing secret comes from the environment instead of being generated, because a static container environment cannot be told a value Blob invented after it started. No schema change, so no migration.

**Tech Stack:** FastAPI, hand-written `text()` SQL, Pydantic settings, Docker Compose. Tests are pytest against a real Postgres and Redis.

**Spec:** `docs/superpowers/specs/2026-09-14-janus-in-the-blob-stack-design.md`

## Global Constraints

- SQL is `text()` with bound parameters. Routers hold no `text(` — machine-enforced by `torsor guard`. Services hold the SQL. A grep for `session.add(` or `select(` under `services/` and `routers/` must return nothing.
- Persist, then broadcast: no event is emitted from inside a transaction.
- The gate is `pnpm check` **and** `cd apps/api && uv run alembic check` **and** `torsor guard --strict --severity error $(git ls-files '*.py')`. A green `pnpm check` alone is not a green CI.
- Every commit on `main` deploys to both production instances, one build at a time, nine to ten minutes. Do not push two commits expecting two builds in parallel.
- `.torsor/map/` timestamps churn on every commit: `git checkout -- .torsor/map` before staging, and commit only genuinely new module map files.
- New optional string settings MUST join the `_blank_is_none` validator in `apps/api/src/blob_api/config.py` or `.env.example`'s empty value arrives as `""`, which is falsy but not `None`.
- The agent's **slug** is fixed at `janus`. Its **display name** defaults to `Janus` and is overridable with `JANUS_AGENT_NAME`.
- Scopes, verbatim from Janus's own `blob-app.json`: `messages:read`, `messages:write`, `channels:read`, `channels:join`.
- Janus listens on **8642**, and its AG-UI path is **`/v1/agui`**.
- `AGENT_ALLOW_PRIVATE_ENDPOINTS` stays `false`. Nothing in this plan changes it.

---

### Task 1: The settings that switch Janus on

**Files:**
- Modify: `apps/api/src/blob_api/config.py` (the `Settings` class, and the `_blank_is_none` validator list)
- Create: `apps/api/tests/test_janus_agent.py`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: `settings.JANUS_AGUI_URL: str | None`, `settings.JANUS_SIGNING_SECRET: str | None`, `settings.JANUS_AGENT_NAME: str` (default `"Janus"`).

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_janus_agent.py`:

```python
"""Janus as a service inside Blob's own stack.

Seeded rather than registered, for the reason `services/workspace_agent.py` gives about
the built-in agent: a setup task somebody may never do is not a feature. The difference
is that this one is somebody else's code, so it is installed untrusted and holds granted
scopes like any app.
"""

from __future__ import annotations

import pytest

from blob_api.config import Settings


def build(**env: str) -> Settings:
    """A Settings built from an explicit environment, the way test_llm_config does."""
    return Settings(_env_file=None, **env)  # type: ignore[call-arg]


class TestSettings:
    def test_janus_is_off_by_default(self) -> None:
        assert build().JANUS_AGUI_URL is None
        assert build().JANUS_SIGNING_SECRET is None

    def test_the_default_name_is_janus(self) -> None:
        assert build().JANUS_AGENT_NAME == "Janus"

    def test_a_blank_value_reads_as_unset(self) -> None:
        # `.env.example` ships these with nothing after the equals. Without the
        # validator they arrive as "", which is falsy but is not None — and
        # `configured()` asks `is None`.
        settings = build(JANUS_AGUI_URL="", JANUS_SIGNING_SECRET="")
        assert settings.JANUS_AGUI_URL is None
        assert settings.JANUS_SIGNING_SECRET is None
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && uv run pytest tests/test_janus_agent.py -q`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'JANUS_AGUI_URL'`

- [ ] **Step 3: Add the settings**

In `apps/api/src/blob_api/config.py`, inside `class Settings`, directly after the `LIVEKIT_API_SECRET` line (they are the two optional-service blocks and belong together):

```python
    #: Janus, when it is running as a service in this stack (`COMPOSE_PROFILES=janus`).
    #:
    #: The URL is internal on purpose — `http://janus:8642/v1/agui` on the `blob-agents`
    #: network — and it never reaches `_assert_reachable`, which is the SSRF guard on the
    #: *registration routes*. Blob composes this from its own settings rather than taking
    #: it from anybody, so the exemption is a property of where the code path starts.
    JANUS_AGUI_URL: str | None = None
    #: Shared with the Janus service, which reads it as BLOB_SIGNING_SECRET. One value in
    #: the operator's .env read by both sides, because a container's environment is static
    #: and cannot be told a secret Blob generated after it started.
    JANUS_SIGNING_SECRET: str | None = None
    #: What people type after `@`. The slug stays `janus`; only the name is configurable.
    JANUS_AGENT_NAME: str = "Janus"
```

Then add `"JANUS_AGUI_URL"` and `"JANUS_SIGNING_SECRET"` to the `@field_validator(...)` list for `_blank_is_none`, after `"AGENT_SHELL_HOST_KEY"`. Do **not** add `JANUS_AGENT_NAME` — it has a real default and empty should not become `None`.

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd apps/api && uv run pytest tests/test_janus_agent.py -q`
Expected: PASS, 3 passed

- [ ] **Step 5: Document the settings**

In `.env.example`, after the `LLM_MODEL=` line, add:

```
# Janus as a service in this stack. Start it with COMPOSE_PROFILES=janus.
# The URL is internal: the service is on the blob-agents network with no published port.
JANUS_AGUI_URL=
# Shared with the janus service, which reads the same value as BLOB_SIGNING_SECRET.
JANUS_SIGNING_SECRET=
# Optional. What people type after @; the slug is always `janus`.
JANUS_AGENT_NAME=Janus
```

- [ ] **Step 6: Commit**

```bash
git checkout -- .torsor/map
git add apps/api/src/blob_api/config.py apps/api/tests/test_janus_agent.py .env.example
git commit -m "Let the environment say Janus is running beside us"
```

---

### Task 2: `install` accepts a signing secret instead of minting one

**Files:**
- Modify: `apps/api/src/blob_api/plugins/registry.py` (`install`, around the `secret = new_secret()` line)
- Test: `apps/api/tests/test_plugins.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `registry.install(..., signing_secret: str | None = None) -> Installed`. When given, `Installed.signing_secret` is that value and `plugin_secrets.signing_secret` holds it; when `None`, behaviour is exactly as today.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_plugins.py`:

```python
async def test_install_can_be_given_its_signing_secret() -> None:
    """A seeded agent's secret comes from the environment, not from us.

    Blob normally mints one at install and shows it once. That cannot work for an agent
    whose container environment is written before Blob starts: the two would never agree.
    """
    from blob_api.db.engine import transaction
    from blob_api.plugins import registry
    from blob_api.plugins.manifest import Manifest

    async with transaction() as (session, _):
        installed = await registry.install(
            session,
            workspace_id=WORKSPACE_ID,
            manifest=Manifest(slug="secret-probe", name="Secret Probe", runtime="external",
                              agui_url="https://example.invalid/v1/agui", scopes=[]),
            installed_by=OWNER_ID,
            signing_secret="a-secret-the-operator-chose",
        )
        assert installed.signing_secret == "a-secret-the-operator-chose"
        stored = (
            await session.execute(
                text("SELECT signing_secret FROM plugin_secrets WHERE plugin_id = :id"),
                {"id": installed.plugin_id},
            )
        ).fetchone()
        assert stored is not None
        assert stored.signing_secret == "a-secret-the-operator-chose"
```

`WORKSPACE_ID` and `OWNER_ID` come from the fixtures already at the top of that file — read them and use the names that are there rather than inventing new ones.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && uv run pytest tests/test_plugins.py -k signing_secret -q`
Expected: FAIL — `TypeError: install() got an unexpected keyword argument 'signing_secret'`

- [ ] **Step 3: Add the parameter**

In `apps/api/src/blob_api/plugins/registry.py`, add to `install`'s keyword-only parameters, directly after `trusted: bool = False,`:

```python
    #: Use this instead of generating one. Only the seeder passes it, and only because an
    #: agent running as a service in this stack reads its half of the secret from a static
    #: container environment — a value Blob generated afterwards could never reach it.
    signing_secret: str | None = None,
```

Then change the generation line from:

```python
    secret = new_secret()
```

to:

```python
    secret = signing_secret or new_secret()
```

Nothing else changes: the INSERT and the returned `Installed` already use `secret`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/api && uv run pytest tests/test_plugins.py -q`
Expected: PASS — the new test plus every existing one, since the default preserves today's behaviour.

- [ ] **Step 5: Commit**

```bash
git checkout -- .torsor/map
git add apps/api/src/blob_api/plugins/registry.py apps/api/tests/test_plugins.py
git commit -m "Let an install be given the secret it must share"
```

---

### Task 3: Seed Janus into a workspace

**Files:**
- Create: `apps/api/src/blob_api/services/janus_agent.py`
- Test: `apps/api/tests/test_janus_agent.py` (extend)

**Interfaces:**
- Consumes: `settings.JANUS_AGUI_URL`, `settings.JANUS_SIGNING_SECRET`, `settings.JANUS_AGENT_NAME` (Task 1); `registry.install(..., signing_secret=)` (Task 2).
- Produces: `janus_agent.AGENT_SLUG: str`, `janus_agent.AGENT_SCOPES: list[str]`, `janus_agent.configured() -> bool`, `janus_agent.manifest() -> Manifest`, `janus_agent.existing_id(session, workspace_id) -> str | None`, `janus_agent.ensure(session, workspace_id, *, installed_by) -> str | None`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_janus_agent.py`. Follow the fixtures in `tests/test_builtin_agent.py` — `sign_up`, `Client`, `workspace_id_of` from `.helpers`:

```python
from blob_api.db.engine import SessionFactory, transaction
from blob_api.services import janus_agent
from sqlalchemy import text

from .helpers import Client, sign_up, workspace_id_of


@pytest.fixture
def janus(monkeypatch: pytest.MonkeyPatch) -> None:
    from blob_api.config import settings
    monkeypatch.setattr(settings, "JANUS_AGUI_URL", "http://janus:8642/v1/agui")
    monkeypatch.setattr(settings, "JANUS_SIGNING_SECRET", "shared-with-the-container")
    monkeypatch.setattr(settings, "JANUS_AGENT_NAME", "Janus")


class TestSeeding:
    async def test_nothing_is_seeded_when_it_is_not_running(self, client: Client) -> None:
        # Both halves are required: a URL with no secret cannot authenticate a run, and a
        # secret with no URL has nothing to call.
        assert janus_agent.configured() is False

    async def test_it_is_installed_with_the_manifest_scopes(
        self, janus: None, client: Client
    ) -> None:
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)

        async with transaction() as (session, _):
            plugin_id = await janus_agent.ensure(
                session, workspace_id, installed_by=await _owner_id(session, workspace_id)
            )
        assert plugin_id is not None

        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        agent = next(p for p in apps if p["slug"] == "janus")
        assert agent["runtime"] == "external"
        assert sorted(agent["scopes"]) == [
            "channels:join", "channels:read", "messages:read", "messages:write",
        ]

    async def test_the_secret_is_the_configured_one(self, janus: None, client: Client) -> None:
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)
        async with transaction() as (session, _):
            plugin_id = await janus_agent.ensure(
                session, workspace_id, installed_by=await _owner_id(session, workspace_id)
            )
        async with SessionFactory() as session:
            row = (
                await session.execute(
                    text("SELECT signing_secret FROM plugin_secrets WHERE plugin_id = :id"),
                    {"id": plugin_id},
                )
            ).fetchone()
        assert row is not None
        assert row.signing_secret == "shared-with-the-container"

    async def test_seeding_twice_installs_once(self, janus: None, client: Client) -> None:
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)
        async with transaction() as (session, _):
            owner_id = await _owner_id(session, workspace_id)
            first = await janus_agent.ensure(session, workspace_id, installed_by=owner_id)
            second = await janus_agent.ensure(session, workspace_id, installed_by=owner_id)
        assert first == second


async def _owner_id(session, workspace_id: str) -> str:
    row = (
        await session.execute(
            text(
                "SELECT id FROM users WHERE workspace_id = :ws AND role = 'owner' "
                "AND deactivated_at IS NULL ORDER BY id LIMIT 1"
            ),
            {"ws": workspace_id},
        )
    ).fetchone()
    return str(row.id)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && uv run pytest tests/test_janus_agent.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'blob_api.services.janus_agent'`

- [ ] **Step 3: Write the service**

Create `apps/api/src/blob_api/services/janus_agent.py`:

```python
"""Making sure a workspace has Janus, when Janus is running beside us.

The shape is `services/workspace_agent.py`'s and the reasoning is the same: an agent that
has to be registered by hand is an agent a team may never get. The differences are the two
that matter.

It is installed **untrusted**. The built-in agent is Blob's own code and is seeded
`trusted=True`; Janus is somebody else's, so it holds granted scopes like any app and
`validate_manifest` refuses anything a manifest off the wire could not claim.

Its signing secret **comes from the environment**. Blob normally mints one at install and
shows it once, which cannot work here: the container's environment is written before Blob
starts, so a value invented afterwards could never reach it. One value in the operator's
`.env`, read by both sides, is how the two agree with no orchestration step.

The URL is internal — `http://janus:8642/v1/agui` on the `blob-agents` network — and it
never meets `_assert_reachable`, the SSRF guard on the registration *routes*. That is not
an exemption anybody passes: `registry.install` has never looked at a URL, so a caller
that starts here is outside the guard by construction. An admin typing the same URL into
`POST /api/admin/plugins` is still refused, and `tests/test_janus_agent.py` pins it.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.engine import session_scope, transaction
from ..plugins import registry
from ..plugins.manifest import Manifest

log = logging.getLogger("blob.janus_agent")

#: Fixed. The seeder matches on it to stay idempotent and the bot's address derives from
#: it, so it is not something to make configurable — the display name is.
AGENT_SLUG = "janus"

AGENT_DESCRIPTION = "Janus, running beside Blob. Mention it in any channel to ask something."

#: Verbatim from Janus's own `blob-app.json`. Not widened here: a grant an admin revoked
#: must stay revoked across a restart, which is why `ensure` does not reconcile grants.
AGENT_SCOPES = ["messages:read", "messages:write", "channels:read", "channels:join"]


def configured() -> bool:
    """Both halves, or nothing. A URL with no secret cannot authenticate a run, and a
    secret with no URL has nothing to call."""
    return bool(settings.JANUS_AGUI_URL and settings.JANUS_SIGNING_SECRET)


def manifest() -> Manifest:
    return Manifest(
        slug=AGENT_SLUG,
        name=settings.JANUS_AGENT_NAME,
        description=AGENT_DESCRIPTION,
        runtime="external",
        version="1.0.0",
        agui_url=settings.JANUS_AGUI_URL,
        scopes=list(AGENT_SCOPES),
    )


async def existing_id(session: AsyncSession, workspace_id: str) -> str | None:
    row = (
        await session.execute(
            text("SELECT id FROM plugins WHERE workspace_id = :ws AND slug = :slug"),
            {"ws": workspace_id, "slug": AGENT_SLUG},
        )
    ).fetchone()
    return str(row.id) if row else None


async def ensure(session: AsyncSession, workspace_id: str, *, installed_by: str) -> str | None:
    """Install Janus if it is missing. Returns the plugin id, or None when it is not running."""
    if not configured():
        return None

    plugin_id = await existing_id(session, workspace_id)
    if plugin_id is not None:
        return plugin_id

    installed = await registry.install(
        session,
        workspace_id=workspace_id,
        manifest=manifest(),
        installed_by=installed_by,
        signing_secret=settings.JANUS_SIGNING_SECRET,
    )
    return installed.plugin_id


__all__ = ["AGENT_SCOPES", "AGENT_SLUG", "configured", "ensure", "existing_id", "manifest"]
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/api && uv run pytest tests/test_janus_agent.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git checkout -- .torsor/map
git add apps/api/src/blob_api/services/janus_agent.py apps/api/tests/test_janus_agent.py
git commit -m "Seed Janus into a workspace when it is running beside us"
```

---

### Task 4: Move an existing Janus from its public URL to the internal one

**Files:**
- Modify: `apps/api/src/blob_api/services/janus_agent.py` (`ensure`)
- Test: `apps/api/tests/test_janus_agent.py` (extend)

**Interfaces:**
- Consumes: Task 3's `ensure`.
- Produces: `ensure` updates `plugins.agui_url` in place when a `janus` row already exists and its URL differs. It returns the same plugin id and never touches the bot user.

- [ ] **Step 1: Write the failing test**

```python
    async def test_an_existing_janus_moves_to_the_internal_url(
        self, janus: None, client: Client
    ) -> None:
        """Production already has a `janus` row pointing at a public domain.

        Updated in place rather than reinstalled: `uninstall` retires the bot — it sets
        `deactivated_at`, releases the handle and mangles the address — so a
        remove-and-reinstall would take the agent's history, its channel memberships and
        its place in the sidebar with it.
        """
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)
        async with transaction() as (session, _):
            owner_id = await _owner_id(session, workspace_id)
            plugin_id = await janus_agent.ensure(session, workspace_id, installed_by=owner_id)
            await session.execute(
                text("UPDATE plugins SET agui_url = :old WHERE id = :id"),
                {"old": "https://janus.example.com/v1/agui", "id": plugin_id},
            )

        async with SessionFactory() as session:
            bot_before = (
                await session.execute(
                    text("SELECT id FROM users WHERE bot_plugin_id = :id"), {"id": plugin_id}
                )
            ).fetchone()

        async with transaction() as (session, _):
            again = await janus_agent.ensure(session, workspace_id, installed_by=owner_id)
        assert again == plugin_id

        async with SessionFactory() as session:
            row = (
                await session.execute(
                    text("SELECT agui_url FROM plugins WHERE id = :id"), {"id": plugin_id}
                )
            ).fetchone()
            bot_after = (
                await session.execute(
                    text("SELECT id FROM users WHERE bot_plugin_id = :id"), {"id": plugin_id}
                )
            ).fetchone()
        assert row is not None and row.agui_url == "http://janus:8642/v1/agui"
        assert bot_before is not None and bot_after is not None
        assert bot_before.id == bot_after.id
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && uv run pytest tests/test_janus_agent.py -k internal_url -q`
Expected: FAIL — `assert 'https://janus.example.com/v1/agui' == 'http://janus:8642/v1/agui'`

- [ ] **Step 3: Update in place**

In `services/janus_agent.py`, replace the early return in `ensure`:

```python
    plugin_id = await existing_id(session, workspace_id)
    if plugin_id is not None:
        return plugin_id
```

with:

```python
    plugin_id = await existing_id(session, workspace_id)
    if plugin_id is not None:
        # Production already holds a `janus` row pointing at a public domain. Moved rather
        # than reinstalled: `uninstall` retires the bot — deactivated, handle released,
        # address mangled — so remove-and-reinstall would take its history, its channel
        # memberships and its place in the sidebar with it.
        #
        # Only the URL. Not the name, not the scopes: a grant an admin revoked must stay
        # revoked across a restart, and a name somebody changed is theirs.
        await session.execute(
            text("UPDATE plugins SET agui_url = :url, updated_at = now() WHERE id = :id"),
            {"url": settings.JANUS_AGUI_URL, "id": plugin_id},
        )
        return plugin_id
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd apps/api && uv run pytest tests/test_janus_agent.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git checkout -- .torsor/map
git add apps/api/src/blob_api/services/janus_agent.py apps/api/tests/test_janus_agent.py
git commit -m "Move an already-installed Janus onto the internal address"
```

---

### Task 5: Reconcile every workspace at boot

**Files:**
- Modify: `apps/api/src/blob_api/services/janus_agent.py` (add `ensure_everywhere`)
- Modify: `apps/api/src/blob_api/main.py` (the `lifespan` function, after the built-in agent block)
- Test: `apps/api/tests/test_janus_agent.py` (extend)

**Interfaces:**
- Consumes: Task 4's `ensure`.
- Produces: `janus_agent.ensure_everywhere() -> int`, returning how many workspaces gained the agent. It opens its own sessions and takes none.

- [ ] **Step 1: Write the failing test**

```python
    async def test_every_workspace_gains_it_at_boot(self, janus: None, client: Client) -> None:
        owner = await sign_up(client, "Founder")
        seeded = await janus_agent.ensure_everywhere()
        assert seeded >= 1

        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        assert any(p["slug"] == "janus" for p in apps)

    async def test_reconciling_twice_seeds_nothing_the_second_time(
        self, janus: None, client: Client
    ) -> None:
        await sign_up(client, "Founder")
        await janus_agent.ensure_everywhere()
        assert await janus_agent.ensure_everywhere() == 0
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && uv run pytest tests/test_janus_agent.py -k boot -q`
Expected: FAIL — `AttributeError: module 'blob_api.services.janus_agent' has no attribute 'ensure_everywhere'`

- [ ] **Step 3: Add the reconcile**

Append to `services/janus_agent.py`, before `__all__` (and add `"ensure_everywhere"` to `__all__`):

```python
async def ensure_everywhere() -> int:
    """Reconcile every workspace. Returns how many gained the agent.

    Runs at startup, because `JANUS_AGUI_URL` arrives as an environment variable and the
    moment it changes *is* a restart — so a server that has been running for a month gains
    the agent for the workspaces already on it, not only for new ones.

    **One transaction per workspace, not one for all of them.** A failure is logged and
    skipped, and a shared session could not survive that: the first error leaves the
    session in a failed transaction and every workspace after it fails too, turning the
    "skip one" this is written for into "skip the rest".
    """
    if not configured():
        return 0

    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT w.id,
                           (SELECT u.id FROM users u
                             WHERE u.workspace_id = w.id AND u.role = 'owner'
                               AND u.deactivated_at IS NULL
                             ORDER BY u.id LIMIT 1) AS owner_id
                      FROM workspaces w
                    """
                )
            )
        ).fetchall()

    seeded = 0
    for row in rows:
        if row.owner_id is None:
            continue  # A workspace with no owner is mid-teardown; leave it alone.
        try:
            async with transaction() as (session, _):
                before = await existing_id(session, str(row.id))
                await ensure(session, str(row.id), installed_by=str(row.owner_id))
                if before is None:
                    seeded += 1
        except Exception:
            log.exception("could not seed Janus for workspace %s", row.id)
    return seeded
```

Note the difference from `workspace_agent.ensure_everywhere`: every workspace is selected, not only those lacking the row, because Task 4's `ensure` also *moves* an existing row's URL. `seeded` counts only the new ones, which is what the log line claims.

- [ ] **Step 4: Call it at boot**

In `apps/api/src/blob_api/main.py`, inside `lifespan`, directly after the existing built-in-agent `try/except` block:

```python
    # And Janus, when it is running as a service in this stack. Same reasoning as above:
    # `JANUS_AGUI_URL` is an environment variable, so a restart is when it changes. This
    # also moves an already-installed Janus off a public domain onto the internal one.
    # It never raises: an agent that cannot be seeded must not stop the boot.
    try:
        seeded = await janus_agent.ensure_everywhere()
        if seeded:
            log.info("seeded Janus into %d workspace(s)", seeded)
    except Exception:
        log.exception("could not reconcile Janus")
```

Add `janus_agent` to the existing `from .services import ...` import beside `workspace_agent`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd apps/api && uv run pytest tests/test_janus_agent.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git checkout -- .torsor/map
git add apps/api/src/blob_api/services/janus_agent.py apps/api/src/blob_api/main.py apps/api/tests/test_janus_agent.py
git commit -m "Reconcile Janus at boot, the way the built-in agent is reconciled"
```

---

### Task 6: Pin that the guard still refuses what the seeder writes

**Files:**
- Test only: `apps/api/tests/test_janus_agent.py` (extend)

**Interfaces:**
- Consumes: Task 3's seeded URL.
- Produces: nothing. This is the test that fails if the private-address exemption ever widens.

- [ ] **Step 1: Write the test**

```python
class TestTheGuardStaysShut:
    async def test_an_admin_still_cannot_register_an_internal_url(
        self, janus: None, client: Client
    ) -> None:
        """The seeder writes `http://janus:8642/v1/agui`; a person may not.

        The exemption is a property of where the code path starts — `registry.install`
        has never looked at a URL, and `_assert_reachable` lives on the registration
        routes — not of a flag anybody passes. This is what fails if that stops being
        true, and it is the reason `AGENT_ALLOW_PRIVATE_ENDPOINTS` can stay false.
        """
        owner = await sign_up(client, "Founder")
        response = await owner.post(
            "/api/admin/plugins",
            {
                "manifest": {
                    "slug": "not-janus",
                    "name": "Not Janus",
                    "runtime": "external",
                    "aguiUrl": "http://janus:8642/v1/agui",
                    "scopes": [],
                }
            },
        )
        assert response.status == 400, response.body
        assert response.body["error"]["code"] == "bad_request_url"
```

Read `tests/test_plugins.py` for the exact registration payload shape before writing this — the route and body must match what that file already sends, not what this plan guesses.

- [ ] **Step 2: Run it**

Run: `cd apps/api && uv run pytest tests/test_janus_agent.py -k guard -q`
Expected: PASS immediately. This test documents existing behaviour; if it fails, stop — the guard is not where this plan believes it is, and Task 3's reasoning needs revisiting before going further.

- [ ] **Step 3: Commit**

```bash
git checkout -- .torsor/map
git add apps/api/tests/test_janus_agent.py
git commit -m "Pin that an internal agent URL is still refused from a route"
```

---

### Task 7: The Compose service

**Files:**
- Modify: `docker-compose.prod.yml` (a new service, and the top-level `volumes:` block)
- Modify: `README.md` (a `### Janus` subsection after the voice/translation settings tables)

**Interfaces:**
- Consumes: the settings from Task 1 — the service's `BLOB_SIGNING_SECRET` must be the same `${JANUS_SIGNING_SECRET}` Blob reads.
- Produces: a `janus` service on the `agents` network, and a `janusdata` volume.

- [ ] **Step 1: Add the service**

In `docker-compose.prod.yml`, after the `livekit` service (they are the two optional services and belong together), add:

```yaml
  # Janus, when this deployment wants it. Off unless COMPOSE_PROFILES=janus, for the same
  # reason LiveKit is: on 2026-09-11 an optional service that could not start stopped the
  # whole stack, and an agent nobody configured must not be able to keep chat down.
  #
  # No `ports:` and no domain on purpose. Blob reaches it on the `agents` network below at
  # http://janus:8642/v1/agui, which is what JANUS_AGUI_URL says. Its /v1/agui
  # authenticates every request by HMAC against the shared secret, and nothing else is
  # exposed to anything.
  janus:
    image: ghcr.io/magnetoid/janus:${JANUS_VERSION:-0.16.0}
    restart: unless-stopped
    profiles: ["janus"]
    # Without this the image's entrypoint starts the interactive CLI and the container
    # comes up listening on nothing. Janus's own compose file says so too.
    command: ["gateway", "run"]
    networks: [agents]
    environment:
      - API_SERVER_ENABLED=true
      - API_SERVER_HOST=0.0.0.0
      - API_SERVER_PORT=8642
      # Mandatory even on a private network: the API server refuses to start without it.
      - API_SERVER_KEY=${JANUS_API_SERVER_KEY}
      # The same value Blob holds as JANUS_SIGNING_SECRET. Its presence is also what
      # registers the /v1/agui route at all — no secret, no route.
      - BLOB_SIGNING_SECRET=${JANUS_SIGNING_SECRET}
      - JANUS_TUI_PROVIDER=${JANUS_PROVIDER:-deepseek}
      # Not `deepseek-chat`: DeepSeek retired it on 2026-09-14 and it does not 404 — it
      # answers 200 and then sends no body, so a run hangs to the caller's timeout.
      - JANUS_MODEL=${JANUS_MODEL:-deepseek-v4-pro}
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY:-}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      # 90 iterations and a 30-minute API timeout are right for a terminal and hopeless
      # for a chat message; the caller gives up at 120s.
      - JANUS_MAX_ITERATIONS=${JANUS_MAX_ITERATIONS:-25}
      - BLOB_AGUI_RUN_TIMEOUT_SECONDS=100
      - BLOB_AGUI_KEEPALIVE_SECONDS=15
      # On a fresh volume the gateway is created stopped and answers nothing. This is the
      # bootstrap the image reads once, on first boot, to bring it up.
      - JANUS_GATEWAY_BOOTSTRAP_STATE=running
    volumes:
      # The image declares VOLUME /opt/data and JANUS_HOME points there. Without a named
      # volume Docker mints an anonymous one and every deploy starts from nothing.
      - janusdata:/opt/data
    # No healthcheck, deliberately: under s6 the supervised process is not the API server,
    # so container liveness says nothing, and a check that cannot pass fails the deploy.
```

Then add `janusdata:` to the top-level `volumes:` block beside `pgdata`, `redisdata` and `miniodata`.

- [ ] **Step 2: Prove the default path is unchanged**

Run:

```bash
docker compose -f docker-compose.prod.yml config --services | sort
```

Expected: the list does **not** contain `janus`.

Then run:

```bash
COMPOSE_PROFILES=janus docker compose -f docker-compose.prod.yml config --services | sort
```

Expected: the same list **plus** `janus`.

If the first command errors rather than listing, the file is malformed — fix it before going on. A broken compose file fails the CI `image` job, which boots the production stack.

- [ ] **Step 3: Document it**

In `README.md`, after the translation settings table, add:

```markdown
### Janus

Janus can run as a service in this stack rather than as a deployment of its own. It is off
unless you ask for it:

| Variable | Default | |
|---|---|---|
| `COMPOSE_PROFILES` | unset | Set to `janus` to start the service. |
| `JANUS_AGUI_URL` | unset | `http://janus:8642/v1/agui` — internal, on the `blob-agents` network. Setting this and the secret is what installs the agent into every workspace at boot. |
| `JANUS_SIGNING_SECRET` | unset | Shared: Blob signs with it, the service reads it as `BLOB_SIGNING_SECRET`. |
| `JANUS_API_SERVER_KEY` | unset | Required by Janus's API server even on a private network. |
| `JANUS_AGENT_NAME` | `Janus` | What people type after `@`. The slug is always `janus`. |
| `JANUS_PROVIDER` / `JANUS_MODEL` | `deepseek` / `deepseek-v4-pro` | Provider and model move together — the same model is named differently by a direct API and by a router. |
| `JANUS_VERSION` | `0.16.0` | The image tag. |

The service publishes no port and has no domain: Blob reaches it on the internal network,
and `/v1/agui` authenticates every request by HMAC.
```

- [ ] **Step 4: Run the whole gate**

```bash
pnpm check && (cd apps/api && uv run alembic check) && torsor guard --strict --severity error $(git ls-files '*.py')
```

Expected: all three clean. `alembic check` must say "No new upgrade operations detected" — this plan adds no schema.

- [ ] **Step 5: Commit**

```bash
git checkout -- .torsor/map
git add docker-compose.prod.yml README.md
git commit -m "Run Janus as a service in this stack, off unless asked for"
```

---

### Task 8: Publish the image from the Janus repository

**Files (in `~/c/janus`, a different repository):**
- Create: `.github/workflows/image.yml`

**Interfaces:**
- Consumes: nothing from this repo.
- Produces: `ghcr.io/magnetoid/janus:<version>` and `:<sha>`, which Task 7's Compose service pins.

- [ ] **Step 1: Write the workflow**

Create `~/c/janus/.github/workflows/image.yml`:

```yaml
name: image

on:
  push:
    branches: [main]

concurrency:
  group: image-${{ github.ref }}
  cancel-in-progress: true

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Read the version the manifest declares
        id: manifest
        run: echo "version=$(python -c "import json;print(json.load(open('blob-app.json'))['version'])")" >> "$GITHUB_OUTPUT"
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/magnetoid/janus:${{ steps.manifest.outputs.version }}
            ghcr.io/magnetoid/janus:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

The version comes from `blob-app.json` rather than being typed twice: that file already declares it and Blob reads it.

- [ ] **Step 2: Commit and push in the Janus repository**

```bash
cd ~/c/janus
git add .github/workflows/image.yml
git commit -m "Publish the image Blob's stack pins"
git push origin main
```

- [ ] **Step 3: Watch it and confirm the tag exists**

```bash
cd ~/c/janus && gh run watch --exit-status
```

Expected: green. Then confirm the package is visible at `ghcr.io/magnetoid/janus`. If it is private, make it public or give the production host a pull secret — a private image that Compose cannot pull fails the Blob deploy, not the Janus one.

- [ ] **Step 4: Pin the real version**

Back in the Blob repo, set the `JANUS_VERSION` default in `docker-compose.prod.yml` to the version the workflow actually published, if it differs from `0.16.0`.

---

### Task 9: Ship it, and switch production over

**Files:** none — this is deployment.

- [ ] **Step 1: Push, and watch the gate deploy both instances**

```bash
git push origin main
gh run watch --exit-status
curl -s https://chat.imbamarketing.com/readyz
curl -s https://chat.hadleyconsulting.global/readyz
```

Expected: both report the commit just pushed. Nothing changes yet — the profile is off, so no Janus service starts and `configured()` is false.

- [ ] **Step 2: Set the environment on the Imba instance only**

In Coolify, on the Blob application for `chat.imbamarketing.com`, add `COMPOSE_PROFILES=janus`, `JANUS_AGUI_URL=http://janus:8642/v1/agui`, `JANUS_SIGNING_SECRET=<a new secret>`, `JANUS_API_SERVER_KEY=<a new key>`, and the provider key. Restart. One instance first, deliberately: if it goes wrong, the other is untouched.

**The secret is not free to choose.** The existing Janus deployment holds one already. Either reuse it or rotate both sides together — a mismatch shows up as every run failing the HMAC check, which reads exactly like the agent being down.

- [ ] **Step 3: Verify from inside**

```bash
ssh tetra 'c=$(docker ps --format "{{.Names}}" | grep "^app-w31xzn" | head -1); docker exec "$c" python -c "
import httpx
print(httpx.post(\"http://janus:8642/v1/agui\", json={}, timeout=10).status_code)
"'
```

Expected: `401` — the endpoint is alive on the internal network and refusing an unsigned request. Anything else (ConnectError, 404) means the service name or port is wrong; fix that before looking at Blob.

- [ ] **Step 4: Verify from the product**

Open `chat.imbamarketing.com`, go to Administration → Apps: `janus` is listed, enabled, with its four scopes. Mention `@Janus` in a channel. Expected: a run card that streams and a reply.

- [ ] **Step 5: Retire the old deployment**

Only once step 4 has worked twice, on two different days: delete the Coolify application serving `janus.imbamarketing.com`. The plugin row needs no attention — Task 4 moved its `agui_url` at boot, and the bot, its history and its channel memberships were never touched.

- [ ] **Step 6: Record it**

Add a paragraph to `.torsor/active/context.md` naming what was learned: that a hosted agent needs no public domain because Blob and the agent share `blob-agents`, and that the seeder is outside the SSRF guard by construction rather than by a flag.

---

## Self-Review

**Spec coverage.** §1 Compose service → Task 7. §2 image from CI → Task 8. §3 seeding → Tasks 1, 3, 5 (with the secret from Task 2). §4 the private address → Tasks 3 and 6. §5 what is retired → Tasks 4 and 9. §6 the model default → Task 7's `JANUS_MODEL`. Phase 2 (the settings page) is **not** in this plan and must not be started from it — its mechanism is an open question the spec names as a spike.

**Placeholders.** None: every code step carries the code, every test step the test, and every verification step the command and its expected output.

**Type consistency.** `registry.install(..., signing_secret=)` is defined in Task 2 and used in Task 3. `janus_agent.configured/manifest/existing_id/ensure` are defined in Task 3 and used in Tasks 4, 5 and 6. `ensure_everywhere` is defined in Task 5 and called in `main.py` in the same task. `AGENT_SLUG` is `"janus"` throughout, matching the Compose service name and `JANUS_AGUI_URL`'s hostname.

**One thing deliberately left to the implementer.** Task 6 says to read `tests/test_plugins.py` for the registration payload shape rather than trusting this plan's guess at it, and Task 3's test says to use the fixture names already in `tests/test_builtin_agent.py`. Those are the two places where copying from a plan would be more fragile than reading the file.
