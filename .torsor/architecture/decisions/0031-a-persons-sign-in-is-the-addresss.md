---
type: decision
status: accepted
tags: [adr, security, auth, sessions]
links:
  [
    0016-an-assistant-token-is-a-person,
    0029-an-assistant-signs-in-as-its-person,
  ]
rules: []
---

# ADR 0031: A person's sign-in is the address's, and handing out reach asks for a fresh proof

## Context

A person in Blob is one `users` row per workspace, joined by an address and one password
(`services/workspaces`). Sessions, though, were treated as the row's: the devices list
showed one workspace's sessions, and "sign out everywhere else" deleted one row's. The
switcher swaps a session for one in another workspace without asking for a password — so a
stolen session in one workspace survived "sign out everywhere else" from another, and could
switch straight back in. Separately, nothing that hands out lasting reach — an MCP token, an
assistant's OAuth grant, a role, a reset link, a bot token — asked anything of a session
beyond existing, so a cookie lifted from an unlocked laptop could mint a year-long token
that outlives the cookie. And an assistant that signed in (ADR 0029) survived every
sign-out: its access token was revoked with the person's tokens, but its grant was not, and
its refresh token minted the next one.

## Decision

**Where a person is signed in, what happened to their sign-in, and signing out are the
address's, across every workspace. Handing somebody else reach needs a sign-in no older
than fifteen minutes.**

- **Sessions are listed and ended per address.** `GET /api/auth/sessions` lists every
  session of every row the address holds, with the workspace and how it signed in
  (`sessions.method`). One can be ended (`DELETE /api/auth/sessions/{id}`) and "everywhere
  else" ends all but the caller's, in every workspace, with every MCP token *and every OAuth
  grant* of the address. An admin's "revoke sessions" stays one workspace's — an admin's
  reach ends at their workspace — and now ends the person's grants there too.
- **A record the person can read.** `account_events` keeps sign-ins (by method), failed
  passwords for an address that exists, confirmations, password changes and sessions ended,
  with the device and address each came from, for ninety days. It is the person's, keyed
  on the address, and nobody else's page shows it. An unknown address leaves nothing.
- **A fresh proof, for reach that outlasts the session.** `sessions.reauth_at` is set at
  sign-in and each time the person confirms (`POST /api/auth/reauth`, a password today).
  `require_recent_auth` refuses with 403 `reauth_required` once it is older than
  `REAUTH_WINDOW` (fifteen minutes) on: minting an MCP token, approving an assistant's
  sign-in (declining needs nothing), attaching a personal agent, installing an app or
  issuing its token or secret, inviting an admin, changing a role, and minting a reset
  link. A workspace switch carries the old session's time over — it proves nothing, and
  minting it as fresh would launder an old cookie. 403, not 401, because the client reads
  401 as signed out; the client answers it once, globally, by asking and sending the same
  request again (`lib/stepUp.ts`), so no screen learns the rule.
- **A password can be changed while signed in.** The current password is the proof; it is
  written to every row (the one-password rule) and every other session ends. Assistants
  stay connected — letting one in needed a fresh proof, so a stolen cookie cannot have —
  while a reset, which is what somebody does who lost the account, ends them too.

## Consequences

- Migration 0063: `sessions.method`, `sessions.reauth_at`, `account_events`. Sessions from
  before it have no proof time and simply ask the first time.
- The record is swept by `jobs/retention` after ninety days, whatever the workspace's own
  retention, because it spans workspaces.
- Not built here: passkeys and single sign-on as ways to sign in and to confirm (the
  `methods` list the confirm prompt reads is where they arrive), an admin view of members'
  sign-ins, mail about a sign-in from a new device, and a lockout after repeated failures —
  sign-in stays rate-limited per address of the caller, as before.
