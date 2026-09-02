---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T03:28:21'
updated: '2026-09-02T03:28:21'
---

# apps/api/src/blob_api/routers/auth.py

Symbols in `apps/api/src/blob_api/routers/auth.py`.

- L48 `AuthStateOut` (class)
- L52 `SessionOut` (class)
- L56 `OkOut` (class)
- L60 `InviteOut` (class)
- L65 `InvitePreviewOut` (class)
- L70 `SessionRow` (class)
- L79 `SessionsOut` (class)
- L83 `_slugify(name: str)` (function)
- L89 `auth_state()` (function) — Is this a fresh install? The first person to sign up founds the workspace.
- L97 `signup(payload: SignupInput, request: Request, response: Response)` (function)
- L236 `login(payload: LoginInput, request: Request, response: Response)` (function)
- L279 `logout(request: Request, response: Response)` (function)
- L288 `logout_others(user: SessionUser=Depends(current_user))` (function)
- L294 `list_sessions(user: SessionUser=Depends(current_user))` (function)
- L325 `create_invite(request: Request, payload: CreateInviteInput | None=None, user: SessionUser=Depends(require_admin))` (function)
- L386 `preview_invite(token: str)` (function)
- L409 `forgot_password(payload: ForgotPasswordInput, request: Request)` (function)
- L446 `reset_password(payload: ResetPasswordInput, request: Request, response: Response)` (function)
