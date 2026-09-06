---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-07T00:07:28'
updated: '2026-09-07T00:07:28'
---

# apps/api/tests/test_thumbnails.py

Symbols in `apps/api/tests/test_thumbnails.py`.

- L23 `a_png(width: int=1600, height: int=900, mode: str='RGB')` (function)
- L30 `a_jpeg_rotated()` (function) — A landscape JPEG that says "I am portrait, rotate me" — an ordinary phone photo.
- L41 `TestMakingOne` (class)
- L42 `test_it_shrinks_to_the_long_edge_and_keeps_the_shape(self)` (method)
- L52 `test_a_photo_that_says_rotate_me_comes_out_upright_and_anonymous(self)` (method)
- L62 `test_transparency_survives(self)` (method)
- L69 `test_rubbish_is_not_an_error(self)` (method)
- L73 `test_what_it_will_even_try(self)` (method)
- L81 `test_the_key_is_derived_from_the_original(self)` (method)
- L85 `storage_is_up()` (function)
- L94 `team(client: Client)` (function)
- L104 `upload(who: Client, data: bytes, *, filename: str='shot.png', mime: str='image/png')` (function) — The three steps a browser takes: ticket, PUT, complete.
- L125 `attachment_row(attachment_id: str)` (function)
- L135 `TestThroughTheUploadPath` (class)
- L136 `test_completing_an_image_upload_leaves_a_thumbnail_behind(self, team: dict[str, Any])` (method)
- L151 `test_the_message_carries_the_thumbnail_url(self, team: dict[str, Any])` (method)
- L161 `test_a_thumbnail_answers_to_the_same_rule_as_its_original(self, team: dict[str, Any])` (method)
- L182 `test_a_file_that_is_not_an_image_gets_no_thumbnail_and_still_works(self, team: dict[str, Any])` (method)
- L198 `test_something_that_claims_to_be_an_image_and_is_not(self, team: dict[str, Any])` (method)
