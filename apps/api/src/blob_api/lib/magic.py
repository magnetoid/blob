"""Sniff the first bytes of an upload so a claimed type cannot lie.

The browser PUTs straight to the bucket. The only moment this process sees those bytes
is `complete`, when it already reads the object to thumbnail an image. That is also the
moment a `shot.png` that is actually an HTML document has to be refused — the extension
check at ticket time only knew the name.
"""

from __future__ import annotations

#: How many bytes we need to tell an image from a lie. WebP's `WEBP` tag sits at offset 8.
HEAD_BYTES = 64

_IMAGE = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
}

_DANGEROUS = {
    "application/x-executable",
    "text/html",
    "image/svg+xml",
}


def sniff(header: bytes) -> str | None:
    """The type the bytes themselves are, or None when we do not have a signature."""
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith(b"GIF87a") or header.startswith(b"GIF89a"):
        return "image/gif"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp"
    if header.startswith(b"%PDF"):
        return "application/pdf"
    if header.startswith(b"\x7fELF") or header.startswith(b"MZ"):
        return "application/x-executable"
    stripped = header.lstrip()
    lower = stripped[:256].lower()
    if lower.startswith(b"<svg") or (lower.startswith(b"<?xml") and b"<svg" in lower):
        return "image/svg+xml"
    if lower.startswith(b"<!doctype html") or lower.startswith(b"<html"):
        return "text/html"
    return None


def claimed_mime(raw: str) -> str:
    return raw.lower().split(";", 1)[0].strip()


def reject_reason(header: bytes, mime: str) -> str | None:
    """Why this upload must not complete, or None when the bytes are acceptable.

    Non-images we do not have a signature for (a `.csv`, a `.docx` that is a zip) pass:
    we are not building a universal classifier. What we will not do is let a file that
    *is* HTML, SVG or an executable through because it was named `.png`, or let a claimed
    image through whose bytes are something else.
    """
    sniffed = sniff(header)
    claimed = claimed_mime(mime)
    if sniffed in _DANGEROUS:
        return "That file type cannot be shared here."
    if claimed in _IMAGE:
        if sniffed is None or sniffed not in _IMAGE:
            return "That file is not the image it says it is."
        if sniffed != claimed:
            return "That file is not the image it says it is."
    return None
