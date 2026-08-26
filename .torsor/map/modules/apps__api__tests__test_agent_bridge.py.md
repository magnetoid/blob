---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T03:43:02'
updated: '2026-08-26T03:43:02'
---

# apps/api/tests/test_agent_bridge.py

Symbols in `apps/api/tests/test_agent_bridge.py`.

- L28 `config(monkeypatch: pytest.MonkeyPatch)` (function)
- L36 `Socket` (class) — A socket that records what was written to it.
- L39 `__init__(self)` (method)
- L42 `send(self, raw: str)` (method)
- L45 `frames(self, kind: str)` (method)
- L49 `TestWhatItIsPointedAt` (class)
- L50 `test_https_becomes_wss(self, config: agent_bridge.Config)` (method)
- L53 `test_http_becomes_ws(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L60 `test_a_missing_setting_fails_at_startup(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L68 `TestTheSignature` (class)
- L69 `test_it_matches_what_the_server_produces(self)` (method)
- L80 `test_the_server_verifies_it(self)` (method)
- L89 `TestReadingTheAgentsStream` (class)
- L90 `test_records_split_across_chunks_are_reassembled(self)` (method)
- L98 `test_keepalive_comments_are_ignored(self)` (method)
- L105 `test_a_final_record_without_a_blank_line_still_arrives(self)` (method)
- L111 `TestRelayingARun` (class)
- L112 `test_every_event_is_forwarded_under_its_run_id(self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch)` (method)
- L127 `test_done_is_sent_last(self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch)` (method)
- L138 `test_done_is_sent_even_when_the_agent_fails(self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch)` (method)
- L151 `test_a_failure_before_any_answer_is_reported(self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch)` (method)
- L163 `test_a_failure_after_a_real_answer_is_not(self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch)` (method)
- L178 `TestKeepingTrackOfRuns` (class)
- L179 `test_draining_snapshots_before_cancelling(self, config: agent_bridge.Config, monkeypatch: pytest.MonkeyPatch)` (method)
- L196 `_stream(chunks: list[str])` (function) — Something shaped enough like an httpx.Response for `_sse_events`.
- L207 `_install(monkeypatch: pytest.MonkeyPatch, bridge: agent_bridge.Bridge, gen: Any)` (function)
- L211 `_answers_with(monkeypatch: pytest.MonkeyPatch, bridge: agent_bridge.Bridge, *events: dict[str, Any])` (function)
- L221 `_fails_with(monkeypatch: pytest.MonkeyPatch, bridge: agent_bridge.Bridge, error: Exception)` (function)
- L231 `_answers_then_fails(monkeypatch: pytest.MonkeyPatch, bridge: agent_bridge.Bridge, event: dict[str, Any])` (function)
