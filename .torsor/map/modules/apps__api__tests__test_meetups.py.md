---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:47'
updated: '2026-09-12T14:23:47'
---

# apps/api/tests/test_meetups.py

Symbols in `apps/api/tests/test_meetups.py`.

- L33 `team(client: Client)` (function)
- L43 `_configure_livekit(monkeypatch: pytest.MonkeyPatch, *, present: bool)` (function)
- L48 `test_meetups_are_served_under_api(team: dict)` (function) — The client dials /api/meetups; the server has to be there.
- L55 `test_a_meetup_in_a_private_channel_needs_membership(team: dict)` (function) — A private channel's existence is private, so an outsider gets 404, not 403.
- L71 `test_joining_needs_membership_of_the_channel(team: dict, monkeypatch: pytest.MonkeyPatch)` (function) — A token is a key to the room; only the channel's members may hold one.
- L91 `test_an_owner_may_end_a_meetup_they_did_not_start(team: dict)` (function) — Admins and owners are both admins everywhere else; here too.
- L101 `test_a_bystander_may_not_end_it(team: dict)` (function)
- L108 `test_unconfigured_livekit_says_so_in_every_environment(team: dict, monkeypatch: pytest.MonkeyPatch)` (function) — The promise in .env.example: no LiveKit means `livekit_not_configured`, not a
