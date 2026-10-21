---
type: decision
status: accepted
tags: [adr, security, auth, sso, oidc]
links:
  [
    0031-a-persons-sign-in-is-the-addresss,
    0032-a-passkey-is-the-persons-and-a-password-can-need-one,
  ]
rules: []
---

# ADR 0033: Single sign-on is the server's, and the provider's subject decides who it is

## Context

Teams moving from Slack expect to sign in with the account their organisation already
gives them. OpenID Connect is what every provider speaks — Google Workspace, Microsoft
Entra, Okta, Keycloak. 2026 had a run of OIDC account takeovers in relying parties
(Coder's CVE-2026-55075, Keycloak's CVE-2026-14781), all from the same family of mistakes:
linking accounts by an email claim that was absent, unverified or not the person's, or
linking a second subject to an address another subject already held. The usual Python
library had its own year of CVEs (Authlib: an `alg: none` bypass, a padding oracle).

## Decision

**A provider is the server's, connected by its administrator. Blob is a small, strict
relying party on top of pyjwt, and who signed in is the pair (provider, `sub`).**

- **The server's, not a workspace's.** One person is one address across every workspace
  here (ADR 0031), so whoever vouches for them does so everywhere. `sso_providers` is set
  up from the instance console (`require_recent_instance_admin`); the client secret lives
  in `sso_provider_secrets` and never comes back.
- **The protocol, strictly.** Authorization code with PKCE (S256), a nonce and a state.
  The state is bound to the browser that began the round trip by a short cookie, so a
  callback finished in another browser is refused (login CSRF). Every round trip starts
  with a same-origin `POST /api/auth/sso/begin`, so a sign-in cannot be started from
  another site and "confirm it's you" and linking pass the usual `reauth_required` first.
  The discovery document must name the issuer it was fetched for; the `iss` parameter is
  checked (RFC 9207), and required where the provider advertises it. The ID token's
  signature is checked against the published keys (refetched once on an unknown `kid`),
  asymmetric algorithms only, with issuer, audience, `azp`, times and nonce.
- **Who it is.** Once (provider, `sub`) is linked, that alone decides — a changed email
  claim changes nothing. A first sign-in links to an existing account only on
  `email_verified` exactly `true`, within the provider's allowed domains, when the address
  has no other subject at that provider (unique per provider and address), and when the
  provider is set to link by address. Otherwise the person links it themselves, signed in
  and freshly proven, from Sign-in & security.
- **Nobody new without a reason.** A new person gets an account only by an invitation they
  arrived with, or by the provider's join workspace — and a join workspace requires the
  provider to name the domains new people may come from, since a provider like Google
  otherwise lets in anyone with a free account. The account has no password of its own
  (the address's, if it has one elsewhere). A password signup for an address that has
  accounts and no password is refused: an open invitation must not hand anyone a way to
  set one.
- **The provider's rules, not ours, after it.** A sign-in through a provider is not followed
  by Blob's own second step (ADR 0032): the organisation's provider applies its own.
  Confirming it is you through a provider asks it to sign the person in again
  (`prompt=login`, `max_age=0`) and checks `auth_time`, in a window of its own, while the
  page polls for the session's proof so the refused request survives.

## Consequences

- Migration 0065; `services/sso.py`, `routers/sso.py`, `routers/admin_sso.py`; two exact
  pairs in `PUBLIC_ROUTES` (`POST /api/auth/sso/begin`, `GET /api/auth/sso/callback`);
  `services/signup.join_by_identity`; the sign-in page's "Continue with" buttons; the
  admin console's Single sign-on page (instance).
- A refusal is a sentence on the sign-in page (`?sso_error=`), never an error page: the
  browser is mid-redirect and the person has nowhere else to read it.
- Provider endpoints must be https outside development. Private addresses are allowed:
  the administrator is the server's operator, and a Keycloak on the same network is an
  ordinary deployment.
- Not built: SAML and SCIM (until somebody asks), the provider's logout, group or role
  claims mapped to roles, and a workspace policy that requires single sign-on.
