---
type: decision
status: accepted
tags: [adr, deployment]
links: []
rules: []
---

# ADR 0008: One image, one origin

## Context
The client and the API were separate processes on separate ports, glued in development by
Vite's proxy. Deployed that way they need two services, two sets of proxy rules, and a
CORS story for the session cookie.

## Decision
A three-stage Dockerfile builds both tiers into one image. FastAPI serves the built client
with an SPA fallback, so `/`, `/api` and `/ws` share an origin.

## Consequences
The session cookie needs no CORS exemption, the socket connects to `location.host` with
nothing to configure, and a proxy in front has one service to route. The frontend needed
no changes — `socket.ts` already built its URL from `location.host`.

`/api/*` and `/ws` are excluded from the SPA fallback and 404 properly; otherwise a
mistyped endpoint answers 200 with HTML and the client parses a page as JSON.

Behind a reverse proxy two settings are not optional:

- **`--proxy-headers` on uvicorn.** Without it every request appears to come from the
  proxy, so one person failing logins rate-limits everybody and every audit row records
  the same address.
- **`PUBLIC_URL` exactly matching the public origin**, because it is the origin every
  mutating request is checked against. A mismatch surfaces as "Blocked request." at
  sign-in.

Migrations run from the entrypoint under a Postgres advisory lock, so replicas booting
together serialize instead of racing to `CREATE TABLE`, and a failed migration stops the
container rather than serving against a schema it does not have.

`/healthz` is liveness and touches nothing; `/readyz` checks Postgres and Redis. The
container health check uses the former deliberately — one that queried the database would
restart a healthy app every time the database blinked.
