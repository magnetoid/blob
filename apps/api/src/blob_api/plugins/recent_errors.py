"""An app's errors: the newest as `last_error`, and the ten before it with their times.

`plugins.last_error` was one string the next failure overwrote, so an agent failing three
ways in an hour showed only the last, and a failure an admin had fixed — by switching the
app back on, which clears `last_error` — left nothing behind to say it had ever happened.
`plugins.recent_errors` (migration 0052) keeps the newest `KEEP`, newest first, and nothing
clears it: it is history, where `last_error` is the app's present state.

Every writer records an error through `record_sql`, so the two columns cannot disagree.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ..schemas.base import require_iso

#: How many of an app's errors are kept.
KEEP = 10


def record_sql(param: str) -> str:
    """The SET clause that records the bound `:param` as an app's newest error."""
    return (
        f"last_error = :{param}, "
        "recent_errors = jsonb_path_query_array("
        f"jsonb_build_array(jsonb_build_object('at', now(), 'error', cast(:{param} AS text)))"
        f" || recent_errors, '$[0 to {KEEP - 1}]')"
    )


def read(raw: Any) -> list[dict[str, str]]:
    """The stored list as the console shows it: `{at, error}`, newest first.

    `at` comes back in the database session's time zone, so it is re-written in the one
    form every other time in the API takes; an entry that is not the shape it should be is
    skipped rather than trusted.
    """
    if not isinstance(raw, list):
        return []
    kept: list[dict[str, str]] = []
    for entry in raw[:KEEP]:
        if not isinstance(entry, dict):
            continue
        at, error = entry.get("at"), entry.get("error")
        if not isinstance(at, str) or not isinstance(error, str):
            continue
        try:
            when = require_iso(datetime.fromisoformat(at))
        except ValueError:
            continue
        kept.append({"at": when, "error": error})
    return kept
