"""Janus as a service inside Blob's own stack.

Seeded rather than registered, for the reason `services/workspace_agent.py` gives about
the built-in agent: a setup task somebody may never do is not a feature. The difference
is that this one is somebody else's code, so it is installed untrusted and holds granted
scopes like any app.
"""

from __future__ import annotations

from blob_api.config import Settings

REQUIRED = {
    "DATABASE_URL": "postgres://blob:blob@localhost:5432/blob_test",
    "SESSION_SECRET": "test-secret-that-is-at-least-32-characters-long",
}


def build(**overrides: str) -> Settings:
    """A `Settings` built from these values alone, the way test_llm_config does."""
    return Settings(_env_file=None, **{**REQUIRED, **overrides})  # type: ignore[arg-type]


class TestSettings:
    def test_janus_is_off_by_default(self) -> None:
        assert build().JANUS_AGUI_URL is None
        assert build().JANUS_SIGNING_SECRET is None

    def test_the_default_name_is_janus(self) -> None:
        assert build().JANUS_AGENT_NAME == "Janus"

    def test_a_blank_value_reads_as_unset(self) -> None:
        # `.env.example` ships these with nothing after the equals. Without the
        # validator they arrive as "", which is falsy but is not None — and
        # `configured()` asks `is None`.
        settings = build(JANUS_AGUI_URL="", JANUS_SIGNING_SECRET="")
        assert settings.JANUS_AGUI_URL is None
        assert settings.JANUS_SIGNING_SECRET is None
