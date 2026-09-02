---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:21:53'
updated: '2026-09-02T05:21:53'
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
- L259 `login(payload: LoginInput, request: Request, response: Response)` (function)
- L302 `logout(request: Request, response: Response)` (function)
- L311 `logout_others(user: SessionUser=Depends(current_user))` (function)
- L327 `list_sessions(user: SessionUser=Depends(current_user))` (function)
- L358 `create_invite(request: Request, payload: CreateInviteInput | None=None, user: SessionUser=Depends(require_admin))` (function)
- L419 `preview_invite(token: str)` (function)
- L443 `forgot_password(payload: ForgotPasswordInput, request: Request)` (function)
- L480 `reset_password(payload: ResetPasswordInput, request: Request, response: Response)` (function)
