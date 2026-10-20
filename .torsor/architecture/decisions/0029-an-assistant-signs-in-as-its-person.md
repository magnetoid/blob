---
type: decision
status: accepted
tags: [adr, product, assistants, security, mcp]
links:
  [
    0016-an-assistant-token-is-a-person,
    0003-hand-tuned-sql-stays-sql,
    0027-an-agent-may-use-an-mcp-servers-tools-through-blob,
  ]
rules: []
---

# ADR 0029: An assistant signs in as its person

## Context

ADR 0016 let a person's assistant into Blob with a token they minted and pasted. That
reaches Claude Code and an editor, and nothing else: in 2026 Claude, ChatGPT and the other
assistants with a "custom connector" take a server's **address and nothing more**, and
expect the server to tell them how to sign in. The MCP authorization spec (2025-06-18,
tightened in 2025-11-25 and 2026-07-28) is what they speak: a 401 that names the
resource's metadata, an authorization server found from it, a client identified by a
metadata document at an https URL (or, older, by registering itself), and the
authorization-code flow with PKCE. Without it, Blob cannot be added to Claude on the web or
to ChatGPT at all — which is where most people's assistant is.

## Decision

**Blob is the authorization server for its own MCP endpoint. A sign-in mints a grant from
one person to one app; the grant mints the same hour-long, person-shaped tokens the endpoint
already resolves.**

- **Found from the endpoint.** A 401 from `/api/mcp` carries
  `WWW-Authenticate: Bearer resource_metadata="…", scope="read write"` (and
  `error="invalid_token"` when a token was presented and is no good — the cue to refresh).
  Protected resource metadata (RFC 9728) is at the path-suffixed well-known URI and the
  root; authorization server metadata (RFC 8414) names `S256` as the only challenge method,
  `client_id_metadata_document_supported`, `authorization_response_iss_parameter_supported`,
  and `none` as the only client authentication. Blob is not an OpenID provider and does not
  pretend to be one: `/.well-known/` is the server's, so a probe for a document it does not
  publish hears 404, not the app's HTML.
- **Clients are public.** A `client_id` that is an https URL is a Client ID Metadata
  Document: fetched through the network guard (`require_https`, no redirects, 16 KB, five
  seconds), refused unless it names itself, cached a day and used stale when its host is
  briefly down. The fetch is **pinned** to the address the guard checked
  (`lib/net.pin_public`, TLS still verified against the name): any signed-in member can make
  Blob fetch a URL of their choosing by opening a consent link, so a nameserver must not be
  able to answer the check with a public address and the connection with a private one —
  DNS rebinding, found in review. The admin-only fetches (an app's address, an MCP server's)
  have the same unpinned check and are the next place to use it. Dynamic Client
  Registration (RFC 7591) stays for clients that still use it
  — deprecated by the spec, open to anyone, rate-limited per address — and never issues a
  secret. Redirect URIs match exactly, except that a loopback one matches on any port
  (RFC 8252), because Claude Code picks its port when it starts.
- **The flow.** Authorization code with PKCE `S256`, nothing else. A request whose client or
  redirect cannot be trusted is said to the person and never redirected — that would be the
  open redirect; anything else wrong goes back to the app as an error, with `state` and
  `iss` (RFC 9207). `resource`, when given, must be the endpoint (RFC 8707). Codes are
  single-use, five minutes long, kept hashed in Redis, and spent by a wrong verifier as much
  as by a right one.
- **The person decides, on a page that says what matters.** `/oauth/authorize` is the
  client's route, so a signed-out person signs in first and the question waits. It names
  the app as it names itself, **who confirms that** — the metadata document's domain, or
  that nothing does because it registered itself — and **where the answer goes**, called
  out as "a program on this computer" for a loopback redirect. Read is what connecting
  means; posting is a second tick, off unless ticked, and only offered when the app asked.
  The pending question lives in Redis for ten minutes, bound to the person who opened it;
  somebody else's attempt to answer it does not spend it.
- **A grant is one person and one app.** Saying yes again to the same app replaces its
  scope rather than adding a second connection. Each access token is an `mcp_tokens` row
  with `grant_id` set and an hour to live, so `/api/mcp` resolves it exactly as it resolves
  a pasted one — to the person (ADR 0016), filtered by its scopes, deactivation honoured.
  Opaque rather than signed: the resource and the authorization server are one process, and
  only the MCP endpoint resolves these rows, so the audience is bound by construction.
- **Refresh tokens rotate, and a replay ends the connection.** Thirty days, one use each; a
  used one presented again ends the grant and every token it minted, in a transaction of its
  own so the refusal cannot roll it back. A refresh may narrow the scope, never widen it.
- **Disconnecting is one place.** A person sees their connected apps under Settings →
  Assistants and an admin sees the workspace's on the same page as pasted tokens; either
  ends a grant, and everything it minted, at once. Granting and disconnecting are audited
  (`oauth.granted`, `oauth.revoked`). Pasted tokens stay for tools that cannot sign in, and
  their lists leave out tokens a grant minted — an hour each would be a list of hours.
- **The OAuth routes read no cookie.** `/.well-known/…` and `/oauth/token|register|revoke`
  sit outside `/api`, answer in RFC 6749's error shape, allow any origin, and are exempt
  from the Origin check (`ORIGIN_EXEMPT` in `main.py`) — there is no ambient credential
  for another site to borrow. The consent page's two calls are ordinary `/api` routes,
  behind the session and the Origin check.

## Consequences

- Migration 0059 (`oauth_clients`, `oauth_grants`, `oauth_refresh_tokens`,
  `mcp_tokens.grant_id`); `services/oauth.py`, `routers/oauth.py`; the nightly sweep drops
  expired grant tokens, spent refresh links and clients nobody connected within a month.
- The client: `features/oauth/ConsentScreen.tsx`, rendered by `App` in place of the
  workspace; Settings → Assistants leads with the connector address and the line for Claude
  Code; the admin's Assistants page lists connected apps above tokens.
- In development Vite proxies `/.well-known` and the three OAuth routes; `/oauth/authorize`
  stays with the client.
- Not built: a 403 `insufficient_scope` step-up (a read-only connection is never offered a
  write tool — the catalogue is filtered by scope — so there is nothing to step up from);
  `resources` and `prompts` on the MCP server; JWT access tokens; a client secret of any
  kind; an admin switch to forbid connecting apps (the token minting has none either — the
  admin's list and disconnect are the control).
