---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:20'
updated: '2026-09-23T03:37:20'
---

# apps/api/tests/test_calls_admin.py

Symbols in `apps/api/tests/test_calls_admin.py`.

- L24 `configure(monkeypatch: pytest.MonkeyPatch, *, present: bool)` (function)
- L31 `people(client: Client)` (function)
- L39 `test_the_defaults_are_what_an_admin_reads(people: dict[str, Any])` (function)
- L48 `test_a_member_may_not_read_or_change_them(people: dict[str, Any])` (function)
- L53 `test_a_change_is_kept_announced_and_leaves_other_settings_alone(people: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (function)
- L78 `test_a_cap_out_of_range_is_invalid_input(people: dict[str, Any])` (function)
- L86 `test_the_server_panel_is_the_instance_admins(people: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (function)
- L94 `test_the_server_panel_says_what_it_can_see(people: dict[str, Any], monkeypatch: pytest.MonkeyPatch, fake_livekit: FakeRooms)` (function)
