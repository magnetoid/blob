---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/admin_emoji.py

Symbols in `apps/api/src/blob_api/routers/admin_emoji.py`.

- L30 `CustomEmojiOut` (class)
- L37 `CustomEmojiListOut` (class)
- L41 `AddEmojiInput` (class)
- L49 `list_custom_emoji(admin: SessionUser=Depends(require_admin))` (function)
- L67 `add_custom_emoji(payload: AddEmojiInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Name an uploaded image so `:name:` resolves to it.
- L105 `remove_custom_emoji(name: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Take a name out of circulation.
