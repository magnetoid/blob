---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:47'
updated: '2026-09-12T14:23:47'
---

# apps/api/tests/test_llm_config.py

Symbols in `apps/api/tests/test_llm_config.py`.

- L29 `build(**overrides: str)` (function) — A `Settings` built from these values alone.
- L39 `TestBlankIsUnset` (class)
- L41 `test_an_empty_line_in_env_means_unset(self, field: str)` (method)
- L44 `test_a_real_value_survives(self)` (method)
- L49 `test_the_defaults_are_already_none(self)` (method)
- L56 `TestStructuredOutputHint` (class) — The check the coercion above exists for.
- L59 `test_openai_with_the_env_example_line_still_gets_the_strict_schema(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L71 `test_a_compatible_server_still_gets_plain_json_mode(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L81 `test_deepseek_never_gets_it(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L90 `TestProviderHosts` (class)
- L91 `test_each_provider_knows_its_own_host(self, monkeypatch: pytest.MonkeyPatch)` (method)
- L104 `test_an_empty_base_url_falls_back_to_the_provider_rather_than_to_nothing(self, monkeypatch: pytest.MonkeyPatch)` (method)
