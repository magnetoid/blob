---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/routers/groups.py

Symbols in `apps/api/src/blob_api/routers/groups.py`.

- L32 `GroupsOut` (class)
- L36 `GroupOut` (class)
- L40 `MembersOut` (class)
- L44 `OkOut` (class)
- L48 `_out(group: group_service.Group)` (function)
- L58 `_upserted(workspace_id: str, group: UserGroup)` (function)
- L64 `_membership(user_id: str, group_id: str, is_member: bool)` (function) — Only to the person it is about.
- L74 `list_groups(admin: SessionUser=Depends(require_admin))` (function)
- L81 `create_group(payload: CreateGroupInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L121 `update_group(group_id: IdParam, payload: UpdateGroupInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L161 `delete_group(group_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L182 `list_members(group_id: IdParam, admin: SessionUser=Depends(require_admin))` (function)
- L193 `add_member(group_id: IdParam, user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L218 `remove_member(group_id: IdParam, user_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L243 `set_mute(group_id: str, payload: MuteGroupInput, user: SessionUser=Depends(current_user))` (function) — Your own switch, for a group you are in.
