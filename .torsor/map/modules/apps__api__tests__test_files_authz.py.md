---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T22:51:52'
updated: '2026-09-01T22:51:52'
---

# apps/api/tests/test_files_authz.py

Symbols in `apps/api/tests/test_files_authz.py`.

- L22 `_plant_attachment(workspace_id: str, uploader_id: str, *, message_id: str | None=None)` (function)
- L49 `team(client: Client)` (function)
- L69 `TestUnattachedFiles` (class)
- L70 `test_the_uploader_can_fetch_their_own_upload(self, team: dict)` (method)
- L75 `test_nobody_else_can(self, team: dict)` (method)
- L81 `TestAttachedFiles` (class)
- L82 `test_channel_members_can_fetch(self, team: dict)` (method)
- L90 `test_non_members_cannot(self, team: dict)` (method)
- L99 `test_even_the_uploader_loses_access_with_the_channel(self, team: dict)` (method)
- L114 `TestWorkspaceBoundary` (class)
- L115 `test_a_key_cannot_be_fetched_from_another_workspace(self, two_workspaces: dict)` (method)
- L128 `TestUploadRefusals` (class)
- L129 `test_blocked_extensions_never_get_a_ticket(self, team: dict)` (method)
- L137 `TestAvatars` (class)
- L138 `test_your_own_upload_becomes_your_picture(self, team: dict)` (method)
- L148 `test_somebody_elses_upload_cannot(self, team: dict)` (method)
- L153 `test_null_clears_the_picture(self, team: dict)` (method)
