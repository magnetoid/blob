"""The layer rules that `torsor guard` does not yet hold.

A ratchet rather than a rule: the number may go down and may not go up. When it reaches
zero the assertion becomes a `forbid_pattern` in the torsor intent file and this test
goes.
"""

from __future__ import annotations

from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src" / "blob_api"

#: `text(` calls inside routers. 131 on 2026-09-12 (admin.py 31, auth.py 21, users.py 14,
#: plugins.py 13, files.py 8, a tail across the rest); 100 once admin.py had a service,
#: 86 once users.py had one.
#: Routers shape and authorize;
#: the SQL belongs in services. Lower this number as it moves, never raise it.
ROUTER_SQL_CEILING = 86


def test_sql_keeps_leaving_the_routers() -> None:
    count = sum(path.read_text().count("text(") for path in (SRC / "routers").glob("*.py"))
    assert count <= ROUTER_SQL_CEILING, (
        f"{count} `text(` calls in routers, ceiling is {ROUTER_SQL_CEILING}: "
        "new SQL belongs in a service"
    )


def test_no_service_or_router_uses_the_orm_as_a_query_layer() -> None:
    hits = [
        f"{path.relative_to(SRC)}:{n}"
        for folder in ("services", "routers")
        for path in (SRC / folder).glob("*.py")
        for n, line in enumerate(path.read_text().splitlines(), 1)
        if "session.add(" in line or "select(" in line
    ]
    assert hits == [], f"ORM query calls under services/ or routers/: {hits}"
