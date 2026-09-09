"""Typed readers over the workspace_settings JSONB blob."""

from __future__ import annotations

from blob_api.services.workspace_settings import parse


def test_defaults_when_empty() -> None:
    s = parse({})
    assert s.signup_policy == "invite"
    assert s.retention_days == 365
    assert s.agents_enabled is True
    assert s.banner is None


def test_known_keys_are_read() -> None:
    s = parse(
        {
            "signupPolicy": "open",
            "retentionDays": 90,
            "uploadLimitBytes": 1024 * 1024,
            "agentsEnabled": False,
            "banner": "  scheduled maintenance  ",
        }
    )
    assert s.signup_policy == "open"
    assert s.retention_days == 90
    assert s.upload_limit_bytes == 1024 * 1024
    assert s.agents_enabled is False
    assert s.banner == "scheduled maintenance"


def test_junk_falls_back() -> None:
    s = parse({"signupPolicy": "maybe", "retentionDays": "nope", "uploadLimitBytes": None})
    assert s.signup_policy == "invite"
    assert s.retention_days == 365
    assert s.upload_limit_bytes == 100 * 1024 * 1024
