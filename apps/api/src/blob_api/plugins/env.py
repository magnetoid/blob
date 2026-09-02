"""Configuration an agent needs that Blob cannot know.

A hosted agent almost always needs a credential of its own — a model provider's API key
being the obvious one. Blob deploys the container, so Blob is the only thing positioned
to hand that over, and until this existed there was no way to: the install request
carried a repository URL and nothing else, which made every agent that talks to an LLM
impossible to install through the console it was built for.

Values pass through to the runner and are not stored here. Coolify keeps them on the
application, which is what makes a redeploy work without asking again, and means the one
copy lives with the container rather than in Blob's database.
"""

from __future__ import annotations

import re

from ..lib.errors import AppError, bad_request

#: Conventional environment-variable spelling. Deliberately strict: a key that only works
#: in some shells is a support question nobody wants at deploy time.
KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")

#: Blob sets these itself. An agent that could overwrite them could point its own bot
#: token or callback host somewhere else, so the names are refused rather than merged.
RESERVED_PREFIX = "BLOB_"

#: Everything Blob writes into a hosted agent's environment, by name.
#:
#: The prefix rule covers the credentials. `PORT` is the one that needs saying separately:
#: it is not prefixed, and it is the number the runner was told to point its proxy at. An
#: agent that binds a different one is unreachable, which presents as an agent that failed
#: to start — so it is refused here rather than debugged later.
#:
#: Listed rather than inferred so the console can show these as fixed. A name missing from
#: a form with no explanation reads as the form having lost it.
RESERVED_NAMES = frozenset(
    {
        "BLOB_BASE_URL",
        "BLOB_BOT_TOKEN",
        "BLOB_SIGNING_SECRET",
        "BLOB_PLUGIN_SLUG",
        "PORT",
    }
)

#: Reserved for values this module passes to the runner out of band.
INTERNAL_PREFIX = "__"

MAX_VARS = 25
MAX_VALUE_BYTES = 4096


def is_reserved(name: str) -> bool:
    """Is this a name Blob writes itself?

    One predicate, because there were two: setting a variable consulted all three rules
    while removing one tested only the prefix, so `PORT` — refused on the way in with an
    explanation of exactly why an agent that binds a different one is unreachable — could
    still be deleted on the way out.
    """
    upper = name.strip().upper()
    return (
        upper.startswith(RESERVED_PREFIX)
        or upper.startswith(INTERNAL_PREFIX)
        or upper in RESERVED_NAMES
    )


def validate_env(raw: dict[str, str] | None) -> dict[str, str]:
    """Check operator-supplied configuration, or explain exactly what is wrong with it."""
    if not raw:
        return {}

    if len(raw) > MAX_VARS:
        raise bad_request(
            f"An agent can be given at most {MAX_VARS} configuration values.",
            code="too_many_env_vars",
        )

    checked: dict[str, str] = {}
    for key, value in raw.items():
        name = key.strip()
        # Reserved names are checked before the spelling rule, so the refusal says why
        # rather than complaining about punctuation. It also keeps the guarantee stated
        # here rather than resting on the shape of the regex below, which is not what
        # anyone would think to re-check after loosening it.
        upper = name.upper()
        if is_reserved(upper):
            raise AppError(
                400, "reserved_env_key", f'"{name}" is set by Blob and cannot be overridden.', key
            )
        if not KEY_RE.match(name):
            raise AppError(
                400,
                "invalid_env_key",
                f'"{key}" is not a usable name. Use capitals, digits and underscores, '
                "starting with a letter.",
                key,
            )
        if not isinstance(value, str) or not value:
            raise AppError(400, "empty_env_value", f'"{name}" needs a value.', key)
        if len(value.encode()) > MAX_VALUE_BYTES:
            raise AppError(400, "env_value_too_long", f'The value for "{name}" is too long.', key)
        checked[name] = value

    return checked


__all__ = [
    "KEY_RE",
    "MAX_VALUE_BYTES",
    "MAX_VARS",
    "RESERVED_NAMES",
    "RESERVED_PREFIX",
    "is_reserved",
    "validate_env",
]
