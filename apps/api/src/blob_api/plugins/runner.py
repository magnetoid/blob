"""Hosting an agent that came from a repository.

Blob does not hold the Docker socket. On a host that runs other things — and the one
this was written for runs about thirty domains — a compromise of the chat app must not
become a compromise of the box. So deployment goes through whatever component already
owns that privilege, behind this interface. See ADR 0010.

The first implementation drives Coolify, because a host running Coolify already has a
service whose entire job is to turn a repository into a running container. Others can
follow the same four methods.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from ..config import settings
from ..lib.errors import AppError, bad_request
from ..lib.net import check_outbound_url

log = logging.getLogger("blob.agents")

#: The port a hosted agent is expected to listen on. Told to the runner so its proxy
#: routes there, and to the agent as PORT so it does not have to guess what we told the
#: proxy. One number, stated in both directions, rather than a convention each side
#: assumes about the other.
AGENT_PORT = 3000


@dataclass(slots=True)
class Deployment:
    """What the runner gives back. `id` is opaque to us — it is the runner's handle."""

    id: str
    status: str
    #: An absolute base URL including scheme, or None until one has been assigned.
    url: str | None = None


def normalize_fqdn(value: object) -> str | None:
    """Turn whatever the runner calls a hostname into a base URL we can append to.

    Coolify is inconsistent here, and the two shapes fail differently. A freshly created
    application reports `http://name.sslip.io` — scheme included — so prefixing another
    scheme produces `https://http://...`, which is not a URL at all and fails every
    delivery. An older application reports `name.sslip.io:3000` with no scheme, which
    needs one. Several domains can also arrive comma-separated; the first is the one the
    proxy answers on.

    Whatever arrives, what leaves here is absolute or nothing.
    """
    if not value:
        return None
    first = str(value).split(",")[0].strip()
    if not first:
        return None
    if first.startswith(("http://", "https://")):
        return first.rstrip("/")
    # No scheme. Assume TLS, which is what a Coolify proxy terminates for a real domain;
    # an operator using a plain-http hostname carries it in the value itself.
    return f"https://{first.rstrip('/')}"


class AgentRunner(Protocol):
    async def deploy(
        self, *, slug: str, repo: str, ref: str, env: dict[str, str]
    ) -> Deployment: ...

    async def redeploy(self, deployment_id: str) -> Deployment: ...

    async def status(self, deployment_id: str) -> Deployment: ...

    async def logs(self, deployment_id: str, lines: int) -> str: ...

    async def stop(self, deployment_id: str) -> None: ...


class CoolifyRunner:
    """Deploys into the same Coolify project as Blob itself.

    Agents live beside the workspace they serve: one project, one place to look when
    something is wrong, and the same backup and restart policy.
    """

    def __init__(self) -> None:
        self._base = (settings.COOLIFY_API_URL or "").rstrip("/")
        self._token = settings.COOLIFY_TOKEN or ""

    async def deploy(self, *, slug: str, repo: str, ref: str, env: dict[str, str]) -> Deployment:
        # A repository URL is operator-supplied and reaches out from this process, so it
        # goes through the same guard registration uses. It resolves DNS, hence the await.
        await check_outbound_url(repo, require_https=True)

        payload: dict[str, Any] = {
            "project_uuid": settings.COOLIFY_PROJECT_UUID,
            "server_uuid": settings.COOLIFY_SERVER_UUID,
            "environment_name": settings.COOLIFY_ENVIRONMENT,
            "git_repository": repo,
            "git_branch": ref,
            # nixpacks reads the repository and works out how to build it, which covers
            # an ordinary Python or Node agent with no Dockerfile. A repo that ships one
            # is better served by it, and says so in its manifest.
            "build_pack": env.pop("__build_pack__", "nixpacks"),
            "name": f"agent-{slug}",
            # Which port the proxy should route to. Without it the runner guesses, and
            # an agent that guessed differently is unreachable — which looks exactly
            # like an agent that failed to start.
            "ports_exposes": str(AGENT_PORT),
            "instant_deploy": False,
        }
        # Sent only when configured: a server with one destination does not need it, and
        # a server with several refuses the create rather than choosing for us.
        if settings.COOLIFY_DESTINATION_UUID:
            payload["destination_uuid"] = settings.COOLIFY_DESTINATION_UUID

        created = await self._call("POST", "/api/v1/applications/public", payload)
        application_uuid = str(created.get("uuid") or "")
        if not application_uuid:
            raise AppError(502, "runner_failed", "The runner did not return an application.")

        # Environment before the first deploy, so the agent has its token on boot rather
        # than crash-looping until a second deploy supplies it.
        for key, value in env.items():
            await self._call(
                "POST",
                f"/api/v1/applications/{application_uuid}/envs",
                {"key": key, "value": value},
            )

        await self._call("POST", "/api/v1/deploy", {"uuid": application_uuid})
        return Deployment(id=application_uuid, status="deploying")

    async def redeploy(self, deployment_id: str) -> Deployment:
        await self._call("POST", "/api/v1/deploy", {"uuid": deployment_id, "force": True})
        return Deployment(id=deployment_id, status="deploying")

    async def status(self, deployment_id: str) -> Deployment:
        payload = await self._call("GET", f"/api/v1/applications/{deployment_id}")
        return Deployment(
            id=deployment_id,
            status=str(payload.get("status") or "unknown"),
            url=normalize_fqdn(payload.get("fqdn")),
        )

    async def logs(self, deployment_id: str, lines: int = 200) -> str:
        """Whatever the container has written lately.

        An agent that will not start says why here and nowhere else, so this is the
        difference between an admin who can fix it and one who can only redeploy and
        hope.
        """
        payload = await self._call(
            "GET", f"/api/v1/applications/{deployment_id}/logs?lines={lines}"
        )
        if isinstance(payload, dict):
            return str(payload.get("logs") or payload.get("output") or "")
        return str(payload or "")

    async def stop(self, deployment_id: str) -> None:
        await self._call("GET", f"/api/v1/applications/{deployment_id}/stop")

    async def _call(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        try:
            async with httpx.AsyncClient(timeout=settings.AGENT_DEPLOY_TIMEOUT_SEC) as client:
                response = await client.request(
                    method,
                    f"{self._base}{path}",
                    headers={"Authorization": f"Bearer {self._token}"},
                    json=body,
                )
                response.raise_for_status()
                return response.json() if response.content else {}
        except httpx.HTTPStatusError as exc:
            # The runner's own message is the useful one — it knows why it refused.
            detail = exc.response.text[:300]
            log.warning("runner refused %s %s: %s", method, path, detail)
            raise AppError(502, "runner_failed", f"The runner refused that: {detail}") from exc
        except httpx.HTTPError as exc:
            log.warning("runner unreachable: %s", exc)
            raise AppError(502, "runner_unreachable", "The runner did not respond.") from exc


def current_runner() -> AgentRunner:
    """The configured runner, or a clear refusal.

    Hosting off is a normal state, not a broken one: agents can still be registered as
    external apps and run wherever their author put them. Only the "run it for me" half
    needs this.
    """
    if not settings.agent_hosting_enabled:
        raise bad_request(
            "This workspace is not set up to host agents. Register the app with a URL "
            "instead, or configure AGENT_RUNNER.",
            code="agent_hosting_disabled",
        )
    return CoolifyRunner()


__all__ = [
    "AGENT_PORT",
    "AgentRunner",
    "CoolifyRunner",
    "Deployment",
    "current_runner",
    "normalize_fqdn",
]
