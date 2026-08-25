---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T03:35:16'
updated: '2026-08-25T03:35:16'
---

# apps/api/tests/test_feedback.py

Symbols in `apps/api/tests/test_feedback.py`.

- L21 `_storage_is_up()` (function) — Snapshots need a bucket. Everything else about a ticket does not.
- L41 `_ticket(**overrides: object)` (function)
- L54 `test_a_member_files_a_ticket_and_an_admin_reads_it(client: Client)` (function)
- L73 `test_a_member_cannot_read_the_tickets(client: Client)` (function)
- L85 `test_the_snapshot_is_served_back_for_an_admin(client: Client)` (function)
- L97 `test_a_ticket_without_a_snapshot_says_so(client: Client)` (function)
- L106 `test_closing_a_ticket_records_who_and_when(client: Client)` (function)
- L125 `test_closing_a_ticket_is_audited(client: Client)` (function)
- L135 `test_deleting_a_ticket_takes_its_snapshot_with_it(client: Client)` (function)
- L151 `test_a_bad_kind_is_refused(client: Client)` (function)
