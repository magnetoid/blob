"""Object storage (MinIO in dev, any S3 in prod).

Browsers upload straight to the bucket with a presigned PUT — the app never proxies file
bytes. The bucket stays private; every read is a short-lived presigned GET issued per
request.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any
from urllib.parse import quote

import boto3
from botocore.client import Config

from ..config import settings
from .ids import new_id

UPLOAD_URL_TTL_SEC = 900  # 15 minutes to start the upload
DOWNLOAD_URL_TTL_SEC = 3600

#: Images render inline; everything else downloads. Never render SVG inline.
INLINE_MIME = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"}


@lru_cache(maxsize=1)
def _client() -> Any:
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        region_name=settings.S3_REGION,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if settings.S3_FORCE_PATH_STYLE else "auto"},
        ),
    )


def is_inline_image(mime: str) -> bool:
    return mime.lower() in INLINE_MIME


def build_object_key(workspace_id: str, filename: str) -> str:
    """Server chooses keys so a client can never overwrite someone else's object."""
    now = datetime.now(UTC)
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in filename)[-120:]
    return f"{workspace_id}/{now.year}/{now.month:02d}/{new_id()}/{safe}"


def presign_upload(key: str, mime: str) -> str:
    # Presigning is local crypto, no I/O, so it is safe to call on the event loop.
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key, "ContentType": mime},
        ExpiresIn=UPLOAD_URL_TTL_SEC,
    )


def presign_download(key: str, filename: str | None = None, mime: str | None = None) -> str:
    if mime and is_inline_image(mime):
        disposition = "inline"
    else:
        safe = (filename or "file").replace('"', "")
        disposition = f'attachment; filename="{safe}"'
    return _client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.S3_BUCKET,
            "Key": key,
            "ResponseContentDisposition": disposition,
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
    await asyncio.to_thread(
        _client().delete_object, Bucket=settings.S3_BUCKET, Key=key
    )


async def put_object(key: str, body: bytes, mime: str) -> None:
    await asyncio.to_thread(
        _client().put_object, Bucket=settings.S3_BUCKET, Key=key, Body=body, ContentType=mime
    )
