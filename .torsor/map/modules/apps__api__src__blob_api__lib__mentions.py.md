---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-01T22:51:51'
updated: '2026-09-01T22:51:51'
---

# apps/api/src/blob_api/lib/mentions.py

Symbols in `apps/api/src/blob_api/lib/mentions.py`.

- L34 `MentionResult` (class)
- L46 `strip_code(body: str)` (function) — Remove fenced blocks and inline code so their contents never mention anyone.
- L51 `_simple_lower(value: str)` (function) — Lowercase one character to one character, the way Postgres does.
- L64 `mention_lookup_phrases(body: str)` (function) — Display-name phrases worth resolving against the database, lowercased.
- L94 `parse_mentions(body: str, targets: dict[str, MentionTarget])` (function) — Extract mentions from raw markdown.
- L152 `matches_keywords(body: str, keywords: list[str])` (function) — Does this message body hit any of the user's keyword alerts?
