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
photo do not travel with the version that renders in the channel.

The original keeps its metadata — it is what they uploaded — **except where it was
taken**. A phone writes the GPS position into every photo, and "Download" hands the
original to everyone in the room, so a picture of a whiteboard used to carry the
coordinates of somebody's kitchen table to the whole channel. `without_location` blanks
the GPS fields and any XMP copy of them in place: same length, same pixels, orientation
and everything else untouched, so the size the upload was signed for still holds and the
photo opens the right way up. Only JPEG — what phone cameras write; HEIC is not decoded
here at all and keeps its own.

WebP because it is half the bytes of JPEG at the same quality, every browser this app
supports reads it, and it keeps transparency, which a screenshot of a UI usually has.
"""

from __future__ import annotations

import io
import logging
import re
import struct
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


#: Bytes per value of each TIFF field type (TIFF 6.0 §2), indexed by type id.
_TIFF_TYPE_SIZE = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4}
_GPS_IFD_TAG = 0x8825
_EXIF_HEADER = b"Exif\x00\x00"
_XMP_HEADER = b"http://ns.adobe.com/xap/1.0/\x00"
#: `exif:GPSLatitude="44,49.2N"` and `<exif:GPSLatitude>44,49.2N</exif:GPSLatitude>`.
_XMP_GPS_ATTR = re.compile(rb'((?:exif|exifEX):GPS\w+=")([^"]*)(")')
_XMP_GPS_ELEM = re.compile(rb"(<((?:exif|exifEX):GPS\w+)>)([^<]*)(</\2>)")


def without_location(data: bytes) -> bytes | None:
    """`data` with its GPS position blanked, or None when there was none to blank.

    In place and length-preserving: the GPS directory is emptied and every byte of its
    values zeroed, and an XMP packet's GPS values become spaces. Nothing is re-encoded,
    so the pixels are the uploader's exactly. None also when the file is not a JPEG or
    does not parse the way one should — a scrub that cannot be sure of its offsets must
    not write zeros somewhere they do not belong, and the caller keeps the original.
    """
    if not data.startswith(b"\xff\xd8"):
        return None
    out = bytearray(data)
    changed = False
    pos = 2
    try:
        while pos + 4 <= len(out):
            if out[pos] != 0xFF:
                return None
            marker = out[pos + 1]
            if marker == 0xFF:  # fill byte before a marker
                pos += 1
                continue
            if marker in (0xD9, 0xDA):  # end of image, or the scan: no metadata after it
                break
            if 0xD0 <= marker <= 0xD7 or marker == 0x01:  # markers with no length
                pos += 2
                continue
            length = struct.unpack(">H", out[pos + 2 : pos + 4])[0]
            start, end = pos + 4, pos + 2 + length
            if length < 2 or end > len(out):
                return None
            if marker == 0xE1:
                payload = bytes(out[start:end])
                if payload.startswith(_EXIF_HEADER):
                    changed |= _blank_gps_ifd(out, start + len(_EXIF_HEADER), end)
                elif payload.startswith(_XMP_HEADER):
                    changed |= _blank_xmp_gps(out, start, end)
            pos = end
    except (struct.error, IndexError, ValueError):
        return None
    return bytes(out) if changed else None


def _blank_gps_ifd(out: bytearray, tiff: int, limit: int) -> bool:
    """Empty the GPS directory of the TIFF block starting at `tiff`. True if it had any."""
    order = bytes(out[tiff : tiff + 2])
    if order == b"II":
        fmt = "<"
    elif order == b"MM":
        fmt = ">"
    else:
        raise ValueError("not a TIFF header")

    def u16(at: int) -> int:
        if at + 2 > limit:
            raise ValueError("past the segment")
        return int(struct.unpack(fmt + "H", out[at : at + 2])[0])

    def u32(at: int) -> int:
        if at + 4 > limit:
            raise ValueError("past the segment")
        return int(struct.unpack(fmt + "I", out[at : at + 4])[0])

    ifd0 = tiff + u32(tiff + 4)
    gps_offset = None
    for i in range(u16(ifd0)):
        entry = ifd0 + 2 + i * 12
        if u16(entry) == _GPS_IFD_TAG:
            gps_offset = u32(entry + 8)
            break
    if gps_offset is None:
        return False

    gps = tiff + gps_offset
    count = u16(gps)
    if count == 0:
        return False
    for i in range(count):
        entry = gps + 2 + i * 12
        kind, n = u16(entry + 2), u32(entry + 4)
        size = _TIFF_TYPE_SIZE.get(kind, 1) * n
        if size > 4:  # stored out of line, at an offset from the TIFF header
            value = tiff + u32(entry + 8)
            if value + size > limit:
                raise ValueError("value past the segment")
            out[value : value + size] = bytes(size)
    # The entries themselves, then a count of zero: an empty directory is a valid one,
    # so the pointer in IFD0 can stay and no reader trips over a dangling offset.
    entries_end = gps + 2 + count * 12
    if entries_end > limit:
        raise ValueError("directory past the segment")
    out[gps + 2 : entries_end] = bytes(count * 12)
    out[gps : gps + 2] = struct.pack(fmt + "H", 0)
    return True


def _blank_xmp_gps(out: bytearray, start: int, end: int) -> bool:
    """Replace the values of XMP's GPS properties with spaces of the same length."""
    packet = bytes(out[start:end])
    cleaned = _XMP_GPS_ATTR.sub(lambda m: m[1] + b" " * len(m[2]) + m[3], packet)
    cleaned = _XMP_GPS_ELEM.sub(lambda m: m[1] + b" " * len(m[3]) + m[4], cleaned)
    if cleaned == packet:
        return False
    out[start:end] = cleaned
    return True


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
    "without_location",
]
