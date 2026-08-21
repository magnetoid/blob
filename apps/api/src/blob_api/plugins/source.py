"""Reading an agent's manifest out of its repository.

An admin pastes a repository URL; this fetches the `blob-app.json` at its root and hands
back a manifest plus what the runner needs to build it. Nothing is executed here — the
repository's code only ever runs in its own container, and only after the scopes it asks
for have been approved.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from ..config import settings
from ..lib.errors import bad_request
from ..lib.net import check_outbound_url
from .manifest import Manifest, validate_manifest

MANIFEST_NAME = "blob-app.json"

#: A manifest is a small JSON document. Anything larger is not one, and reading it would
#: be a way to make this process fetch something big on request.
MANIFEST_MAX_BYTES = 64 * 1024

_GITHUB_REPO_RE = re.compile(r"^/(?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?/?$")


@dataclass(slots=True)
class RepoSource:
    """A repository, resolved to the pieces a deploy needs."""

    repo_url: str
    ref: str
    manifest: Manifest
    #: nixpacks reads the repository and infers the build; a repo that ships a Dockerfile
    #: says so in its manifest and gets built by it instead.
    build_pack: str


def raw_manifest_url(repo_url: str, ref: str) -> str:
    """Where `blob-app.json` lives for a GitHub repository.

    Only GitHub is understood for now. A different host is not refused because it is
    untrusted — it is refused because the raw-file URL is host-specific and guessing is
    worse than saying so.
    """
    parsed = urlparse(repo_url)
    if parsed.scheme != "https" or parsed.netloc.lower() not in {"github.com", "www.github.com"}:
        raise bad_request(
            "Only https://github.com repositories can be read automatically. Register "
            "the app with a manifest instead.",
            code="unsupported_repo_host",
        )

    match = _GITHUB_REPO_RE.match(parsed.path)
    if not match:
        raise bad_request("That does not look like a repository URL.", code="bad_repo_url")

    owner, repo = match.group("owner"), match.group("repo")
    return f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{MANIFEST_NAME}"


async def read_manifest(repo_url: str, ref: str = "main") -> RepoSource:
    url = raw_manifest_url(repo_url, ref)
    # The same guard registration uses: resolves DNS rather than matching strings, so a
    # hostname pointing at a private address is refused.
    await check_outbound_url(url, require_https=True)

    try:
        async with httpx.AsyncClient(
            timeout=settings.AGENT_DEPLOY_TIMEOUT_SEC, follow_redirects=False
        ) as client:
            response = await client.get(url)
    except httpx.HTTPError as exc:
        raise bad_request(
            "That repository could not be reached.", code="repo_unreachable"
        ) from exc

    if response.status_code == 404:
        raise bad_request(
            f"No {MANIFEST_NAME} at the root of that repository on {ref}.",
            code="manifest_missing",
        )
    if response.status_code >= 400:
        raise bad_request(
            f"The repository answered {response.status_code}.", code="repo_unreachable"
        )
    if len(response.content) > MANIFEST_MAX_BYTES:
        raise bad_request("That manifest is implausibly large.", code="manifest_too_large")

    try:
        document = json.loads(response.content)
    except ValueError as exc:
        raise bad_request(f"{MANIFEST_NAME} is not valid JSON.", code="manifest_invalid") from exc
    if not isinstance(document, dict):
        raise bad_request(f"{MANIFEST_NAME} must be an object.", code="manifest_invalid")

    build_pack = str(document.pop("build", "nixpacks")).lower()
    if build_pack not in {"nixpacks", "dockerfile"}:
        raise bad_request(
            'A manifest\'s "build" must be "nixpacks" or "dockerfile".', code="manifest_invalid"
        )

    # Hosted agents are reached over HTTP like any external app. The URL is not known
    # until the runner has assigned one, so the manifest neither carries it nor needs to.
    document["runtime"] = "container"
    document.pop("requestUrl", None)
    document.pop("request_url", None)

    manifest = Manifest.model_validate(document)
    validate_manifest(manifest)

    return RepoSource(
        repo_url=repo_url.rstrip("/").removesuffix(".git"),
        ref=ref,
        manifest=manifest,
        build_pack=build_pack,
    )


__all__ = ["MANIFEST_NAME", "RepoSource", "raw_manifest_url", "read_manifest"]
