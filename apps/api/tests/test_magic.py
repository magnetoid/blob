"""The first bytes of a file decide whether it may complete, not the name it arrived with."""

from __future__ import annotations

from blob_api.lib import magic


class TestSniff:
    def test_png_jpeg_gif_webp(self) -> None:
        assert magic.sniff(b"\x89PNG\r\n\x1a\n" + b"\x00" * 8) == "image/png"
        assert magic.sniff(b"\xff\xd8\xff\xe0") == "image/jpeg"
        assert magic.sniff(b"GIF89a....") == "image/gif"
        assert magic.sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"

    def test_html_and_elf_are_dangerous(self) -> None:
        assert magic.sniff(b"<!DOCTYPE html><html>") == "text/html"
        assert magic.sniff(b"\x7fELF\x02\x01") == "application/x-executable"


class TestReject:
    def test_a_png_that_is_png_is_fine(self) -> None:
        assert magic.reject_reason(b"\x89PNG\r\n\x1a\nxxxx", "image/png") is None

    def test_a_png_that_is_html_is_refused(self) -> None:
        reason = magic.reject_reason(b"<!DOCTYPE html>", "image/png")
        assert reason is not None
        assert "image" in reason.lower() or "type" in reason.lower()

    def test_an_executable_named_anything_is_refused(self) -> None:
        assert magic.reject_reason(b"MZ\x90\x00", "application/octet-stream") is not None

    def test_a_csv_without_a_signature_is_left_alone(self) -> None:
        assert magic.reject_reason(b"name,count\nana,1\n", "text/csv") is None
