"""The layer rules that `torsor guard` does not yet hold.

The first of them, `text(` inside routers, was a ratchet here from 131 down to 0 on
2026-09-13 and is now a `forbid_pattern` in ADR 0003; what stays is the ORM grep.
"""

from __future__ import annotations

from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src" / "blob_api"


def test_no_service_or_router_uses_the_orm_as_a_query_layer() -> None:
    hits = [
        f"{path.relative_to(SRC)}:{n}"
        for folder in ("services", "routers")
        for path in (SRC / folder).glob("*.py")
        for n, line in enumerate(path.read_text().splitlines(), 1)
        if "session.add(" in line or "select(" in line
    ]
    assert hits == [], f"ORM query calls under services/ or routers/: {hits}"
