---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:47'
updated: '2026-09-12T14:23:47'
---

# apps/api/tests/test_files_authz.py

Symbols in `apps/api/tests/test_files_authz.py`.

- L23 `_plant_attachment(workspace_id: str, uploader_id: str, *, message_id: str | None=None)` (function)
- L50 `team(client: Client)` (function)
- L70 `TestUnattachedFiles` (class)
- L71 `test_the_uploader_can_fetch_their_own_upload(self, team: dict)` (method)
- L76 `test_nobody_else_can(self, team: dict)` (method)
- L82 `TestAttachedFiles` (class)
- L83 `test_channel_members_can_fetch(self, team: dict)` (method)
- L91 `test_non_members_cannot(self, team: dict)` (method)
- L101 `TestFilesLibrary` (class)
- L102 `test_members_see_files_posted_in_their_channels(self, team: dict)` (method)
- L115 `test_outsiders_do_not_see_a_private_channel(self, team: dict)` (method)
- L125 `test_unattached_uploads_stay_off_the_library(self, team: dict)` (method)
- L133 `TestAttachedFilesLeave` (class)
- L134 `test_even_the_uploader_loses_access_with_the_channel(self, team: dict)` (method)
- L149 `TestWorkspaceBoundary` (class)
- L150 `test_a_key_cannot_be_fetched_from_another_workspace(self, two_workspaces: dict)` (method)
- L163 `TestUploadRefusals` (class)
- L164 `test_blocked_extensions_never_get_a_ticket(self, team: dict)` (method)
- L171 `test_html_named_as_a_png_is_refused_on_complete(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L192 `TestAvatars` (class)
- L193 `test_your_own_upload_becomes_your_picture(self, team: dict)` (method)
- L203 `test_somebody_elses_upload_cannot(self, team: dict)` (method)
- L208 `test_null_clears_the_picture(self, team: dict)` (method)
