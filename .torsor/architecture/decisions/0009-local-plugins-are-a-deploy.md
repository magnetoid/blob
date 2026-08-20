---
type: decision
status: accepted
tags: [adr, plugins, security]
links: []
rules: []
---

# ADR 0009: Local plugins are installed by deploying, not from the console

## Context
The plugin system supports two runtimes from one manifest. It would be natural to let an
admin install either from the same screen.

## Decision
The console registers **external apps only**. Local plugins are discovered on the
filesystem at boot; `POST /api/admin/plugins` refuses `runtime: "local"` with
`local_not_installable`.

## Consequences
Stated plainly, because the docs must not imply otherwise: a local plugin runs in the
FastAPI process. It can read the environment, query anything, and forge a session. The
scopes it declares are an **ergonomics and audit boundary, not a security boundary**, and
Python has no in-process sandbox worth building here.

So the supply chain is what gets defended. Installing a local plugin requires filesystem
access plus a restart, which makes it a deploy — with a commit and a review behind it —
rather than something an admin session can do to the server.

The reliability mitigations are separate and do earn their keep, because the realistic
failure is a buggy plugin rather than a hostile one: per-handler timeouts, a circuit
breaker, and boot quarantine so a plugin that fails to import leaves the server running.

The sentence the docs use: *"Local plugins are trusted code — installing one is
equivalent to deploying server code. If you need to run code you don't fully trust, write
an external app."*
