"""Who is actually calling — the one question `request.client.host` does not answer.

`X-Forwarded-For` is append-only and anybody can start it. A browser that sends
`X-Forwarded-For: 1.2.3.4` gets that value carried along, because a proxy *appends* the
peer it saw rather than replacing what it was handed. So by the time a request reaches
this process the header reads

    [ whatever the caller made up …, the real caller, each proxy's peer … ]

and the only entries worth anything are the ones our own infrastructure appended, at the
right-hand end. Everything to the left of those is the caller's to invent.

uvicorn's `--forwarded-allow-ips "*"` takes the **leftmost** entry, which is precisely the
attacker-supplied one. That is not a bug in uvicorn — with a wildcard it has been told to
trust the whole chain — but it means `request.client.host` is a value the caller chooses.
Blob used it to key the login, signup and password-reset rate limits and to stamp the
audit log, so varying one header gave unlimited password attempts against a known address
and wrote whatever address the attacker liked into the forensic record.

**The rule here: count from the right, never from the left.** `TRUSTED_PROXY_HOPS` is how
many proxies append an entry *after* the one naming the real caller. The proxy nearest the
caller contributes the caller's own address, so it does not count; every proxy behind it
does. For a single reverse proxy the answer is 0. For the reference deployment — nginx
terminating TLS in front of Coolify's Traefik — it is 1, because Traefik appends nginx's
address after nginx has appended the caller's.

The default is 0 rather than a guess, because the two ways to be wrong are not
symmetrical. Too low and the address resolves to a proxy: one shared rate-limit bucket and
a useless audit column — visibly broken, and safe. Too high and it resolves to whatever
the caller wrote — invisible, and the whole point of the check gone.

This is deliberately not in `net.py`, which answers the opposite question: whether a URL
is safe for *the server* to fetch.
"""

from __future__ import annotations

import ipaddress

from starlette.requests import HTTPConnection

from ..config import settings

#: What the rate limiter keys on when there is no usable address at all. A constant, so
#: those callers share one bucket rather than each getting their own.
UNKNOWN = "unknown"


def forwarded_for(connection: HTTPConnection) -> list[str]:
    raw = connection.headers.get("x-forwarded-for", "")
    return [part.strip() for part in raw.split(",") if part.strip()]


def client_ip(connection: HTTPConnection) -> str | None:
    """The caller's address, or None when nothing trustworthy names one.

    Takes an `HTTPConnection` rather than a `Request` so a WebSocket asks the same
    question the same way — a second implementation for sockets is how the two drift.
    """
    chain = forwarded_for(connection)
    hops = max(settings.TRUSTED_PROXY_HOPS, 0)

    # `chain[-(hops + 1)]` is the entry the nearest trusted proxy vouched for. A chain
    # too short for the configured hops means the request did not come through the proxy
    # the configuration describes, so there is nothing in it to trust — fall through to
    # the peer rather than reaching left into what the caller wrote.
    if len(chain) > hops:
        return _an_address(chain[-(hops + 1)])

    return _an_address(connection.client.host) if connection.client else None


def _an_address(value: str | None) -> str | None:
    """An address, or nothing.

    `audit_events.ip` is an `inet` column and the value reaches it through a cast. With
    no proxy in front, `X-Forwarded-For: not-an-address` is a header the caller writes
    and this is the entry that gets picked — so without this the caller chooses whether
    the insert raises, and a 500 with a stack trace is the answer to a header.
    """
    if not value:
        return None
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return None
    return value


def client_key(connection: HTTPConnection) -> str:
    """The same address, as a rate-limit key that is never empty."""
    return client_ip(connection) or UNKNOWN


__all__ = ["UNKNOWN", "client_ip", "client_key", "forwarded_for"]
