"""An unset model setting has to read as unset, not as the empty string.

`.env.example` ships `LLM_BASE_URL=` and `LLM_API_KEY=` with nothing after the equals,
because that is how you show somebody a setting exists and is optional. pydantic hands
those through as `""`, which is falsy and therefore harmless everywhere the code writes
`settings.X or default` — and wrong in the one place that asks `is None`.

That one place decides which structured-output hint `complete` sends. Under the old
spelling, an operator who copied `.env.example`, set `LLM_PROVIDER=openai` and a key, and
left the base URL line alone was treated as if they were running a compatible server:
real OpenAI got plain `json_object` instead of its strict schema, for every thread
summary, forever, with nothing failing to show it. That is the shape of bug this file
exists to stop — so the fix is to coerce at the boundary, the way every other optional
setting in `config.py` already does, rather than to spell the check differently.
"""

from __future__ import annotations

import pytest

from blob_api.config import Settings

REQUIRED = {
    "DATABASE_URL": "postgres://blob:blob@localhost:5432/blob_test",
    "SESSION_SECRET": "test-secret-that-is-at-least-32-characters-long",
}


def build(**overrides: str) -> Settings:
    """A `Settings` built from these values alone.

    `_env_file=None` because `Settings` otherwise reads the repo-root `.env`, and a
    developer who has configured a real provider would see their own key here — which is
    how "the default is None" passes on CI and fails on the machine that has one.
    """
    return Settings(_env_file=None, **{**REQUIRED, **overrides})  # type: ignore[arg-type]


class TestBlankIsUnset:
    @pytest.mark.parametrize("field", ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"])
    def test_an_empty_line_in_env_means_unset(self, field: str) -> None:
        assert getattr(build(**{field: ""}), field) is None

    def test_a_real_value_survives(self) -> None:
        settings = build(LLM_BASE_URL="http://ollama.local:11434", LLM_API_KEY="sk-test")
        assert settings.LLM_BASE_URL == "http://ollama.local:11434"
        assert settings.LLM_API_KEY == "sk-test"

    def test_the_defaults_are_already_none(self) -> None:
        settings = build()
        assert settings.LLM_BASE_URL is None
        assert settings.LLM_API_KEY is None
        assert settings.LLM_MODEL is None


class TestStructuredOutputHint:
    """The check the coercion above exists for."""

    def test_openai_with_the_env_example_line_still_gets_the_strict_schema(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from blob_api.config import settings
        from blob_api.lib import llm

        monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
        # What `Settings` now produces from `LLM_BASE_URL=` — the bug was that this was
        # `""` here, and `"" is None` is False.
        monkeypatch.setattr(settings, "LLM_BASE_URL", build(LLM_BASE_URL="").LLM_BASE_URL)
        assert llm._takes_strict_json_schema() is True

    def test_a_compatible_server_still_gets_plain_json_mode(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from blob_api.config import settings
        from blob_api.lib import llm

        monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
        monkeypatch.setattr(settings, "LLM_BASE_URL", "http://ollama.local:11434")
        assert llm._takes_strict_json_schema() is False

    def test_deepseek_never_gets_it(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from blob_api.config import settings
        from blob_api.lib import llm

        monkeypatch.setattr(settings, "LLM_PROVIDER", "deepseek")
        monkeypatch.setattr(settings, "LLM_BASE_URL", None)
        assert llm._takes_strict_json_schema() is False


class TestProviderHosts:
    def test_each_provider_knows_its_own_host(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from blob_api.config import settings
        from blob_api.lib import llm

        monkeypatch.setattr(settings, "LLM_BASE_URL", None)
        for provider, host in [
            ("anthropic", "https://api.anthropic.com"),
            ("openai", "https://api.openai.com"),
            ("deepseek", "https://api.deepseek.com"),
        ]:
            monkeypatch.setattr(settings, "LLM_PROVIDER", provider)
            assert llm._base() == host

    def test_an_empty_base_url_falls_back_to_the_provider_rather_than_to_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Belt and braces: even if a blank reached `_base()` uncoerced, the request must
        # not be built against "" and posted to a relative URL.
        from blob_api.config import settings
        from blob_api.lib import llm

        monkeypatch.setattr(settings, "LLM_PROVIDER", "deepseek")
        monkeypatch.setattr(settings, "LLM_BASE_URL", "")
        assert llm._base() == "https://api.deepseek.com"
