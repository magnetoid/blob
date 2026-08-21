---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T22:18:43'
updated: '2026-08-21T22:18:43'
---

# apps/api/src/blob_api/lib/mentions.py

Symbols in `apps/api/src/blob_api/lib/mentions.py`.

- L25 `MentionResult` (class)
- L34 `strip_code(body: str)` (function) — Remove fenced blocks and inline code so their contents never mention anyone.
- L39 `parse_mentions(body: str, name_to_id: dict[str, str])` (function) — Extract mentions from raw markdown.
- L75 `matches_keywords(body: str, keywords: list[str])` (function) — Does this message body hit any of the user's keyword alerts?
