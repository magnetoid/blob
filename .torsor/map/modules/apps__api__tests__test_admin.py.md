---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-27T02:15:42'
updated: '2026-08-27T02:15:42'
---

# apps/api/tests/test_admin.py

Symbols in `apps/api/tests/test_admin.py`.

- L15 `team(client: Client)` (function)
- L26 `test_a_member_cannot_reach_the_admin_api(team: dict)` (function)
- L33 `test_an_admin_can_read_the_directory(team: dict)` (function)
- L41 `test_an_invited_admin_really_is_an_admin(team: dict)` (function)
- L46 `test_only_the_owner_can_change_roles(team: dict)` (function)
- L53 `test_the_owner_can_promote_a_member(team: dict)` (function)
- L61 `test_transferring_ownership_demotes_the_previous_owner(team: dict)` (function)
- L74 `test_the_owner_cannot_change_their_own_role(team: dict)` (function)
- L81 `test_the_owner_cannot_be_deactivated(team: dict)` (function)
- L87 `test_deactivating_ends_access_immediately(team: dict)` (function)
- L94 `test_reactivating_restores_access(team: dict)` (function)
- L107 `test_revoking_sessions_signs_someone_out_without_disabling_them(team: dict)` (function)
- L120 `test_invitations_are_visible_and_revocable(team: dict)` (function)
- L136 `test_an_accepted_invitation_cannot_be_revoked(team: dict)` (function)
- L143 `test_an_admin_sees_private_channels_they_are_not_in(team: dict)` (function)
- L157 `test_an_admin_can_archive_any_channel(team: dict)` (function)
- L167 `test_every_admin_mutation_writes_an_audit_row(team: dict)` (function)
- L182 `test_the_audit_log_filters_by_action(team: dict)` (function)
- L190 `test_a_member_cannot_read_the_audit_log(team: dict)` (function)
- L195 `test_settings_merge_rather_than_replace(team: dict)` (function)
- L203 `test_renaming_the_workspace(team: dict)` (function)
- L209 `test_health_reports_the_datastores(team: dict)` (function)
- L218 `test_a_webhook_can_be_created_used_and_revoked(team: dict)` (function)
- L239 `test_the_webhook_token_is_shown_once_and_never_again(team: dict)` (function)
- L247 `test_an_admin_deleting_someone_elses_message_is_audited(team: dict)` (function) — Moderation is exactly what the log is for, and it used to leave no trace.
- L261 `test_deleting_your_own_message_is_not_audited(team: dict)` (function)
- L270 `test_creating_an_invitation_is_audited(team: dict)` (function)
- L289 `test_instance_users_lists_every_account_with_its_workspace(team: dict)` (function)
- L298 `test_instance_users_is_owner_only(team: dict)` (function)
- L304 `test_instance_workspaces_counts_what_is_in_each(team: dict)` (function)
- L315 `test_instance_workspaces_is_owner_only(team: dict)` (function)
