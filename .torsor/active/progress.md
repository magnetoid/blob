---
type: progress
status: active
tags: [active]
---

# Progress

Roadmap and milestone numbering come from `TEAM-CHAT-BUILD-PLAN.md`.

## Done

- **1–9 · Python port** — schema, auth, channels, messages, threads, search, realtime,
  jobs, cutover. Existing argon2 password hashes carried over untouched, so nobody reset
  a password; the dev database was adopted with `alembic stamp 0001` rather than rebuilt.
  **Milestone 8 is only half done**: `pnpm openapi` dumps the spec and ruff/mypy are in
  `pnpm check`, but the generated TS types, the `check:contract` diff and the protocol
  parity test were never built. See "Gaps" below.
- **10 · `apps/server` deleted** — one milestone past the cutover, as planned.
- **11–13 · Superadmin console** — `owner` became a real role (exactly one, cannot
  self-demote or be deactivated). People, invitations, channels, audit log, settings,
  health, webhooks.
- **14–15 · Themes** — four presets, token allowlist plus colour grammar, admin editor
  previewing on the live window, pre-hydration script killing the light flash.
- **16 · External apps** — manifest, SSRF-guarded registration, bots as real users,
  `/api/v1/` callback API, signed delivery, transactional outbox, admin management API.
- **Deployment** — one image, one origin, Coolify compose, boot migrations under an
  advisory lock.
- **Routing** — the four views and the seven admin sections are real paths, so a screen
  can be linked and reloaded into. Hand-rolled: four views and no nested layouts did not
  justify a fourth runtime dependency. Administration also gained the labelled way in
  that Slack has, behind the workspace name.
- **File uploads** — attach, drag-and-drop and paste-a-screenshot. Only the client was
  missing; the ticket/PUT/complete flow and `attachmentIds` on send already existed. The
  bucket is created on first upload rather than by an init container, because a container
  that exits makes `docker compose up --wait` report failure even on exit 0.
- **Feedback tickets** — filed by anyone from the user menu, read by admins only, since a
  page snapshot can contain a private channel. Carries the console log and the page as
  the reporter saw it, both captured when the dialog opens rather than on submit.
- **Agents from a repository** — `blob-app.json` read from GitHub, scopes approved, then
  deployed as a container by a runner that is not this process. See ADR 0010. Hosting is
  off unless `AGENT_RUNNER` is set, and the Coolify calls have not yet been exercised
  against a live deploy — only against a stub.

## In progress

Nothing. 231 tests pass; ruff, mypy --strict and tsc are clean.

## Next

- **17 · Blocks** — seven types, `messages.blocks` already in the schema,
  `BlockRenderer.tsx`, `/api/interactions` validating `actionId` against stored blocks.
  Wanted sooner now than the numbering suggests: structured output from an agent, in the
  conversation rather than beside it, *is* blocks.
- **Agent deployment, second half** — the console shows no live status or logs for a
  hosted agent. `GET /{id}/deployment`, `redeploy` and `stop` exist and are tested;
  nothing renders them.
- **19 · Slash commands** — conflict resolution at install; ephemeral, in-channel and
  deferred responses.
- **18 · Local plugin runtime** — importlib discovery under `PLUGINS_DIR`, decorator API,
  per-plugin KV, circuit breaker, boot quarantine. Less urgent than it was: an agent from
  a repository now runs as a container, which is what people actually wanted this for,
  without the in-process trust ADR 0009 refuses.
- **20 · Plugin admin console** — largely built as the Apps section; what remains is the
  deployment surface above.

## Gaps in what already ships

Not features — places where working code is unprotected.

- **No protocol parity test.** The WebSocket protocol is hand-written on both sides —
  `packages/shared/src/protocol.ts` and a Pydantic mirror. Nothing catches a drift, and
  the failure is silent at runtime rather than at build time.
- **No generated types or contract diff.** Milestone 8 planned `openapi-typescript` output
  under "packages/shared/src/generated/" plus a `check:contract` script. Neither exists,
  so the hand-written types and the real API can diverge unnoticed. (Path in quotes, not
  backticks — it is a planned artifact, and the staleness check rightly flags a backticked
  path that is not on disk.)
- **Almost no frontend tests.** Two files are covered — the outbox and the router — out of
  roughly 26 under `apps/web/src`, and `vitest` still runs with `--passWithNoTests`. The
  theme token logic and the socket reconnect path are the two worth covering next.

## Deferred
- **Huddles** and the **AI layer** — see the build plan.

## Blocked

- **Verifying the Docker image build.** Needs roughly 6 GB free; the machine had 4.3 GB
  on a 98%-full volume.
