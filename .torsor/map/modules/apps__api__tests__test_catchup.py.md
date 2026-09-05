---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/tests/test_catchup.py

Symbols in `apps/api/tests/test_catchup.py`.

- L16 `team(client: Client)` (function)
- L38 `model_speaks(monkeypatch: pytest.MonkeyPatch)` (function) — A model that answers instantly and records what it was asked.
- L51 `TestCatchup` (class)
- L52 `test_a_channel_with_unread_gets_a_summary(self, team: dict, model_speaks: list)` (method)
- L63 `test_nothing_unread_means_no_summaries_and_no_model_call(self, team: dict, model_speaks: list)` (method)
- L77 `test_a_channel_you_cannot_see_is_a_404(self, team: dict, model_speaks: list)` (method)
- L82 `test_the_workspace_form_never_reads_channels_you_are_not_in(self, team: dict, model_speaks: list)` (method)
- L93 `test_no_model_is_a_clean_refusal(self, team: dict, monkeypatch)` (method)
