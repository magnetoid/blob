"""Where an agent's run is sent, decided as it is sent (plugins/egress).

Registration checks an app's address once. These pin that an agent's run is checked again
as it goes, and sent to the address that was checked — one lookup, so a nameserver cannot
answer the check and the connection differently — with the name kept for the certificate
and the `Host` header; that an address inside the network is refused with the reason on
the run; and that the addresses Blob does not judge — a workspace allowed private
endpoints, the seeded agent's own — go as they are.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.lib import net

from .conftest import EXAMPLE_ADDRESS
from .helpers import allow_policy, workspace_id_of
from .test_agent_follows import say
from .test_agent_tools import says
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse in its own module
from .test_task_dispatch import desk_fixture  # noqa: F401 — the fake agent and its room

AGENT_HOST = "apps.example.com"


def answering(*answers: list[str]) -> tuple[Any, list[str]]:
    """A resolver for the agent's host that gives these answers in turn, the last for ever
    after, and records each lookup."""
    asked: list[str] = []
    real = net.resolve

    async def resolve(hostname: str, port: int | None) -> list[str]:
        if hostname != AGENT_HOST:
            return await real(hostname, port)
        asked.append(hostname)
        return answers[min(len(asked), len(answers)) - 1]

    return resolve, asked


async def the_run(desk: dict[str, Any]) -> Any:
    async with SessionFactory() as session:
        return (
            await session.execute(
                text("SELECT status, error FROM agent_runs WHERE plugin_id = :p"),
                {"p": desk["plugin_id"]},
            )
        ).one()


async def test_a_run_goes_to_the_address_that_was_checked(desk: dict[str, Any]) -> None:
    await say(desk, "@Helper hello", says("Hello."))
    [request] = desk["state"]["seen"]
    assert request.url.host == EXAMPLE_ADDRESS
    # The name is kept where the agent's server reads it: the certificate and the host.
    assert request.headers["host"] == AGENT_HOST
    assert request.extensions["sni_hostname"] == AGENT_HOST
    assert (await the_run(desk)).status == "succeeded"


async def test_an_agent_whose_name_points_inside_the_network_is_refused(
    desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    resolve, _asked = answering(["10.0.0.5"])
    monkeypatch.setattr(net, "resolve", resolve)

    await say(desk, "@Helper hello", says("Never sent."))

    assert desk["state"]["seen"] == []
    run = await the_run(desk)
    assert run.status == "failed"
    assert "inside the server's own network" in run.error


async def test_one_lookup_so_the_check_and_the_connection_cannot_disagree(
    desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """DNS rebinding: a public answer for the check, the database's for the connection.
    There is no second lookup to rebind."""
    resolve, asked = answering([EXAMPLE_ADDRESS], ["10.0.0.5"])
    monkeypatch.setattr(net, "resolve", resolve)

    await say(desk, "@Helper hello", says("Hello."))

    assert asked == [AGENT_HOST]
    [request] = desk["state"]["seen"]
    assert request.url.host == EXAMPLE_ADDRESS


async def test_a_workspace_allowed_private_endpoints_reaches_the_name_as_it_is(
    desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AGENT_ALLOW_PRIVATE_ENDPOINTS", True)
    await allow_policy(await workspace_id_of(desk["owner"]), may_use_private_endpoints=True)
    resolve, asked = answering(["10.0.0.5"])
    monkeypatch.setattr(net, "resolve", resolve)

    await say(desk, "@Helper hello", says("Hello."))

    [request] = desk["state"]["seen"]
    assert request.url.host == AGENT_HOST
    assert asked == [], "not judged, so not looked up here"


async def test_the_seeded_agents_own_address_is_not_judged(
    desk: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """`JANUS_AGUI_URL` is the operator's own setting, internal by design."""
    monkeypatch.setattr(settings, "JANUS_AGUI_URL", f"https://{AGENT_HOST}/agui")
    resolve, _asked = answering(["10.0.0.5"])
    monkeypatch.setattr(net, "resolve", resolve)

    await say(desk, "@Helper hello", says("Hello."))

    [request] = desk["state"]["seen"]
    assert request.url.host == AGENT_HOST
