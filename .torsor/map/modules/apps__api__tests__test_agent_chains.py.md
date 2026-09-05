---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:24'
updated: '2026-09-05T04:19:24'
---

# apps/api/tests/test_agent_chains.py

Symbols in `apps/api/tests/test_agent_chains.py`.

- L76 `_nothing()` (function) — What a recorded `enqueue` hands to `fire_and_forget`: a coroutine that does nothing.
- L80 `two_agents(scripts: dict[str, tuple[bytes, ...]])` (function) — Two fake agents behind one transport, told apart by path.
- L99 `room(client: Client, monkeypatch: pytest.MonkeyPatch)` (function) — Helper and Planner in #general, with a swappable pair of scripts.
- L146 `speak(room: dict, **scripts: tuple[bytes, ...])` (function)
- L154 `root_run(room: dict, asker: Client, body: str='@Helper sort this out')` (function)
- L161 `spawned(room: dict)` (function) — (message id, parent run id) for every hop the job asked for.
- L168 `follow_hops(room: dict, *, rounds: int=6)` (function) — Drive every enqueued hop, as the worker would, until nothing new is enqueued.
- L180 `runs(room: dict)` (function)
- L198 `set_depth(room: dict, depth: int)` (function)
- L213 `TestAHop` (class)
- L214 `test_an_agents_reply_that_mentions_another_agent_starts_a_child_run(self, room: dict)` (method)
- L240 `test_a_bot_api_post_never_starts_a_run(self, room: dict)` (method)
- L254 `test_an_agent_mentioning_itself_does_not_run_again(self, room: dict)` (method)
- L262 `TestWhoseAuthority` (class)
- L263 `give_planner_to(self, room: dict, person: Client)` (method)
- L270 `test_a_hop_carries_the_persons_authority_not_the_agents(self, room: dict)` (method)
- L283 `test_and_runs_when_the_person_could_have_asked_it_themselves(self, room: dict)` (method)
- L294 `TestTheBudget` (class)
- L295 `test_the_depth_budget_ends_a_chain_silently(self, room: dict)` (method)
- L306 `test_depth_zero_is_yesterdays_behaviour(self, room: dict)` (method)
- L316 `test_the_environment_is_the_ceiling(self, room: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L327 `test_ping_pong_stops_at_the_per_agent_cap(self, room: dict)` (method)
- L340 `test_a_stale_chain_admits_nothing(self, room: dict)` (method)
- L355 `TestStop` (class)
- L356 `test_cancelling_a_parent_cancels_its_running_children(self, room: dict)` (method)
- L374 `test_a_hop_enqueued_after_its_parent_was_stopped_never_starts(self, room: dict)` (method)
- L393 `TestTheBuiltinKnowsTheRoom` (class)
- L394 `test_it_is_told_who_else_is_in_the_room(self)` (method)
- L400 `test_and_says_nothing_about_agents_when_it_is_alone(self)` (method)
- L405 `test_being_asked_by_an_agent_is_described_as_such(self)` (method)
- L414 `TestThePolicyRoundTrips` (class)
- L415 `test_through_the_console_route(self, client: Client)` (method)
