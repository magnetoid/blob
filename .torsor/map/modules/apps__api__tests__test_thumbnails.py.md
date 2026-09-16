---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/tests/test_thumbnails.py

Symbols in `apps/api/tests/test_thumbnails.py`.

- L24 `a_png(width: int=1600, height: int=900, mode: str='RGB')` (function)
- L31 `a_jpeg_rotated()` (function) — A landscape JPEG that says "I am portrait, rotate me" — an ordinary phone photo.
- L42 `TestMakingOne` (class)
- L43 `test_it_shrinks_to_the_long_edge_and_keeps_the_shape(self)` (method)
- L53 `test_a_photo_that_says_rotate_me_comes_out_upright_and_anonymous(self)` (method)
- L63 `test_transparency_survives(self)` (method)
- L70 `test_rubbish_is_not_an_error(self)` (method)
- L74 `test_what_it_will_even_try(self)` (method)
- L82 `test_the_key_is_derived_from_the_original(self)` (method)
- L86 `storage_is_up()` (function) — Ask the bucket directly, not through `ensure_bucket`.
- L108 `team(client: Client)` (function)
- L118 `upload(who: Client, data: bytes, *, filename: str='shot.png', mime: str='image/png')` (function) — The three steps a browser takes: ticket, PUT, complete.
- L139 `attachment_row(attachment_id: str)` (function)
- L149 `TestThroughTheUploadPath` (class)
- L150 `test_completing_an_image_upload_leaves_a_thumbnail_behind(self, team: dict[str, Any])` (method)
- L165 `test_the_message_carries_the_thumbnail_url(self, team: dict[str, Any])` (method)
- L175 `test_a_thumbnail_answers_to_the_same_rule_as_its_original(self, team: dict[str, Any])` (method)
- L196 `test_a_file_that_is_not_an_image_gets_no_thumbnail_and_still_works(self, team: dict[str, Any])` (method)
- L212 `test_something_that_claims_to_be_an_image_and_is_not(self, team: dict[str, Any])` (method) — Used to complete anyway and just skip the thumbnail. Now the lie is refused.
