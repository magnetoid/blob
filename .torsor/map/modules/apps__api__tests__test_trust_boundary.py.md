---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:47'
updated: '2026-09-12T14:23:47'
---

# apps/api/tests/test_trust_boundary.py

Symbols in `apps/api/tests/test_trust_boundary.py`.

- L24 `bot_client(who: Client, token: str)` (function)
- L31 `team(client: Client)` (function)
- L41 `TestABotTokenCannotConfirmAPrivateChannel` (class) — Any member can mint one of these for themselves through `POST /api/agents/mine`.
- L49 `test_a_name_it_cannot_see_answers_the_same_as_a_name_that_is_not_there(self, team: dict[str, Any])` (method)
- L67 `test_a_public_channel_still_resolves_by_name(self, team: dict[str, Any])` (method)
- L77 `test_a_private_channel_it_was_added_to_does_resolve(self, team: dict[str, Any])` (method) — The clause narrows to what the bot can see — not to public channels only.
- L95 `TestAnAvatarIsAPicture` (class)
- L96 `test_a_profile_picture_that_is_markup_is_refused(self, team: dict[str, Any])` (method) — `mime` is whatever the uploader typed; the ticket route checks the extension.
- L113 `test_a_real_picture_is_accepted(self, team: dict[str, Any])` (method)
- L123 `test_the_download_pins_the_type_it_serves(self)` (method) — Whatever is stored, the browser is told what this server decided.
- L138 `TestAnAssistantTokenIsASession` (class)
- L139 `test_a_password_reset_revokes_it(self, team: dict[str, Any])` (method) — Somebody who lost control of their account and reset it was still being read.
- L177 `test_signing_out_everywhere_else_revokes_it(self, team: dict[str, Any])` (method)
- L193 `_hashed(token: str)` (function)
- L199 `TestCompletingAnUpload` (class)
- L200 `test_the_second_completion_is_free(self, team: dict[str, Any])` (method) — A retry is a retry. Each repeat used to pay for the whole re-encode again.
- L227 `test_it_is_rate_limited_like_the_ticket_that_made_it(self, team: dict[str, Any])` (method)
