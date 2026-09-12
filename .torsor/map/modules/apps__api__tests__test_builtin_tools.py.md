---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/tests/test_builtin_tools.py

Symbols in `apps/api/tests/test_builtin_tools.py`.

- L41 `model(monkeypatch: pytest.MonkeyPatch)` (function) — A configured Anthropic that asks for one tool, then answers with `reply`.
- L68 `_general(client: Client)` (function)
- L72 `_ask(client: Client, channel_id: str, question: str)` (function)
- L77 `_bodies(client: Client, channel_id: str)` (function)
- L82 `_tool_names(request: dict[str, Any])` (function)
- L86 `_tool_results(request: dict[str, Any])` (function) — Every tool_result block in a request, as one string to search.
- L99 `TestReadingAsTheAsker` (class)
- L100 `test_it_reads_the_channel_it_was_asked_about(self, model: dict[str, Any], client: Client)` (method)
- L118 `test_a_private_channel_the_asker_is_not_in_stays_private(self, model: dict[str, Any], client: Client)` (method)
- L138 `test_the_tool_calls_are_on_the_run_card(self, model: dict[str, Any], client: Client)` (method)
- L159 `TestWhatItIsOffered` (class)
- L160 `test_tools_follow_the_plugins_grants(self)` (method)
- L171 `test_posting_is_a_grant_of_its_own(self)` (method) — Answering where it was asked and choosing where to speak are different powers.
- L186 `test_the_agent_that_ships_turned_on_cannot_post_elsewhere(self)` (method)
- L191 `test_the_shape_is_what_the_model_layer_takes(self)` (method)
- L195 `test_the_seeded_agent_may_see_who_is_here(self, model: dict[str, Any], client: Client)` (method) — Naming a person is not a bonus feature, it is most of what gets asked.
- L212 `test_a_revoked_grant_removes_the_tool(self, model: dict[str, Any], client: Client)` (method)
- L232 `TestInADirectMessage` (class)
- L233 `test_a_personal_agent_is_handed_the_same_tools(self, model: dict[str, Any], client: Client)` (method) — The DM is the room where "what did I miss" is actually typed.
- L260 `TestWhatItIsTold` (class)
- L261 `test_the_prompt_says_what_it_can_read_when_it_has_tools(self)` (method)
- L273 `test_a_personal_agent_with_tools_no_longer_claims_blindness(self)` (method)
- L282 `_drain()` (function) — Let the tasks `fire_and_forget` created actually run.
- L295 `_record(monkeypatch: pytest.MonkeyPatch, queued: list[tuple[Any, ...]])` (function) — Capture what `announce` queues, without actually queueing it.
- L310 `TestWhenItPosts` (class) — `post_message` in an agent's hands, which is not the same as in an assistant's.
- L326 `_caller(self, client: Client, *, agent: bool)` (method)
- L349 `test_an_agents_post_cannot_root_a_second_chain(self, model: dict[str, Any], client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L366 `test_a_persons_assistant_still_starts_one(self, model: dict[str, Any], client: Client, monkeypatch: pytest.MonkeyPatch)` (method)
- L383 `test_with_the_grant_it_posts_where_it_was_told(self, model: dict[str, Any], client: Client)` (method) — The whole path: grant, schema, dispatch, message — as the person who asked.
