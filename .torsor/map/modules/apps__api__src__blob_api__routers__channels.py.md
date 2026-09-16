---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/channels.py

Symbols in `apps/api/src/blob_api/routers/channels.py`.

- L31 `ChannelsOut` (class)
- L35 `ChannelOut` (class)
- L40 `list_channels(user: SessionUser=Depends(current_user))` (function)
- L46 `BrowseOut` (class)
- L51 `browse_channels(q: str=Query('', max_length=100), archived: bool=False, user: SessionUser=Depends(current_user))` (function) — The channel directory.
- L69 `create_channel(payload: CreateChannelInput, user: SessionUser=Depends(current_user))` (function)
- L114 `get_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L124 `update_channel(channel_id: IdParam, payload: UpdateChannelInput, user: SessionUser=Depends(current_user))` (function)
- L155 `archive_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function) — Close a channel. Admins only — the client has always said so; this enforces it.
- L174 `unarchive_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function) — Open an archived channel again.
- L201 `join_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L239 `leave_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L268 `add_members(channel_id: IdParam, payload: AddMembersInput, user: SessionUser=Depends(current_user))` (function)
- L309 `list_members(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L319 `update_membership(channel_id: IdParam, payload: MembershipUpdateInput, user: SessionUser=Depends(current_user))` (function) — Per-user channel settings: notification level and starring.
- L345 `list_pins(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L353 `open_dm(payload: CreateDmInput, user: SessionUser=Depends(current_user))` (function) — Open (or reopen) a DM. Idempotent: the same member set returns the same channel.
