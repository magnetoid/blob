---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T18:21:59'
updated: '2026-09-06T18:21:59'
---

# apps/api/src/blob_api/routers/auth.py

Symbols in `apps/api/src/blob_api/routers/auth.py`.

- L50 `AuthStateOut` (class)
- L54 `SessionOut` (class)
- L58 `OkOut` (class)
- L62 `ForgotOut` (class)
- L68 `InviteOut` (class)
- L77 `InvitePreviewOut` (class)
- L82 `SessionRow` (class)
- L91 `SessionsOut` (class)
- L95 `_slugify(name: str)` (function)
- L101 `auth_state()` (function) — Is this a fresh install? The first person to sign up founds the workspace.
- L109 `signup(payload: SignupInput, request: Request, response: Response)` (function)
- L281 `login(payload: LoginInput, request: Request, response: Response)` (function)
- L324 `logout(request: Request, response: Response)` (function)
- L333 `logout_others(user: SessionUser=Depends(current_user))` (function)
- L349 `list_sessions(user: SessionUser=Depends(current_user))` (function)
- L380 `create_invite(request: Request, payload: CreateInviteInput | None=None, user: SessionUser=Depends(require_admin))` (function)
- L442 `preview_invite(token: str)` (function)
- L466 `forgot_password(payload: ForgotPasswordInput, request: Request)` (function)
- L507 `reset_password(payload: ResetPasswordInput, request: Request, response: Response)` (function)
