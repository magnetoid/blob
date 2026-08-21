"""Deciding whether a URL is safe for the server to fetch.

The server sits inside a private network with a database, a Redis and a cloud metadata
endpoint on it. Anything that takes a URL from a user and fetches it — link unfurls,
plugin deliveries — is a way to make the server issue requests on someone's behalf, so
both go through here.

The check resolves the hostname rather than pattern-matching the string: `127.0.0.1`,
`localhost`, `0x7f.1`, and a public name with an A record pointing at 10.0.0.5 are all
the same request, and only resolution catches the last one.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

from .errors import bad_request


def is_private_address(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        # Unparseable is not provably public, so it is refused.
        return True
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


async def is_private_host(hostname: str) -> bool:
    """True if any address the name resolves to is one we refuse to reach."""
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(hostname, None)
    except socket.gaierror:
        # A name that does not resolve is not a name worth fetching.
        return True
    return any(is_private_address(str(info[4][0])) for info in infos)


async def check_outbound_url(raw_url: str, *, require_https: bool) -> str | None:
    """Validate a URL the server will POST to. Returns a reason to refuse, or None.

    The message is returned rather than raised so callers can phrase it for their own
    context — an admin registering an app deserves a better error than a job log line.
    """
    try:
        parsed = urlparse(raw_url)
    except ValueError:
        return "That is not a valid URL."

    allowed_schemes = ("https",) if require_https else ("http", "https")
    if parsed.scheme not in allowed_schemes:
        return (
            "The URL must start with https://."
            if require_https
            else "The URL must start with http:// or https://."
        )
    if not parsed.hostname:
        return "The URL needs a hostname."
    if await is_private_host(parsed.hostname):
        return "That address is inside the server's own network."
    return None


async def assert_outbound_url(raw_url: str, *, require_https: bool, code: str) -> None:
    """Refuse a URL the server should not fetch, by raising.

    `check_outbound_url` returns its reason rather than raising, which reads as a guard
    at a glance and is one forgotten `if` away from being no guard at all — two call
    sites had exactly that, awaiting it and discarding the answer. Anywhere the only
    sensible response is "refuse", call this instead: there is nothing to forget.
    """
    reason = await check_outbound_url(raw_url, require_https=require_https)
    if reason is not None:
        raise bad_request(reason, code=code)
