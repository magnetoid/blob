"""Notification rules.

Notification fatigue is the top complaint about every incumbent, so these tests assert
silence as much as delivery.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from blob_api.jobs.unfurl import first_url, is_private_address
from blob_api.lib.mentions import matches_keywords, parse_mentions
from blob_api.schemas.models import UserPrefs
from blob_api.services.notify import (
    Decision,
    NotifiableMessage,
    Recipient,
    decide,
    is_snoozed,
)

NAMES = {"ana": "user-ana", "ana maria": "user-ana-maria", "marko": "user-marko"}


def message(**overrides) -> NotifiableMessage:
    base = {
        "id": "m1",
        "channel_id": "c1",
        "channel_kind": "public",
        "author_id": "author",
        "body": "hello everyone",
        "mention_user_ids": [],
        "mentions_everyone": False,
        "thread_root_id": None,
    }
    return NotifiableMessage(**{**base, **overrides})


def recipient(user_id: str = "u1", **overrides) -> Recipient:
    return Recipient(user_id=user_id, **overrides)


# ─── mention parsing ──────────────────────────────────────────────────────────
def test_finds_a_simple_mention() -> None:
    assert parse_mentions("hey @ana can you look?", NAMES).user_ids == ["user-ana"]


def test_prefers_the_longest_matching_name() -> None:
    # Otherwise "@Ana Maria" would silently ping the wrong person.
    assert parse_mentions("@Ana Maria ping", NAMES).user_ids == ["user-ana-maria"]


def test_ignores_trailing_punctuation() -> None:
    assert parse_mentions("thanks @ana!", NAMES).user_ids == ["user-ana"]


def test_deduplicates_repeated_mentions() -> None:
    assert parse_mentions("@ana @ana @ana", NAMES).user_ids == ["user-ana"]


def test_recognises_channel_and_here() -> None:
    everyone = parse_mentions("@channel heads up", NAMES)
    assert everyone.everyone and not everyone.here_only

    here = parse_mentions("@here quick one", NAMES)
    assert here.everyone and here.here_only


def test_never_mentions_anyone_from_inside_code() -> None:
    fenced = parse_mentions("```\n@channel @ana\n```", NAMES)
    assert fenced.user_ids == [] and not fenced.everyone
    assert parse_mentions("use `@ana` as the flag", NAMES).user_ids == []


def test_ignores_unknown_names_and_email_addresses() -> None:
    assert parse_mentions("@nobody hello", NAMES).user_ids == []
    assert parse_mentions("write to ana@example.com", NAMES).user_ids == []


# ─── keywords ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("body", "keywords", "expected"),
    [
        ("the deploy failed", ["deploy"], True),
        ("redeployment finished", ["deploy"], False),  # not inside a larger word
        ("Postgres is down", ["postgres"], True),  # case insensitive
        ("```\ndeploy\n```", ["deploy"], False),  # code is not content
        ("anything at all", [], False),
    ],
)
def test_matches_keywords(body: str, keywords: list[str], expected: bool) -> None:
    assert matches_keywords(body, keywords) is expected


# ─── who gets notified ────────────────────────────────────────────────────────
def test_never_notifies_the_author_of_their_own_message() -> None:
    assert decide(message(mention_user_ids=["author"]), [recipient("author")]) == []


def test_stays_silent_for_ordinary_channel_chatter() -> None:
    assert decide(message(), [recipient()]) == []


def test_notifies_on_a_direct_mention_and_counts_a_badge() -> None:
    assert decide(message(mention_user_ids=["u1"]), [recipient()]) == [
        Decision("u1", "mention", True)
    ]


def test_notifies_every_recipient_of_a_dm() -> None:
    [decision] = decide(message(channel_kind="dm"), [recipient()])
    assert decision.reason == "dm" and decision.counts_as_mention


def test_notifies_on_a_keyword_hit() -> None:
    prefs = UserPrefs(keywords=["postgres"])
    [decision] = decide(message(body="postgres is down"), [recipient(prefs=prefs)])
    assert decision.reason == "keyword"


def test_notifies_about_all_activity_when_the_channel_is_set_to_all() -> None:
    [decision] = decide(message(), [recipient(notify_level="all")])
    assert decision.reason == "all_activity" and not decision.counts_as_mention


def test_says_nothing_at_all_when_muted_even_for_a_mention() -> None:
    assert decide(message(mention_user_ids=["u1"]), [recipient(notify_level="none")]) == []


def test_respects_a_manual_snooze() -> None:
    prefs = UserPrefs(snooze_until="2099-01-01T00:00:00Z")
    assert decide(message(mention_user_ids=["u1"]), [recipient(prefs=prefs)]) == []


def test_notifies_thread_subscribers_without_counting_a_badge() -> None:
    [decision] = decide(message(thread_root_id="root"), [recipient()], thread_subscribers={"u1"})
    assert decision.reason == "thread" and not decision.counts_as_mention


def test_channel_wide_mentions_skip_people_who_muted() -> None:
    decisions = decide(
        message(mentions_everyone=True),
        [recipient("u1"), recipient("u2", notify_level="none")],
    )
    assert [d.user_id for d in decisions] == ["u1"]


# ─── quiet hours ──────────────────────────────────────────────────────────────
def with_dnd(**overrides) -> Recipient:
    dnd = {"enabled": True, "startHour": 9, "endHour": 18, "days": [1, 2, 3, 4, 5]}
    dnd.update(overrides.pop("dnd", {}))
    return Recipient(user_id="u1", prefs=UserPrefs(dnd=dnd), **overrides)


def test_quiet_outside_working_hours() -> None:
    # Tuesday 22:00 UTC
    assert is_snoozed(with_dnd(), datetime(2026, 8, 18, 22, tzinfo=UTC)) is True


def test_allows_notifications_during_working_hours() -> None:
    assert is_snoozed(with_dnd(), datetime(2026, 8, 18, 10, tzinfo=UTC)) is False


def test_quiet_on_a_non_working_day() -> None:
    # Saturday
    assert is_snoozed(with_dnd(), datetime(2026, 8, 22, 10, tzinfo=UTC)) is True


def test_handles_a_window_that_wraps_midnight() -> None:
    night = with_dnd(dnd={"startHour": 22, "endHour": 6, "days": []})
    assert is_snoozed(night, datetime(2026, 8, 18, 23, tzinfo=UTC)) is False
    assert is_snoozed(night, datetime(2026, 8, 18, 12, tzinfo=UTC)) is True


def test_respects_the_recipient_timezone_rather_than_the_server_clock() -> None:
    tokyo = Recipient(
        user_id="u1",
        timezone="Asia/Tokyo",
        prefs=UserPrefs(dnd={"enabled": True, "startHour": 9, "endHour": 18, "days": []}),
    )
    # 01:00 UTC is 10:00 in Tokyo — inside working hours there, outside here.
    assert is_snoozed(tokyo, datetime(2026, 8, 18, 1, tzinfo=UTC)) is False


def test_does_nothing_when_dnd_is_off() -> None:
    assert is_snoozed(recipient(), datetime(2026, 8, 18, 3, tzinfo=UTC)) is False


# ─── unfurl safety ────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("address", "private"),
    [
        ("127.0.0.1", True),
        ("10.0.0.5", True),
        ("172.16.4.4", True),
        ("192.168.1.1", True),
        ("169.254.1.1", True),
        ("::1", True),
        ("93.184.216.34", False),
    ],
)
def test_unfurl_refuses_private_addresses(address: str, private: bool) -> None:
    assert is_private_address(address) is private


def test_first_url_finds_the_leading_link() -> None:
    assert first_url("see https://example.com/x and more") == "https://example.com/x"
    assert first_url("no links here") is None
