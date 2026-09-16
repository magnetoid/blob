---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/groups.py

Symbols in `apps/api/src/blob_api/routers/groups.py`.

- L32 `GroupsOut` (class)
- L36 `GroupOut` (class)
- L40 `_out(group: group_service.Group)` (function)
- L50 `_upserted(workspace_id: str, group: UserGroup)` (function)
- L56 `_membership(user_id: str, group_id: str, is_member: bool)` (function) — Only to the person it is about.
- L66 `list_groups(admin: SessionUser=Depends(require_admin))` (function)
- L73 `create_group(payload: CreateGroupInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L113 `update_group(group_id: IdParam, payload: UpdateGroupInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L153 `delete_group(group_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L174 `list_members(group_id: IdParam, admin: SessionUser=Depends(require_admin))` (function)
- L185 `add_member(group_id: IdParam, user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L210 `remove_member(group_id: IdParam, user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L235 `set_mute(group_id: str, payload: MuteGroupInput, user: SessionUser=Depends(current_user))` (function) — Your own switch, for a group you are in.
