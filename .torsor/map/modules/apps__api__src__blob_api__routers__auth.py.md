---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T03:48:04'
updated: '2026-08-21T03:48:04'
---

# apps/api/src/blob_api/routers/auth.py

Symbols in `apps/api/src/blob_api/routers/auth.py`.

- L44 `AuthStateOut` (class)
- L48 `SessionOut` (class)
- L52 `OkOut` (class)
- L56 `InviteOut` (class)
- L61 `InvitePreviewOut` (class)
- L66 `SessionRow` (class)
- L75 `SessionsOut` (class)
- L79 `_slugify(name: str)` (function)
- L85 `auth_state()` (function) — Is this a fresh install? The first person to sign up founds the workspace.
- L93 `signup(payload: SignupInput, request: Request, response: Response)` (function)
- L222 `login(payload: LoginInput, request: Request, response: Response)` (function)
- L252 `logout(request: Request, response: Response)` (function)
- L261 `logout_others(user: SessionUser=Depends(current_user))` (function)
- L267 `list_sessions(user: SessionUser=Depends(current_user))` (function)
- L298 `create_invite(payload: CreateInviteInput | None=None, user: SessionUser=Depends(require_admin))` (function)
- L347 `preview_invite(token: str)` (function)
- L370 `forgot_password(payload: ForgotPasswordInput, request: Request)` (function)
- L400 `reset_password(payload: ResetPasswordInput, request: Request, response: Response)` (function)
