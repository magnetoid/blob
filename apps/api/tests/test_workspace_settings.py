"""Typed readers over the workspace_settings JSONB blob."""

from __future__ import annotations

from blob_api.services.workspace_settings import parse


def test_defaults_when_empty() -> None:
    s = parse({})
    assert s.retention_days == 365
    assert s.agents_enabled is True


def test_known_keys_are_read() -> None:
    s = parse(
        {
            "retentionDays": 90,
            "uploadLimitBytes": 1024 * 1024,
            "agentsEnabled": False,
        }
    )
    assert s.retention_days == 90
    assert s.upload_limit_bytes == 1024 * 1024
    assert s.agents_enabled is False


def test_keys_nothing_acts_on_are_not_read() -> None:
    """A stored `signupPolicy` or `banner` from before they went is ignored, not an error."""
    s = parse({"signupPolicy": "open", "banner": "maintenance", "retentionDays": 90})
    assert not hasattr(s, "signup_policy")
    assert not hasattr(s, "banner")
    assert s.retention_days == 90


def test_junk_falls_back() -> None:
    s = parse({"retentionDays": "nope", "uploadLimitBytes": None})
    assert s.retention_days == 365
    assert s.upload_limit_bytes == 100 * 1024 * 1024
