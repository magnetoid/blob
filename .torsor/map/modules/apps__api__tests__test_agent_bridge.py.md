---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T22:51:52'
updated: '2026-09-01T22:51:52'
---

# apps/api/tests/test_agent_bridge.py

Symbols in `apps/api/tests/test_agent_bridge.py`.

- L30 `config(monkeypatch: pytest.MonkeyPatch)` (function)
- L38 `Socket` (class) — A socket that records what was written to it.
- L41 `__init__(self)` (method)
- L44 `send(self, raw: str)` (method)
- L47 `frames(self, kind: str)` (method)
- L51 `TestWhatItIsPointedAt` (class)
- L52 `test_https_becomes_wss(self, config: agent_bridge.Config)` (method)
- L55 `test_http_becomes_ws(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L62 `test_a_missing_setting_fails_at_startup(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L70 `TestTheSignature` (class)
- L71 `test_it_matches_what_the_server_produces(self)` (method)
- L82 `test_the_server_verifies_it(self)` (method)
- L91 `TestReadingTheAgentsStream` (class)
- L92 `test_records_split_across_chunks_are_reassembled(self)` (method)
- L100 `test_keepalive_comments_are_ignored(self)` (method)
- L107 `test_a_final_record_without_a_blank_line_still_arrives(self)` (method)
- L113 `TestRelayingARun` (class)
- L114 `test_every_event_is_forwarded_under_its_run_id(self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch)` (method)
- L129 `test_done_is_sent_last(self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch)` (method)
- L140 `test_done_is_sent_even_when_the_agent_fails(self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch)` (method)
- L153 `test_a_failure_before_any_answer_is_reported(self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch)` (method)
- L165 `test_a_failure_after_a_real_answer_is_not(self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch)` (method)
- L180 `TestKeepingTrackOfRuns` (class)
- L181 `test_draining_snapshots_before_cancelling(self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch)` (method)
- L198 `_stream(chunks: list[str])` (function) — Something shaped enough like an httpx.Response for `_sse_events`.
- L209 `_install(monkeypatch: pytest.MonkeyPatch, bridge: agent_bridge.Bridge, gen: Any)` (function)
- L213 `_answers_with(monkeypatch: pytest.MonkeyPatch, bridge: agent_bridge.Bridge, *events: dict[str, Any])` (function)
- L223 `_fails_with(monkeypatch: pytest.MonkeyPatch, bridge: agent_bridge.Bridge, error: Exception)` (function)
- L233 `_answers_then_fails(monkeypatch: pytest.MonkeyPatch, bridge: agent_bridge.Bridge, event: dict[str, Any])` (function)
- L243 `TestServingTheBridge` (class) — The download an admin gets, so a laptop needs two commands rather than a checkout.
- L251 `test_an_admin_gets_the_script(self, team: dict)` (method)
- L260 `test_a_member_does_not(self, team: dict)` (method)
