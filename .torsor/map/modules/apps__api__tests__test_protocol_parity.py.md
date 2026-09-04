---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T07:26:44'
updated: '2026-09-04T07:26:44'
---

# apps/api/tests/test_protocol_parity.py

Symbols in `apps/api/tests/test_protocol_parity.py`.

- L26 `source()` (function)
- L31 `_union_block(source: str, name: str)` (function) — The body of `export type <name> = ... ;`.
- L53 `_event_names(block: str)` (function) — Every `t` literal, including the `'a' | 'b'` form used for paired events.
- L61 `_constant(source: str, name: str)` (function)
- L67 `test_the_server_events_match(source: str)` (function)
- L77 `test_the_client_frames_match(source: str)` (function)
- L92 `test_the_timings_match(source: str, name: str, value: int)` (function) — A drifted timing is worse than a drifted name: nothing breaks, it just misbehaves.
- L103 `test_the_socket_path_matches(source: str)` (function)
- L107 `test_every_declared_event_is_actually_emitted()` (function) — A declaration nobody sends is drift too, just in the other direction.
