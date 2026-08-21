---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T07:49:12'
updated: '2026-08-21T07:49:12'
---

# apps/api/src/blob_api/plugins/blocks.py

Symbols in `apps/api/src/blob_api/plugins/blocks.py`.

- L33 `TextSpan` (class) — Text inside a block.
- L45 `SectionBlock` (class)
- L50 `FieldsBlock` (class) — Two-column key/value pairs — a build result, a deploy summary.
- L57 `DividerBlock` (class)
- L61 `ContextBlock` (class) — Small print: who triggered this, when, from where.
- L68 `ImageBlock` (class)
- L76 `ButtonElement` (class)
- L84 `SelectOption` (class)
- L89 `SelectElement` (class)
- L99 `ActionsBlock` (class)
- L104 `InputBlock` (class) — A labelled single-line input. Submitted by the action beside it.
- L125 `validate_blocks(raw: list[dict[str, object]] | None)` (function) — Parse and re-serialize, so what is stored is what the schema allows.
- L157 `collect_action_ids(blocks: list[Block])` (function)
- L167 `action_ids_of(raw: list[dict[str, object]] | None)` (function) — The ids a stored message actually published. The whole interaction check.
