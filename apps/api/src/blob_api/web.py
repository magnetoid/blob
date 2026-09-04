"""Serving the built client from the API process.

In development Vite serves the client and proxies /api and /ws here. In production the
two ship in one image and one origin: the session cookie needs no CORS exemption, the
socket connects to `location.host` with nothing to configure, and a proxy in front has a
single service to route.

Mounted last, so every real route wins first. Unknown paths under /api and /ws are
refused rather than answered with index.html — a client that asks for a route that does
not exist should hear 404, not receive a page.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

#: Vite fingerprints these filenames, so they can be cached until the heat death.
IMMUTABLE_PREFIX = "assets/"
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"

#: index.html is the one file whose name never changes, so it must never be held.
DOCUMENT_CACHE = "no-cache"

#: Paths the client owns; everything else here is the API's to answer.
API_PREFIXES = ("api", "ws", "healthz", "readyz", "docs", "redoc", "openapi.json")


class SinglePageApp(StaticFiles):
    """Static files with a client-side-routing fallback."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        head = path.split("/", 1)[0]
        if head in API_PREFIXES:
            # Falling through to index.html here would answer a bad API call with HTML.
            raise HTTPException(status_code=404)

        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            # A request that names a file is not a client route, and answering it with
            # index.html is worse than answering nothing: the browser asked for a PNG and
            # got HTML with a 200, so a missing asset looks like a working one. That is
            # exactly how the app's own icons went missing in production without anything
            # appearing broken — index.html and the manifest pointed at four PNGs that
            # were never committed, and every request for one came back 200.
            #
            # Client routes have no extension: /c/<uuid>, /workspace/members, /help.
            # `suffix` rather than "contains a dot", because StaticFiles normalises the
            # root to "." — which the cruder test read as a file and answered 404, taking
            # the whole app down with it.
            if PurePosixPath(path).suffix:
                raise
            # A deep link like /channel/general is the client's route, not a file.
            response = await super().get_response("index.html", scope)

        response.headers["cache-control"] = (
            IMMUTABLE_CACHE if path.startswith(IMMUTABLE_PREFIX) else DOCUMENT_CACHE
        )
        return response


def mount_web(app: FastAPI, dist: str | Path) -> bool:
    """Serve `dist` at the root. Returns False if it has not been built."""
    directory = Path(dist)
    if not (directory / "index.html").is_file():
        return False
    app.mount("/", SinglePageApp(directory=directory), name="web")
    return True
