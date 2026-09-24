---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:20'
updated: '2026-09-23T03:37:20'
---

# apps/api/tests/test_calls.py

Symbols in `apps/api/tests/test_calls.py`.

- L35 `configure(monkeypatch: pytest.MonkeyPatch, *, present: bool)` (function)
- L41 `_configured(monkeypatch: pytest.MonkeyPatch)` (function)
- L46 `frames(monkeypatch: pytest.MonkeyPatch)` (function) — Every frame sent to a channel, in order.
- L56 `team(client: Client)` (function)
- L77 `start(who: Client, channel: dict[str, Any], kind: str='meetup')` (function)
- L81 `test_a_start_creates_the_room_with_the_kinds_cap(team: dict[str, Any], fake_livekit: FakeRooms, frames: list)` (function)
- L94 `test_starting_a_live_call_joins_it(team: dict[str, Any], fake_livekit: FakeRooms, frames: list)` (function)
- L106 `test_a_huddle_and_a_meetup_can_both_be_live(team: dict[str, Any])` (function)
- L113 `test_an_outsider_gets_the_channels_404_everywhere(team: dict[str, Any])` (function)
- L121 `test_starting_in_an_archived_channel_is_refused(team: dict[str, Any])` (function) — A call is a write to its conversation, so a read-only channel refuses one — the
- L133 `test_the_list_holds_only_calls_in_your_conversations(team: dict[str, Any])` (function)
- L143 `test_the_token_carries_what_the_settings_allow(team: dict[str, Any])` (function)
- L166 `test_the_cap_is_set_on_the_room(team: dict[str, Any], fake_livekit: FakeRooms)` (function)
- L175 `test_a_kind_that_is_off_can_neither_start_nor_mint(team: dict[str, Any])` (function)
- L210 `test_a_start_livekit_refuses_writes_nothing(team: dict[str, Any], fake_livekit: FakeRooms, frames: list)` (function)
- L221 `test_no_livekit_is_a_state_that_says_so(team: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (function)
- L232 `test_a_token_with_no_livekit_says_so(team: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (function) — A call already running loses its media server the same way a fresh one would.
- L243 `test_the_starter_or_an_admin_ends_it_and_a_bystander_cannot(team: dict[str, Any], fake_livekit: FakeRooms, frames: list)` (function)
- L260 `test_ending_closes_the_room_only_after_its_own_commit(team: dict[str, Any], fake_livekit: FakeRooms, monkeypatch: pytest.MonkeyPatch)` (function) — `end` opens its own transaction and must not still be inside it while it closes
- L283 `test_ending_with_no_livekit_still_ends_it(team: dict[str, Any], fake_livekit: FakeRooms, monkeypatch: pytest.MonkeyPatch)` (function) — Closing the room is best-effort cleanup, not a precondition: a call that Blob
- L297 `test_an_ended_call_mints_no_token(team: dict[str, Any])` (function)
- L305 `test_the_old_routes_are_gone(team: dict[str, Any])` (function)
- L309 `test_more_than_30_token_requests_a_minute_are_refused(team: dict[str, Any], fake_livekit: FakeRooms)` (function) — Joining is more frequent than starting — a reload re-joins — so `call_token` has
- L323 `test_a_token_still_works_when_the_room_already_exists(team: dict[str, Any], fake_livekit: FakeRooms)` (function) — `token` mints a fresh pass into a room `start` already created — the common case,
- L334 `test_the_foreign_keys_are_named_for_the_table_they_are_on()` (function) — 0045 renamed `meetups` to `calls`, but `RENAME TABLE` alone leaves a foreign key's
