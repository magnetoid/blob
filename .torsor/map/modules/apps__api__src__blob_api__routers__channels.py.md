---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-06T04:17:08'
updated: '2026-09-06T04:17:08'
---

# apps/api/src/blob_api/routers/channels.py

Symbols in `apps/api/src/blob_api/routers/channels.py`.

- L31 `ChannelsOut` (class)
- L35 `ChannelOut` (class)
- L39 `MembersOut` (class)
- L43 `MessagesOut` (class)
- L47 `OkOut` (class)
- L52 `list_channels(user: SessionUser=Depends(current_user))` (function)
- L58 `BrowseOut` (class)
- L63 `browse_channels(q: str=Query('', max_length=100), archived: bool=False, user: SessionUser=Depends(current_user))` (function) — The channel directory.
- L81 `create_channel(payload: CreateChannelInput, user: SessionUser=Depends(current_user))` (function)
- L134 `get_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L144 `update_channel(channel_id: IdParam, payload: UpdateChannelInput, user: SessionUser=Depends(current_user))` (function)
- L188 `archive_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function) — Close a channel. Admins only — the client has always said so; this enforces it.
- L209 `unarchive_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function) — Open an archived channel again.
- L238 `join_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L276 `leave_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L305 `add_members(channel_id: IdParam, payload: AddMembersInput, user: SessionUser=Depends(current_user))` (function)
- L346 `list_members(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L356 `update_membership(channel_id: IdParam, payload: MembershipUpdateInput, user: SessionUser=Depends(current_user))` (function) — Per-user channel settings: notification level and starring.
- L391 `list_pins(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L399 `open_dm(payload: CreateDmInput, user: SessionUser=Depends(current_user))` (function) — Open (or reopen) a DM. Idempotent: the same member set returns the same channel.
