---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:36:31'
updated: '2026-09-02T05:36:31'
---

# apps/api/src/blob_api/routers/channels.py

Symbols in `apps/api/src/blob_api/routers/channels.py`.

- L32 `ChannelsOut` (class)
- L36 `ChannelOut` (class)
- L40 `MembersOut` (class)
- L44 `MessagesOut` (class)
- L48 `OkOut` (class)
- L52 `_channel_event(name: str, channel: ChannelWithState)` (function)
- L57 `list_channels(user: SessionUser=Depends(current_user))` (function)
- L63 `BrowseOut` (class)
- L68 `browse_channels(q: str=Query('', max_length=100), archived: bool=False, user: SessionUser=Depends(current_user))` (function) — The channel directory.
- L86 `create_channel(payload: CreateChannelInput, user: SessionUser=Depends(current_user))` (function)
- L129 `get_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L139 `update_channel(channel_id: IdParam, payload: UpdateChannelInput, user: SessionUser=Depends(current_user))` (function)
- L183 `archive_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L201 `join_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L239 `leave_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L268 `add_members(channel_id: IdParam, payload: AddMembersInput, user: SessionUser=Depends(current_user))` (function)
- L308 `list_members(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L318 `update_membership(channel_id: IdParam, payload: MembershipUpdateInput, user: SessionUser=Depends(current_user))` (function) — Per-user channel settings: notification level and starring.
- L351 `list_pins(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L359 `open_dm(payload: CreateDmInput, user: SessionUser=Depends(current_user))` (function) — Open (or reopen) a DM. Idempotent: the same member set returns the same channel.
