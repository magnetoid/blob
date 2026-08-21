"""What has to be true before Blob will try to host an agent.

The name of the runner's API setting is load-bearing in a way that is invisible from
inside this repository: Coolify injects `COOLIFY_URL` into every container it runs, set
to that container's own address. A Blob deployed on Coolify — which is the deployment
this feature exists for — would therefore read its own public URL and aim the runner at
itself, and the first one-click install would POST "create an application" to Blob.
"""

from __future__ import annotations

from blob_api.config import Settings

BASE = {
    "DATABASE_URL": "postgresql://localhost/blob_test",
    "SESSION_SECRET": "x" * 32,
}


def _settings(**overrides: str) -> Settings:
    # _env_file=None so a developer's own .env cannot decide the result of these.
    return Settings(**{**BASE, **overrides}, _env_file=None)  # type: ignore[arg-type]


def test_hosting_is_off_until_it_is_configured() -> None:
    assert _settings().agent_hosting_enabled is False


def test_the_runner_needs_every_piece_before_it_will_start() -> None:
    # Half-configured is worse than off: the deploy fails partway through, after the
    # plugin row and its bot user have already been committed.
    partial = _settings(
        AGENT_RUNNER="coolify",
        COOLIFY_API_URL="http://coolify:8080",
        COOLIFY_TOKEN="t",
    )
    assert partial.agent_hosting_enabled is False


def test_fully_configured_hosting_is_on() -> None:
    ready = _settings(
        AGENT_RUNNER="coolify",
        COOLIFY_API_URL="http://coolify:8080",
        COOLIFY_TOKEN="t",
        COOLIFY_PROJECT_UUID="p",
        COOLIFY_SERVER_UUID="s",
    )
    assert ready.agent_hosting_enabled is True


def test_coolifys_own_injected_url_is_not_what_we_read() -> None:
    """The regression guard for the name collision.

    A container Coolify runs always has COOLIFY_URL set to its own address. If the
    runner ever reads that name again, this fails: hosting would look configured while
    pointing at Blob itself.
    """
    settings = _settings(
        AGENT_RUNNER="coolify",
        COOLIFY_URL="https://chat.example.com",  # what Coolify injects
        COOLIFY_TOKEN="t",
        COOLIFY_PROJECT_UUID="p",
        COOLIFY_SERVER_UUID="s",
    )
    assert settings.COOLIFY_API_URL is None
    assert settings.agent_hosting_enabled is False


def test_a_blank_setting_counts_as_unset() -> None:
    # Compose files supply empty strings for variables nobody filled in.
    assert _settings(COOLIFY_API_URL="").COOLIFY_API_URL is None
