"""Object storage (MinIO in dev, any S3 in prod).

Browsers upload straight to the bucket with a presigned PUT — the app never proxies file
bytes. The bucket stays private; every read is a short-lived presigned GET issued per
request.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any
from urllib.parse import quote

import boto3
from botocore.client import Config

from ..config import settings
from .ids import new_id

log = logging.getLogger("blob.storage")

UPLOAD_URL_TTL_SEC = 900  # 15 minutes to start the upload
DOWNLOAD_URL_TTL_SEC = 3600

#: Images render inline; everything else downloads. Never render SVG inline.
INLINE_MIME = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"}


def _build(endpoint: str) -> Any:
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=settings.S3_REGION,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if settings.S3_FORCE_PATH_STYLE else "auto"},
        ),
    )


@lru_cache(maxsize=1)
def _client() -> Any:
    """For the server's own reads and writes, over whatever network reaches the bucket."""
    return _build(settings.S3_ENDPOINT)


@lru_cache(maxsize=1)
def _signing_client() -> Any:
    """For presigning, which is different.

    A signature covers the host, and the browser follows the URL from outside. Deployed
    behind a container network the server reaches the bucket at `http://minio:9000` and
    the browser cannot, so signing with the internal endpoint produces links that fail
    to resolve. S3_PUBLIC_ENDPOINT is the one the browser will use; it falls back to
    S3_ENDPOINT, which is correct in development where both are the same host.
    """
    return _build(settings.s3_public_endpoint)


_bucket_ready = False


async def ensure_bucket() -> None:
    """Create the bucket on first use if it is not there.

    The alternative is a one-shot `mc` container in the compose file, and a container
    that exits makes `docker compose up --wait` report failure even on exit 0 — so the
    bucket would cost a deploy step or a permanently unhealthy stack. Doing it here is
    idempotent and needs nothing of the operator.

    Failures are swallowed: a managed S3 bucket usually denies CreateBucket to the
    application's credentials, and the bucket already exists in that case. A real
    problem surfaces on the upload itself rather than taking the request down here.
    """
    global _bucket_ready
    if _bucket_ready:
        return

    client = _client()
    try:
        await asyncio.to_thread(client.head_bucket, Bucket=settings.S3_BUCKET)
    except Exception:
        try:
            await asyncio.to_thread(client.create_bucket, Bucket=settings.S3_BUCKET)
        except Exception:
            # Deliberately not cached: storage may simply not be up yet, and caching a
            # failure here would mean uploads stayed broken until the process restarted.
            # The upload itself is what reports a real problem to the caller.
            log.warning("bucket %s is not reachable yet", settings.S3_BUCKET)
            return
    _bucket_ready = True


def is_inline_image(mime: str) -> bool:
    return mime.lower() in INLINE_MIME


def build_object_key(workspace_id: str, filename: str) -> str:
    """Server chooses keys so a client can never overwrite someone else's object."""
    now = datetime.now(UTC)
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in filename)[-120:]
    return f"{workspace_id}/{now.year}/{now.month:02d}/{new_id()}/{safe}"


def presign_upload(key: str, mime: str) -> str:
    # Presigning is local crypto, no I/O, so it is safe to call on the event loop.
    return _signing_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key, "ContentType": mime},
        ExpiresIn=UPLOAD_URL_TTL_SEC,
    )


def presign_download(key: str, filename: str | None = None, mime: str | None = None) -> str:
    """A short-lived GET, with the response's own type and disposition pinned.

    `ResponseContentType` is not decoration. Without it the object is served with the
    Content-Type it was *stored* with, which came from the `mime` the uploader declared
    at ticket time and was never checked against anything. Pair that with the `inline`
    disposition an image gets and a member could upload `text/html`, make it their
    avatar, and have the storage origin serve their markup as a document.

    So the type the browser is told is the type this server decided, and anything that is
    not an image it is willing to render inline is served as a download of octet-stream.
    """
    inline = bool(mime and is_inline_image(mime))
    if inline:
        disposition = "inline"
    else:
        safe = (filename or "file").replace('"', "")
        disposition = f'attachment; filename="{safe}"'
    return _signing_client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.S3_BUCKET,
            "Key": key,
            "ResponseContentDisposition": disposition,
            # Only an allowlisted image type is ever echoed back; everything else is
            # bytes to save, whatever the uploader called it.
            "ResponseContentType": mime if inline else "application/octet-stream",
        },
        ExpiresIn=DOWNLOAD_URL_TTL_SEC,
    )


def public_file_url(key: str) -> str:
    """Stable URL that routes through the API, which redirects to a fresh presigned GET.

    Serialized objects embed this rather than a signed URL, so cached message payloads
    never contain an expiring link.
    """
    return f"/api/files/{quote(key, safe='')}"


async def delete_object(key: str) -> None:
    await asyncio.to_thread(_client().delete_object, Bucket=settings.S3_BUCKET, Key=key)


async def get_object(key: str) -> bytes:
    """Read an object through the app rather than redirecting the browser to it.

    Used where the response headers matter — a feedback snapshot is markup captured from
    a browser, and it is served under a CSP this process controls.
    """
    response = await asyncio.to_thread(_client().get_object, Bucket=settings.S3_BUCKET, Key=key)
    body: bytes = await asyncio.to_thread(response["Body"].read)
    return body


async def get_object_head(key: str, n: int = 64) -> bytes:
    """The first `n` bytes, for magic-number checks that must not download a 100MB file."""
    response = await asyncio.to_thread(
        _client().get_object,
        Bucket=settings.S3_BUCKET,
        Key=key,
        Range=f"bytes=0-{n - 1}",
    )
    body: bytes = await asyncio.to_thread(response["Body"].read)
    return body


async def put_object(key: str, body: bytes, mime: str) -> None:
    await asyncio.to_thread(
        _client().put_object, Bucket=settings.S3_BUCKET, Key=key, Body=body, ContentType=mime
    )


#: Long enough for a proxy hop, short enough that the health page never hangs on it.
PROBE_TIMEOUT_SEC = 3.0


async def probe() -> str:
    """Whether *a browser* could reach object storage — not whether this process can.

    The distinction is the whole point, and it is the failure this exists for. Uploads are
    a presigned PUT straight from the browser to the bucket, so the signing endpoint has to
    be a name the browser can resolve and a port the proxy actually forwards. The app talks
    to MinIO over the compose network and is perfectly happy while both of those are wrong.

    Two real deployments were broken this way at once and nothing anywhere said so:
    one had a bucket hostname routed to the wrong container port and answered 502; the
    other had `S3_PUBLIC_ENDPOINT` set to the bare string `https://`, which signs URLs
    against no host at all *and* silently drops the storage origin from the CSP, so the
    browser blocked the request before it was even made. In both, every upload failed with
    a console message nobody reads, and the app's own health page said storage was fine.

    Returns `"ok"`, `"unconfigured"` (no host to sign against), `"private"` (a name only
    this network can resolve — correct in dev, fatal in production) or `"unreachable"`.
    """
    from urllib.parse import urlparse

    endpoint = settings.s3_public_endpoint
    parsed = urlparse(endpoint)
    if not parsed.hostname:
        return "unconfigured"

    # A container name has no dot. In dev that is `localhost` and fine; in production it
    # is `minio`, which resolves for this process and for nobody holding a browser.
    if settings.is_prod and "." not in parsed.hostname and parsed.hostname != "localhost":
        return "private"

    import httpx

    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SEC, follow_redirects=False) as http:
            response = await http.get(endpoint.rstrip("/") + "/minio/health/live")
    except Exception:
        # A closed port, a name that does not resolve, a certificate nobody signed. Any
        # of them is an upload the browser cannot make.
        return "unreachable"

    # 502/503/504 is a proxy that knows the name and cannot reach what is behind it —
    # which is exactly a bucket published on the wrong container port. Anything else,
    # including a 403 from a bucket that refuses anonymous reads, proves the path works.
    if response.status_code in (502, 503, 504):
        return "unreachable"
    return "ok"
