"""When a repeating schedule comes round again.

The arithmetic is the part that can be wrong, and the way it goes wrong is quiet: add
twenty-four hours in UTC and, on the two days a year a zone shifts, "every weekday at
nine" starts arriving at eight and stays there. Nobody reports that, because each
individual message looks fine.

`next_occurrence` takes the moment rather than reading the clock, so these can stand on
the Sunday the clocks change without waiting for October.
"""

from __future__ import annotations

from datetime import UTC, datetime, tzinfo
from zoneinfo import ZoneInfo

import pytest

from blob_api.services.recurrence import describe, next_occurrence

BELGRADE = ZoneInfo("Europe/Belgrade")


def at(iso: str, zone: tzinfo = UTC) -> datetime:
    return datetime.fromisoformat(iso).replace(tzinfo=zone)


class TestDaily:
    def test_moves_to_the_same_time_tomorrow(self) -> None:
        nxt = next_occurrence(at("2026-09-02T09:00:00"), "daily", "UTC")
        assert nxt == at("2026-09-03T09:00:00")

    def test_keeps_the_wall_clock_across_a_clocks_change(self) -> None:
        # Europe/Belgrade goes back an hour on 2026-10-25. An occurrence at 09:00 local
        # on the Saturday must be 09:00 local on the Sunday — which is a *different*
        # number of hours later, and a different UTC time.
        saturday = datetime(2026, 10, 24, 9, 0, tzinfo=BELGRADE)

        nxt = next_occurrence(saturday, "daily", "Europe/Belgrade")

        assert nxt is not None
        assert nxt.astimezone(BELGRADE).hour == 9
        assert nxt.astimezone(BELGRADE).day == 25

    def test_and_across_a_clocks_forward(self) -> None:
        saturday = datetime(2026, 3, 28, 9, 0, tzinfo=BELGRADE)

        nxt = next_occurrence(saturday, "daily", "Europe/Belgrade")

        assert nxt is not None
        assert nxt.astimezone(BELGRADE).hour == 9


class TestWeekdays:
    def test_skips_the_weekend(self) -> None:
        friday = at("2026-09-04T09:00:00")
        assert friday.weekday() == 4

        nxt = next_occurrence(friday, "weekdays", "UTC")

        assert nxt == at("2026-09-07T09:00:00")
        assert nxt is not None and nxt.weekday() == 0

    def test_moves_a_saturday_to_monday(self) -> None:
        # Reachable: somebody schedules the first one on a Saturday.
        saturday = at("2026-09-05T09:00:00")

        nxt = next_occurrence(saturday, "weekdays", "UTC")

        assert nxt is not None and nxt.weekday() == 0

    def test_an_ordinary_weekday_is_the_next_day(self) -> None:
        nxt = next_occurrence(at("2026-09-02T09:00:00"), "weekdays", "UTC")
        assert nxt == at("2026-09-03T09:00:00")


class TestWeekly:
    def test_is_the_same_weekday_seven_days_on(self) -> None:
        previous = at("2026-09-02T09:00:00")

        nxt = next_occurrence(previous, "weekly", "UTC")

        assert nxt == at("2026-09-09T09:00:00")
        assert nxt is not None and nxt.weekday() == previous.weekday()

    def test_crosses_a_month_without_help(self) -> None:
        nxt = next_occurrence(at("2026-12-28T09:00:00"), "weekly", "UTC")
        assert nxt == at("2027-01-04T09:00:00")


class TestAlways:
    @pytest.mark.parametrize("repeat", ["daily", "weekdays", "weekly"])
    def test_lands_strictly_after_the_occurrence_it_follows(self, repeat: str) -> None:
        # What stops a sweep that runs late from firing the same slot twice.
        previous = at("2026-09-02T09:00:00")

        nxt = next_occurrence(previous, repeat, "UTC")

        assert nxt is not None and nxt > previous

    def test_a_rule_nobody_defined_names_no_occurrence(self) -> None:
        assert next_occurrence(at("2026-09-02T09:00:00"), "hourly", "UTC") is None
        assert next_occurrence(at("2026-09-02T09:00:00"), "", "UTC") is None

    def test_a_zone_that_has_gone_away_does_not_stop_the_sweep(self) -> None:
        # A row can outlive a tz database entry. Falling back beats raising inside a job
        # that is sending everybody else's messages too.
        nxt = next_occurrence(at("2026-09-02T09:00:00"), "daily", "Mars/Olympus")

        assert nxt == at("2026-09-03T09:00:00")


class TestHowItReads:
    def test_names_each_rule_in_words(self) -> None:
        assert describe("daily") == "Every day"
        assert describe("weekdays") == "Every weekday"
        assert describe("weekly") == "Every week"
        assert describe(None) == "Once"
