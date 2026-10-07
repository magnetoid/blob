---
type: decision
status: superseded
tags: [adr, plugins, security]
links: []
rules: []
---

# ADR 0009: Local plugins are installed by deploying, not from the console

> **Superseded on 2026-10-08: there is no local runtime.** The loader this ADR describes
> was never built. The install route refused `runtime: "local"`, nothing else could
> create one, and the docs said "not built yet" — a capability promised in the manifest,
> the schema and the console's error codes, and present nowhere else. Phase 8 of the
> agentic review dropped it: migration 0053 takes `local` out of
> `plugins_runtime_check`, and a manifest naming it is refused as invalid input. Every
> app now runs outside the server process — at an address, in a container Blob hosts
> (0010), or dialling in (0012) — so a scope is a real boundary for every one of them.
> The reasoning below is why the runtime should not come back as a console install.

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
