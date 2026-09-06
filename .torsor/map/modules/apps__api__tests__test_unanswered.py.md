---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-07T00:07:28'
updated: '2026-09-07T00:07:28'
---

# apps/api/tests/test_unanswered.py

Symbols in `apps/api/tests/test_unanswered.py`.

- L28 `later(delta: timedelta=A_DAY_AND_A_BIT)` (function)
- L33 `room(client: Client)` (function)
- L44 `ask(room: dict[str, Any], body: str='Does anyone know why CI is red?')` (function)
- L50 `saved_row(user_id: str, message_id: str)` (function)
- L63 `TestWhatCountsAsAnswered` (class)
- L64 `test_a_question_nobody_answered_becomes_a_reminder_for_its_asker(self, room: dict[str, Any])` (method)
- L79 `test_a_reply_in_the_thread_counts(self, room: dict[str, Any])` (method)
- L84 `test_a_reaction_from_somebody_else_counts(self, room: dict[str, Any])` (method)
- L90 `test_the_askers_own_reaction_does_not_count(self, room: dict[str, Any])` (method)
- L95 `test_a_later_message_by_somebody_else_counts(self, room: dict[str, Any])` (method)
- L100 `test_the_askers_own_follow_up_does_not_count(self, room: dict[str, Any])` (method)
- L105 `test_an_app_chiming_in_does_not_count(self, room: dict[str, Any], monkeypatch: pytest.MonkeyPatch)` (method)
- L129 `test_a_mention_of_the_asker_in_another_thread_counts(self, room: dict[str, Any])` (method)
- L146 `test_a_question_mark_before_a_quote_or_bang_still_counts(self, room: dict[str, Any])` (method)
- L153 `test_a_statement_is_not_a_question(self, room: dict[str, Any])` (method)
- L157 `test_a_room_that_did_not_switch_it_on_is_left_alone(self, room: dict[str, Any])` (method)
- L168 `TestTheWindow` (class)
- L169 `test_too_early_and_too_late_are_both_nothing(self, room: dict[str, Any])` (method)
- L179 `test_two_sweeps_at_once_nudge_once(self, room: dict[str, Any])` (method)
- L195 `TestWhoIsTold` (class)
- L196 `test_a_muted_channel_is_an_answer_too(self, room: dict[str, Any])` (method)
- L208 `test_a_person_who_opted_out_is_not_nudged(self, room: dict[str, Any])` (method)
- L216 `test_nobody_else_is_told(self, room: dict[str, Any])` (method)
- L225 `TestTheReminder` (class)
- L226 `test_the_persons_own_reminder_is_left_alone(self, room: dict[str, Any])` (method)
- L240 `test_something_already_dealt_with_is_not_resurfaced(self, room: dict[str, Any])` (method)
- L252 `test_it_fires_through_the_ordinary_reminder_sweep(self, room: dict[str, Any])` (method)
- L269 `TestTheSwitch` (class)
- L270 `test_it_travels_with_the_channel(self, room: dict[str, Any])` (method)
- L281 `test_the_note_quotes_the_question_briefly(self)` (method)
