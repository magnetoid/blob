"""Preferences that one person saves must not break the workspace.

`dnd` was `dict[str, Any]`, merged into a jsonb column with no shape check, and then read
by `is_snoozed` with `.get()` and `int()`. `is_snoozed` runs inside the notify job for
every recipient of every message — so saving `{"enabled": true, "startHour": "nine"}`
raised `ValueError` there and, from that moment, nobody in any channel that person
belonged to was notified about anything. An ordinary member could switch off their team's
notifications by saving their own preferences once, and nothing would say so.

Two layers, because they answer different questions. Writing is where the shape is
enforced. Reading is where the workspace stays up: rows written under the old, looser
schema already exist, and refusing to read them would turn one broken preference into a
user who cannot be serialised at all.
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from blob_api.config import settings
from blob_api.schemas.models import UserPrefs
from blob_api.services.serialize import read_prefs

from .helpers import Client, sign_up


@pytest_asyncio.fixture
async def owner(client: Client) -> Client:
    return await sign_up(client, "Prefs Owner")


@pytest.mark.asyncio
class TestWhatCanBeSaved:
    async def test_a_usable_window_is_accepted(self, owner: Client) -> None:
        answer = await owner.patch(
            "/api/me/prefs",
            {"dnd": {"enabled": True, "startHour": 9, "endHour": 18, "days": [1, 2, 3, 4, 5]}},
        )
        assert answer.status == 200

    @pytest.mark.parametrize(
        "dnd",
        [
            {"enabled": True, "startHour": "nine"},
            {"enabled": True, "startHour": 99},
            {"enabled": True, "endHour": -1},
            {"enabled": True, "days": [9]},
            {"enabled": True, "days": "weekdays"},
        ],
    )
    async def test_an_hour_or_a_day_that_is_not_one_is_refused(
        self, owner: Client, dnd: dict
    ) -> None:
        answer = await owner.patch("/api/me/prefs", {"dnd": dnd})
        assert answer.status == 400, f"{dnd} was accepted"


class TestWhatCanStillBeRead:
    def test_a_preference_written_before_the_shape_existed_falls_back(self) -> None:
        # The row this defends against: valid json, invalid shape, already stored.
        prefs = read_prefs(
            {"theme": "dark", "keywords": ["deploy"], "dnd": {"enabled": True, "startHour": "nine"}}
        )

        assert prefs.dnd is None, "the unreadable preference is dropped"
        assert prefs.theme == "dark", "the readable ones survive"
        assert prefs.keywords == ["deploy"]

    def test_nothing_readable_at_all_still_yields_defaults(self) -> None:
        # Defaults beat an exception: this is called while serialising a user, and a
        # user who cannot be serialised is worse than a preference that is ignored.
        assert read_prefs({"theme": 5, "density": object}) == UserPrefs()

    def test_ordinary_preferences_are_untouched(self) -> None:
        prefs = read_prefs({"theme": "light", "enterToSend": False})
        assert prefs.theme == "light"
        assert prefs.enter_to_send is False


class TestTheNotifyJobSurvivesIt:
    def test_a_dropped_dnd_reads_as_not_snoozed(self) -> None:
        from datetime import UTC, datetime

        from blob_api.services.notify import Recipient, is_snoozed

        recipient = Recipient(
            user_id="u1",
            prefs=read_prefs({"dnd": {"enabled": True, "startHour": "nine"}}),
            timezone="UTC",
        )

        # Not snoozed rather than an exception: the person loses their quiet hours until
        # they save them again, and everyone else keeps their notifications.
        assert is_snoozed(recipient, datetime.now(UTC)) is False


class TestTheBuildTheServerIsRunning:
    async def test_bootstrap_carries_it_when_the_host_said_which(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Coolify sets SOURCE_COMMIT on the container it deploys, and the client cannot
        # find this out for itself: the bundle stamps its own commit at build time from
        # a repository, and the build host here ships a source tree without one.
        monkeypatch.setattr(settings, "SOURCE_COMMIT", "a" * 40)
        owner = await sign_up(client, "Build Owner")

        boot = (await owner.get("/api/bootstrap")).body

        assert boot["serverCommit"] == "a" * 40

    async def test_and_says_nothing_when_nobody_did(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "SOURCE_COMMIT", None)
        owner = await sign_up(client, "Quiet Owner")

        boot = (await owner.get("/api/bootstrap")).body

        # Null rather than "unknown": the page hides what it does not know.
        assert boot["serverCommit"] is None

    async def test_operator_input_is_bounded(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # It is an environment variable, which is to say it is whatever was typed.
        monkeypatch.setattr(settings, "SOURCE_COMMIT", "  " + "b" * 200 + "  ")
        owner = await sign_up(client, "Long Owner")

        boot = (await owner.get("/api/bootstrap")).body

        assert boot["serverCommit"] == "b" * 40
