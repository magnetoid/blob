---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T05:52:32'
updated: '2026-08-21T05:52:32'
---

# apps/api/tests/test_messages.py

Symbols in `apps/api/tests/test_messages.py`.

- L16 `team(client: Client)` (function) — An owner, a member, an outsider, and the default #general channel.
- L28 `test_bootstrap_returns_the_workspace_and_everyone_in_it(team: dict)` (function)
- L36 `test_new_users_land_on_the_default_channels(team: dict)` (function)
- L43 `test_sending_stores_a_message(team: dict)` (function)
- L49 `test_sending_is_idempotent_for_a_repeated_client_msg_id(team: dict)` (function)
- L62 `test_an_empty_message_is_refused(team: dict)` (function)
- L70 `test_mentions_are_resolved_at_write_time(team: dict)` (function)
- L78 `test_a_mention_inside_code_pings_nobody(team: dict)` (function)
- L85 `test_history_comes_back_oldest_last(team: dict)` (function)
- L97 `test_a_thread_tracks_its_replies_on_the_root(team: dict)` (function)
- L112 `test_thread_replies_stay_out_of_the_channel_timeline(team: dict)` (function)
- L123 `test_replying_subscribes_you_to_the_thread(team: dict)` (function)
- L133 `test_reactions_aggregate_and_ignore_duplicates(team: dict)` (function)
- L154 `test_you_can_edit_your_own_message_but_not_someone_elses(team: dict)` (function)
- L166 `test_deleting_clears_the_body(team: dict)` (function)
- L179 `test_an_admin_can_delete_anyone_s_message(team: dict)` (function)
- L185 `test_pinning_shows_up_in_the_channel_pins(team: dict)` (function)
- L195 `test_a_message_is_unread_for_others_but_not_its_author(team: dict)` (function)
- L207 `test_marking_read_clears_unread(team: dict)` (function)
- L220 `test_a_late_ack_never_rewinds_the_read_cursor(team: dict)` (function)
- L237 `secret(team: dict)` (function)
- L247 `test_a_private_channel_is_hidden_from_non_members(team: dict, secret: dict)` (function)
- L252 `test_a_private_channel_reports_404_not_403(team: dict, secret: dict)` (function)
- L258 `test_an_invited_member_can_read_a_private_channel(team: dict, secret: dict)` (function)
- L265 `test_a_duplicate_channel_name_is_refused(team: dict)` (function)
- L272 `test_an_archived_channel_is_read_only(team: dict)` (function)
- L281 `test_joining_and_leaving_a_public_channel(team: dict)` (function)
- L290 `test_channel_settings_are_per_user(team: dict)` (function)
- L305 `test_opening_a_dm_twice_returns_the_same_channel(team: dict)` (function)
- L313 `test_a_group_dm_is_a_different_channel(team: dict)` (function)
- L323 `test_prefs_merge_rather_than_replace(team: dict)` (function)
- L332 `test_clearing_a_profile_field_differs_from_omitting_it(team: dict)` (function)
- L346 `test_deactivating_a_user_revokes_their_access(team: dict)` (function)
- L352 `test_a_member_cannot_deactivate_anyone(team: dict)` (function)
- L358 `test_the_owner_account_is_protected(team: dict, target: str)` (function)
