---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T03:38:17'
updated: '2026-08-27T03:38:17'
---

# apps/api/src/blob_api/routers/admin_emoji.py

Symbols in `apps/api/src/blob_api/routers/admin_emoji.py`.

- L30 `OkOut` (class)
- L34 `CustomEmojiOut` (class)
- L41 `CustomEmojiListOut` (class)
- L45 `AddEmojiInput` (class)
- L53 `list_custom_emoji(admin: SessionUser=Depends(require_admin))` (function)
- L84 `add_custom_emoji(payload: AddEmojiInput, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Name an uploaded image so `:name:` resolves to it.
- L158 `remove_custom_emoji(name: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Take a name out of circulation.
