"""What agents and Blob's own model spend, for an admin and for an agent's owner (M2 · A9).

The admin's page reads every agent in the workspace, the people whose authority runs were
on, Blob's own catch-ups and summaries, and the models seen — priced where the workspace
priced them. An owner reads the same for their own agents and nothing else. Prices are
the admin's to set: a currency, and per model a price per million input and output tokens.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user, require_admin
from ..schemas.base import CamelModel
from ..services import audit as audit_service
from ..services import usage as usage_service

router = APIRouter(tags=["usage"])


class UsageLineOut(CamelModel):
    #: The agent's or person's id; null for one of Blob's own features.
    id: str | None = None
    #: An agent's or person's name, or `catchup` / `summary` for Blob's own.
    name: str
    #: Whose agent it is, for one somebody owns.
    owner_name: str | None = None
    #: Runs, or for Blob's own features, calls.
    runs: int
    input_tokens: int
    output_tokens: int
    tokens: int
    #: In the workspace's currency; null when nothing could be priced.
    cost: float | None = None
    #: False when some tokens had no price — a model nobody priced, or a total that did
    #: not say how much of it was input.
    cost_complete: bool


class UsageModelOut(CamelModel):
    model: str
    tokens: int
    input_per_million: float | None = None
    output_per_million: float | None = None


class UsageReportOut(CamelModel):
    days: int
    currency: str | None = None
    agents: list[UsageLineOut]
    people: list[UsageLineOut]
    blob: list[UsageLineOut]
    models: list[UsageModelOut]


class ModelPriceIn(CamelModel):
    model: Annotated[str, Field(min_length=1, max_length=80)]
    input_per_million: Annotated[float, Field(ge=0, le=100_000)]
    output_per_million: Annotated[float, Field(ge=0, le=100_000)]


class PricesIn(CamelModel):
    currency: Annotated[str | None, Field(pattern=r"^[A-Z]{3}$")] = None
    prices: Annotated[list[ModelPriceIn], Field(max_length=100)]


class ModelPriceOut(CamelModel):
    model: str
    input_per_million: float
    output_per_million: float


class PricesOut(CamelModel):
    currency: str | None = None
    prices: list[ModelPriceOut]


def _line(line: usage_service.Line) -> UsageLineOut:
    return UsageLineOut(
        id=line.id,
        name=line.name,
        owner_name=line.owner,
        runs=line.runs,
        input_tokens=line.input_tokens,
        output_tokens=line.output_tokens,
        tokens=line.tokens,
        cost=round(float(line.cost), 6) if line.cost is not None else None,
        cost_complete=line.cost_complete,
    )


def _report(report: usage_service.Report) -> UsageReportOut:
    return UsageReportOut(
        days=report.days,
        currency=report.currency,
        agents=[_line(line) for line in report.agents],
        people=[_line(line) for line in report.people],
        blob=[_line(line) for line in report.blob],
        models=[
            UsageModelOut(
                model=model.model,
                tokens=model.tokens,
                input_per_million=float(model.price.input_per_million) if model.price else None,
                output_per_million=float(model.price.output_per_million) if model.price else None,
            )
            for model in report.models
        ],
    )


def _prices(prices: usage_service.Prices) -> PricesOut:
    return PricesOut(
        currency=prices.currency,
        prices=[
            ModelPriceOut(
                model=model,
                input_per_million=float(price.input_per_million),
                output_per_million=float(price.output_per_million),
            )
            for model, price in sorted(prices.by_model.items())
        ],
    )


@router.get("/api/admin/usage", response_model=UsageReportOut)
async def workspace_usage(
    days: Annotated[int, Query(description="1, 7 or 30")] = 7,
    admin: SessionUser = Depends(require_admin),
) -> UsageReportOut:
    async with session_scope() as session:
        report = await usage_service.report(session, admin.workspace_id, days=days)
    return _report(report)


@router.get("/api/admin/usage/prices", response_model=PricesOut)
async def prices(admin: SessionUser = Depends(require_admin)) -> PricesOut:
    async with session_scope() as session:
        return _prices(await usage_service.load_prices(session, admin.workspace_id))


@router.put("/api/admin/usage/prices", response_model=PricesOut)
async def set_prices(
    payload: PricesIn, request: Request, admin: SessionUser = Depends(require_admin)
) -> PricesOut:
    """Replace the currency and the price list whole: what the page shows is what is kept."""
    by_model = {
        row.model.strip(): usage_service.Price(
            Decimal(str(row.input_per_million)), Decimal(str(row.output_per_million))
        )
        for row in payload.prices
    }
    async with transaction() as (session, _after):
        saved = await usage_service.save_prices(
            session,
            audit_service.actor_for(request, admin),
            currency=payload.currency,
            prices=by_model,
        )
    return _prices(saved)


@router.get("/api/agents/usage", response_model=UsageReportOut)
async def my_agents_usage(
    days: Annotated[int, Query(description="1, 7 or 30")] = 7,
    user: SessionUser = Depends(current_user),
) -> UsageReportOut:
    """What the agents this person owns spent — whoever asked them — priced as the
    workspace prices it. Nothing of anybody else's agents."""
    async with session_scope() as session:
        report = await usage_service.report(session, user.workspace_id, days=days, owner_id=user.id)
    return _report(report)


__all__ = ["router"]
