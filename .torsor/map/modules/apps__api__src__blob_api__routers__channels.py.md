---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T01:08:40'
updated: '2026-08-27T01:08:40'
---

# apps/api/src/blob_api/routers/channels.py

Symbols in `apps/api/src/blob_api/routers/channels.py`.

- L31 `ChannelsOut` (class)
- L35 `ChannelOut` (class)
- L39 `MembersOut` (class)
- L43 `MessagesOut` (class)
- L47 `OkOut` (class)
- L51 `_channel_event(name: str, channel: ChannelWithState)` (function)
- L56 `list_channels(user: SessionUser=Depends(current_user))` (function)
- L63 `create_channel(payload: CreateChannelInput, user: SessionUser=Depends(current_user))` (function)
- L106 `get_channel(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L116 `update_channel(channel_id: str, payload: UpdateChannelInput, user: SessionUser=Depends(current_user))` (function)
- L160 `archive_channel(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L178 `join_channel(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L214 `leave_channel(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L243 `add_members(channel_id: str, payload: AddMembersInput, user: SessionUser=Depends(current_user))` (function)
- L283 `list_members(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L291 `update_membership(channel_id: str, payload: MembershipUpdateInput, user: SessionUser=Depends(current_user))` (function) — Per-user channel settings: notification level and starring.
- L324 `list_pins(channel_id: str, user: SessionUser=Depends(current_user))` (function)
- L332 `open_dm(payload: CreateDmInput, user: SessionUser=Depends(current_user))` (function) — Open (or reopen) a DM. Idempotent: the same member set returns the same channel.
