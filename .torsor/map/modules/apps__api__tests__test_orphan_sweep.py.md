---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:24'
updated: '2026-09-05T04:19:24'
---

# apps/api/tests/test_orphan_sweep.py

Symbols in `apps/api/tests/test_orphan_sweep.py`.

- L28 `orphan(client: Client)` (function) — An upload old enough to sweep, attached to nothing.
- L55 `_row_exists(attachment_id: str)` (function)
- L66 `TestWhenStorageAnswers` (class)
- L67 `test_the_object_and_the_row_both_go(self, orphan: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L83 `TestWhenStorageIsDown` (class)
- L84 `test_the_row_stays_so_the_next_sweep_can_find_the_file(self, orphan: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L98 `test_and_the_sweep_after_it_succeeds(self, orphan: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L117 `TestAnAttachmentInUse` (class)
- L118 `test_is_never_swept(self, orphan: dict, monkeypatch: pytest.MonkeyPatch)` (method)
