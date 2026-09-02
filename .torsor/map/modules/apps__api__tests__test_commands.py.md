---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T04:50:24'
updated: '2026-09-02T04:50:24'
---

# apps/api/tests/test_commands.py

Symbols in `apps/api/tests/test_commands.py`.

- L18 `team(client: Client)` (function)
- L26 `run(client: Client, channel_id: str, text: str, **extra: object)` (function)
- L34 `test_an_unknown_command_answers_rather_than_failing(team: dict)` (function)
- L42 `test_text_that_is_not_a_command_is_refused(team: dict)` (function)
- L55 `test_a_lone_slash_is_not_a_command(team: dict)` (function)
- L64 `test_help_lists_commands_and_posts_nothing(team: dict)` (function)
- L76 `test_an_ephemeral_reply_is_not_visible_to_anyone_else(team: dict)` (function)
- L85 `test_shrug_posts_a_message(team: dict)` (function)
- L90 `test_shrug_alone_still_posts_the_shrug(team: dict)` (function)
- L95 `test_me_posts_an_action_in_italics(team: dict)` (function)
- L100 `test_me_with_nothing_to_do_explains_itself(team: dict)` (function)
- L106 `test_a_command_that_posts_is_idempotent(team: dict)` (function)
- L120 `test_topic_sets_the_topic(team: dict)` (function)
- L129 `test_topic_with_no_argument_clears_it(team: dict)` (function)
- L138 `test_leave_removes_the_member(team: dict)` (function)
- L149 `test_a_command_cannot_reach_a_channel_you_are_not_in(team: dict)` (function)
- L163 `test_direct_messages_refuse_channel_commands(team: dict, command: str)` (function)
