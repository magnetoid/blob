---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:20'
updated: '2026-09-23T03:37:20'
---

# apps/api/tests/test_calls_webhook.py

Symbols in `apps/api/tests/test_calls_webhook.py`.

- L38 `_configured(monkeypatch: pytest.MonkeyPatch)` (function)
- L45 `live(client: Client)` (function)
- L54 `in_channel(client: Client)` (function) — A live call in a private channel a member can leave — unlike `live`'s DM, whose
- L67 `post_event(client: Client, event: dict[str, Any], secret: str=SECRET)` (function)
- L78 `joined(call_id: str, user_id: str, sid: str)` (function)
- L86 `left(call_id: str, user_id: str, sid: str)` (function)
- L94 `people(who: Client)` (function)
- L99 `test_a_join_and_a_leave_move_the_list(live: dict[str, Any])` (function)
- L111 `test_a_stale_leave_does_not_remove_a_rejoin(live: dict[str, Any])` (function)
- L119 `test_a_finished_room_ends_the_call(live: dict[str, Any])` (function)
- L135 `test_a_bad_signature_is_refused(live: dict[str, Any])` (function)
- L146 `test_rooms_that_are_not_ours_are_ignored(live: dict[str, Any])` (function)
- L160 `_age(call_id: str, seconds: int)` (function)
- L168 `test_the_sweep_ends_a_call_whose_room_is_gone(live: dict[str, Any], fake_livekit: FakeRooms)` (function)
- L179 `test_the_sweep_does_not_churn_forever_on_an_identity_with_no_user(live: dict[str, Any], fake_livekit: FakeRooms)` (function) — A well-formed uuid that names nobody real must not make the sweep report a change
- L194 `test_the_sweep_replaces_who_is_in_a_call(live: dict[str, Any], fake_livekit: FakeRooms)` (function)
- L205 `test_the_sweep_closes_a_room_left_behind_by_an_ended_call(live: dict[str, Any], fake_livekit: FakeRooms)` (function)
- L221 `test_a_concurrent_sweep_does_nothing_while_the_first_holds_the_lease(live: dict[str, Any], fake_livekit: FakeRooms)` (function)
- L237 `test_the_lease_is_released_when_the_sweep_raises(live: dict[str, Any], fake_livekit: FakeRooms, monkeypatch: pytest.MonkeyPatch)` (function)
- L258 `test_a_member_who_leaves_the_channel_is_removed_from_a_live_call(in_channel: dict[str, Any], fake_livekit: FakeRooms)` (function)
- L275 `test_a_deactivated_member_is_removed_from_a_live_call(in_channel: dict[str, Any], fake_livekit: FakeRooms)` (function)
- L292 `test_an_active_member_is_never_removed(live: dict[str, Any], fake_livekit: FakeRooms)` (function)
- L304 `test_a_membership_check_that_raises_leaves_the_participant_alone(live: dict[str, Any], fake_livekit: FakeRooms, monkeypatch: pytest.MonkeyPatch)` (function) — A query that cannot answer must not be read as "no access": that would eject
- L333 `test_an_oversized_body_is_refused_before_the_signature_is_checked(live: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (function)
- L348 `test_a_body_at_the_ceiling_is_still_checked_normally(live: dict[str, Any])` (function) — The limit is on the body LiveKit sends, not a trap for an ordinary one — padding an
