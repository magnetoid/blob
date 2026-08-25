---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T17:52:26'
updated: '2026-08-25T17:52:26'
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
- L98 `get_channel(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L108 `update_channel(channel_id: str, payload: UpdateChannelInput, user: SessionUser=Depends(current_user))` (function)
- L152 `archive_channel(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L170 `join_channel(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L195 `leave_channel(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L217 `add_members(channel_id: str, payload: AddMembersInput, user: SessionUser=Depends(current_user))` (function)
- L249 `list_members(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L257 `update_membership(channel_id: str, payload: MembershipUpdateInput, user: SessionUser=Depends(current_user))` (function) — Per-user channel settings: notification level and starring.
- L290 `list_pins(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L298 `open_dm(payload: CreateDmInput, user: SessionUser=Depends(current_user))` (function) — Open (or reopen) a DM. Idempotent: the same member set returns the same channel.
