"""Reading a time out of a sentence.

The grammar is deliberately small, so half of what is worth pinning is what it *refuses*:
a parser that accepts everything mis-hears half of it, and a reminder arriving at the
wrong time is worse than one that was refused — the refusal is visible and the person
retypes it in five seconds.

Everything here passes `now` rather than reading the clock, which is what lets these
stand on a Tuesday in March without waiting for one.
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from blob_api.services.when import parse_reminder, parse_when

BELGRADE = "Europe/Belgrade"
#: A Wednesday, at half past two in the afternoon, in Belgrade.
NOW = datetime(2026, 9, 2, 12, 30, tzinfo=UTC)


def local(iso: str) -> datetime:
    return datetime.fromisoformat(iso).replace(tzinfo=ZoneInfo(BELGRADE))


def when(phrase: str, *, timezone: str = BELGRADE):
    return parse_when(phrase, now=NOW, timezone=timezone)


class TestADuration:
    def test_minutes(self) -> None:
        parsed = when("in 20 minutes")
        assert parsed is not None
        assert parsed.at == NOW.astimezone(ZoneInfo(BELGRADE)).replace(minute=50)

    @pytest.mark.parametrize("phrase", ["in 2 hours", "in 2 hrs", "in 2 hour"])
    def test_hours_however_it_is_spelled(self, phrase: str) -> None:
        parsed = when(phrase)
        assert parsed is not None
        assert (parsed.at - NOW).total_seconds() == 7200

    def test_days_and_weeks(self) -> None:
        assert (when("in 3 days").at - NOW).days == 3  # type: ignore[union-attr]
        assert (when("in 1 week").at - NOW).days == 7  # type: ignore[union-attr]

    def test_none_of_it_is_a_duration(self) -> None:
        assert when("in 0 minutes") is None
        assert when("in 5 fortnights") is None
        assert when("in minutes") is None


class TestAClock:
    def test_an_hour_still_to_come_is_today(self) -> None:
        # 14:30 local; 17:00 has not happened.
        assert when("at 17:00") is not None
        assert when("at 17:00").at == local("2026-09-02T17:00")  # type: ignore[union-attr]

    def test_an_hour_that_has_gone_is_tomorrow(self) -> None:
        # Guessing the other way would schedule something for a moment already past.
        assert when("at 9").at == local("2026-09-03T09:00")  # type: ignore[union-attr]

    def test_the_meridiem_is_read(self) -> None:
        assert when("at 9pm").at == local("2026-09-02T21:00")  # type: ignore[union-attr]
        assert when("at 9:30 pm").at == local("2026-09-02T21:30")  # type: ignore[union-attr]

    def test_noon_and_midnight_are_the_awkward_ones(self) -> None:
        # 12am is midnight and 12pm is noon, which the arithmetic gets wrong unless it
        # is said out loud.
        assert when("at 12pm").at == local("2026-09-02T12:00").replace(day=3)  # type: ignore[union-attr]
        assert when("at 12am").at == local("2026-09-03T00:00")  # type: ignore[union-attr]

    def test_a_time_that_is_not_one(self) -> None:
        assert when("at 25:00") is None
        assert when("at 9:75") is None
        assert when("at 13pm") is None


class TestADay:
    def test_tomorrow_alone_means_the_morning(self) -> None:
        assert when("tomorrow").at == local("2026-09-03T09:00")  # type: ignore[union-attr]

    def test_tomorrow_with_an_hour(self) -> None:
        assert when("tomorrow at 17:00").at == local("2026-09-03T17:00")  # type: ignore[union-attr]

    def test_today_only_if_it_is_still_ahead(self) -> None:
        assert when("today at 17:00") is not None
        assert when("today at 9") is None

    def test_a_weekday_is_the_next_one(self) -> None:
        # Wednesday the 2nd; Friday is the 4th.
        assert when("friday").at == local("2026-09-04T09:00")  # type: ignore[union-attr]

    def test_and_naming_today_means_next_week(self) -> None:
        # "wednesday" typed on a Wednesday morning could mean either; at 09:00, which has
        # gone, the only reading left is the next one.
        assert when("wednesday").at == local("2026-09-09T09:00")  # type: ignore[union-attr]

    def test_on_is_optional(self) -> None:
        assert when("on friday at 17:00") == when("friday at 17:00")


class TestARule:
    def test_every_day(self) -> None:
        parsed = when("every day at 9am")
        assert parsed is not None and parsed.repeat == "daily"
        assert parsed.at == local("2026-09-03T09:00")

    def test_every_weekday_skips_the_weekend_for_its_first_slot(self) -> None:
        # Friday at 14:30; "every weekday at 9am" first fires on Monday, not Saturday.
        friday = datetime(2026, 9, 4, 12, 30, tzinfo=UTC)
        parsed = parse_when("every weekday at 9am", now=friday, timezone=BELGRADE)

        assert parsed is not None and parsed.repeat == "weekdays"
        assert parsed.at.weekday() == 0

    def test_every_week(self) -> None:
        parsed = when("every week at 9am")
        assert parsed is not None and parsed.repeat == "weekly"

    def test_a_rule_with_no_hour_is_not_read(self) -> None:
        # "every day" alone names no slot, and picking one for somebody is how a
        # reminder arrives at a time they never chose.
        assert when("every day") is None


class TestTheZoneIsTheirs:
    def test_nine_means_nine_where_they_are(self) -> None:
        parsed = parse_when("at 9", now=NOW, timezone="Pacific/Auckland")

        assert parsed is not None
        assert parsed.at.astimezone(ZoneInfo("Pacific/Auckland")).hour == 9

    def test_a_zone_that_has_gone_away_falls_back(self) -> None:
        # Raising inside a command over a stale tz database entry helps nobody.
        assert parse_when("at 9", now=NOW, timezone="Mars/Olympus") is not None


class TestTheWholeSentence:
    def test_the_time_at_the_end(self) -> None:
        parsed = parse_reminder("me to water the plants tomorrow at 9", now=NOW, timezone=BELGRADE)

        assert parsed is not None
        assert parsed.body == "water the plants"
        assert parsed.at == local("2026-09-03T09:00")

    def test_the_time_at_the_start(self) -> None:
        parsed = parse_reminder("me in 20 minutes to check the oven", now=NOW, timezone=BELGRADE)

        assert parsed is not None
        assert parsed.body == "to check the oven"

    def test_me_and_to_are_stripped(self) -> None:
        parsed = parse_reminder("me to stand up at 17:00", now=NOW, timezone=BELGRADE)
        assert parsed is not None and parsed.body == "stand up"

    def test_a_rule_survives_the_sentence(self) -> None:
        parsed = parse_reminder(
            "me to post standup every weekday at 9am", now=NOW, timezone=BELGRADE
        )

        assert parsed is not None
        assert parsed.body == "post standup"
        assert parsed.repeat == "weekdays"

    def test_a_time_in_the_middle_is_left_alone(self) -> None:
        # The one that matters: a greedy search would turn this into a reminder for an
        # hour nobody named, and drop half the sentence.
        parsed = parse_reminder("me to tell Ana at the standup", now=NOW, timezone=BELGRADE)

        assert parsed is None

    def test_a_sentence_with_no_time_is_refused(self) -> None:
        assert parse_reminder("me to do the thing", now=NOW, timezone=BELGRADE) is None

    def test_a_time_with_no_words_is_refused(self) -> None:
        # There would be nothing to remind them of.
        assert parse_reminder("me at 17:00", now=NOW, timezone=BELGRADE) is None

    def test_nothing_at_all(self) -> None:
        assert parse_reminder("", now=NOW, timezone=BELGRADE) is None
        assert parse_reminder("me", now=NOW, timezone=BELGRADE) is None

    def test_the_moment_is_always_ahead(self) -> None:
        for phrase in (
            "me to x at 9",
            "me to x tomorrow",
            "me to x in 5 minutes",
            "me to x friday",
        ):
            parsed = parse_reminder(phrase, now=NOW, timezone=BELGRADE)
            assert parsed is not None, phrase
            assert parsed.at > NOW, phrase
