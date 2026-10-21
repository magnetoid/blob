---
type: decision
status: accepted
tags: [adr, security, auth, passkeys, webauthn]
links:
  [
    0031-a-persons-sign-in-is-the-addresss,
  ]
rules: []
---

# ADR 0032: A passkey is the person's, and a password can be made to need one

## Context

Email and password was the only way into Blob. Passkeys — WebAuthn credentials whose
private key stays on the person's device or in their password manager — are the 2026
default for phishing-resistant sign-in, and every browser Blob supports parses WebAuthn's
JSON options natively (Chrome 129, Firefox 119, Safari 18.4) and offers passkeys in a
field's autofill. The plan asked for passkeys both as a way in on their own and as a
second factor.

## Decision

**A passkey is the address's, like the password beside it. It signs in alone, confirms
it is you, and — when the person asks — is required after their password.**

- **One set per person.** `passkeys` and `passkey_owners` are keyed on the address, not a
  `users` row: a passkey added in one workspace signs in wherever a password would
  (`accounts.find_for_login`), and the switcher does the rest (ADR 0031). The credential's
  user handle is random per address, never the address.
- **Three ceremonies, each bound to what began it.** Every challenge lives in Redis for
  five minutes and is spent once (`GETDEL`): a sign-in names nobody (discoverable
  credentials, so no address is typed and the browser can offer them in autofill); a
  confirmation names the person and the session that asked; a second step names the
  person and the account their password just matched. The server checks the credential
  belongs to whoever the flow named — the `allowCredentials` the browser is given is a
  hint, not a control — and that a confirmation answers the session it was minted for.
- **Verification is py_webauthn's**, with user verification required whenever the
  passkey is the only factor (sign-in, confirmation) and at registration, and the
  signature counter enforced so a cloned key is refused. No attestation is requested:
  which brand holds the key is not Blob's business.
- **Two-step is the person's choice, and its way back is an admin's.** "Ask for a passkey
  after my password" makes `POST /api/auth/login` answer a challenge instead of a session
  (`twoStep`), finished at `POST /api/auth/two-step`. A password reset proves only the
  inbox, so it does not sign such a person in (`signedIn: false`). Somebody who lost every
  device their passkeys were on gets it ended by an admin from People, under the reset
  link's rule (`_may_act_on(everywhere=True)`), audited as `user.two_step_ended`. The last
  passkey cannot be removed while the second step is on.
- **The client carries the ceremony and nothing else.** `lib/passkeys.ts` is the platform's
  `parse*OptionsFromJSON` and `toJSON()` — no WebAuthn library — plus the Signal API, where
  a browser has it, to tell a password manager a removed key is gone.

## Consequences

- Migration 0064; `services/passkeys.py`, `routers/passkeys.py`; three exact pairs in
  `PUBLIC_ROUTES` (`/api/auth/passkey/options`, `/api/auth/passkey/sign-in`,
  `/api/auth/two-step`); `account_events` learns the passkey lines; adding, removing and
  turning the second step on or off need a fresh proof (ADR 0031).
- The relying party is `PUBLIC_URL`'s host, so a server that moves to a new address
  leaves its passkeys behind — the password and a reset still get people in, and they
  add passkeys again. Related-origin requests are not used.
- `webauthn` is held below 3.0 while cbor2 6 has no Intel-macOS wheel; 3.0 adds only
  post-quantum algorithms no authenticator ships yet.
- Not built: recovery codes (an admin is the way back), a workspace policy that requires
  two-step of everyone, passkey upgrades offered after a password sign-in (WebAuthn's
  conditional create), and naming a passkey by its authenticator's AAGUID — it is named
  after the browser it was made in, and renamed by hand.
