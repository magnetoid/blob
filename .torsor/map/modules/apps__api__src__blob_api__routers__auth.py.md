---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T20:31:00'
updated: '2026-08-21T20:31:00'
---

# apps/api/src/blob_api/routers/auth.py

Symbols in `apps/api/src/blob_api/routers/auth.py`.

- L46 `AuthStateOut` (class)
- L50 `SessionOut` (class)
- L54 `OkOut` (class)
- L58 `InviteOut` (class)
- L63 `InvitePreviewOut` (class)
- L68 `SessionRow` (class)
- L77 `SessionsOut` (class)
- L81 `_slugify(name: str)` (function)
- L87 `auth_state()` (function) — Is this a fresh install? The first person to sign up founds the workspace.
- L95 `signup(payload: SignupInput, request: Request, response: Response)` (function)
- L224 `login(payload: LoginInput, request: Request, response: Response)` (function)
- L254 `logout(request: Request, response: Response)` (function)
- L263 `logout_others(user: SessionUser=Depends(current_user))` (function)
- L269 `list_sessions(user: SessionUser=Depends(current_user))` (function)
- L300 `create_invite(request: Request, payload: CreateInviteInput | None=None, user: SessionUser=Depends(require_admin))` (function)
- L361 `preview_invite(token: str)` (function)
- L384 `forgot_password(payload: ForgotPasswordInput, request: Request)` (function)
- L414 `reset_password(payload: ResetPasswordInput, request: Request, response: Response)` (function)
