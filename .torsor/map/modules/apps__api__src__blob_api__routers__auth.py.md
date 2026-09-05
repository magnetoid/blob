---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
---

# apps/api/src/blob_api/routers/auth.py

Symbols in `apps/api/src/blob_api/routers/auth.py`.

- L49 `AuthStateOut` (class)
- L53 `SessionOut` (class)
- L57 `OkOut` (class)
- L61 `InviteOut` (class)
- L66 `InvitePreviewOut` (class)
- L71 `SessionRow` (class)
- L80 `SessionsOut` (class)
- L84 `_slugify(name: str)` (function)
- L90 `auth_state()` (function) — Is this a fresh install? The first person to sign up founds the workspace.
- L98 `signup(payload: SignupInput, request: Request, response: Response)` (function)
- L270 `login(payload: LoginInput, request: Request, response: Response)` (function)
- L313 `logout(request: Request, response: Response)` (function)
- L322 `logout_others(user: SessionUser=Depends(current_user))` (function)
- L338 `list_sessions(user: SessionUser=Depends(current_user))` (function)
- L369 `create_invite(request: Request, payload: CreateInviteInput | None=None, user: SessionUser=Depends(require_admin))` (function)
- L430 `preview_invite(token: str)` (function)
- L454 `forgot_password(payload: ForgotPasswordInput, request: Request)` (function)
- L491 `reset_password(payload: ResetPasswordInput, request: Request, response: Response)` (function)
