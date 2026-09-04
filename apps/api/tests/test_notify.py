"""Notification rules.

Notification fatigue is the top complaint about every incumbent, so these tests assert
silence as much as delivery.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from blob_api.jobs.unfurl import first_url
from blob_api.lib.mentions import (
    MentionTarget,
    matches_keywords,
    mention_lookup_phrases,
    parse_mentions,
)
from blob_api.lib.net import is_private_address
from blob_api.schemas.models import UserPrefs
from blob_api.services.notify import (
    Decision,
    NotifiableMessage,
    Recipient,
    decide,
    is_snoozed,
)

# A handle names a person or a group, in one namespace — that is the whole point of
# `workspace_handles`, and why the value is a discriminated pair rather than a bare id.
NAMES: dict[str, MentionTarget] = {
    "ana": ("user", "user-ana"),
    "ana maria": ("user", "user-ana-maria"),
    "marko": ("user", "user-marko"),
    "platform-team": ("group", "group-platform"),
}


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


# ─── which names are worth asking the database about ──────────────────────────
def test_the_lookup_offers_every_prefix_of_a_mention() -> None:
    # parse_mentions tries the longest name first and works down, so the filter that
    # decides which rows come back has to cover the same ground or the longer name is
    # never in the dictionary to be preferred.
    phrases = mention_lookup_phrases("@Ana Maria ping")
    assert "ana maria ping" in phrases
    assert "ana maria" in phrases
    assert "ana" in phrases


def test_the_lookup_matches_how_postgres_lowercases() -> None:
    # The phrase is lowercased in Python; `display_name` is lowercased by SQL. Python
    # applies full case mapping and turns "İ" into two code points, Postgres applies the
    # simple mapping and returns "i", so a name spelled with it would be filtered out
    # before anyone could match it — a mention that resolves to nobody, silently.
    phrases = mention_lookup_phrases("hey @İvan")
    assert "ivan" in phrases  # what lower(display_name) actually produces
    assert "i̇van" in phrases  # and what Python produces, still offered


def test_ordinary_names_gain_nothing_from_that() -> None:
    # The second spelling is only added when it differs, so the common path is unchanged.
    assert mention_lookup_phrases("hi @Ana") == ["ana"]
    assert mention_lookup_phrases("hi @Miloš") == ["miloš"]


def test_a_body_with_no_mention_asks_nothing() -> None:
    assert mention_lookup_phrases("no names here") == []
    assert mention_lookup_phrases("`@ana`") == []


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


# ─── @here ────────────────────────────────────────────────────────────────────
# `here_only` was parsed from the day mentions were written and then read by nobody:
# `decide` branched on `mentions_everyone` alone, so `@here` woke exactly the room
# `@channel` woke. The whole point of the quieter one is that it spares the people who
# are not at their desk.
def test_here_reaches_the_people_who_are_active() -> None:
    decisions = decide(
        message(mentions_everyone=True, here_only=True),
        [recipient("u1"), recipient("u2")],
        active_user_ids={"u1"},
    )
    assert [d.user_id for d in decisions] == ["u1"]


def test_here_does_not_reach_someone_who_is_away() -> None:
    assert (
        decide(
            message(mentions_everyone=True, here_only=True),
            [recipient("u1")],
            active_user_ids=set(),
        )
        == []
    )


def test_channel_still_reaches_everybody() -> None:
    # The distinction is the feature. @channel is unchanged by presence.
    decisions = decide(
        message(mentions_everyone=True),
        [recipient("u1"), recipient("u2")],
        active_user_ids={"u1"},
    )
    assert [d.user_id for d in decisions] == ["u1", "u2"]


def test_here_notifies_everyone_when_presence_cannot_be_read() -> None:
    # Redis is where presence lives. If it cannot be asked, the honest failure is the
    # old behaviour — a mention that reaches too many people, rather than one that
    # silently reaches nobody.
    decisions = decide(
        message(mentions_everyone=True, here_only=True),
        [recipient("u1"), recipient("u2")],
        active_user_ids=None,
    )
    assert [d.user_id for d in decisions] == ["u1", "u2"]


def test_someone_here_skips_is_still_reachable_another_way() -> None:
    # Being passed over by @here is not being silenced: the branches below it still run.
    [decision] = decide(
        message(mentions_everyone=True, here_only=True, body="the build is red"),
        [recipient("u1", prefs=UserPrefs(keywords=["build"]))],
        active_user_ids=set(),
    )
    assert decision.reason == "keyword"


def test_a_direct_mention_beats_being_away() -> None:
    [decision] = decide(
        message(mentions_everyone=True, here_only=True, mention_user_ids=["u1"]),
        [recipient("u1")],
        active_user_ids=set(),
    )
    assert decision.reason == "mention"


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


class TestUnfurlFollowsRedirectsSafely:
    """A link is attacker-controlled input that makes the server fetch something.

    The address check used to run on the URL someone typed and then hand the fetch to
    httpx with `follow_redirects=True`, so any public redirector was a way to reach
    169.254.169.254 or a service on the internal network. The title and og: tags of
    whatever came back are stored on the message and broadcast to the channel, so the
    request came with a read channel attached. These pin the hop-by-hop check.
    """

    async def test_a_redirect_into_a_private_address_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import httpx

        from blob_api.jobs import unfurl as unfurl_job

        hops: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            hops.append(str(request.url))
            if request.url.host == "redirector.example.com":
                return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/"})
            # Reaching here would mean the guard let the metadata service through.
            return httpx.Response(
                200,
                headers={"content-type": "text/html"},
                content=b"<title>root credentials</title>",
            )

        transport = httpx.MockTransport(handler)
        real_client = httpx.AsyncClient

        def fake_client(**kwargs: object) -> httpx.AsyncClient:
            kwargs.pop("transport", None)
            return real_client(**kwargs, transport=transport)  # type: ignore[arg-type]

        monkeypatch.setattr(unfurl_job.httpx, "AsyncClient", fake_client)

        async def only_the_link_local_is_private(hostname: str) -> bool:
            return hostname == "169.254.169.254"

        monkeypatch.setattr(unfurl_job, "is_private_host", only_the_link_local_is_private)

        result = await unfurl_job.fetch_unfurl("https://redirector.example.com/go")

        assert result is None
        # It stopped at the redirect: the private address was never requested.
        assert hops == ["https://redirector.example.com/go"]

    async def test_a_redirect_to_a_public_page_is_still_followed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import httpx

        from blob_api.jobs import unfurl as unfurl_job

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "redirector.example.com":
                return httpx.Response(302, headers={"location": "https://example.com/article"})
            return httpx.Response(
                200,
                headers={"content-type": "text/html"},
                content=b"<title>An article</title>",
            )

        transport = httpx.MockTransport(handler)
        real_client = httpx.AsyncClient

        def fake_client(**kwargs: object) -> httpx.AsyncClient:
            kwargs.pop("transport", None)
            return real_client(**kwargs, transport=transport)  # type: ignore[arg-type]

        monkeypatch.setattr(unfurl_job.httpx, "AsyncClient", fake_client)

        async def nothing_is_private(hostname: str) -> bool:
            return False

        monkeypatch.setattr(unfurl_job, "is_private_host", nothing_is_private)

        result = await unfurl_job.fetch_unfurl("https://redirector.example.com/go")

        assert result is not None
        assert result["title"] == "An article"


async def test_an_inert_guard_now_refuses_rather_than_returning_a_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two call sites awaited the checker and dropped its answer on the floor.

    `check_outbound_url` returns its reason instead of raising, which reads as a guard
    and is one forgotten `if` away from being none. The raising form removes the choice.
    """
    from blob_api.lib import net
    from blob_api.lib.errors import AppError

    async def everything_is_private(hostname: str) -> bool:
        return True

    monkeypatch.setattr(net, "is_private_host", everything_is_private)

    with pytest.raises(AppError) as caught:
        await net.assert_outbound_url(
            "https://internal.example.com", require_https=True, code="bad_repo_url"
        )
    assert caught.value.status_code == 400
    assert caught.value.code == "bad_repo_url"
