"""The checked-in OpenAPI document matches the app.

`packages/shared/openapi.json` is generated (`pnpm openapi`) and committed, and nothing in
the build read it — so it drifted silently: a route added in one commit was missing from
the file until a later one happened to regenerate it. A stale contract is worse than none,
because a reader trusts it. This is the check that was missing.
"""

from __future__ import annotations

import json
from pathlib import Path

from blob_api.main import app

CHECKED_IN = Path(__file__).resolve().parents[3] / "packages" / "shared" / "openapi.json"


def test_the_checked_in_openapi_document_is_current() -> None:
    generated = json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"
    committed = CHECKED_IN.read_text(encoding="utf-8")
    if generated != committed:
        live = json.loads(generated)["paths"].keys()
        stored = json.loads(committed)["paths"].keys()
        added = sorted(set(live) - set(stored))
        removed = sorted(set(stored) - set(live))
        raise AssertionError(
            "packages/shared/openapi.json is stale — run `pnpm openapi` and commit it. "
            f"Routes missing from the file: {added or 'none'}; routes no longer served: "
            f"{removed or 'none'}; if both are empty a schema changed shape."
        )
