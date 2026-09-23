"""The `calls` key of workspace_settings, read through one typed door."""

from __future__ import annotations

from blob_api.schemas.calls import CallSettings
from blob_api.services.workspace_settings import parse_calls


def test_nothing_stored_is_the_defaults() -> None:
    assert parse_calls(None) == CallSettings()
    assert parse_calls({"banner": "hi"}) == CallSettings()
    defaults = CallSettings()
    assert defaults.huddles.enabled and defaults.huddles.cameras and defaults.huddles.screen_share
    assert defaults.huddles.max_participants == 50
    assert defaults.meetups.enabled and defaults.meetups.cameras_on_join
    assert defaults.meetups.max_participants == 50


def test_what_is_stored_is_read_in_its_own_names() -> None:
    parsed = parse_calls(
        {
            "calls": {
                "huddles": {"cameras": False, "maxParticipants": 8},
                "meetups": {"enabled": False},
            }
        }
    )
    assert parsed.huddles.cameras is False
    assert parsed.huddles.max_participants == 8
    assert parsed.huddles.screen_share is True
    assert parsed.meetups.enabled is False


def test_one_bad_kind_does_not_take_the_other_down() -> None:
    parsed = parse_calls(
        {"calls": {"huddles": {"maxParticipants": 100000}, "meetups": {"enabled": False}}}
    )
    assert parsed.huddles == CallSettings().huddles
    assert parsed.meetups.enabled is False


def test_a_value_that_is_not_an_object_is_ignored() -> None:
    assert parse_calls({"calls": "yes"}) == CallSettings()
    assert parse_calls({"calls": {"huddles": [1, 2]}}) == CallSettings()
