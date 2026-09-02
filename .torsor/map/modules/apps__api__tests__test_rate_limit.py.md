---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:04:41'
updated: '2026-09-02T05:04:41'
---

# apps/api/tests/test_rate_limit.py

Symbols in `apps/api/tests/test_rate_limit.py`.

- L13 `_DeadPipeline` (class) — A Redis client whose pipeline fails the way a dead server fails.
- L16 `pipeline(self, transaction: bool=True)` (method)
- L19 `__aenter__(self)` (method)
- L22 `__aexit__(self, *exc: object)` (method)
- L26 `test_a_redis_outage_does_not_block_the_write(monkeypatch: pytest.MonkeyPatch)` (function)
- L36 `test_a_legitimate_429_still_raises(monkeypatch: pytest.MonkeyPatch)` (function)
- L61 `test_the_workspace_stays_usable_end_to_end(client: Client, monkeypatch: pytest.MonkeyPatch)` (function)
