---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/lib/jsonpatch.py

Symbols in `apps/api/src/blob_api/lib/jsonpatch.py`.

- L21 `PatchError` (class) — The patch could not be applied as a whole.
- L25 `apply(document: Any, operations: Sequence[Mapping[str, Any]])` (function) — Return a new document with every operation applied, or raise `PatchError`.
- L60 `_value_of(operation: Mapping[str, Any], index: int)` (function)
- L66 `_from_of(operation: Mapping[str, Any], index: int)` (function)
- L73 `_tokens(pointer: str)` (function) — RFC 6901: '' is the whole document; otherwise '/'-separated, ~1 → /, ~0 → ~.
- L82 `_index(container: list[Any], token: str, *, allow_end: bool)` (function)
- L94 `_get(document: Any, tokens: list[str])` (function)
- L108 `_add(document: Any, tokens: list[str], value: Any)` (function)
- L122 `_remove(document: Any, tokens: list[str])` (function)
