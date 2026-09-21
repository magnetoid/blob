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

#: The containers a browser records a voice message into, under every name they arrive
#: as. Safari records `audio/mp4`, Chrome `audio/webm`, Firefox `audio/ogg`; the same AAC
#: bytes reach us as `audio/mp4`, `audio/x-m4a` or `audio/aac` depending on the client.
#: Verified as a *family* rather than exactly, for that reason — see `reject_reason`.
_AUDIO = {
    "audio/webm",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/ogg",
    "audio/mpeg",
    "audio/wav",
}

#: What a voice ticket may claim. The router checks this before presigning, so a claimed
#: type that is not audio never gets an upload URL at all.
AUDIO_MIME = frozenset(_AUDIO)

_EXECUTABLE = "application/x-executable"

#: Scriptable documents, and the only names each may travel under. An HTML page or an
#: SVG that says what it is may be shared: storage serves neither inline (see
#: `lib/storage.presign_download`) and the preview shows them only in the no-network
#: sandbox. One wearing another type is the disguise this module exists to catch.
_HONEST = {
    "text/html": frozenset({"text/html", "application/xhtml+xml"}),
    "image/svg+xml": frozenset({"image/svg+xml"}),
}

#: Extensions refused by name, whatever the bytes: programs a double-click would run.
#: HTML and SVG were here too until something could show them safely.
BLOCKED_EXTENSIONS = frozenset(
    {"exe", "msi", "bat", "cmd", "com", "scr", "ps1", "sh", "app", "jar"}
)


def blocked_extension(filename: str) -> str | None:
    """The extension that rules this file out, or None when its name is acceptable."""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return extension if extension in BLOCKED_EXTENSIONS else None


def sniff(header: bytes) -> str | None:
    """The type the bytes themselves are, or None when we do not have a signature."""
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith(b"GIF87a") or header.startswith(b"GIF89a"):
        return "image/gif"
    if header.startswith(b"RIFF") and header[8:12] == b"WAVE":
        return "audio/wav"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp"
    if header.startswith(b"OggS"):
        return "audio/ogg"
    # Matroska/WebM's EBML header. A `.webm` is one container for both, so the bytes
    # cannot say whether there is video in it; a voice ticket is what says it is audio.
    if header.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    # ISO base media: the box length comes first, so the brand sits at 4.
    if header[4:8] == b"ftyp":
        return "audio/mp4"
    if header.startswith(b"ID3") or header[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}:
        return "audio/mpeg"
    if header[:2] in {b"\xff\xf1", b"\xff\xf9"}:
        return "audio/aac"
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
    we are not building a universal classifier. What we will not do is let an executable
    through under any name, let a file that *is* HTML or SVG through under a name other
    than its own, or let a claimed image through whose bytes are something else.
    """
    sniffed = sniff(header)
    claimed = claimed_mime(mime)
    if sniffed == _EXECUTABLE:
        return "That file type cannot be shared here."
    if claimed in _IMAGE:
        if sniffed is None or sniffed not in _IMAGE:
            return "That file is not the image it says it is."
        if sniffed != claimed:
            return "That file is not the image it says it is."
    if claimed in _AUDIO:
        # By family, not exactly. AAC in an MP4 box arrives as `audio/mp4` from Safari,
        # `audio/x-m4a` from a file picker and `audio/aac` from somewhere else, and all
        # three sniff as `audio/mp4`; matching exactly would refuse real recordings.
        # Audio is not scriptable, so the claim only decides the Content-Type we echo.
        if sniffed is None or sniffed not in _AUDIO:
            return "That file is not the audio it says it is."
    if sniffed in _HONEST and claimed not in _HONEST[sniffed]:
        return "That file's type is not what it says it is."
    return None
