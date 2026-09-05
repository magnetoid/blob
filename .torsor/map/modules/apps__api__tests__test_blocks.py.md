---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/tests/test_blocks.py

Symbols in `apps/api/tests/test_blocks.py`.

- L43 `_resolve_the_example_host(monkeypatch: pytest.MonkeyPatch)` (function)
- L52 `test_the_vocabulary_is_closed()` (function) — A block type nobody wrote a renderer for must not reach one.
- L60 `test_unknown_keys_are_dropped_rather_than_stored()` (function) — What is stored is what the schema allows, so nothing extra reaches the renderer.
- L66 `test_an_action_id_has_to_look_like_one()` (function)
- L79 `test_action_ids_are_collected_from_every_shape()` (function)
- L99 `_bot_with_blocks(client: Client)` (function) — An app that has posted a message carrying buttons.
- L119 `test_a_bot_posts_blocks_and_they_come_back(client: Client)` (function)
- L131 `test_a_forged_action_is_refused(client: Client)` (function)
- L141 `test_a_published_action_is_accepted(client: Client)` (function)
- L150 `test_someone_who_cannot_see_the_message_cannot_press_its_buttons(client: Client)` (function) — Pressing a button requires being able to read the message it is on.
- L193 `test_a_deleted_message_takes_its_buttons_with_it(client: Client)` (function)
