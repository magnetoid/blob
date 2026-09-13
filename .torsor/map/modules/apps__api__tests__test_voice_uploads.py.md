---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-13T23:52:37'
updated: '2026-09-13T23:52:37'
---

# apps/api/tests/test_voice_uploads.py

Symbols in `apps/api/tests/test_voice_uploads.py`.

- L33 `team(client: Client)` (function)
- L53 `audio_arrives(monkeypatch: pytest.MonkeyPatch)` (function) — `complete` reads the first bytes back to check the type. Say they are webm.
- L67 `_ticket(client: Client, **overrides: Any)` (function)
- L78 `_row(attachment_id: str)` (function)
- L91 `_plant_voice(workspace_id: str, uploader_id: str, *, message_id: str | None=None)` (function)
- L118 `TestTheTicket` (class)
- L119 `test_a_voice_ticket_refuses_a_type_that_is_not_audio(self, team: dict)` (method)
- L124 `test_it_stores_the_bare_mime_and_the_kind(self, team: dict)` (method) — `audio/webm;codecs=opus` is what MediaRecorder reports and what the browser
- L136 `test_an_ordinary_file_ticket_is_unchanged(self, team: dict)` (method)
- L144 `TestCompletion` (class)
- L145 `test_it_records_the_length_and_the_bars(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L160 `test_a_voice_message_without_a_length_is_refused(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L169 `test_a_bar_outside_a_byte_is_refused(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L181 `test_a_recording_that_is_not_audio_is_refused(self, team: dict, monkeypatch: pytest.MonkeyPatch)` (method)
- L200 `TestWhatTheClientSees` (class)
- L201 `test_the_message_carries_the_kind_length_and_bars(self, team: dict)` (method)
- L214 `test_the_files_tab_lists_voice_apart_from_files(self, team: dict)` (method)
- L227 `test_an_unknown_kind_is_refused(self, team: dict)` (method)
- L231 `TestPlayback` (class)
- L232 `test_a_voice_message_is_served_inline_as_its_own_type(self, team: dict)` (method) — Without this an `<audio src>` downloads the file instead of playing it.
- L246 `test_an_ordinary_audio_file_still_downloads(self, team: dict)` (method) — The same bytes attached as a file, not recorded as a voice message. Serving
- L271 `test_an_outsider_cannot_hear_a_private_channels_voice_note(self, team: dict)` (method)
- L276 `test_a_voice_message_cannot_become_a_profile_picture(self, team: dict)` (method) — The avatar branch asks the *image* allowlist, which is why audio has its own.
