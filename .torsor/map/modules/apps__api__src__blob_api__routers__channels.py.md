---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T06:42:34'
updated: '2026-08-21T06:42:34'
---

# apps/api/src/blob_api/routers/channels.py

Symbols in `apps/api/src/blob_api/routers/channels.py`.

- L29 `ChannelsOut` (class)
- L33 `ChannelOut` (class)
- L37 `MembersOut` (class)
- L41 `MessagesOut` (class)
- L45 `OkOut` (class)
- L49 `_channel_event(name: str, channel: ChannelWithState)` (function)
- L54 `list_channels(user: SessionUser=Depends(current_user))` (function)
- L61 `create_channel(payload: CreateChannelInput, user: SessionUser=Depends(current_user))` (function)
- L96 `get_channel(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L106 `update_channel(channel_id: str, payload: UpdateChannelInput, user: SessionUser=Depends(current_user))` (function)
- L150 `archive_channel(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L168 `join_channel(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L193 `leave_channel(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L215 `add_members(channel_id: str, payload: AddMembersInput, user: SessionUser=Depends(current_user))` (function)
- L247 `list_members(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L255 `update_membership(channel_id: str, payload: MembershipUpdateInput, user: SessionUser=Depends(current_user))` (function) — Per-user channel settings: notification level and starring.
- L288 `list_pins(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L296 `open_dm(payload: CreateDmInput, user: SessionUser=Depends(current_user))` (function) — Open (or reopen) a DM. Idempotent: the same member set returns the same channel.
