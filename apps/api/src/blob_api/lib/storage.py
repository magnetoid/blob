"""Object storage (MinIO in dev, any S3 in prod).

Browsers upload straight to the bucket with a presigned PUT — the app never proxies file
bytes. The bucket stays private; every read is a short-lived presigned GET issued per
request.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any
from urllib.parse import quote

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from ..config import settings
from .ids import new_id

log = logging.getLogger("blob.storage")

UPLOAD_URL_TTL_SEC = 900  # 15 minutes to start the upload
DOWNLOAD_URL_TTL_SEC = 3600

#: Images render inline; everything else downloads. Never render SVG inline.
INLINE_MIME = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"}

#: What a *voice message* may be served inline as, so `<audio>` can play it.
#:
#: Deliberately a second set rather than more entries in `INLINE_MIME`, because that one
#: is not only about disposition: `services/users.py` asks `is_inline_image` to decide
#: whether an upload may become somebody's avatar. Widening it would make a voice note a
#: valid profile picture, served inline to the whole workspace. So audio goes inline only
#: where the caller says the row is a voice message, and an ordinary `.mp3` somebody
#: attached to a message still downloads exactly as it does today.
INLINE_AUDIO_MIME = {
    "audio/webm",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/ogg",
    "audio/mpeg",
    "audio/wav",
}


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


def presign_upload(key: str, mime: str, size_bytes: int) -> str:
    """A URL a browser can PUT exactly this file to, and nothing else.

    The length is signed in beside the type, so storage refuses a PUT of any other size
    and the limit checked when the ticket was issued is the limit that holds. Before,
    a ticket asked for as 1 KB accepted gigabytes — onto a disk shared with every other
    project on the host — and `/complete` then read the lot into memory.
    """
    # Presigning is local crypto, no I/O, so it is safe to call on the event loop.
    return _signing_client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.S3_BUCKET,
            "Key": key,
            "ContentType": mime,
            "ContentLength": size_bytes,
        },
        ExpiresIn=UPLOAD_URL_TTL_SEC,
    )


def is_inline_media(mime: str, *, voice: bool = False) -> bool:
    """Whether this type may be served inline. Audio only for a voice message."""
    return is_inline_image(mime) or (voice and mime.lower() in INLINE_AUDIO_MIME)


def presign_download(
    key: str, filename: str | None = None, mime: str | None = None, *, voice: bool = False
) -> str:
    """A short-lived GET, with the response's own type and disposition pinned.

    `ResponseContentType` is not decoration. Without it the object is served with the
    Content-Type it was *stored* with, which came from the `mime` the uploader declared
    at ticket time and was never checked against anything. Pair that with the `inline`
    disposition an image gets and a member could upload `text/html`, make it their
    avatar, and have the storage origin serve their markup as a document.

    So the type the browser is told is the type this server decided, and anything that is
    not an image it is willing to render inline is served as a download of octet-stream.
    """
    inline = bool(mime and is_inline_media(mime, voice=voice))
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
            # Only an allowlisted image type — or a voice message's own audio type —
            # is ever echoed back; everything else is bytes to save, whatever the
            # uploader called it.
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


class ObjectTooLargeError(Exception):
    """An object bigger than the caller agreed to hold in memory."""


async def get_object(key: str, *, max_bytes: int) -> bytes:
    """Read a whole object into memory — never more than `max_bytes` of it.

    Used where the bytes are needed here: a feedback snapshot served under a CSP this
    process controls, an image to thumbnail, a file handed to an agent. The bound is
    required rather than defaulted because every one of those used to read whatever was
    stored, and what was stored was whatever a browser chose to PUT.
    """
    response = await asyncio.to_thread(_client().get_object, Bucket=settings.S3_BUCKET, Key=key)
    body = response["Body"]
    try:
        if int(response.get("ContentLength") or 0) > max_bytes:
            raise ObjectTooLargeError(key)
        data: bytes = await asyncio.to_thread(body.read, max_bytes + 1)
    finally:
        await asyncio.to_thread(body.close)
    if len(data) > max_bytes:
        raise ObjectTooLargeError(key)
    return data


async def object_size(key: str) -> int | None:
    """How many bytes are stored under `key`, or None when nothing is."""
    try:
        response = await asyncio.to_thread(
            _client().head_object, Bucket=settings.S3_BUCKET, Key=key
        )
    except ClientError as error:
        if str(error.response.get("Error", {}).get("Code")) in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
    return int(response["ContentLength"])


#: How much of an object is held at once while it streams through the app.
STREAM_CHUNK_BYTES = 256 * 1024


async def stream_object(key: str) -> tuple[int, AsyncIterator[bytes]]:
    """An object's length and its bytes, a chunk at a time, for a response the app sends.

    For the one case where the headers are ours to set and the file may be large — a PDF
    shown in the side panel — so memory stays at one chunk rather than the whole file.
    """
    response = await asyncio.to_thread(_client().get_object, Bucket=settings.S3_BUCKET, Key=key)
    body = response["Body"]
    length = int(response.get("ContentLength") or 0)

    async def chunks() -> AsyncIterator[bytes]:
        try:
            while True:
                piece: bytes = await asyncio.to_thread(body.read, STREAM_CHUNK_BYTES)
                if not piece:
                    return
                yield piece
        finally:
            await asyncio.to_thread(body.close)

    return length, chunks()


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


# ─── backups (M3 · B4): their own bucket when there is one ──────────────────────────


def backup_bucket() -> str:
    return settings.BACKUP_S3_BUCKET or settings.S3_BUCKET


def upload_stream(key: str, stream: Any, *, bucket: str) -> None:
    """Stream a file-like object into the bucket as it is read — multipart, so a dump of
    any size goes up without being held in memory or written to disk first. Blocking:
    called from a thread."""
    _client().upload_fileobj(stream, bucket, key)


def list_objects(prefix: str, *, bucket: str) -> list[dict[str, Any]]:
    """Every object under `prefix`, as S3 describes them (`Key`, `Size`, `LastModified`).
    Blocking: called from a thread."""
    found: list[dict[str, Any]] = []
    for page in _client().get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        found.extend(page.get("Contents", []))
    return found


def remove_object(key: str, *, bucket: str) -> None:
    """Blocking: called from a thread."""
    _client().delete_object(Bucket=bucket, Key=key)


def download_to(key: str, path: str, *, bucket: str) -> None:
    """Blocking: for the backup CLI, which runs outside the event loop."""
    _client().download_file(bucket, key, path)


#: S3's smallest part other than the last. A head rewritten by `replace_head` has to be at
#: least this long, which is why the location scrub reads that much of a large file.
MIN_PART_BYTES = 5 * 1024 * 1024


async def replace_head(key: str, head: bytes, *, total: int, mime: str) -> None:
    """Rewrite the first `len(head)` bytes of an object, keeping the rest — server side.

    S3 cannot overwrite part of an object, and downloading a 90 MB photo to change a few
    bytes at its start would hold the whole thing in this process. So the object is
    rebuilt as a two-part multipart upload onto its own key: the new head uploaded, the
    unchanged tail copied by storage from the current object (`UploadPartCopy` with a
    range). Nothing past the head passes through here. The head has to be at least
    `MIN_PART_BYTES`, S3's rule for every part but the last, and shorter than the object.

    An abandoned upload is aborted, so a failure leaves the original exactly as it was.
    """
    if len(head) < MIN_PART_BYTES or len(head) >= total:
        raise ValueError("the head must be at least one part long and shorter than the object")
    client = _client()
    bucket = settings.S3_BUCKET
    created = await asyncio.to_thread(
        client.create_multipart_upload, Bucket=bucket, Key=key, ContentType=mime
    )
    upload_id = created["UploadId"]
    try:
        first = await asyncio.to_thread(
            client.upload_part,
            Bucket=bucket,
            Key=key,
            UploadId=upload_id,
            PartNumber=1,
            Body=head,
        )
        second = await asyncio.to_thread(
            client.upload_part_copy,
            Bucket=bucket,
            Key=key,
            UploadId=upload_id,
            PartNumber=2,
            CopySource={"Bucket": bucket, "Key": key},
            CopySourceRange=f"bytes={len(head)}-{total - 1}",
        )
        await asyncio.to_thread(
            client.complete_multipart_upload,
            Bucket=bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={
                "Parts": [
                    {"PartNumber": 1, "ETag": first["ETag"]},
                    {"PartNumber": 2, "ETag": second["CopyPartResult"]["ETag"]},
                ]
            },
        )
    except BaseException:
        with contextlib.suppress(Exception):
            await asyncio.to_thread(
                client.abort_multipart_upload, Bucket=bucket, Key=key, UploadId=upload_id
            )
        raise


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
