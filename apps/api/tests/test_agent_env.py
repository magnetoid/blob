"""Configuration an agent needs that Blob cannot know.

Every agent that talks to a model provider needs a key, and until the install request
could carry one there was no way to give it: the container is created by Blob, so Blob
was the only thing positioned to hand it over, and it did not. These cover the guard
rails on that, because an agent's configuration arrives from an admin's browser and
lands in a process that also holds the workspace's own credentials.
"""

from __future__ import annotations

import pytest

from blob_api.lib.errors import AppError
from blob_api.plugins.env import MAX_VALUE_BYTES, MAX_VARS, validate_env


def test_nothing_supplied_is_not_an_error() -> None:
    assert validate_env(None) == {}
    assert validate_env({}) == {}


def test_a_provider_key_passes_through_untouched() -> None:
    # The whole point: this is what makes an LLM agent installable at all.
    assert validate_env({"ANTHROPIC_API_KEY": "sk-ant-123"}) == {"ANTHROPIC_API_KEY": "sk-ant-123"}


def test_surrounding_space_in_a_name_is_forgiven() -> None:
    assert validate_env({" OPENAI_API_KEY ": "k"}) == {"OPENAI_API_KEY": "k"}


@pytest.mark.parametrize(
    "key",
    ["lowercase", "1LEADING_DIGIT", "HAS-HYPHEN", "HAS SPACE", "", "WITH.DOT", "WITH$SIGN"],
)
def test_a_name_that_only_works_in_some_shells_is_refused(key: str) -> None:
    with pytest.raises(AppError) as caught:
        validate_env({key: "value"})
    assert caught.value.status_code == 400
    # The field is named, so the console can point at the row that is wrong.
    assert caught.value.field == key


@pytest.mark.parametrize("key", ["BLOB_BOT_TOKEN", "BLOB_BASE_URL", "BLOB_ANYTHING"])
def test_blobs_own_credentials_cannot_be_overridden(key: str) -> None:
    # An agent that could set its own bot token or callback host could point either
    # somewhere else. Refused by name, before the merge order gets a chance to matter.
    with pytest.raises(AppError) as caught:
        validate_env({key: "mine"})
    assert caught.value.code == "reserved_env_key"


def test_the_runners_own_channel_cannot_be_forged() -> None:
    # __build_pack__ is how the build method reaches the runner; a supplied one would
    # change how the image is built.
    with pytest.raises(AppError) as caught:
        validate_env({"__BUILD_PACK__": "dockerfile"})
    assert caught.value.code == "reserved_env_key"


def test_an_empty_value_is_refused_rather_than_deployed() -> None:
    with pytest.raises(AppError) as caught:
        validate_env({"OPENAI_API_KEY": ""})
    assert caught.value.code == "empty_env_value"


def test_a_value_that_is_too_long_is_refused() -> None:
    with pytest.raises(AppError) as caught:
        validate_env({"BIG": "x" * (MAX_VALUE_BYTES + 1)})
    assert caught.value.code == "env_value_too_long"


def test_there_is_a_ceiling_on_how_much_can_be_supplied() -> None:
    too_many = {f"KEY_{i}": "v" for i in range(MAX_VARS + 1)}
    with pytest.raises(AppError) as caught:
        validate_env(too_many)
    assert caught.value.code == "too_many_env_vars"
