"""Slack's markup as Blob's markdown (lib/slack_markup, ADR 0042)."""

from __future__ import annotations

from blob_api.lib.slack_markup import attachments_text, to_markdown

PEOPLE = {"U1": "Ana Petrov", "U2": "Bo"}
CHANNELS = {"C1": "general"}


def convert(text: str) -> tuple[str, list[str]]:
    out = to_markdown(
        text, person=PEOPLE.get, channel=CHANNELS.get, emoji={"thumbsup": "👍", "tada": "🎉"}.get
    )
    return out.body, out.mentioned


def test_a_person_becomes_their_name_and_is_kept_beside_the_message() -> None:
    body, mentioned = convert("<@U1> and <@U2|bo>, then <@U1> again, and <@U9|zed>")
    assert body == "@Ana Petrov and @Bo, then @Ana Petrov again, and @zed"
    # Once each, in order — an unknown person still named, by Slack's label.
    assert mentioned == ["U1", "U2", "U9"]


def test_channels_links_and_the_room_read_as_blob_writes_them() -> None:
    body, _ = convert(
        "see <#C1|general> and <#C7|old-name>, <https://x.example/a?b=1&amp;c=2|the doc>, "
        "<https://y.example>, <mailto:a@b.example|a@b.example>, <!here> <!channel> <!everyone>, "
        "<!subteam^S1|@design>, <!date^1392734382^{date}|Feb 18, 2014>"
    )
    assert body == (
        "see #general and #old-name, [the doc](https://x.example/a?b=1&c=2), "
        "https://y.example, a@b.example, @here @channel @everyone, @design, Feb 18, 2014"
    )


def test_bold_and_strike_change_their_marks_and_code_keeps_its_words() -> None:
    body, mentioned = convert(
        "*ship it* ~not this~ _maybe_ 2*3*4 `*literal* &lt;b&gt; <@U1>`\n```\nx = *y*\n```"
    )
    assert body == "**ship it** ~~not this~~ _maybe_ 2*3*4 `*literal* <b> <@U1>`\n```\nx = *y*\n```"
    # A person inside code is code, not a mention.
    assert mentioned == []


def test_entities_and_shortcodes_become_characters() -> None:
    body, _ = convert("a &amp; b &lt;3 :thumbsup: :tada: :not-an-emoji:")
    assert body == "a & b <3 👍 🎉 :not-an-emoji:"


def test_an_apps_attachments_are_its_words_when_it_has_none_of_its_own() -> None:
    text = attachments_text(
        [
            {
                "pretext": "Build failed",
                "title": "main #12",
                "title_link": "https://ci.example/12",
                "text": "2 tests failed",
                "fields": [{"title": "Branch", "value": "main"}],
            },
            {"fallback": "Only a fallback"},
            "not an attachment",
        ]
    )
    body, _ = convert(text)
    assert body == (
        "Build failed\n[main #12](https://ci.example/12)\n2 tests failed\n**Branch**: main"
        "\n\nOnly a fallback"
    )


def test_the_emoji_table_is_shipped_with_the_code() -> None:
    # It lived in a `data/` folder once, which the repository ignores everywhere: tests
    # passed on the machine that generated it, and a deploy would have had no table.
    import subprocess
    from pathlib import Path

    from blob_api.lib import slack_markup

    table = Path(slack_markup.__file__).parent / "slack_emoji.json"
    ignored = subprocess.run(
        ["git", "check-ignore", "-q", str(table)], cwd=table.parent, check=False
    )
    assert ignored.returncode == 1, "slack_emoji.json is ignored by git"
    assert slack_markup.slack_emoji("+1::skin-tone-6") == "👍🏿"
    assert slack_markup.slack_emoji("white_check_mark") == "✅"
    assert slack_markup.slack_emoji("partyparrot") is None
