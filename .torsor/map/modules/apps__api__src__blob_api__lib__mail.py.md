---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T18:21:59'
updated: '2026-09-06T18:21:59'
---

# apps/api/src/blob_api/lib/mail.py

Symbols in `apps/api/src/blob_api/lib/mail.py`.

- L23 `send_mail(to: str, subject: str, body: str)` (function) — Send it, and say whether it went. Never raises.
- L48 `send_invite(to: str, inviter_name: str, url: str, workspace: str)` (function)
- L57 `send_password_reset(to: str, url: str)` (function)
- L73 `probe()` (function) — Whether mail could go out at all: "ok", "unreachable", or "unconfigured".
