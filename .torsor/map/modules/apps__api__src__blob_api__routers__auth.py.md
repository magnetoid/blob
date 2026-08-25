---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T03:35:16'
updated: '2026-08-25T03:35:16'
---

# apps/api/src/blob_api/routers/auth.py

Symbols in `apps/api/src/blob_api/routers/auth.py`.

- L47 `AuthStateOut` (class)
- L51 `SessionOut` (class)
- L55 `OkOut` (class)
- L59 `InviteOut` (class)
- L64 `InvitePreviewOut` (class)
- L69 `SessionRow` (class)
- L78 `SessionsOut` (class)
- L82 `_slugify(name: str)` (function)
- L88 `auth_state()` (function) — Is this a fresh install? The first person to sign up founds the workspace.
- L96 `signup(payload: SignupInput, request: Request, response: Response)` (function)
- L229 `login(payload: LoginInput, request: Request, response: Response)` (function)
- L272 `logout(request: Request, response: Response)` (function)
- L281 `logout_others(user: SessionUser=Depends(current_user))` (function)
- L287 `list_sessions(user: SessionUser=Depends(current_user))` (function)
- L318 `create_invite(request: Request, payload: CreateInviteInput | None=None, user: SessionUser=Depends(require_admin))` (function)
- L379 `preview_invite(token: str)` (function)
- L402 `forgot_password(payload: ForgotPasswordInput, request: Request)` (function)
- L439 `reset_password(payload: ResetPasswordInput, request: Request, response: Response)` (function)
