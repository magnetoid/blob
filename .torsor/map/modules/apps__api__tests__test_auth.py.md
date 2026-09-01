---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T23:39:51'
updated: '2026-09-01T23:39:51'
---

# apps/api/tests/test_auth.py

Symbols in `apps/api/tests/test_auth.py`.

- L10 `test_first_signup_founds_the_workspace_and_owns_it(client: Client)` (function)
- L20 `test_signup_without_an_invitation_is_refused(client: Client)` (function)
- L36 `test_invited_user_joins_and_lands_on_the_default_channels(client: Client)` (function)
- L46 `test_an_invitation_can_only_be_used_once(client: Client)` (function)
- L66 `test_invite_preview_is_public_and_hides_used_invites(client: Client)` (function)
- L81 `test_only_admins_can_invite(client: Client)` (function)
- L91 `test_login_and_logout(client: Client)` (function)
- L106 `test_login_gives_one_message_for_wrong_email_or_wrong_password(client: Client)` (function)
- L123 `test_logout_others_keeps_the_current_session(client: Client)` (function)
- L157 `test_invalid_signup_reports_400_with_the_offending_field(client: Client, payload: dict, field: str)` (function)
