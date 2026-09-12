---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/routers/auth.py

Symbols in `apps/api/src/blob_api/routers/auth.py`.

- L51 `AuthStateOut` (class)
- L55 `SessionOut` (class)
- L59 `OkOut` (class)
- L63 `ForgotOut` (class)
- L69 `InviteOut` (class)
- L78 `InvitePreviewOut` (class)
- L83 `SessionRow` (class)
- L92 `SessionsOut` (class)
- L96 `_slugify(name: str)` (function)
- L102 `auth_state()` (function) — Is this a fresh install? The first person to sign up founds the workspace.
- L110 `signup(payload: SignupInput, request: Request, response: Response)` (function)
- L282 `login(payload: LoginInput, request: Request, response: Response)` (function)
- L325 `logout(request: Request, response: Response)` (function)
- L334 `logout_others(user: SessionUser=Depends(current_user))` (function)
- L361 `list_sessions(user: SessionUser=Depends(current_user))` (function)
- L392 `create_invite(request: Request, payload: CreateInviteInput | None=None, user: SessionUser=Depends(require_admin))` (function)
- L454 `preview_invite(token: str)` (function)
- L478 `forgot_password(payload: ForgotPasswordInput, request: Request)` (function)
- L519 `reset_password(payload: ResetPasswordInput, request: Request, response: Response)` (function)
