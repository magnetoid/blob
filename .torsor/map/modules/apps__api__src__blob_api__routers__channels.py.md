---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:58:13'
updated: '2026-09-05T04:58:13'
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
- L183 `archive_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function) — Close a channel. Admins only — the client has always said so; this enforces it.
- L204 `unarchive_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function) — Open an archived channel again.
- L235 `join_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L273 `leave_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L302 `add_members(channel_id: IdParam, payload: AddMembersInput, user: SessionUser=Depends(current_user))` (function)
- L342 `list_members(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L352 `update_membership(channel_id: IdParam, payload: MembershipUpdateInput, user: SessionUser=Depends(current_user))` (function) — Per-user channel settings: notification level and starring.
- L385 `list_pins(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L393 `open_dm(payload: CreateDmInput, user: SessionUser=Depends(current_user))` (function) — Open (or reopen) a DM. Idempotent: the same member set returns the same channel.
