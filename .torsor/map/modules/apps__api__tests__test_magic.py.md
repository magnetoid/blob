---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/tests/test_magic.py

Symbols in `apps/api/tests/test_magic.py`.

- L8 `TestSniff` (class)
- L9 `test_png_jpeg_gif_webp(self)` (method)
- L15 `test_html_and_elf_are_dangerous(self)` (method)
- L20 `TestReject` (class)
- L21 `test_a_png_that_is_png_is_fine(self)` (method)
- L24 `test_a_png_that_is_html_is_refused(self)` (method)
- L29 `test_an_executable_named_anything_is_refused(self)` (method)
- L32 `test_a_csv_without_a_signature_is_left_alone(self)` (method)
- L36 `TestAudioSignatures` (class) — A voice message is verified the way an image is: by its bytes, not its name.
- L39 `test_every_container_a_browser_records_into(self)` (method)
- L48 `test_riff_still_tells_a_wave_from_a_webp(self)` (method) — Both open `RIFF`; only the tag at offset 8 separates them.
- L54 `TestRejectAudio` (class)
- L55 `test_the_same_aac_bytes_pass_under_all_three_names(self)` (method) — Safari says `audio/mp4`, a file picker `audio/x-m4a`, something else
- L62 `test_a_voice_message_that_is_html_is_refused(self)` (method)
- L65 `test_a_claimed_audio_with_no_signature_is_refused(self)` (method) — Unlike a `.csv`, audio is verified positively — nothing else may wear the name.
- L71 `test_an_image_is_not_audio(self)` (method)
