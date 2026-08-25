---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T10:13:28'
updated: '2026-08-25T10:13:28'
---

# apps/api/tests/test_app_commands.py

Symbols in `apps/api/tests/test_app_commands.py`.

- L34 `Received` (class)
- L40 `FakeApp` (class) — An app that answers a command with whatever it has been told to say.
- L52 `fake_app()` (function)
- L87 `workspace_of(user_id: str)` (function)
- L98 `install_app(owner: Client, *, port: int, slug: str='deployer', commands: list[CommandDecl] | None=None, scopes: list[str] | None=None)` (function) — Install through the registry.
- L134 `add_bot_to_channel(plugin_id: str, channel_id: str)` (function)
- L152 `team(client: Client)` (function)
- L159 `run(client: Client, channel_id: str, text_input: str)` (function)
- L169 `test_an_app_cannot_claim_a_built_in_name(team: dict, fake_app: FakeApp)` (function)
- L179 `test_commands_need_the_commands_scope(team: dict, fake_app: FakeApp)` (function)
- L189 `test_two_apps_cannot_hold_the_same_command(team: dict, fake_app: FakeApp)` (function)
- L202 `test_an_app_command_appears_in_the_bootstrap_list(team: dict, fake_app: FakeApp)` (function)
- L215 `test_an_app_answers_a_command_privately(team: dict, fake_app: FakeApp)` (function)
- L236 `test_an_app_can_answer_in_the_channel(team: dict, fake_app: FakeApp)` (function)
- L255 `test_a_slow_app_is_not_a_broken_one(team: dict, fake_app: FakeApp)` (function)
- L268 `test_an_app_that_says_nothing_is_told_to_answer_later(team: dict, fake_app: FakeApp)` (function)
- L281 `test_rubbish_from_an_app_is_not_shown_to_the_person(team: dict, fake_app: FakeApp)` (function)
- L295 `test_an_app_not_in_the_channel_is_not_asked(team: dict, fake_app: FakeApp)` (function)
- L304 `test_a_disabled_app_stops_answering(team: dict, fake_app: FakeApp)` (function)
- L321 `test_a_response_token_round_trips()` (function)
- L328 `test_a_tampered_token_is_refused()` (function)
- L335 `test_an_expired_token_is_refused()` (function)
- L342 `test_an_app_answers_later_through_its_response_url(team: dict, fake_app: FakeApp)` (function)
- L368 `test_the_same_deferred_answer_twice_posts_once(team: dict, fake_app: FakeApp)` (function)
- L390 `test_two_different_deferred_answers_both_post(team: dict, fake_app: FakeApp)` (function)
- L411 `test_a_forged_response_url_is_refused(team: dict)` (function)
