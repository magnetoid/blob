# Security policy

## Reporting a vulnerability

Please report it privately through GitHub: the repository's **Security** tab →
**Report a vulnerability**. That opens a private advisory only the maintainers can read.
Do not open a public issue, and do not test against the public demo instances or anybody
else's deployment — run your own (`docker compose up -d`, see the README's Quick start).

A useful report says what an attacker needs (a session? a bot token? nothing?), what they
get, and the shortest reproduction you have. You will hear back within a week. A fix ships
on `main`, which deploys, and the advisory is published once deployments have had a chance
to update.

## Supported versions

Only the newest release on `main` is supported. Blob is self-hosted and ships continuously;
there are no maintained release branches. Upgrading is pulling `main` and redeploying —
migrations run on boot.

## What is in scope

Everything in this repository: the API, the worker, the web client, the agent socket and
terminal, the MCP endpoint, the app (bot) API, and the production compose file. The
boundaries the code is meant to hold, and that a report breaking any of them is about:

- **A private channel's existence is private.** An outsider gets 404, never 403, for the
  channel and anything in it — messages, files, threads, calls, search hits.
- **An agent never reaches further than the person it acts for**, and in a channel no
  further than that room (ADRs 0017 and 0022). A write an agent proposes waits for a
  person's approval.
- **Nothing an agent or app publishes executes on Blob's origin.** Pages run in a
  sandboxed frame under their own policy, and only after a person asks (ADR 0007).
- **Workspaces on one server are isolated** from each other except to the server's own
  administrator.
- **No credential appears in a response body, log line or audit row** — provider keys
  passed through the Janus console included.

Out of scope: denial of service by volume against your own instance, findings that need a
compromised server or database, and missing hardening headers with no demonstrated impact.

## How the project checks itself

Every push runs a dependency audit of what ships (`pip-audit` over the locked production
requirements, `pnpm audit --prod`), a secret scan of the whole history (gitleaks), ruff's
security rules over the backend, a check that only code is ever interpolated into SQL
(`apps/api/tests/test_sql_interpolation.py`), and the architectural rules in
`.torsor/architecture/decisions/`. Dependabot proposes dependency and action updates
weekly; nothing merges itself.
