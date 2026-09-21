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


class TestAudioSignatures:
    """A voice message is verified the way an image is: by its bytes, not its name."""

    def test_every_container_a_browser_records_into(self) -> None:
        assert magic.sniff(b"OggS\x00\x02\x00\x00") == "audio/ogg"
        assert magic.sniff(b"\x1a\x45\xdf\xa3\x01\x00\x00\x00") == "audio/webm"
        assert magic.sniff(b"\x00\x00\x00\x18ftypM4A \x00\x00") == "audio/mp4"
        assert magic.sniff(b"RIFF\x24\x08\x00\x00WAVEfmt ") == "audio/wav"
        assert magic.sniff(b"ID3\x04\x00\x00\x00") == "audio/mpeg"
        assert magic.sniff(b"\xff\xfb\x90\x00") == "audio/mpeg"
        assert magic.sniff(b"\xff\xf1\x50\x80") == "audio/aac"

    def test_riff_still_tells_a_wave_from_a_webp(self) -> None:
        """Both open `RIFF`; only the tag at offset 8 separates them."""
        assert magic.sniff(b"RIFF\x24\x08\x00\x00WEBPVP8 ") == "image/webp"
        assert magic.sniff(b"RIFF\x24\x08\x00\x00WAVEfmt ") == "audio/wav"


class TestRejectAudio:
    def test_the_same_aac_bytes_pass_under_all_three_names(self) -> None:
        """Safari says `audio/mp4`, a file picker `audio/x-m4a`, something else
        `audio/aac`. Matching the sniffed type exactly would refuse real recordings."""
        head = b"\x00\x00\x00\x18ftypM4A \x00\x00"
        for claimed in ("audio/mp4", "audio/x-m4a", "audio/aac"):
            assert magic.reject_reason(head, claimed) is None, claimed

    def test_a_voice_message_that_is_html_is_refused(self) -> None:
        assert magic.reject_reason(b"<!DOCTYPE html><html>", "audio/webm") is not None

    def test_a_claimed_audio_with_no_signature_is_refused(self) -> None:
        """Unlike a `.csv`, audio is verified positively — nothing else may wear the name."""
        reason = magic.reject_reason(b"name,count\nana,1\n", "audio/mpeg")
        assert reason is not None
        assert "audio" in reason.lower()

    def test_an_image_is_not_audio(self) -> None:
        assert magic.reject_reason(b"\x89PNG\r\n\x1a\nxxxx", "audio/webm") is not None


class TestHonestPages:
    """An HTML page or an SVG that says what it is may be shared; one in disguise may not.

    They were refused outright while nothing could show them safely. Storage serves every
    type that is not an allowlisted image as a download of octet-stream, and the preview
    renders a page only inside the no-network sandbox, so the refusal now guards against
    the disguise — which is what it was written to stop — and not against the page.
    """

    def test_an_html_page_that_says_so_is_fine(self) -> None:
        assert magic.reject_reason(b"<!doctype html><html><body>", "text/html") is None

    def test_an_svg_that_says_so_is_fine(self) -> None:
        head = b'<svg xmlns="http://www.w3.org/2000/svg" width="10">'
        assert magic.reject_reason(head, "image/svg+xml") is None

    def test_html_wearing_another_type_is_still_refused(self) -> None:
        for claimed in ("text/plain", "application/pdf", "image/svg+xml"):
            assert magic.reject_reason(b"<!doctype html><html>", claimed) is not None, claimed

    def test_an_svg_wearing_another_type_is_still_refused(self) -> None:
        head = b'<svg xmlns="http://www.w3.org/2000/svg">'
        for claimed in ("text/plain", "text/html", "image/png"):
            assert magic.reject_reason(head, claimed) is not None, claimed

    def test_an_executable_is_refused_whatever_it_claims(self) -> None:
        for claimed in ("text/html", "image/svg+xml", "application/octet-stream"):
            assert magic.reject_reason(b"MZ\x90\x00", claimed) is not None, claimed


class TestBlockedExtensions:
    def test_programs_are_refused_by_name(self) -> None:
        for name in ("setup.exe", "run.sh", "x.PS1", "app.jar"):
            assert magic.blocked_extension(name) is not None, name

    def test_pages_and_pictures_are_not(self) -> None:
        for name in ("index.html", "page.htm", "logo.svg", "notes.md", "README"):
            assert magic.blocked_extension(name) is None, name
