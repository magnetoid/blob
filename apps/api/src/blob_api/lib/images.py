"""Thumbnails, and the two things a photograph carries that a chat app should not.

`attachments.thumb_key` has existed since the first migration and nothing ever wrote it,
so every image in a channel was the *original* — the client scales a 12-megapixel phone
photo down to 360px with CSS after downloading all eight megabytes of it, once per person
per visit. A timeline with twenty screenshots in it was tens of megabytes of traffic to
draw a column of small pictures.

Two things come off in the making. **Orientation**: a phone photo is stored landscape
with an EXIF tag saying "rotate me", and a naive resize bakes in the wrong one, so the
thumbnail is sideways while the original is not. `exif_transpose` applies the rotation to
the pixels first. **Everything else in the metadata**: a re-encode keeps no EXIF unless
asked, so the GPS coordinates, the camera serial and the timestamp in somebody's holiday
photo do not travel with the version that renders in the channel. The original keeps its
own — it is what they uploaded — but the copy the room actually looks at is clean.

WebP because it is half the bytes of JPEG at the same quality, every browser this app
supports reads it, and it keeps transparency, which a screenshot of a UI usually has.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

log = logging.getLogger("blob.images")

#: The longest edge of a thumbnail. The client caps display at 360x320 and doubles it on
#: a retina screen, so this is that with room to spare and no more.
MAX_EDGE = 800

#: Bigger than this and we do not decode it at all. A decompression bomb is a small file
#: that becomes a huge bitmap; Pillow's own pixel limit catches that, and this catches
#: the ordinary case of somebody attaching a RAW file.
MAX_SOURCE_BYTES = 30 * 1024 * 1024

#: Pillow refuses an image with more pixels than this rather than allocating for it.
MAX_PIXELS = 50_000_000

THUMB_MIME = "image/webp"
THUMB_QUALITY = 82

#: What we will decode. Anything else keeps its original and no thumbnail — including
#: SVG, which the uploader refuses outright for being scriptable.
DECODABLE = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/tiff"}


@dataclass(slots=True)
class Rendered:
    """A thumbnail, and the true size of what it was made from."""

    thumb: bytes
    thumb_mime: str
    #: The original's dimensions *after* orientation is applied, which is what a client
    #: needs to reserve the right box before the bytes arrive.
    width: int
    height: int


def can_thumbnail(mime: str, size_bytes: int) -> bool:
    return mime.lower() in DECODABLE and 0 < size_bytes <= MAX_SOURCE_BYTES


def render(data: bytes) -> Rendered | None:
    """A thumbnail for `data`, or None if it is not an image we can read.

    Never raises: an attachment whose thumbnail cannot be made is still an attachment,
    and a corrupt PNG is not a reason to fail somebody's upload.
    """
    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(io.BytesIO(data)) as source:
            # Applies the EXIF rotation to the pixels and drops the tag with it, so the
            # thumbnail is the right way up wherever it is drawn.
            upright = ImageOps.exif_transpose(source) or source
            width, height = upright.size
            # An animated GIF thumbnails to its first frame: a still is what a 200px
            # preview is for, and re-encoding the animation costs more than the original.
            if upright.mode not in ("RGB", "RGBA"):
                upright = upright.convert("RGBA" if "A" in upright.getbands() else "RGB")
            upright.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            # `save` writes no EXIF unless handed some, so the copy carries none.
            upright.save(buffer, format="WEBP", quality=THUMB_QUALITY, method=4)
            return Rendered(
                thumb=buffer.getvalue(), thumb_mime=THUMB_MIME, width=width, height=height
            )
    except (UnidentifiedImageError, OSError, ValueError, MemoryError) as error:
        log.info("no thumbnail for this upload: %s", error)
        return None
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit


def thumb_key_for(object_key: str) -> str:
    """Derived, not stored twice: the thumbnail lives beside the original."""
    return f"{object_key}.thumb.webp"


__all__ = [
    "MAX_EDGE",
    "MAX_SOURCE_BYTES",
    "THUMB_MIME",
    "Rendered",
    "can_thumbnail",
    "render",
    "thumb_key_for",
]
