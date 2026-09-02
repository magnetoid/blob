---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T23:42:00'
updated: '2026-09-02T23:42:00'
---

# apps/api/tests/test_agent_socket_handshake.py

Symbols in `apps/api/tests/test_agent_socket_handshake.py`.

- L33 `mute_socket()` (function) — Connect with no Authorization header, so the first frame is the handshake.
- L42 `_first_frame_close_code(payload: str)` (function)
- L52 `TestAFirstFrameThatIsNotAnObject` (class)
- L54 `test_is_refused_rather_than_crashing_the_handler(self, payload: str)` (method)
- L58 `TestAFirstFrameThatIsNotJson` (class)
- L59 `test_is_refused_as_a_bad_frame(self)` (method)
- L64 `TestAWellFormedFrameWithABadToken` (class)
- L65 `test_is_refused_without_saying_why(self)` (method)
