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


# ─── the callback URL ─────────────────────────────────────────────────────────
class TestTheHostnameTheRunnerReports:
    """Coolify reports a hostname in two different shapes, and one of them used to
    produce `https://http://host/blob/events` — every delivery to every hosted agent
    failing on a URL that was never a URL. Found by creating a real application and
    reading the field back, not from the code."""

    def test_a_scheme_that_is_already_there_is_not_doubled(self) -> None:
        from blob_api.plugins.runner import normalize_fqdn

        assert normalize_fqdn("http://abc.65.21.238.89.sslip.io") == (
            "http://abc.65.21.238.89.sslip.io"
        )
        assert normalize_fqdn("https://agent.example.com") == "https://agent.example.com"

    def test_a_bare_hostname_gets_one(self) -> None:
        from blob_api.plugins.runner import normalize_fqdn

        assert normalize_fqdn("abc.sslip.io:3000") == "https://abc.sslip.io:3000"

    def test_the_first_of_several_domains_wins(self) -> None:
        from blob_api.plugins.runner import normalize_fqdn

        assert normalize_fqdn("https://a.example.com,https://b.example.com") == (
            "https://a.example.com"
        )

    def test_nothing_assigned_yet_stays_nothing(self) -> None:
        from blob_api.plugins.runner import normalize_fqdn

        assert normalize_fqdn(None) is None
        assert normalize_fqdn("") is None
        assert normalize_fqdn("   ") is None

    def test_what_comes_out_can_always_have_a_path_appended(self) -> None:
        from blob_api.plugins.runner import normalize_fqdn

        for raw in ("http://a.io", "a.io", "a.io:3000/", "https://a.io/"):
            base = normalize_fqdn(raw)
            assert base is not None
            url = f"{base}/blob/events"
            assert url.count("://") == 1, url
            assert url.endswith("/blob/events")


class TestWhichDomainFieldWins:
    """`fqdn` is stamped at creation and survives every later domain change, while
    `docker_compose_domains` is what the proxy routes today. An agent whose domain was
    repointed kept being called on the dead hostname because the runner read the stale
    field — found live, when a certificate error outlasted the domain fix."""

    def test_the_compose_domain_beats_the_stale_fqdn(self) -> None:
        from blob_api.plugins.runner import _reported_domain

        payload = {
            "fqdn": "abc.65.21.238.89.sslip.io:8642",
            "docker_compose_domains": '{"gateway":{"domain":"https://janus.example.com"}}',
        }
        assert _reported_domain(payload) == "https://janus.example.com"

    def test_a_compose_domain_port_names_the_container_not_the_public_side(self) -> None:
        # Coolify's `https://host:8642` means "route this host to container port 8642";
        # publicly the app answers on 443. Keeping the suffix aimed the callback at a
        # port nothing listens on.
        from blob_api.plugins.runner import _reported_domain

        payload = {
            "fqdn": "abc.sslip.io:8642",
            "docker_compose_domains": ('{"gateway":{"domain":"https://janus.example.com:8642"}}'),
        }
        assert _reported_domain(payload) == "https://janus.example.com"

    def test_no_compose_domains_falls_back_to_fqdn(self) -> None:
        from blob_api.plugins.runner import _reported_domain

        assert _reported_domain({"fqdn": "abc.sslip.io:3000"}) == "abc.sslip.io:3000"
        assert (
            _reported_domain({"fqdn": "abc.sslip.io", "docker_compose_domains": ""})
            == "abc.sslip.io"
        )

    def test_garbage_compose_domains_fall_back_rather_than_fail(self) -> None:
        from blob_api.plugins.runner import _reported_domain

        for garbage in ("not json", '{"gateway": null}', '{"gateway": {"domain": ""}}', "[1,2]"):
            payload = {"fqdn": "abc.sslip.io", "docker_compose_domains": garbage}
            assert _reported_domain(payload) == "abc.sslip.io", garbage
