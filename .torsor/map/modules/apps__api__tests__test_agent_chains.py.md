---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T01:13:47'
updated: '2026-09-16T01:13:47'
---

# apps/api/tests/test_agent_chains.py

Symbols in `apps/api/tests/test_agent_chains.py`.

- L76 `_nothing()` (function) — What a recorded `enqueue` hands to `fire_and_forget`: a coroutine that does nothing.
- L80 `two_agents(scripts: dict[str, tuple[bytes, ...]])` (function) — Two fake agents behind one transport, told apart by path.
- L99 `room(client: Client, monkeypatch: pytest.MonkeyPatch)` (function) — Helper and Planner in #general, with a swappable pair of scripts.
- L145 `speak(room: dict, **scripts: tuple[bytes, ...])` (function)
- L153 `root_run(room: dict, asker: Client, body: str='@Helper sort this out')` (function)
- L160 `spawned(room: dict)` (function) — (message id, parent run id) for every hop the job asked for.
- L167 `follow_hops(room: dict, *, rounds: int=6)` (function) — Drive every enqueued hop, as the worker would, until nothing new is enqueued.
- L179 `runs(room: dict)` (function)
- L197 `set_depth(room: dict, depth: int)` (function)
- L212 `TestAHop` (class)
- L213 `test_an_agents_reply_that_mentions_another_agent_starts_a_child_run(self, room: dict)` (method)
- L239 `test_a_bot_api_post_never_starts_a_run(self, room: dict)` (method)
- L253 `test_an_agent_mentioning_itself_does_not_run_again(self, room: dict)` (method)
- L261 `TestWhoseAuthority` (class)
- L262 `give_planner_to(self, room: dict, person: Client)` (method)
- L269 `test_a_hop_carries_the_persons_authority_not_the_agents(self, room: dict)` (method)
- L282 `test_and_runs_when_the_person_could_have_asked_it_themselves(self, room: dict)` (method)
- L293 `TestTheBudget` (class)
- L294 `test_the_depth_budget_ends_a_chain_silently(self, room: dict)` (method)
- L305 `test_depth_zero_is_yesterdays_behaviour(self, room: dict)` (method)
- L315 `test_the_environment_is_the_ceiling(self, room: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L326 `test_ping_pong_stops_at_the_per_agent_cap(self, room: dict)` (method)
- L339 `test_a_stale_chain_admits_nothing(self, room: dict)` (method)
- L354 `TestStop` (class)
- L355 `test_cancelling_a_parent_cancels_its_running_children(self, room: dict)` (method)
- L373 `test_a_hop_enqueued_after_its_parent_was_stopped_never_starts(self, room: dict)` (method)
- L392 `TestThePolicyRoundTrips` (class)
- L393 `test_through_the_console_route(self, client: Client)` (method)
- L408 `TestAnAgentOnASchedule` (class)
- L409 `test_a_scheduled_message_that_mentions_an_agent_roots_a_chain(self, room: dict)` (method) — Proactive agents need no new machinery: a scheduled message is sent through the
