"""Nothing but code reaches the text of a SQL statement.

Every statement in the backend is `text()` with bound parameters (ADR 0003), and a
statement is often assembled from shared fragments — `MESSAGE_SELECT`, `USER_COLUMNS`,
`MAY_COMMAND` — with an f-string. That is safe exactly as long as each interpolated
piece is code, never a value that arrived in a request.

Ruff's S608 cannot tell those apart: it flags every f-string that looks like SQL, which
was 64 sites on 2026-10-18 and every one of them reviewed safe. So the rule lives here
instead, and says what it means: in an f-string that reads like SQL, each `{…}` must be
an UPPER_CASE constant defined or imported at the top of its module (or one reached
through a module), a call to a fragment builder
whose arguments are literals, a choice between two literals, or a name on the reviewed
list below — where the reason it is code and not input is written down.

Adding to `REVIEWED` is a decision, not a fix for a red test: it says a human checked
that the value cannot come from outside.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src" / "blob_api"

#: Uppercase SQL as this codebase writes it. Lowercase prose in a log line does not match.
LOOKS_LIKE_SQL = re.compile(r"\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|WHERE|ORDER BY)\b")
CONSTANT = re.compile(r"^_?[A-Z][A-Z0-9_]*$")

#: (file, expression) pairs a person has checked. The expression is `ast.unparse` of it.
REVIEWED: dict[tuple[str, str], str] = {
    ("services/messages.py", "order"): "ASC or DESC, chosen by `forward` two lines above",
    ("services/search.py", "hits"): "one of two literal keyset clauses, chosen above",
    ("services/search.py", "order"): "one of two literal ORDER BY clauses, chosen above",
    ("plugins/registry.py", "assignments"): (
        "column names from a literal dict of three keys; only the values come from the "
        "wire, and those are bound"
    ),
}

#: Functions that return a SQL fragment built only from their (literal) arguments.
FRAGMENT_BUILDERS = {"record_sql", "_cols"}


def _module_constants(tree: ast.Module) -> set[str]:
    """UPPER_CASE names bound at the top of a module: assigned there, or imported.

    Only these count. An upper-case *local* inside a function is a name somebody chose,
    not a constant — it could hold a value a request handed in and launder it past a rule
    that looked only at the shape of the name (found in review, 2026-10-18).
    """
    names: set[str] = set()
    for statement in tree.body:
        if isinstance(statement, ast.Assign):
            names |= {t.id for t in statement.targets if isinstance(t, ast.Name)}
        elif isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name):
            names.add(statement.target.id)
        elif isinstance(statement, ast.ImportFrom):
            names |= {alias.asname or alias.name for alias in statement.names}
    return {name for name in names if CONSTANT.match(name)}


def _is_code(node: ast.expr, constants: set[str]) -> bool:
    if isinstance(node, ast.Constant):
        return True
    if isinstance(node, ast.Name):
        return node.id in constants
    if isinstance(node, ast.Attribute):
        return bool(CONSTANT.match(node.attr))
    if isinstance(node, ast.IfExp):
        return _is_code(node.body, constants) and _is_code(node.orelse, constants)
    if isinstance(node, ast.BinOp):
        return _is_code(node.left, constants) and _is_code(node.right, constants)
    if isinstance(node, ast.Call):
        func = node.func
        name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
        return name in FRAGMENT_BUILDERS and all(isinstance(arg, ast.Constant) for arg in node.args)
    return False


def _sql_fstrings() -> list[tuple[str, int, ast.JoinedStr, set[str]]]:
    found = []
    for path in sorted(SRC.rglob("*.py")):
        if "migrations" in path.parts:
            continue
        tree = ast.parse(path.read_text(), filename=str(path))
        constants = _module_constants(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.JoinedStr):
                continue
            literal = "".join(
                part.value
                for part in node.values
                if isinstance(part, ast.Constant) and isinstance(part.value, str)
            )
            if LOOKS_LIKE_SQL.search(literal):
                found.append((str(path.relative_to(SRC)), node.lineno, node, constants))
    return found


def test_the_check_sees_the_statements_it_is_about() -> None:
    # A rule that matched nothing would pass forever. On 2026-10-18 there were 64.
    assert len(_sql_fstrings()) >= 50


def test_only_code_is_interpolated_into_sql() -> None:
    offenders = []
    for relative, line, node, constants in _sql_fstrings():
        for part in node.values:
            if not isinstance(part, ast.FormattedValue):
                continue
            expression = ast.unparse(part.value)
            if _is_code(part.value, constants) or (relative, expression) in REVIEWED:
                continue
            offenders.append(f"{relative}:{line} interpolates `{expression}`")
    assert offenders == [], "\n".join(offenders)


def test_every_reviewed_entry_still_exists() -> None:
    # A stale allowance is a hole waiting for a new value with the same name.
    live = {
        (relative, ast.unparse(part.value))
        for relative, _line, node, _constants in _sql_fstrings()
        for part in node.values
        if isinstance(part, ast.FormattedValue)
    }
    assert set(REVIEWED) <= live, set(REVIEWED) - live


def test_an_upper_case_local_is_not_a_constant() -> None:
    tree = ast.parse(
        "from .x import SHARED\nLIMIT = 3\n"
        "def f(q):\n    SNEAKY = q\n    return f'SELECT {SNEAKY} FROM t WHERE {LIMIT}'\n"
    )
    constants = _module_constants(tree)
    assert constants == {"SHARED", "LIMIT"}
    fstring = next(n for n in ast.walk(tree) if isinstance(n, ast.JoinedStr))
    verdicts = {
        ast.unparse(part.value): _is_code(part.value, constants)
        for part in fstring.values
        if isinstance(part, ast.FormattedValue)
    }
    assert verdicts == {"SNEAKY": False, "LIMIT": True}
