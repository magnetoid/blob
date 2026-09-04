"""Serving the client, and the two health endpoints.

These cover what only breaks in production: in development Vite serves the client and
nothing ever exercises the mount, so a regression here would ship silently and take the
whole app down rather than one endpoint.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from blob_api.web import mount_web

from .helpers import Client


def build_dist(root: Path) -> Path:
    """The shape `vite build` leaves behind."""
    dist = root / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Blob</title>")
    (dist / "assets" / "main-a1b2c3d4.js").write_text("console.log('hi')")
    (dist / "favicon.svg").write_text("<svg/>")
    return dist


@pytest_asyncio.fixture
async def web(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    """A miniature app: one API route, and the client mounted the way main.py mounts it."""
    app = FastAPI()

    @app.get("/api/ping")
    async def ping() -> dict[str, bool]:
        return {"ok": True}

    assert mount_web(app, build_dist(tmp_path))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def test_the_root_serves_the_app(web: httpx.AsyncClient) -> None:
    response = await web.get("/")
    assert response.status_code == 200
    assert "<title>Blob</title>" in response.text


async def test_a_deep_link_serves_the_app(web: httpx.AsyncClient) -> None:
    # Client-side routes are not files; reloading on one has to work.
    response = await web.get("/channel/general/thread/abc")
    assert response.status_code == 200
    assert "<title>Blob</title>" in response.text


async def test_a_missing_file_is_a_404_and_not_the_app(web: httpx.AsyncClient) -> None:
    """A request that names a file must not be answered with index.html.

    This is how the app's own icons went missing in production without anything looking
    wrong: index.html and the manifest pointed at four PNGs that `.gitignore` had never
    let anybody commit, and every request for one came back 200 with HTML in it. The
    browser asked for an image, was handed a web page, and drew nothing — a broken
    favicon and no Home Screen icon, reported by no log line anywhere.
    """
    response = await web.get("/icons/icon-192.png")

    assert response.status_code == 404
    assert "<title>Blob</title>" not in response.text


async def test_a_file_that_is_there_is_still_served(web: httpx.AsyncClient) -> None:
    response = await web.get("/favicon.svg")

    assert response.status_code == 200
    assert response.text == "<svg/>"


async def test_real_files_are_served_as_themselves(web: httpx.AsyncClient) -> None:
    assert (await web.get("/assets/main-a1b2c3d4.js")).text == "console.log('hi')"
    assert (await web.get("/favicon.svg")).text == "<svg/>"


async def test_routes_still_win_over_the_mount(web: httpx.AsyncClient) -> None:
    assert (await web.get("/api/ping")).json() == {"ok": True}


async def test_an_unknown_api_path_is_a_404_not_the_app(web: httpx.AsyncClient) -> None:
    # The failure this guards against: a mistyped endpoint answering 200 with HTML, so
    # the client parses a page as JSON and reports something incomprehensible.
    for path in ("/api/nope", "/api", "/ws"):
        response = await web.get(path)
        assert response.status_code == 404, path
        assert "<title>" not in response.text, path


async def test_fingerprinted_assets_are_cached_and_the_document_is_not(
    web: httpx.AsyncClient,
) -> None:
    # Vite hashes asset filenames, so they are safe to hold forever. index.html keeps its
    # name across deploys, so holding it would pin people to the old build.
    assert "immutable" in (await web.get("/assets/main-a1b2c3d4.js")).headers["cache-control"]
    assert (await web.get("/")).headers["cache-control"] == "no-cache"


def test_an_unbuilt_client_is_not_fatal(tmp_path: Path) -> None:
    # A missing dist means "API only", not a crash at boot.
    assert mount_web(FastAPI(), tmp_path / "nothing") is False


# ─── health ───────────────────────────────────────────────────────────────────
async def test_liveness_needs_no_session_and_touches_nothing(client: Client) -> None:
    response = await client.get("/healthz")
    assert response.status == 200
    assert response.body == {"ok": True}


async def test_liveness_does_not_publish_socket_counts(client: Client) -> None:
    # It is a public URL behind the proxy; who is connected is not public information.
    assert set((await client.get("/healthz")).body) == {"ok"}


async def test_readiness_checks_the_datastores(client: Client) -> None:
    response = await client.get("/readyz")
    assert response.status == 200
    assert response.body == {"ok": True}


@pytest.mark.parametrize("path", ["/healthz", "/readyz"])
async def test_health_is_reachable_without_signing_in(client: Client, path: str) -> None:
    assert (await client.get(path)).status == 200
