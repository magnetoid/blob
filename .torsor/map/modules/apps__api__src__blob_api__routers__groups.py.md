---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-26T05:44:10'
updated: '2026-08-26T05:44:10'
---

# apps/api/src/blob_api/routers/groups.py

Symbols in `apps/api/src/blob_api/routers/groups.py`.

- L31 `GroupsOut` (class)
- L35 `GroupOut` (class)
- L39 `MembersOut` (class)
- L43 `OkOut` (class)
- L47 `_out(group: group_service.Group)` (function)
- L57 `_upserted(workspace_id: str, group: UserGroup)` (function)
- L63 `_membership(user_id: str, group_id: str, is_member: bool)` (function) — Only to the person it is about.
- L73 `list_groups(admin: SessionUser=Depends(require_admin))` (function)
- L80 `create_group(payload: CreateGroupInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L120 `update_group(group_id: str, payload: UpdateGroupInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L160 `delete_group(group_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L181 `list_members(group_id: str, admin: SessionUser=Depends(require_admin))` (function)
- L190 `add_member(group_id: str, user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L215 `remove_member(group_id: str, user_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L240 `set_mute(group_id: str, payload: MuteGroupInput, user: SessionUser=Depends(current_user))` (function) — Your own switch, for a group you are in.
