---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/src/blob_api/plugins/blocks.py

Symbols in `apps/api/src/blob_api/plugins/blocks.py`.

- L36 `TextSpan` (class) — Text inside a block.
- L48 `SectionBlock` (class)
- L53 `FieldsBlock` (class) — Two-column key/value pairs — a build result, a deploy summary.
- L60 `DividerBlock` (class)
- L64 `ContextBlock` (class) — Small print: who triggered this, when, from where.
- L71 `ImageBlock` (class)
- L80 `_stays_on_this_workspace(cls, value: str)` (method) — The comment above was the whole enforcement, which is to say there was none.
- L97 `ButtonElement` (class)
- L105 `SelectOption` (class)
- L110 `SelectElement` (class)
- L120 `ActionsBlock` (class)
- L125 `InputBlock` (class) — A labelled single-line input. Submitted by the action beside it.
- L146 `validate_blocks(raw: list[dict[str, object]] | None)` (function) — Parse and re-serialize, so what is stored is what the schema allows.
- L178 `collect_action_ids(blocks: list[Block])` (function)
- L188 `action_ids_of(raw: list[dict[str, object]] | None)` (function) — The ids a stored message actually published. The whole interaction check.
- L214 `_action_ids_from_raw(raw: list[dict[str, object]])` (function) — The same answer, without the models. Shapes it does not recognise contribute none.
