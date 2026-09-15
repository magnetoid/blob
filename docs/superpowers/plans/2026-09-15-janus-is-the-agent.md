# Janus is the agent Blob ships with — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the agent Blob ran itself (`plugins/builtin.py`) and everything that existed only for it, make Janus the one agent every workspace gets, and let a DM with the right agents be answered without a mention.

**Architecture:** Three migrations (0040 the DM flag, 0041 the retirement, 0042 the policy drop), each mirrored in `db/models.py` so `alembic check` is quiet at every commit. The in-process AG-UI transport, the asker-authority tools and the `agent_reads` room bound are deleted rather than disabled. The DM rule in `jobs/agui_admission.personal_agent_for` and `services/messages.addressed_by_the_room` keys on `plugins.answers_dm_without_mention` (set only by the seeder) or on `plugins.owner_user_id` being the one person in the room. `services/agent_seeding.py` folds back into `services/janus_agent.py`, the one seeder left.

**Tech Stack:** FastAPI + hand-written `text()` SQL on Postgres, Alembic, pytest (`-n 4`, needs Postgres + Redis), React 19 client with vitest, `pnpm openapi` for the wire contract.

**Spec:** `docs/superpowers/specs/2026-09-15-janus-is-the-agent-design.md` — the binding authority. `docs/superpowers/specs/2026-09-15-janus-console-design.md` is the *next* slice and is not built here.

## Global Constraints

- Work on branch `janus-is-the-agent` in the main checkout. Commit per task. **Do not push, do not merge.**
- The gate at every commit, from the repo root: `pnpm check && (cd apps/api && uv run alembic check) && torsor guard --strict --severity error $(git ls-files '*.py')`. `pnpm check` runs tsc, eslint, ruff, mypy `--strict`, vitest and the ~1,500 pytest tests; nothing red is committed.
- `apps/api` tests need Postgres (`blob_test`) and Redis on localhost: `docker compose up -d` from the repo root if they are not running. Run one pytest process at a time — the suite `TRUNCATE`s the shared test database.
- Every SQL statement is `text()` with bound parameters. No `session.add(`, no `select(`, no `OFFSET`. Routers hold no `text(`.
- Migrations are numbered in sequence: `0040`, `0041`, `0042` (head before this plan is `0039`; check with `uv run alembic heads` before writing a `down_revision`). Each migration file is mirrored in `db/models.py` in the same commit.
- Wherever a manifest, request or policy loses a field, run `pnpm openapi` from the repo root in the same task and commit `packages/shared/openapi.json` and `packages/shared/src/generated/api.d.ts` — `test_openapi_contract.py` and `contract.test-d.ts` fail otherwise.
- The torsor post-commit hook rewrites timestamps under `.torsor/map/`. Before staging, run `git checkout -- .torsor/map`; stage a map file only when it is new or its symbol list changed (run `torsor map` after your code is final, look at `git diff .torsor/map/modules/<file>`, keep only those with non-timestamp lines).
- Comments and docstrings in this codebase are load-bearing. When you delete a function, delete or rewrite every comment that pointed at it (`grep -rn "<name>" apps/api/src apps/web/src`), and keep the *why* of anything you keep.
- No new dependencies.

---

### Task 1: The room is the address — for resident and owned agents

**Files:**
- Create: `apps/api/src/blob_api/db/migrations/versions/0040_answers_dm_without_mention.py`
- Modify: `apps/api/src/blob_api/db/models.py` (the `Plugin` model, beside `in_every_public_channel`)
- Modify: `apps/api/src/blob_api/plugins/registry.py` (`install`, the INSERT)
- Modify: `apps/api/src/blob_api/services/janus_agent.py` (`_install`)
- Modify: `apps/api/src/blob_api/services/workspace_agent.py` (`ensure`, the `registry.install` call)
- Modify: `apps/api/src/blob_api/jobs/agui_admission.py` (`personal_agent_for`, lines ~87–160)
- Modify: `apps/api/src/blob_api/services/messages.py` (`addressed_by_the_room`, lines ~640–675)
- Create: `apps/api/tests/test_agent_dm.py`
- Modify: `apps/api/tests/test_janus_agent.py` (one assertion in `test_it_is_installed_with_the_manifest_scopes` is fine as is; add the flag check to `test_the_secret_is_the_configured_one`'s neighbour — see step 6)

**Interfaces:**
- Produces: `plugins.answers_dm_without_mention` (boolean, default false); `registry.install(..., answers_dm_without_mention: bool = False)`.
- Consumes: `plugins.in_every_public_channel` and `registry.install(..., in_every_public_channel=)` from commit `1d424d73`.

- [ ] **Step 1: Write the migration**

`apps/api/src/blob_api/db/migrations/versions/0040_answers_dm_without_mention.py`:

```python
"""Which agents are addressed by their DM — no `@name` needed.

Today only the built-in agent answers its DM without a mention, and
`jobs/agui_admission.personal_agent_for` says why it was never "any bot in a DM":
widening the trigger would hand every installed third-party app a run for every line
typed at it, with no manifest opt-in and no way for its author to decline. That reasoning
stands. So the property is made explicit: `answers_dm_without_mention` is set only by the
seeders — the agents Blob itself presents as *the* assistant — and the send path and the
job read it. A person's own agent is the other case and needs no flag: `owner_user_id`
being the one person in the room is the whole condition.

Two flags rather than one with two meanings: `in_every_public_channel` (0039) says where
the bot *is*, this says how it may be *addressed*.

Backfilled by the seeders' own identity — the same predicate 0039 used.

Revision ID: 0040
Revises: 0039
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plugins",
        sa.Column(
            "answers_dm_without_mention",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.execute(
        """
        UPDATE plugins
           SET answers_dm_without_mention = true
         WHERE owner_user_id IS NULL
           AND ((slug = 'blob-agent' AND runtime = 'builtin')
             OR (slug = 'janus' AND runtime = 'external'))
        """
    )


def downgrade() -> None:
    op.drop_column("plugins", "answers_dm_without_mention")
```

- [ ] **Step 2: Mirror it in the model**

In `db/models.py`, directly after the `in_every_public_channel` column of `Plugin`:

```python
    #: Addressed by its DM: a message there needs no `@name`. Set only by the seeders —
    #: the agents Blob presents as *the* assistant — never for an app installed by hand,
    #: which would otherwise get a run for every line typed at it with no opt-in from
    #: its author. A person's own agent needs no flag: `owner_user_id` being the one
    #: person in the room is that case. See `jobs/agui_admission.personal_agent_for`.
    answers_dm_without_mention: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
```

Run `cd apps/api && uv run alembic upgrade head && uv run alembic check` — expect `No new upgrade operations detected.`

- [ ] **Step 3: Let an install set it**

In `plugins/registry.py` `install`, after the `in_every_public_channel: bool = False,` parameter:

```python
    #: Addressed by its DM without a mention. Only the seeders pass it, for the reason
    #: `db/models.Plugin.answers_dm_without_mention` gives.
    answers_dm_without_mention: bool = False,
```

Add the column to the INSERT's column list and VALUES (`:answers_dm_without_mention`) and to the parameter dict, exactly the way `in_every_public_channel` was added in commit `1d424d73`.

In `services/janus_agent.py` `_install` and in `services/workspace_agent.py` `ensure`, pass `answers_dm_without_mention=True` beside `in_every_public_channel=True`. (The built-in seeder still exists in this task; Task 2 deletes it. Setting the flag there keeps `test_personal_agent.py` green until then.)

- [ ] **Step 4: The job's rule**

In `jobs/agui_admission.py` `personal_agent_for`: replace the docstring paragraph that begins "Scoped to `runtime = 'builtin'` deliberately." with:

```
    Never "any bot in a DM", deliberately. That would hand every installed third-party
    app a run for every line typed at it, with no manifest opt-in and no way for its
    author to decline — a change to somebody else's contract, smuggled in as a
    convenience. So the room is the address in exactly two cases: a *resident* agent
    (`plugins.answers_dm_without_mention`, set only by the seeder), and the person's own
    agent (`plugins.owner_user_id` is the one person in the room — ADR 0018, "your
    agent answers you").
```

Change the first line of the docstring from "The built-in agent, if this channel is one person's private room with it." to "The agent this channel is one person's private room with, when that agent may be addressed by the room."

In the SQL, replace the line `AND p.runtime = :runtime` with:

```sql
                   -- The room is the address for a resident agent, and for the
                   -- person's own agent. Never for an app installed by hand.
                   AND (p.answers_dm_without_mention OR p.owner_user_id = other.id)
```

and remove `"runtime": builtin.RUNTIME` from the parameter dict. If `builtin` is now unused in that module, remove the import (Task 2 deletes the module; leave the import if `agent_tools` still uses it).

- [ ] **Step 5: The send path's rule**

In `services/messages.py` `addressed_by_the_room`, replace the docstring's first sentence "True for a one-to-one DM that has an enabled built-in agent in it." with "True for a one-to-one DM that holds an enabled agent the room may address: a resident one (`answers_dm_without_mention`) or somebody's own." and replace, in the SQL,

```sql
                  JOIN plugins p ON p.id = u.bot_plugin_id
                                AND p.status = 'enabled'
                                AND p.runtime = 'builtin'
```

with

```sql
                  JOIN plugins p ON p.id = u.bot_plugin_id
                                AND p.status = 'enabled'
                                -- Looser than the job on purpose (see above): the job
                                -- checks that the owner is the person in the room.
                                AND (p.answers_dm_without_mention
                                     OR p.owner_user_id IS NOT NULL)
```

- [ ] **Step 6: Write the tests**

`apps/api/tests/test_agent_dm.py`:

```python
"""A DM with an agent is a conversation with it: the room is the address.

Until this, only the agent Blob ran itself answered its DM without a mention. The rule is
now a property of the agent — `answers_dm_without_mention`, set by the seeder — or of
the room being one person's with their own agent. It is still never "any bot in a DM":
an app somebody installed by hand needs a mention in its DM, because a run per line typed
at it is a change to its author's contract.

Every agent here is a fake external one (`test_agui.agent_speaks`), or the seeded Janus
answered by the same fake transport, because that is what an agent now is.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.plugins import streams

from .helpers import Client, allow_policy, invite_and_sign_up, send_message, sign_up
from .test_agui import (
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    agent_speaks,
    frame,
    install,
    route_agent_to,
)


def says(text_: str) -> tuple[bytes, ...]:
    """A complete AG-UI reply: one text message, then the run finishes."""
    return (
        frame(type="RUN_STARTED", threadId="t", runId="r"),
        frame(type="TEXT_MESSAGE_START", messageId="m1", role="assistant"),
        frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta=text_),
        frame(type="TEXT_MESSAGE_END", messageId="m1"),
        frame(type="RUN_FINISHED", threadId="t", runId="r"),
    )


@pytest.fixture
def janus(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "JANUS_AGUI_URL", "http://janus:8642/v1/agui")
    monkeypatch.setattr(settings, "JANUS_SIGNING_SECRET", "shared-with-the-container")
    monkeypatch.setattr(settings, "JANUS_AGENT_NAME", "Janus")


async def bot_named(owner: Client, name: str) -> str:
    people = (await owner.get("/api/users")).body["users"]
    return str(next(u["id"] for u in people if u["displayName"] == name))


async def open_dm(owner: Client, *user_ids: str) -> str:
    response = await owner.post("/api/dms", {"userIds": list(user_ids)})
    assert response.status == 200, response.body
    return str(response.body["channel"]["id"])


async def say(owner: Client, channel_id: str, body: str) -> str:
    sent = await send_message(owner, channel_id, body)
    message_id = str(sent.body["message"]["id"])
    await agui_job.handle_agui_run(message_id)
    return message_id


async def replies_in(owner: Client, channel_id: str) -> list[str]:
    history = (await owner.get(f"/api/channels/{channel_id}/messages")).body["messages"]
    return [m["body"] for m in history if m["kind"] == "bot"]


@pytest.fixture
async def mine(janus: None, client: Client, monkeypatch: pytest.MonkeyPatch) -> dict:
    """A founder, their DM with the seeded agent, and the fake that answers for it."""
    owner = await sign_up(client, "Ada")
    bot_id = await bot_named(owner, settings.JANUS_AGENT_NAME)
    transport, seen = agent_speaks(*says("Morning."))
    route_agent_to(monkeypatch, transport)
    return {"owner": owner, "bot_id": bot_id, "dm": await open_dm(owner, bot_id), "seen": seen}


class TestTheRoomIsTheAddress:
    async def test_the_seeded_agent_answers_without_being_mentioned(self, mine: dict) -> None:
        await say(mine["owner"], mine["dm"], "morning")

        # No `@Janus`. There is nobody else in the room it could have been meant for, and
        # making people type a name at a wall is ceremony Slack does not ask for either.
        assert await replies_in(mine["owner"], mine["dm"]) == ["Morning."]

    async def test_mentioning_it_in_its_own_dm_does_not_answer_twice(self, mine: dict) -> None:
        await say(mine["owner"], mine["dm"], f"@{settings.JANUS_AGENT_NAME} hello")

        assert await replies_in(mine["owner"], mine["dm"]) == ["Morning."]

    async def test_its_own_replies_do_not_start_another_run(self, mine: dict) -> None:
        await say(mine["owner"], mine["dm"], "hi")
        async with SessionFactory() as session:
            reply_id = (
                await session.execute(
                    text(
                        "SELECT id FROM messages WHERE channel_id = :c AND kind = 'bot' "
                        "ORDER BY id DESC LIMIT 1"
                    ),
                    {"c": mine["dm"]},
                )
            ).scalar_one()

        await agui_job.handle_agui_run(str(reply_id))

        # The loop guard is structural — only a `kind='user'` message is a trigger — and
        # removing the mention requirement must not have weakened it.
        assert await replies_in(mine["owner"], mine["dm"]) == ["Morning."]
        assert len(mine["seen"]) == 1


class TestWhoElseIsInTheRoom:
    async def test_a_dm_with_a_person_is_untouched(self, mine: dict) -> None:
        bo = await invite_and_sign_up(mine["owner"], "Bo")
        pair = await open_dm(mine["owner"], str(bo.user_id))

        await say(mine["owner"], pair, "lunch?")

        assert await replies_in(mine["owner"], pair) == []
        assert mine["seen"] == []

    async def test_a_third_member_stops_it_answering(self, mine: dict) -> None:
        bo = await invite_and_sign_up(mine["owner"], "Bo")
        pair = await open_dm(mine["owner"], str(bo.user_id))
        apps = (await mine["owner"].get("/api/admin/plugins")).body["plugins"]
        plugin_id = next(p["id"] for p in apps if p["slug"] == "janus")
        joined = await mine["owner"].post(f"/api/admin/plugins/{plugin_id}/channels/{pair}")
        assert joined.status == 200, joined.body

        await say(mine["owner"], pair, "no mention here")

        # Three members, still labelled 'dm': `kind` is derived once at creation and
        # `app_join_channel` has no kind test. Answering would put an agent told "nobody
        # else can read this" into a room Bo is reading.
        assert await replies_in(mine["owner"], pair) == []

    async def test_a_group_dm_is_not_a_personal_room(self, mine: dict) -> None:
        bo = await invite_and_sign_up(mine["owner"], "Bo")
        trio = await open_dm(mine["owner"], str(bo.user_id), mine["bot_id"])

        await say(mine["owner"], trio, "no mention here")

        assert await replies_in(mine["owner"], trio) == []


class TestWhichAgentsTheRoomAddresses:
    async def test_an_app_installed_by_hand_still_needs_a_mention(
        self, janus: None, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        owner = await sign_up(client, "Ada")
        app_body = await install(owner)
        transport, seen = agent_speaks(*says("I was not asked."))
        route_agent_to(monkeypatch, transport)
        their_dm = await open_dm(owner, str(app_body["plugin"]["botUserId"]))

        await say(owner, their_dm, "hello?")

        # A run per line typed at it would be a change to its author's contract.
        assert await replies_in(owner, their_dm) == []
        assert seen == []

    async def test_a_persons_own_agent_answers_its_owner(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A personal agent dials in over a socket, so the run itself cannot complete
        # here; what is pinned is that the room is its address — the job finds it.
        owner = await sign_up(client, "Ada")
        await allow_policy(await _workspace_of(owner))
        attached = await owner.post("/api/agents/mine", {"name": "Desktop Claude"})
        assert attached.status == 201, attached.body
        bot_id = await bot_named(owner, "Desktop Claude")
        dm = await open_dm(owner, bot_id)

        from blob_api.jobs.agui_admission import personal_agent_for

        async with SessionFactory() as session:
            listener = await personal_agent_for(
                session, workspace_id=await _workspace_of(owner), channel_id=dm
            )
        assert listener is not None and listener.bot_user_id == bot_id

    async def test_somebody_elses_agent_does_not_answer_you(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        owner = await sign_up(client, "Ada")
        workspace_id = await _workspace_of(owner)
        await allow_policy(workspace_id)
        assert (await owner.post("/api/agents/mine", {"name": "Desktop Claude"})).status == 201
        bot_id = await bot_named(owner, "Desktop Claude")
        bo = await invite_and_sign_up(owner, "Bo")
        dm = await open_dm(bo, bot_id)

        from blob_api.jobs.agui_admission import personal_agent_for

        async with SessionFactory() as session:
            listener = await personal_agent_for(session, workspace_id=workspace_id, channel_id=dm)
        assert listener is None


async def _workspace_of(client: Client) -> str:
    boot = (await client.get("/api/bootstrap")).body
    return str(boot["workspace"]["id"])


def record_jobs(monkeypatch: pytest.MonkeyPatch) -> list[tuple[Any, ...]]:
    """Every `enqueue(...)` call, recorded at call time rather than when it runs."""
    seen: list[tuple[Any, ...]] = []

    async def nothing() -> None:
        return None

    def record(job: str, *args: Any) -> Any:
        seen.append((job, *args))
        return nothing()

    from blob_api.lib import queue as queue_module
    from blob_api.services import messages as messages_service

    monkeypatch.setattr(queue_module, "enqueue", record)
    monkeypatch.setattr(messages_service, "enqueue", record, raising=False)
    return seen


class TestTheWayIn:
    """Sending is what has to start the run, not a test calling the job by hand."""

    async def test_a_plain_message_in_the_agents_dm_asks_for_a_run(
        self, mine: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        jobs = record_jobs(monkeypatch)
        sent = await send_message(mine["owner"], mine["dm"], "what did I miss?")

        assert ("agui_run", str(sent.body["message"]["id"])) in jobs

    async def test_a_dm_between_two_people_asks_for_nothing(
        self, mine: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        bo = await invite_and_sign_up(mine["owner"], "Bo")
        room = await open_dm(mine["owner"], str(bo.user_id))

        jobs = record_jobs(monkeypatch)
        await send_message(mine["owner"], room, "lunch?")

        assert not [job for job in jobs if job[0] == "agui_run"]

    async def test_an_app_installed_by_hand_asks_for_nothing(
        self, janus: None, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        owner = await sign_up(client, "Ada")
        app_body = await install(owner)
        their_dm = await open_dm(owner, str(app_body["plugin"]["botUserId"]))

        jobs = record_jobs(monkeypatch)
        await send_message(owner, their_dm, "hello?")

        assert not [job for job in jobs if job[0] == "agui_run"]
```

If `streams` ends up unused in the file, drop the import. If `install(owner)` needs the workspace policy for external agents, look at how `test_agui.py`'s tests call it and match them. `personal_agent_for` may need the personal agent's `plugin_secrets` row and a `messages:write` grant — `routers/my_agents.py` grants what it declares; if the listener comes back None, print the row and adjust the assertion to the real reason rather than weakening the rule.

- [ ] **Step 7: Run and commit**

```bash
cd apps/api && uv run pytest tests/test_agent_dm.py tests/test_personal_agent.py tests/test_janus_agent.py tests/test_builtin_agent.py -q -n 4
```

Then the whole gate from the repo root, then commit: `feat: let a DM address a resident or owned agent without a mention`.

---

### Task 2: Retire the built-in agent

**Files:**
- Create: `apps/api/src/blob_api/db/migrations/versions/0041_retire_the_builtin_agent.py`
- Delete: `apps/api/src/blob_api/plugins/builtin.py`, `apps/api/src/blob_api/services/workspace_agent.py`, `apps/api/tests/test_builtin_agent.py`, `apps/api/tests/test_builtin_tools.py`, `apps/api/tests/test_personal_agent.py`, `apps/api/tests/test_llm_tools.py`, `apps/api/tests/test_llm_tools_anthropic.py`
- Modify: `db/models.py`, `plugins/streams.py`, `plugins/manifest.py`, `plugins/registry.py`, `jobs/agui_admission.py`, `jobs/agui_outcome.py`, `lib/llm.py`, `main.py`, `services/workspaces.py`, `services/agent_seeding.py` (docstrings only), `config.py` (comments), `tests/test_agent_chains.py`, `tests/test_agent_decisions.py`, `tests/test_agent_ownership.py`, `tests/test_summary_model.py`, `tests/test_llm_deepseek.py`, `tests/conftest.py` (comment), `packages/shared/openapi.json`, `packages/shared/src/generated/api.d.ts`

**Interfaces:**
- Produces: `plugins_runtime_check` admits `('local', 'external', 'container', 'socket')`; `Runtime = Literal["local", "external", "container", "socket"]`; `registry.install` has no `trusted`; `streams.stream_run(listener, run_input, *, on_event)`; `Listener` without `workspace_name`/`owner_name`/`runs_here`; `lib/llm.py` exports `stream_reply`, `complete`, `extract_json`, `Turn`, `LlmError`, `ProviderRefusedError`, `configured`, `model_name`, `open_client` and no tool types.
- Consumes: Task 1's flag on the Janus seeder.

- [ ] **Step 1: The migration**

```python
"""Retire the agent Blob ran itself.

Decided 2026-09-15: Janus is the agent Blob ships with, and the built-in one — a
placeholder for exactly that — goes. Its rows are retired the way `registry.uninstall`
retires any app, statement for statement: the bot deactivated with `bot_plugin_id`
cleared, its address mangled so the identity is free (`users_workspace_id_email_key`),
its handle released so the name can be claimed, and the plugin row deleted — grants,
secrets, tokens and queued deliveries cascade. Every message it ever sent stays, under a
retired author, like any uninstalled app's.

Then `plugins_runtime_check` is tightened to the runtimes that remain. `agent_runs`
keeps `'builtin'` in its transport check: the run log is history and the rows stay.

Revision ID: 0041
Revises: 0040
"""

from __future__ import annotations

from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TEMP TABLE retiring AS
            SELECT u.id AS user_id, p.id AS plugin_id
              FROM users u JOIN plugins p ON p.id = u.bot_plugin_id
             WHERE p.runtime = 'builtin'
        """
    )
    op.execute(
        """
        UPDATE users
           SET deactivated_at = now(),
               bot_plugin_id = NULL,
               email = split_part(email, '@', 1) || '+' || id::text
                       || '@' || split_part(email, '@', 2)
         WHERE id IN (SELECT user_id FROM retiring)
        """
    )
    op.execute("DELETE FROM workspace_handles WHERE user_id IN (SELECT user_id FROM retiring)")
    op.execute("DELETE FROM plugins WHERE runtime = 'builtin'")
    op.execute("DROP TABLE retiring")
    op.drop_constraint("plugins_runtime_check", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_runtime_check",
        "plugins",
        "runtime IN ('local', 'external', 'container', 'socket')",
    )


def downgrade() -> None:
    # The rows cannot be brought back; only the runtime becomes admissible again.
    op.drop_constraint("plugins_runtime_check", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_runtime_check",
        "plugins",
        "runtime IN ('local', 'external', 'container', 'socket', 'builtin')",
    )
```

Mirror the tightened CHECK in `db/models.py` (`Plugin.__table_args__`, the `plugins_runtime_check` constraint). Leave `agent_runs_transport_check` alone. `uv run alembic upgrade head && uv run alembic check` must be quiet.

- [ ] **Step 2: Delete the runtime**

Delete `plugins/builtin.py` and `services/workspace_agent.py`. Then, following the compiler and `grep -rn "builtin\|workspace_agent\|runs_here\|agent_tools\|ToolRunner" apps/api/src`:

- `plugins/streams.py`: remove the import of `builtin`, `_stream_builtin`, `Listener.runs_here`, the `"builtin"` arm of `transport`, the `tools`/`call` parameters of `stream_run`, and the fields `workspace_name` and `owner_name` on `Listener` (only the built-in persona read them). Rewrite the module docstring's "three transports" as two: the HTTP POST and the reversed socket.
- `plugins/manifest.py`: `Runtime` loses `"builtin"`; the `#: "builtin" is the agent Blob runs itself` comment goes; `validate_manifest` loses the `trusted` parameter, the two docstring paragraphs about it, and the `runtime_reserved` refusal block. Delete `runtime_reserved` from wherever error codes are catalogued if it is only raised here (`grep -rn runtime_reserved`).
- `plugins/registry.py`: `install` loses `trusted` and passes nothing for it; `MENTIONABLE_AGENT` becomes `"(p.agui_url IS NOT NULL OR p.runtime = 'socket')"` and its comment loses the built-in clause.
- `jobs/agui_admission.py`: delete `agent_tools` and every helper only it used (read the function; it is ~50 lines under `def agent_tools`), the `builtin` import, and in `personal_agent_for` the `workspace_name`/`owner_name` columns and `Listener(...)` keywords. Keep `personal_agent_for`, `_is_private_room_with` and the rest.
- `jobs/agui_outcome.py` (~lines 390–410): remove the `agent_tools(...)` call and the `tools=`/`call=` keywords on `stream_run`.
- `lib/llm.py`: delete `stream_reply_with_tools`, `_anthropic_tool_turn`, `_openai_tool_turn`, `_tool_arguments`, `ToolCall`, `ToolResult`, `ToolRunner` and their `__all__` entries. Rewrite the module docstring: two callers — `services/catchup.py` (the unread recap) and `services/agentic.py` (thread summaries) — and "two calls: stream a reply, and complete a JSON answer". Keep everything `complete`, `stream_reply` and their tests use (`_takes_strict_json_schema`, `ProviderRefusedError`, `_post_json`, `_refused_the_hint`, the provider branches).
- `main.py`: the lifespan awaits `janus_agent.ensure_everywhere()` alone; rewrite the comment above it for one seeder (keep the "environment variable, so a restart is when it changes" reasoning and "never raises").
- `services/workspaces.py` `found`: only `janus_agent.ensure(...)` remains; merge the two comments into one that keeps: seeded at founding because the boot pass cannot reach a workspace that does not exist yet; silently a no-op when Janus is not running.
- `services/agent_seeding.py`: docstrings still name the built-in seeder — rewrite them to name one seeder (Task 4 folds the module away; keep this to a sentence each so the tree is honest between tasks).
- `config.py`: the `LLM_*` comments that say the built-in agent spends the key — reword to "Catch-up and thread summaries".
- `services/mcp.py` and `jobs/agui_admission.py` still compile with `room_channel_id` in place; Task 3 removes that.

- [ ] **Step 3: The tests**

- Delete `tests/test_builtin_agent.py`, `tests/test_builtin_tools.py`, `tests/test_personal_agent.py` (replaced by Task 1's `test_agent_dm.py`), `tests/test_llm_tools.py`, `tests/test_llm_tools_anthropic.py`.
- `tests/test_llm_deepseek.py`: delete the tests that call `stream_reply_with_tools`; keep the rest.
- `tests/test_agent_chains.py`: delete the `builtin` import and the tests around lines 390–410 that build `builtin.Persona`/`builtin.system_prompt`.
- `tests/test_agent_decisions.py`: delete the `workspace_agent` import, the `from .test_builtin_agent import model` line, and `test_the_builtin_gets_the_answer_as_its_next_turn` (~lines 517–560). Check no other test in the file uses `model`.
- `tests/test_agent_ownership.py`: `test_the_workspace_agent_needs_no_lending` — read the `team` fixture in that file; if "the workspace agent" there is an unowned app installed through `install`, the test stands; if it relied on the seeded built-in agent, point it at an unowned external app installed the same way the fixture installs the others.
- `tests/test_summary_model.py`: its own `model` fixture stays; reword the docstring line that points at `test_builtin_agent` for the rationale (keep the rationale, drop the pointer).
- `tests/conftest.py`: the `LLM_*` block's comment — replace "the built-in agent" wording if present with "Catch-up and summaries".
- `tests/test_plugins.py` and `tests/test_agui.py`: `grep -n "trusted\|builtin\|runtime_reserved"`; delete any test that registered a `builtin` manifest expecting `runtime_reserved` (the runtime no longer exists; a manifest naming it now fails Pydantic validation as `invalid_input` — if such a test exists, change its expectation to that).

- [ ] **Step 4: The wire contract**

From the repo root: `pnpm openapi`. Commit the regenerated `packages/shared/openapi.json` and `packages/shared/src/generated/api.d.ts` (the runtime union loses `"builtin"`).

- [ ] **Step 5: Gate and commit**

`cd apps/api && uv run pytest -q -n 4`, then the full gate. Commit: `feat: retire the agent Blob ran itself`.

---

### Task 3: Remove the agent-reads bound

**Files:**
- Create: `apps/api/src/blob_api/db/migrations/versions/0042_drop_agent_reads.py`
- Modify: `db/models.py` (`WorkspacePolicy`), `services/policies.py`, `routers/admin_instance.py`, `services/mcp.py`, `services/search.py`, `apps/web/src/features/admin/sections/AppPolicySection.tsx`, `apps/web/src/features/admin/sections/AppsSection.tsx`, `apps/web/src/features/admin/sections/AppsList.test.tsx`, `apps/web/src/lib/api.ts`, `packages/shared/openapi.json`, `packages/shared/src/generated/api.d.ts`
- Modify: `.torsor/architecture/decisions/0017-an-agent-reads-what-its-room-could-read.md` (a superseded note at the top, nothing else)

**Interfaces:**
- Produces: `Policy` without `agent_reads`; `McpCaller` without `room_channel_id`/`reads_are_room_bound`; `search.search(...)` without `audience_channel_id`.

- [ ] **Step 1: Migration**

```python
"""Drop the agent-reads bound.

ADR 0017 bounded what the agent Blob ran itself could *read* on the asker's authority
when it answered in a room. That agent is retired (0041) and no other agent runs tools
on the asker's authority — every external agent reads through its own bot token, bounded
by its channel membership and scopes. A switch that changes nothing is worse than no
switch. The reasoning stays in the ADR, superseded, for the day an external agent is
offered Blob's tools.

Revision ID: 0042
Revises: 0041
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("workspace_policies_agent_reads_check", "workspace_policies", type_="check")
    op.drop_column("workspace_policies", "agent_reads")


def downgrade() -> None:
    op.add_column(
        "workspace_policies",
        sa.Column("agent_reads", sa.Text(), nullable=False, server_default="audience"),
    )
    op.create_check_constraint(
        "workspace_policies_agent_reads_check",
        "workspace_policies",
        "agent_reads IN ('audience', 'asker')",
    )
```

Remove the column and the check from `WorkspacePolicy` in `db/models.py`. `alembic upgrade head && alembic check` quiet.

- [ ] **Step 2: Backend**

- `services/policies.py`: remove `agent_reads` from the column tuple, the `AgentReads` alias, the `Policy` field, `_row_to_policy`, the SELECT, the merge dict and the upsert.
- `routers/admin_instance.py`: remove `agent_reads` from `PolicyOut`, `PolicyInput` and `_policy_out`.
- `services/mcp.py`: remove `room_channel_id`, `reads_are_room_bound`, `_refuse_outside_the_room` and its three call sites (`_resolve_channel` twice, and the one near line 410), and the `audience_channel_id=` keyword near line 447. Rewrite the `McpCaller` docstring lines that mention the room. Keep `may_start_runs`.
- `services/search.py`: remove the `audience_channel_id` parameter, its docstring paragraph and the `"audience"` bind and whatever SQL fragment used it (read the function; the fragment is a `WHERE` clause keyed on that bind).
- Any remaining `grep -rn "agent_reads\|audience_channel_id\|room_channel_id\|reads_are_room_bound" apps/api/src` hit is a miss.
- Tests: `grep -rn "agent_reads\|audience" apps/api/tests` — the only file that tested the bound was deleted in Task 2; fix any policy test that sends or asserts `agentReads`.

- [ ] **Step 3: Client**

- `AppPolicySection.tsx` (~lines 216–240): remove the "What a shared agent may read" row — the hint paragraph, the select and its handler.
- `AppsSection.tsx` (~lines 424–431): remove the guardrails `<li>` that reads `policy.agentReads`. Also remove the `builtin` access sentence at line ~328 (`if (plugin.runtime === "builtin") return ...`), left from Task 2's runtime change.
- `AppsList.test.tsx:92`: drop `agentReads: 'audience'` from the mocked policy.
- `lib/api.ts`: remove `agentReads` from the workspace-policy types (`grep -n agentReads apps/web/src/lib/api.ts`).
- `pnpm openapi`; commit the regenerated files.

- [ ] **Step 4: ADR 0017**

Add, directly under the title of `0017-an-agent-reads-what-its-room-could-read.md`:

```
> **Superseded on 2026-09-15 by [[0019-blob-ships-no-agent-of-its-own]].** The bound this
> ADR describes applied to the tools the built-in agent ran on the asker's authority.
> That agent is retired and no external agent is offered Blob's tools, so the bound has
> no subject. The reasoning below is kept for the day one is.
```

(Task 6 writes 0019; the link resolves then.)

- [ ] **Step 5: Gate and commit**

`pnpm check`, `alembic check`, `torsor guard`. Commit: `refactor: drop the agent-reads bound with the agent it bounded`.

---

### Task 4: One seeder

**Files:**
- Delete: `apps/api/src/blob_api/services/agent_seeding.py`, `apps/api/tests/test_agent_seeding.py`
- Modify: `apps/api/src/blob_api/services/janus_agent.py`, `apps/api/tests/test_janus_agent.py`

**Interfaces:**
- Produces: `janus_agent.join_public_channels(session, workspace_id, bot_user_id)`, `janus_agent.ensure_everywhere() -> int` (visits every workspace; one transaction each; never raises; logs its own outcome).

- [ ] **Step 1: Fold**

Move `join_public_channels` into `services/janus_agent.py` with its docstring (drop the sentence about being shared with the built-in seeder; keep the "why join" and "never private" paragraphs and the note that `create_channel` handles channels founded later). Move the body of `reconcile_everywhere` into `ensure_everywhere`, concrete: no `Ensure`/`Lookup` protocols, no `lacking_slug`, no `what` parameter — it calls this module's `existing_id` and `ensure`, and its docstring keeps the "one transaction per workspace", "never raises" and "counted by the difference" paragraphs. Delete `agent_seeding.py`. Update `main.py`'s comment if it names the module.

- [ ] **Step 2: Tests**

Delete `tests/test_agent_seeding.py`. Into `tests/test_janus_agent.py`'s `TestReconcilingAtBoot` add, adapted from it:

- `test_one_workspaces_failure_costs_no_other_its_agent`: two workspaces (`POST /api/admin/instance/workspaces`), Janus settings on, `monkeypatch.setattr(janus_agent, "ensure", failing_first)` where `failing_first` records calls, executes `SELECT 1` on the session it is given, and on its first call runs `SELECT 1/0` (a real Postgres failure that poisons the transaction) — then `ensure_everywhere()` visits both, and returns 1 when the stand-in answers a plugin id for the other.
- `test_each_workspace_is_seeded_as_its_own_owner`: the recorded `installed_by` for the second workspace is that workspace's owner row, not the founder's first-workspace id.
- `test_a_workspace_with_no_owner_is_left_alone`: deactivate the second workspace's users; only the first is visited.
- `test_a_workspace_that_already_had_it_is_not_counted` (existing `test_reconciling_twice_seeds_nothing_the_second_time` covers it — keep that one, drop this if redundant).

- [ ] **Step 3: Gate and commit**

Commit: `refactor: fold the seeding loop back into the one seeder left`.

---

### Task 5: The client

**Files:**
- Modify: `apps/web/src/features/home/HomeView.tsx` (~lines 79–86), `apps/web/src/lib/changelog.ts`, `apps/web/src/lib/help.ts` (if it names @Blob — `grep -n "Blob" apps/web/src/lib/help.ts`)

- [ ] **Step 1: HomeView**

Replace the `blob` memo with:

```tsx
  // The first agent that can answer. There used to be a preference for one named
  // "Blob", the agent Blob ran itself; that agent is retired and the workspace's agent
  // is whichever is installed and available — Janus, where it is running.
  const agent = useMemo(() => {
    const usable = Object.values(users).filter((u) => u.kind === 'bot' && agentIsAvailable(u));
    return usable[0];
  }, [users]);
```

and rename every `blob` use in the component to `agent`. The placeholder already reads `No agent installed yet` when there is none.

- [ ] **Step 2: Changelog**

At the top of the entries in `lib/changelog.ts`, in the shape of the existing entries (read the first one for the fields), add a `1.1.0` entry dated `2026-09-15` titled "One agent, and it is Janus" with two items: "Blob's own assistant is retired. Janus is the agent every workspace gets, in every public channel from the moment a channel exists. Old conversations with @Blob stay readable." and "A direct message with your workspace's agent, or with your own, needs no @mention — the room is the address. An app somebody installed by hand still needs one."

Run `pnpm stamp` from the repo root if the file's docstring says a release entry needs it; otherwise leave the stamp alone.

- [ ] **Step 3: Tests**

`apps/web`: `pnpm exec vitest run src/features/home src/features/admin`. Fix any test that mocked a bot named "Blob" and asserted the preference.

- [ ] **Step 4: Gate and commit**

Commit: `feat: the home view asks whichever agent is here`.

---

### Task 6: Records — ADR 0019, the digest, the traps, the README, the dev compose

**Files:**
- Create: `.torsor/architecture/decisions/0019-blob-ships-no-agent-of-its-own.md`
- Modify: `CLAUDE.md`, `.torsor/active/context.md`, `README.md`, `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml` (comments only)

- [ ] **Step 1: ADR 0019**

Copy the frontmatter shape of `0018-an-agent-is-the-workspaces-or-a-persons.md` (status, date, tags, `rules: []`, links). Body:

```
# Blob ships no agent of its own; Janus is the workspace agent

## Context

From 2026-09-14 Blob seeded two agents into every workspace: the one it ran itself
(`plugins/builtin.py` — an AG-UI server that never left the process, answering on the
server's `LLM_*` key, with tools that ran on the asker's authority) and Janus
(`magnetoid/janus`, a service in the stack, seeded by `services/janus_agent.py`). Two
`@` names in every sidebar, two configurations to keep in step, and a built-in agent that
had only ever been a placeholder for the real platform.

## Decision

Marko, 2026-09-15: *"Remove agent Blob, that doesn't exist anymore. Janus is the primary
agent."*

Blob ships no agent of its own. Janus is the agent every workspace gets — seeded at
founding and reconciled at boot by `services/janus_agent.py`, in every public channel
from the moment a channel exists (`plugins.in_every_public_channel`), addressed by its DM
without a mention (`plugins.answers_dm_without_mention`). Where Janus is not running, a
workspace has no agent and the home view says so.

The built-in runtime is deleted, not switched off: `plugins/builtin.py`, the in-process
transport, the `builtin` runtime and the `trusted` install flag that admitted it, and the
asker-authority tools (`jobs/agui_admission.agent_tools`) that only it used. With those
tools gone, [[0017-an-agent-reads-what-its-room-could-read]] has no subject and is
superseded: `workspace_policies.agent_reads`, the room bound in `services/mcp.py` and
the console switch are removed with it. Its reasoning is kept for the day an external
agent is offered Blob's tools — `plugins/agui.build_run_input` sends an empty `tools`
list by design, so that day is a decision, not a drift.

`LLM_*` stays for the two callers that remain: the unread recap and thread summaries.
`lib/llm.py` is the smallest layer those two need; the tool-calling half had one caller.

## A DM is addressed to its agent — for the right agents

The built-in agent answered its DM without `@Blob`, and only it: widening that to "any
bot in a DM" would hand every installed third-party app a run for every line typed at
it, with no manifest opt-in. That reasoning stands. The rule now: the room is the address
for a *resident* agent (`answers_dm_without_mention`, set only by the seeder) and for a
person's own agent (`owner_user_id` is the one person in the room — [[0018-an-agent-is-the-workspaces-or-a-persons]],
"your agent answers you"). An app installed by hand needs a mention in its DM; its
author's contract is unchanged.

## What stays

[[0013-agent-chains-carry-human-authority]] — a person's message roots a chain and
authority flows down it; unchanged, it never depended on which agent answered.
[[0014-work-channels-and-sandboxed-artifacts]], [[0015-summaries-cite-and-nudges-stay-private]],
[[0016-an-assistant-token-is-a-person]] and [[0018-an-agent-is-the-workspaces-or-a-persons]]
are untouched.

## Consequences

* Every workspace's agent runs in its own process with its own model and key, configured
  on Janus's side (see the console design of the same date for how Blob reaches it).
* Old conversations show messages from a retired "Blob", like any uninstalled app's.
* A deployment that has not set `COMPOSE_PROFILES=janus` goes from one agent to none.
```

- [ ] **Step 2: CLAUDE.md**

Exact replacements (each `old` occurs once; verify with a count before writing):

1. In the intro paragraph: `like the built-in Blob and the `magnetoid/janus` agent` → `like the `magnetoid/janus` agent, the one Blob seeds`.
2. `eighteen ADRs` → `nineteen ADRs`; `0013–0018 are the agentic surface — chains, work channels, summaries and nudges, the MCP caller, what a shared agent may read, and whose an agent is` → `0013–0019 are the agentic surface — chains, work channels, summaries and nudges, the MCP caller, whose an agent is, and that Blob ships no agent of its own (0017, what a shared agent may read, is superseded by 0019)`.
3. Replace the whole bullet that begins `* **The agent Blob runs itself**` (through `Do not grow it into a framework.`) with:

```
* **The agent Blob ships with is Janus** (`services/janus_agent.py`, ADR 0019). Seeded
  into every workspace through the ordinary install path when `JANUS_AGUI_URL` and
  `JANUS_SIGNING_SECRET` are set, so it is a `plugins` row with a bot in `users` and an
  admin revokes it with the same two clicks as anything else. The seeder sets
  `plugins.in_every_public_channel`, which is what puts it into a public channel founded
  *later* (`services/channels.create_channel`), and `plugins.answers_dm_without_mention`,
  which is what lets a DM with it need no `@` — a mention needs membership, and an agent
  absent from a new room is silently deaf in it. Nothing an admin installs by hand gets
  either flag. Blob runs no agent of its own any more: `lib/llm.py` is deliberately the
  smallest possible provider layer with two callers — the unread recap and thread
  summaries. Do not grow it into a framework.
```

4. Delete the whole bullet that begins `* **What a shared agent may read**` (through `private channels always answer 404.`).
5. In the "Auth" paragraph nothing changes. In the `lib/llm.py` mention under Ground rules, if the digest says "three model-invoking callers" anywhere else (`grep -n "three" CLAUDE.md`), make it two.

Then check `torsor rules` output still fits (it reads only the charter section, which this does not touch).

- [ ] **Step 3: The traps file**

`.torsor/active/context.md` ~line 294: the trap "The worker answers mentions; the app only seeds" — reword its consequence: with `LLM_*` set on the app and not the worker, summaries written by the worker say "no model is configured" while Catch-up on the app works; it no longer produces "the worst version of the built-in agent". Keep the rule ("set these on the app and the worker both").

- [ ] **Step 4: README and .env.example**

- `README.md` ~line 211: replace the bullet `- **A built-in agent** — set LLM_PROVIDER and LLM_API_KEY and every workspace gets **@Blob** ...` with `- **An agent in every workspace** — Janus, run as a service in this stack (`COMPOSE_PROFILES=janus`, see *Janus* below). It is seeded into every workspace, in every public channel from the moment a channel exists, and a DM with it needs no @mention.`
- `README.md` ~line 420: retitle `### The built-in agent` to `### A model for Catch-up and summaries`; in the `LLM_PROVIDER` row replace `Turns on **@Blob**, the Catch-up summaries and model-written thread summaries.` with `Turns on the Catch-up summaries and model-written thread summaries. It runs no agent: the agent is Janus.`; in `LLM_API_KEY`'s row drop "unlike an installed agent's, which its own container holds" if it reads oddly — keep the sentence if it still holds.
- `.env.example` lines ~73–94: rewrite the block comment: these give the server a model for Catch-up and thread summaries; leave `LLM_PROVIDER=disabled` and both say so instead of inventing a summary; the agent is Janus (`COMPOSE_PROFILES=janus` below). Drop the sentence about the built-in runtime spending the key.
- `docker-compose.prod.yml`: the `LLM_*` comment blocks on `app` and `worker` — if they name the built-in agent, reword to Catch-up and summaries. Values unchanged.

- [ ] **Step 5: The dev compose**

In `docker-compose.yml`, after `mailhog`, add the production `janus` service verbatim from `docker-compose.prod.yml` (image, `restart`, `profiles: ["janus"]`, `command`, `environment`, the `janusdata` volume) with two changes: no `networks:` key (the dev compose has no `agents` network; the app runs on the host and reaches `localhost`), and `ports: ["8642:8642"]` so `JANUS_AGUI_URL=http://localhost:8642/v1/agui` works from `pnpm dev`. Add `janusdata:` under `volumes:`. Above it, a comment: the agent the product assumes; `COMPOSE_PROFILES=janus docker compose up -d` starts it; the four `JANUS_*` lines in `.env.example` are what the API needs. Verify: `COMPOSE_PROFILES=janus docker compose config` renders the service.

- [ ] **Step 6: Gate and commit**

`torsor guard --strict --severity error $(git ls-files '*.py')` and `pnpm check`. Commit: `docs: record that Blob ships no agent of its own`.

---

### Task 7: The acceptance test the fix was written for

**Files:**
- Modify: `apps/api/tests/test_janus_agent.py` (`TestItIsInTheRoomsItIsMentionedIn`)

- [ ] **Step 1: The test**

```python
    async def test_it_answers_in_a_channel_founded_after_it_was_seeded(
        self, janus: None, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Without the join at founding (commit 1d424d73) this was dropped with no
        # message, no error and no run row — indistinguishable from the agent being down.
        from .test_agent_dm import says
        from .test_agui import agent_speaks, route_agent_to

        owner = await sign_up(client, "Founder")
        transport, seen = agent_speaks(*says("Here too."))
        route_agent_to(monkeypatch, transport)
        later = (await owner.post("/api/channels", {"name": "later", "kind": "public"})).body[
            "channel"
        ]["id"]

        sent = await send_message(owner, later, f"@{settings.JANUS_AGENT_NAME} are you here?")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        history = (await owner.get(f"/api/channels/{later}/messages")).body["messages"]
        assert any(m["body"] == "Here too." for m in history)
        assert len(seen) == 1
```

Add the imports the file lacks (`send_message`, `from blob_api.jobs import agui as agui_job`). If the fake transport also has to answer the `_resolve_the_example_host` fixture, import it as `test_agent_dm.py` does.

- [ ] **Step 2: Prove it**

Temporarily change `if kind == "public":` in `services/channels.create_channel` to `if kind == "public" and False:`, run the test, see it fail, restore the line, run the file: `uv run pytest tests/test_janus_agent.py -q`.

- [ ] **Step 3: Gate and commit**

Commit: `test: a mention in a channel founded after seeding is answered`.
