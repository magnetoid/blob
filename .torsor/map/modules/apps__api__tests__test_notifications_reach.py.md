---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T13:47:09'
updated: '2026-09-06T13:47:09'
---

# apps/api/tests/test_notifications_reach.py

Symbols in `apps/api/tests/test_notifications_reach.py`.

- L23 `_Sub` (class) — The duck-typed row `push` takes: id, endpoint and the browser's two keys.
- L26 `__init__(self, sub_id: str)` (method)
- L33 `TestPushReportsWhatHappened` (class)
- L34 `test_a_key_the_library_cannot_use_is_a_failure_not_a_delivery(self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture)` (method) — The bug this exists for: a bad VAPID key raised something that was not a
- L52 `test_a_subscription_the_browser_threw_away_is_dead_not_failed(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L71 `test_every_push_carries_a_timeout(self, monkeypatch: pytest.MonkeyPatch)` (method) — Without one `pywebpush` waits for ever, on a thread the worker cannot reclaim.
- L82 `test_the_old_entrance_still_answers_with_the_dead_ones(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L98 `team(client: Client)` (function)
- L104 `TestThePushTestButton` (class)
- L105 `test_it_refuses_when_the_server_has_no_keys(self, team: dict[str, Any])` (method)
- L110 `test_it_counts_what_landed_and_what_did_not(self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (method)
- L135 `test_nothing_subscribed_is_zero_rather_than_an_error(self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (method)
- L145 `TestMailTellsTheTruth` (class)
- L146 `test_send_mail_says_when_it_could_not(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L151 `test_the_probe_says_unreachable_rather_than_raising(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L161 `test_an_invitation_says_whether_the_email_went(self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (method)
- L178 `test_forgot_password_reports_the_server_not_the_account(self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (method)
- L192 `test_health_says_whether_either_path_works(self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (method)
- L206 `TestTheAdminCanUnlockSomebody` (class)
- L207 `test_a_reset_link_an_admin_hands_over_works(self, team: dict[str, Any])` (method)
- L221 `test_a_member_cannot_mint_one(self, team: dict[str, Any])` (method)
- L225 `test_somebody_who_is_not_here_is_a_404(self, team: dict[str, Any])` (method)
- L231 `test_a_deactivated_account_is_not_unlocked_this_way(self, team: dict[str, Any])` (method)
