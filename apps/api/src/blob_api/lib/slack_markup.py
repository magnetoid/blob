"""Slack's message markup, as Blob's markdown (ADR 0042).

Slack stores a message as "mrkdwn": `*bold*`, `_italic_`, `~strike~`, code as in
markdown, and everything that points somewhere inside angle brackets — `<@U024BE7LH>` for
a person, `<#C024BE7LR|general>` for a channel, `<https://…|label>` for a link,
`<!here>` for the room — with `&`, `<` and `>` in the words escaped as entities. Blob's
renderer reads `*x*` as italic, so bold doubles its stars; a person becomes the `@name`
Blob writes and the client highlights, with the id kept beside the message rather than in
it; `@here`, `@channel` and `@everyone` stay words, because history must not page anybody.

Inside code nothing is touched but the entities: what somebody pasted between backticks
is what they meant.
"""

from __future__ import annotations

import functools
import html
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_CODE = re.compile(r"```.*?```|`[^`\n]*`", re.DOTALL)
_ANGLED = re.compile(r"<([^<>\n]+)>")
_BOLD = re.compile(r"(?<![\w*\\])\*(?![\s*])([^*\n]+?)(?<![\s\\])\*(?![\w*])")
_STRIKE = re.compile(r"(?<![\w~\\])~(?![\s~])([^~\n]+?)(?<![\s\\])~(?![\w~])")
_SHORTCODE = re.compile(r":([a-z0-9_+'-]+(?:::skin-tone-[2-6])?):")


@dataclass
class Converted:
    body: str
    #: Slack ids of the people the message named, in the order it named them, once each.
    mentioned: list[str] = field(default_factory=list)


def to_markdown(
    text: str,
    *,
    person: Callable[[str], str | None],
    channel: Callable[[str], str | None],
    emoji: Callable[[str], str | None] = lambda _name: None,
) -> Converted:
    """`text` in Slack's markup as Blob's. `person` and `channel` name a Slack id, or
    say they cannot; `emoji` turns a shortcode's name into its character."""
    out = Converted(body="")
    parts: list[str] = []
    cursor = 0
    for code in _CODE.finditer(text):
        parts.append(_prose(text[cursor : code.start()], out, person, channel, emoji))
        parts.append(html.unescape(code.group(0)))
        cursor = code.end()
    parts.append(_prose(text[cursor:], out, person, channel, emoji))
    out.body = "".join(parts).strip()
    return out


def _prose(
    text: str,
    out: Converted,
    person: Callable[[str], str | None],
    channel: Callable[[str], str | None],
    emoji: Callable[[str], str | None],
) -> str:
    if not text:
        return text

    def angled(match: re.Match[str]) -> str:
        inner = match.group(1)
        target, _, label = inner.partition("|")
        if target.startswith("@"):
            slack_id = target[1:]
            if slack_id not in out.mentioned:
                out.mentioned.append(slack_id)
            return f"@{person(slack_id) or _plain(label).lstrip('@') or 'somebody'}"
        if target.startswith("#"):
            return f"#{channel(target[1:]) or _plain(label) or 'a-channel'}"
        if target.startswith("!"):
            command = target[1:]
            if command in ("here", "channel", "everyone"):
                return f"@{command}"
            # `<!subteam^S123|@designers>`, `<!date^1392734382^{date}|Feb 18, 2014>`:
            # the label is the words Slack showed.
            return _plain(label)
        if label:
            if target.startswith("mailto:"):
                return _plain(label)
            words = _plain(label).replace("[", "(").replace("]", ")")
            return f"[{words}]({target})"
        return target[len("mailto:") :] if target.startswith("mailto:") else target

    text = _ANGLED.sub(angled, text)
    text = _BOLD.sub(r"**\1**", text)
    text = _STRIKE.sub(r"~~\1~~", text)

    def shortcode(match: re.Match[str]) -> str:
        return emoji(match.group(1)) or match.group(0)

    text = _SHORTCODE.sub(shortcode, text)
    return html.unescape(text)


def _plain(label: str) -> str:
    return html.unescape(label).strip()


def attachments_text(attachments: Any) -> str:
    """What an app's message said in its legacy attachments, for a message with no text
    of its own — Slack's integrations often put everything there."""
    if not isinstance(attachments, list):
        return ""
    blocks: list[str] = []
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        lines: list[str] = []
        for key in ("pretext",):
            if isinstance(attachment.get(key), str) and attachment[key].strip():
                lines.append(attachment[key].strip())
        title = attachment.get("title")
        if isinstance(title, str) and title.strip():
            link = attachment.get("title_link")
            lines.append(
                f"<{link}|{title.strip()}>" if isinstance(link, str) and link else title.strip()
            )
        body = attachment.get("text")
        if isinstance(body, str) and body.strip():
            lines.append(body.strip())
        for item in attachment.get("fields") or []:
            if isinstance(item, dict) and isinstance(item.get("value"), str):
                heading = item.get("title")
                lines.append(
                    f"*{heading}*: {item['value']}"
                    if isinstance(heading, str) and heading
                    else item["value"]
                )
        if not lines and isinstance(attachment.get("fallback"), str):
            lines.append(attachment["fallback"].strip())
        if lines:
            blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


@functools.cache
def _emoji_table() -> tuple[dict[str, str], dict[str, list[str]]]:
    """Slack's names for emoji and their characters, built from the data Slack's own names
    come from (`scripts/slack-emoji.mjs`, emoji-datasource)."""
    # Beside this module, not in a `data/` folder: the repository ignores every `data/` and
    # the table would never have reached the image.
    data = json.loads((Path(__file__).parent / "slack_emoji.json").read_text("utf-8"))
    return data["names"], data["tones"]


def slack_emoji(name: str) -> str | None:
    """The character Slack shows for `name` — `tada`, `+1::skin-tone-3` — or None for a
    name Slack's standard set does not have, which is a workspace's own emoji."""
    base, _, tone = name.partition("::")
    names, tones = _emoji_table()
    if tone.startswith("skin-tone-") and tone[len("skin-tone-") :].isdigit():
        toned = tones.get(base)
        index = int(tone[len("skin-tone-") :]) - 2
        if toned and 0 <= index < len(toned):
            return toned[index]
    return names.get(base)
