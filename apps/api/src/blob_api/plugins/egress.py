"""Where Blob may connect for an app or an agent, decided at the moment it connects.

Registration checks an app's address once (`routers/plugins._assert_reachable`), and that
was all an agent's run or an app's delivery ever met: a record changed since — or a
nameserver answering the check and the connection differently, DNS rebinding — made an
app's address a way to have the worker POST signed requests inside the server's own
network and, for an agent, read the answer back into a channel. So every request is
checked as it is made and sent to the address that was checked (`net.pin_public`): the
connection goes to that address, TLS verifies the certificate against the name, and the
`Host` header still says the name.

Some addresses are not judged, because Blob did not take them from anybody it should
doubt: the seeded agent's (`JANUS_AGUI_URL`, the operator's own setting, internal by
design), a container agent's (written by the deployment sync from the runner), and any in a
workspace whose operator and policy both allow private endpoints, where reaching the
private network is the point (`policies.may_use_private_endpoints`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..config import settings
from ..lib import net

#: What a refused request says, on a run's card or a delivery's log line.
REFUSED = "its address is inside the server's own network, or does not resolve"


@dataclass(frozen=True, slots=True)
class Target:
    """The request to make: where to, and the headers and transport extensions that keep
    it the named host's — empty for an address that is not pinned."""

    url: str
    headers: dict[str, str] = field(default_factory=dict)
    extensions: dict[str, Any] = field(default_factory=dict)


def trusted(url: str, *, runtime: str, private_ok: bool) -> bool:
    """Whether Blob connects to `url` as it is, unjudged — see the module's docstring."""
    if private_ok or runtime == "container":
        return True
    return bool(settings.JANUS_AGUI_URL) and url == settings.JANUS_AGUI_URL


async def target(url: str, *, trusted_address: bool) -> Target | None:
    """The request to make for `url`, or None when it may not be made."""
    if trusted_address:
        return Target(url)
    pinned = await net.pin_public(url)
    if pinned is None:
        return None
    return Target(pinned.url, dict(pinned.headers), dict(pinned.extensions))


__all__ = ["REFUSED", "Target", "target", "trusted"]
