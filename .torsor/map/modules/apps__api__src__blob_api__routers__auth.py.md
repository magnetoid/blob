---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/auth.py

Symbols in `apps/api/src/blob_api/routers/auth.py`.

- L50 `AuthStateOut` (class)
- L54 `SessionOut` (class)
- L58 `ForgotOut` (class)
- L64 `InviteOut` (class)
- L73 `InvitePreviewOut` (class)
- L78 `SessionRow` (class)
- L87 `SessionsOut` (class)
- L91 `_sign_in(request: Request, response: Response, user_id: str)` (function)
- L97 `auth_state()` (function) — Is this a fresh install? The first person to sign up founds the workspace.
- L104 `signup(payload: SignupInput, request: Request, response: Response)` (function)
- L120 `login(payload: LoginInput, request: Request, response: Response)` (function)
- L139 `logout(request: Request, response: Response)` (function)
- L148 `logout_others(user: SessionUser=Depends(current_user))` (function)
- L165 `list_sessions(user: SessionUser=Depends(current_user))` (function)
- L185 `create_invite(request: Request, payload: CreateInviteInput | None=None, user: SessionUser=Depends(require_admin))` (function)
- L209 `preview_invite(token: str)` (function)
- L217 `forgot_password(payload: ForgotPasswordInput, request: Request)` (function)
- L232 `reset_password(payload: ResetPasswordInput, request: Request, response: Response)` (function)
