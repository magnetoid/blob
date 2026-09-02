---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:36:30'
updated: '2026-09-02T05:36:30'
---

# apps/api/src/blob_api/plugins/blocks.py

Symbols in `apps/api/src/blob_api/plugins/blocks.py`.

- L33 `TextSpan` (class) — Text inside a block.
- L45 `SectionBlock` (class)
- L50 `FieldsBlock` (class) — Two-column key/value pairs — a build result, a deploy summary.
- L57 `DividerBlock` (class)
- L61 `ContextBlock` (class) — Small print: who triggered this, when, from where.
- L68 `ImageBlock` (class)
- L77 `_stays_on_this_workspace(cls, value: str)` (method) — The comment above was the whole enforcement, which is to say there was none.
- L94 `ButtonElement` (class)
- L102 `SelectOption` (class)
- L107 `SelectElement` (class)
- L117 `ActionsBlock` (class)
- L122 `InputBlock` (class) — A labelled single-line input. Submitted by the action beside it.
- L143 `validate_blocks(raw: list[dict[str, object]] | None)` (function) — Parse and re-serialize, so what is stored is what the schema allows.
- L175 `collect_action_ids(blocks: list[Block])` (function)
- L185 `action_ids_of(raw: list[dict[str, object]] | None)` (function) — The ids a stored message actually published. The whole interaction check.
