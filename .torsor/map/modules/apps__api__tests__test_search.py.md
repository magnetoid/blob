---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-08T17:49:32'
updated: '2026-09-08T17:49:32'
---

# apps/api/tests/test_search.py

Symbols in `apps/api/tests/test_search.py`.

- L17 `team(client: Client)` (function)
- L57 `test_parse_query(raw: str, expected: dict)` (function)
- L63 `test_an_unknown_has_value_raises_rather_than_parsing_to_nothing()` (function) — It used to appear in this table as `("has:nonsense deploy", {"text": "deploy"})`.
- L76 `test_finds_a_message_by_word(team: dict)` (function)
- L82 `test_returns_nothing_for_a_term_nobody_said(team: dict)` (function)
- L88 `test_the_from_modifier_narrows_by_author(team: dict)` (function)
- L98 `test_the_in_modifier_narrows_by_channel(team: dict)` (function)
- L105 `test_a_deleted_message_leaves_the_index(team: dict)` (function)
- L113 `test_total_counts_all_matches_even_when_the_page_is_limited(team: dict)` (function)
- L124 `test_private_messages_stay_out_of_a_non_members_results(team: dict)` (function)
- L133 `test_sync_returns_only_what_was_missed(team: dict)` (function)
- L148 `test_sync_without_cursors_replays_nothing(team: dict)` (function)
- L156 `TestDateModifiers` (class)
- L157 `test_a_bad_date_is_refused_as_input(self, team: dict)` (method)
- L165 `test_a_real_date_still_narrows(self, team: dict)` (method)
- L170 `TestAModifierThatNamesNobody` (class) — A filter that matches nothing must narrow the search to nothing.
- L180 `test_an_unknown_person_finds_nothing(self, team: dict)` (method)
- L191 `test_an_unknown_channel_finds_nothing(self, team: dict)` (method)
- L199 `test_a_first_name_finds_the_person(self, team: dict)` (method)
- L212 `test_an_ambiguous_first_name_finds_nothing_rather_than_guessing(self, team: dict)` (method)
- L230 `TestPagingThroughResults` (class) — Reaching result 26.
- L240 `test_paging_reaches_every_match_exactly_once(self, team: dict)` (method)
- L262 `test_the_last_page_does_not_offer_another(self, team: dict)` (method)
- L271 `test_a_full_final_page_offers_one_more_that_is_empty(self, team: dict)` (method)
- L285 `test_a_forged_cursor_is_refused_rather_than_ignored(self, team: dict)` (method)
- L291 `test_paging_does_not_cross_the_membership_boundary(self, team: dict)` (method)
- L307 `TestAModifierThatCannotBeHonoured` (class) — Every modifier refuses rather than widening — `has:` was the last one that did not.
- L316 `test_an_unknown_has_value_is_refused(self, team: dict)` (method)
- L324 `test_the_two_it_accepts_still_work(self, team: dict)` (method)
- L330 `test_a_colon_in_ordinary_text_is_still_searchable(self, team: dict)` (method)
- L339 `TestOrdering` (class) — Relevance is the default; recency is the other question people ask.
- L346 `test_most_recent_puts_the_newest_first(self, team: dict)` (method)
- L361 `test_relevance_is_what_you_get_without_asking(self, team: dict)` (method)
- L369 `test_paging_by_recency_walks_the_whole_result_set_once(self, team: dict)` (method)
- L392 `test_a_cursor_cannot_be_replayed_into_the_other_ordering(self, team: dict)` (method)
- L405 `test_an_ordering_nobody_offers_is_refused(self, team: dict)` (method)
- L411 `TestAccents` (class) — A team that types without diacritics still finds what was written with them.
- L414 `test_a_word_typed_plainly_finds_the_accented_one(self, team: dict)` (method)
- L421 `test_and_the_other_way_round(self, team: dict)` (method)
- L427 `test_english_stemming_survived_the_folding(self, team: dict)` (method)
