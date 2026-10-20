"""What a workspace's agents and Blob's own model spend (M2 · A9).

Two sources, each counted by somebody else. An agent reports its tokens on its run's last
event — AG-UI 1.0's `usage`, one entry per provider and model, kept in `agent_runs.usage`.
Blob's own two model features, the catch-up and thread summaries, read their provider's
counts into `model_calls`. Neither is Blob's measurement, and the page says so: a run that
reported nothing counted nothing.

Money is the workspace's own arithmetic. An admin names a currency and a price per million
input and output tokens for each model they want priced — Blob ships no price list, which
would be wrong by the next release and wrong for anyone on a contract — and cost is tokens
times price, model by model. A model nobody priced, or an entry that gave a total without
saying how much was input, leaves the cost partial and says so; it never reads as zero.

Thirty days at most: that is as long as runs are kept (`agent_runs.sweep`), and Blob's own
calls are swept on the same day.
"""

from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import transaction
from ..lib import metrics
from ..lib.errors import bad_request
from ..lib.ids import new_id
from ..lib.llm import Meter
from . import audit as audit_service

log = logging.getLogger("blob.usage")

WINDOWS = (1, 7, 30)
KEEP_DAYS = 30
FEATURES = ("catchup", "summary")
MAX_PRICED_MODELS = 100
MODEL_MAX = 80
MAX_PRICE = Decimal("100000")
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_MILLION = Decimal(1_000_000)


@dataclass(frozen=True, slots=True)
class Price:
    input_per_million: Decimal
    output_per_million: Decimal


@dataclass(frozen=True, slots=True)
class Prices:
    currency: str | None
    by_model: dict[str, Price]


@dataclass(slots=True)
class Spend:
    """Tokens for one model: priced input and output, and a total that may hold more —
    an entry that gave only a total, or counted reasoning separately."""

    input: int = 0
    output: int = 0
    total: int = 0
    unsplit: int = 0

    def add(self, row: Any) -> None:
        self.input += int(row.input)
        self.output += int(row.output)
        self.total += int(row.total)
        self.unsplit += int(row.unsplit)


@dataclass(frozen=True, slots=True)
class Line:
    """One row of the usage page: an agent, a person, or one of Blob's own features."""

    id: str | None
    name: str
    owner: str | None
    runs: int
    input_tokens: int
    output_tokens: int
    tokens: int
    cost: Decimal | None
    #: False when some of the tokens could not be priced.
    cost_complete: bool


@dataclass(frozen=True, slots=True)
class ModelLine:
    model: str
    tokens: int
    price: Price | None


@dataclass(frozen=True, slots=True)
class Report:
    days: int
    currency: str | None
    agents: list[Line]
    people: list[Line]
    blob: list[Line]
    models: list[ModelLine]


# ─── prices ──────────────────────────────────────────────────────────────────────────


def _decimal(value: object) -> Decimal | None:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() and Decimal(0) <= number <= MAX_PRICE else None


def parse_prices(raw: Mapping[str, Any] | None) -> Prices:
    """The `usage` key of a workspace's settings, typed. Anything malformed is left out."""
    data = (raw or {}).get("usage")
    if not isinstance(data, Mapping):
        return Prices(currency=None, by_model={})
    currency = data.get("currency")
    stored = data.get("prices")
    by_model: dict[str, Price] = {}
    if isinstance(stored, Mapping):
        for model, price in stored.items():
            if not isinstance(model, str) or not isinstance(price, Mapping):
                continue
            given_in, given_out = _decimal(price.get("input")), _decimal(price.get("output"))
            if given_in is not None and given_out is not None:
                by_model[model] = Price(given_in, given_out)
    return Prices(
        currency=currency if isinstance(currency, str) and _CURRENCY.match(currency) else None,
        by_model=by_model,
    )


async def load_prices(session: AsyncSession, workspace_id: str) -> Prices:
    row = (
        await session.execute(
            text("SELECT settings FROM workspace_settings WHERE workspace_id = :ws"),
            {"ws": workspace_id},
        )
    ).first()
    return parse_prices(row.settings if row else None)


async def save_prices(
    session: AsyncSession,
    actor: audit_service.Actor,
    *,
    currency: str | None,
    prices: Mapping[str, Price],
) -> Prices:
    """Replace the workspace's currency and price list, and nothing else in its settings."""
    if currency is not None and not _CURRENCY.match(currency):
        raise bad_request("A currency is three capital letters, like EUR.", code="invalid_input")
    if len(prices) > MAX_PRICED_MODELS:
        raise bad_request(f"At most {MAX_PRICED_MODELS} models.", code="invalid_input")
    stored: dict[str, dict[str, str]] = {}
    for model, price in prices.items():
        name = model.strip()
        if not name or len(name) > MODEL_MAX:
            raise bad_request("A model's name is 1 to 80 characters.", code="invalid_input")
        for amount in (price.input_per_million, price.output_per_million):
            if not (amount.is_finite() and Decimal(0) <= amount <= MAX_PRICE):
                raise bad_request(
                    "A price is between 0 and 100000 per million tokens.", code="invalid_input"
                )
        stored[name] = {
            "input": str(price.input_per_million),
            "output": str(price.output_per_million),
        }
    value: dict[str, Any] = {"currency": currency, "prices": stored}
    await session.execute(
        text(
            """
            INSERT INTO workspace_settings (workspace_id, settings, updated_by)
            VALUES (:ws, jsonb_build_object('usage', cast(:usage AS jsonb)), :actor)
            ON CONFLICT (workspace_id) DO UPDATE
              SET settings = workspace_settings.settings
                             || jsonb_build_object('usage', cast(:usage AS jsonb)),
                  updated_at = now(),
                  updated_by = EXCLUDED.updated_by
            """
        ),
        {"ws": actor.workspace_id, "usage": json.dumps(value), "actor": actor.id},
    )
    await audit_service.record(
        session,
        actor,
        "usage.prices_set",
        metadata={"currency": currency, "models": sorted(stored)},
    )
    return parse_prices({"usage": value})


def cost_of(spends: Iterable[tuple[str, Spend]], prices: Prices) -> tuple[Decimal | None, bool]:
    """Tokens times price, model by model. None when nothing could be priced; `complete`
    is False when anything could not be — a model with no price, or a total that did not
    say how much of it was input."""
    total = Decimal(0)
    priced = False
    complete = True
    for model, spend in spends:
        if spend.total == 0 and spend.input == 0 and spend.output == 0:
            continue
        price = prices.by_model.get(model)
        if price is None:
            complete = False
            continue
        total += (
            Decimal(spend.input) * price.input_per_million
            + Decimal(spend.output) * price.output_per_million
        ) / _MILLION
        priced = True
        if spend.unsplit:
            complete = False
    return (total if priced else None), complete


# ─── Blob's own calls ────────────────────────────────────────────────────────────────


async def record_model_call(
    *, workspace_id: str, feature: str, user_id: str | None, meter: Meter
) -> None:
    """One of Blob's own model calls, counted. Never raises: a usage row that could not be
    written must not take the summary it was counting down with it."""
    if not meter.spent:
        return
    try:
        async with transaction() as (session, _after):
            await session.execute(
                text(
                    """
                    INSERT INTO model_calls
                           (id, workspace_id, feature, user_id, model, input_tokens,
                            output_tokens)
                    VALUES (:id, :ws, :feature, :user, :model, :input, :output)
                    """
                ),
                {
                    "id": new_id(),
                    "ws": workspace_id,
                    "feature": feature,
                    "user": user_id,
                    "model": (meter.model or "unknown")[:MODEL_MAX],
                    "input": meter.input_tokens,
                    "output": meter.output_tokens,
                },
            )
        await metrics.model_called(meter.input_tokens, meter.output_tokens)
    except Exception:
        log.exception("could not record the usage of a %s", feature)


async def sweep(session: AsyncSession) -> int:
    """Blob's own calls are kept as long as runs are, so a window never mixes ages."""
    gone = (
        await session.execute(
            text(
                """
                DELETE FROM model_calls
                 WHERE created_at < now() - make_interval(days => :days)
                RETURNING id
                """
            ),
            {"days": KEEP_DAYS},
        )
    ).fetchall()
    return len(gone)


# ─── the report ──────────────────────────────────────────────────────────────────────

#: A run's usage entries, one row each. Counts are read only if they are digits, as
#: `agent_runs._RUN_TOKENS` reads them: one row written by anything else must not be able
#: to make the page a 500.
_ENTRIES = """
      CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(r.usage) = 'array' THEN r.usage ELSE '[]'::jsonb END) u
"""
_COUNTS = """
    left(COALESCE(u->>'model', ''), 80) AS model,
    sum(CASE WHEN u->>'inputTokens' ~ '^[0-9]{1,15}$'
             THEN (u->>'inputTokens')::bigint ELSE 0 END) AS input,
    sum(CASE WHEN u->>'outputTokens' ~ '^[0-9]{1,15}$'
             THEN (u->>'outputTokens')::bigint ELSE 0 END) AS output,
    sum(COALESCE(
          CASE WHEN u->>'totalTokens' ~ '^[0-9]{1,15}$' THEN (u->>'totalTokens')::bigint END,
          CASE WHEN u->>'inputTokens' ~ '^[0-9]{1,15}$'
               THEN (u->>'inputTokens')::bigint ELSE 0 END
          + CASE WHEN u->>'outputTokens' ~ '^[0-9]{1,15}$'
                 THEN (u->>'outputTokens')::bigint ELSE 0 END)) AS total,
    sum(CASE WHEN NOT (u ? 'inputTokens' OR u ? 'outputTokens')
              AND u->>'totalTokens' ~ '^[0-9]{1,15}$'
             THEN (u->>'totalTokens')::bigint ELSE 0 END) AS unsplit
"""
#: The runs a window covers: the workspace's, begun inside it, refusals left out as the
#: budget leaves them out. `:owner` narrows it to one person's own agents.
_WINDOW = """
     WHERE r.workspace_id = :ws AND r.status <> 'refused'
       AND r.started_at > now() - make_interval(days => :days)
       AND (CAST(:owner AS uuid) IS NULL OR p.owner_user_id = CAST(:owner AS uuid))
"""
_AGENT_RUNS = f"""
    SELECT p.id, p.name, o.display_name AS owner, count(*) AS runs
      FROM agent_runs r
      JOIN plugins p ON p.id = r.plugin_id
      LEFT JOIN users o ON o.id = p.owner_user_id
    {_WINDOW}
     GROUP BY p.id, p.name, o.display_name
"""
_AGENT_SPEND = f"""
    SELECT r.plugin_id AS key, {_COUNTS}
      FROM agent_runs r
      JOIN plugins p ON p.id = r.plugin_id
    {_ENTRIES}
    {_WINDOW}
     GROUP BY r.plugin_id, 2
"""
#: Whose authority a run was on — the person who started its chain (ADR 0013).
_PEOPLE_RUNS = f"""
    SELECT r.initiated_by_user_id AS id, u.display_name AS name, count(*) AS runs
      FROM agent_runs r
      JOIN plugins p ON p.id = r.plugin_id
      JOIN users u ON u.id = r.initiated_by_user_id
    {_WINDOW}
     GROUP BY r.initiated_by_user_id, u.display_name
"""
_PEOPLE_SPEND = f"""
    SELECT r.initiated_by_user_id AS key, {_COUNTS}
      FROM agent_runs r
      JOIN plugins p ON p.id = r.plugin_id
    {_ENTRIES}
    {_WINDOW}
       AND r.initiated_by_user_id IS NOT NULL
     GROUP BY r.initiated_by_user_id, 2
"""
_BLOB_CALLS = """
    SELECT feature, model, count(*) AS calls, sum(input_tokens) AS input,
           sum(output_tokens) AS output
      FROM model_calls
     WHERE workspace_id = :ws AND created_at > now() - make_interval(days => :days)
     GROUP BY feature, model
"""


async def report(
    session: AsyncSession, workspace_id: str, *, days: int, owner_id: str | None = None
) -> Report:
    """Every agent's runs and tokens over the window, the people whose authority they ran
    on, Blob's own calls and the models seen — priced where the workspace priced them.
    With `owner_id`, that person's own agents and nothing else."""
    if days not in WINDOWS:
        raise bad_request("A window is 1, 7 or 30 days.", code="invalid_input")
    prices = await load_prices(session, workspace_id)
    params = {"ws": workspace_id, "days": days, "owner": owner_id}

    async def rows(sql: str) -> list[Any]:
        return list((await session.execute(text(sql), params)).fetchall())

    agent_spend = await rows(_AGENT_SPEND)
    agents = _lines(
        [(str(row.id), row.name, row.owner, int(row.runs)) for row in await rows(_AGENT_RUNS)],
        agent_spend,
        prices,
    )
    seen: dict[str, int] = defaultdict(int)
    for row in agent_spend:
        seen[row.model] += int(row.total)

    people: list[Line] = []
    blob: list[Line] = []
    if owner_id is None:
        people = _lines(
            [(str(row.id), row.name, None, int(row.runs)) for row in await rows(_PEOPLE_RUNS)],
            await rows(_PEOPLE_SPEND),
            prices,
        )
        calls = await rows(_BLOB_CALLS)
        blob = _blob_lines(calls, prices)
        for row in calls:
            seen[row.model] += int(row.input) + int(row.output)

    models = [
        ModelLine(model=model, tokens=tokens, price=prices.by_model.get(model))
        for model, tokens in sorted(seen.items(), key=lambda item: (-item[1], item[0]))
        if model
    ]
    return Report(
        days=days,
        currency=prices.currency,
        agents=agents,
        people=people,
        blob=blob,
        models=models,
    )


def _lines(
    heads: list[tuple[str, str, str | None, int]], spend_rows: Iterable[Any], prices: Prices
) -> list[Line]:
    by_key: dict[str, dict[str, Spend]] = defaultdict(lambda: defaultdict(Spend))
    for row in spend_rows:
        by_key[str(row.key)][row.model].add(row)
    lines = [
        _line(key, name, owner, runs, by_key.get(key, {}), prices)
        for key, name, owner, runs in heads
    ]
    return sorted(lines, key=lambda line: (-line.tokens, -line.runs, line.name.casefold()))


def _line(
    key: str | None,
    name: str,
    owner: str | None,
    runs: int,
    spends: Mapping[str, Spend],
    prices: Prices,
) -> Line:
    cost, complete = cost_of(spends.items(), prices)
    return Line(
        id=key,
        name=name,
        owner=owner,
        runs=runs,
        input_tokens=sum(spend.input for spend in spends.values()),
        output_tokens=sum(spend.output for spend in spends.values()),
        tokens=sum(spend.total for spend in spends.values()),
        cost=cost,
        cost_complete=complete,
    )


def _blob_lines(rows: Iterable[Any], prices: Prices) -> list[Line]:
    calls: dict[str, int] = defaultdict(int)
    spends: dict[str, dict[str, Spend]] = defaultdict(lambda: defaultdict(Spend))
    for row in rows:
        calls[row.feature] += int(row.calls)
        spend = spends[row.feature][row.model]
        spend.input += int(row.input)
        spend.output += int(row.output)
        spend.total += int(row.input) + int(row.output)
    return [
        _line(None, feature, None, calls[feature], spends[feature], prices)
        for feature in FEATURES
        if feature in calls
    ]


__all__ = [
    "FEATURES",
    "WINDOWS",
    "Line",
    "ModelLine",
    "Price",
    "Prices",
    "Report",
    "Spend",
    "cost_of",
    "load_prices",
    "parse_prices",
    "record_model_call",
    "report",
    "save_prices",
    "sweep",
]
