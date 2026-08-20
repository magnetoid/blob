"""Shared Pydantic configuration.

The wire format is camelCase because the React client and every plugin see the same
shapes. Python code keeps snake_case field names; the alias generator bridges them.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        # zod strips unknown keys rather than rejecting; match that.
        extra="ignore",
        from_attributes=True,
    )


def iso(value: datetime | str | None) -> str | None:
    """Serialize a timestamp the way the client already expects.

    Node's `toISOString()` produces milliseconds and a trailing `Z`; Python's
    `isoformat()` produces microseconds and `+00:00`. Every timestamp the client sees
    would change format without this, so all timestamp serialization goes through here.
    """
    if value is None:
        return None
    if isinstance(value, str):
        return value
    text = value.isoformat(timespec="milliseconds")
    return text.replace("+00:00", "Z") if text.endswith("+00:00") else f"{text}Z"


def require_iso(value: datetime | str) -> str:
    result = iso(value)
    assert result is not None  # noqa: S101 - non-null input guaranteed by the signature
    return result


def unwrap(row: Any, key: str, default: Any = None) -> Any:
    """Read a column from a SQLAlchemy Row or a mapping, whichever a caller passes."""
    if hasattr(row, key):
        return getattr(row, key)
    if isinstance(row, dict):
        return row.get(key, default)
    return default
