"""Mention parsing.

Kept deliberately close to the client's copy in `packages/shared/src/mentions.ts`, so
what highlights in the composer is exactly what notifies on the server.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

EVERYONE_TOKENS = ("channel", "everyone")
HERE_TOKEN = "here"

#: Longest display name we will try to match, in words.
MAX_NAME_WORDS = 4

_MENTION_RE = re.compile(r"@([^\W_][\w.'-]*(?:\s+[^\W_][\w.'-]*)*)", re.UNICODE)
_FENCED_RE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
_TRAILING_PUNCT_RE = re.compile(r"[.,!?;:]+$")


#: What a handle resolves to: a person, or a group of them.
#:
#: A tuple rather than two maps, because the whole point is that both live in *one*
#: namespace — two maps would let a handle appear in each and reintroduce exactly the
#: ambiguity `workspace_handles` exists to make impossible.
MentionTarget = tuple[Literal["user", "group"], str]


@dataclass(slots=True)
class MentionResult:
    #: Ids of users named directly. Never contains a group's members: five things read
    #: this as "people this message named", including the agent dispatcher.
    user_ids: list[str] = field(default_factory=list)
    #: Ids of groups named. Resolved to people at notify time, not here.
    group_ids: list[str] = field(default_factory=list)
    #: True when @channel or @here appeared.
    everyone: bool = False
    #: True specifically for @here (notify only active members).
    here_only: bool = False


def strip_code(body: str) -> str:
    """Remove fenced blocks and inline code so their contents never mention anyone."""
    return _INLINE_CODE_RE.sub(" ", _FENCED_RE.sub(" ", body))


def _simple_lower(value: str) -> str:
    """Lowercase one character to one character, the way Postgres does.

    Python applies Unicode *full* case mapping, which is allowed to expand: "İ".lower()
    is "i" followed by a combining dot, two code points. Postgres applies the simple
    mapping and returns plain "i". Only this matters because the two run on opposite
    sides of the same comparison — the phrase is lowercased here, `display_name` is
    lowercased by SQL — so for such a name the two never meet and the mention resolves
    to nobody, with nothing logged and no error shown.
    """
    return "".join(character.lower()[:1] or character for character in value)


def mention_lookup_phrases(body: str) -> list[str]:
    """Display-name phrases worth resolving against the database, lowercased.

    This keeps mention resolution bounded by the names a message could plausibly mention
    instead of fetching every active user in the workspace.

    Both lowercasings of a phrase are returned when they differ, because this list is
    only a filter: it decides which rows come back, and `parse_mentions` still decides
    which of them the message actually named. Sending a candidate that matches nothing
    costs one array element; omitting one loses a notification silently.
    """
    phrases: dict[str, None] = {}

    for match in _MENTION_RE.finditer(strip_code(body)):
        candidate = match.group(1)
        if not candidate:
            continue
        words = candidate.split()[:MAX_NAME_WORDS]
        for take in range(len(words), 0, -1):
            joined = " ".join(words[:take])
            for phrase in (
                _TRAILING_PUNCT_RE.sub("", joined.lower()),
                _TRAILING_PUNCT_RE.sub("", _simple_lower(joined)),
            ):
                if phrase:
                    phrases[phrase] = None

    return list(phrases)


def parse_mentions(body: str, targets: dict[str, MentionTarget]) -> MentionResult:
    """Extract mentions from raw markdown.

    `targets` maps a lowercased handle to what it names. Names may contain spaces, so we
    match greedily against the known set rather than by regex alone.

    Both lowercasings of a phrase are tried, and that is load-bearing rather than
    defensive. The keys come from `workspace_handles.handle_lower`, which Postgres
    lowered — and Postgres applies the *simple* case mapping while Python applies the
    full one, so "İvan" is `ivan` on one side and a two-code-point `i̇van` on the other.
    Looking up only `phrase.lower()` would miss such a name entirely: a mention that
    resolves to nobody, with nothing logged. `mention_lookup_phrases` already offers both
    spellings to the SQL filter for the same reason; this is the other half of it.
    """
    text = strip_code(body)
    user_ids: dict[str, None] = {}  # ordered sets
    group_ids: dict[str, None] = {}
    everyone = False
    here_only = False

    for match in _MENTION_RE.finditer(text):
        candidate = match.group(1)
        if not candidate:
            continue
        words = candidate.split()[:MAX_NAME_WORDS]

        # Prefer the longest matching name: "@Ana Maria" beats "@Ana".
        for take in range(len(words), 0, -1):
            joined = " ".join(words[:take])
            target = None
            for spelling in (joined.lower(), _simple_lower(joined)):
                target = targets.get(_TRAILING_PUNCT_RE.sub("", spelling))
                if target is not None:
                    break
            if target is not None:
                kind, target_id = target
                if kind == "group":
                    group_ids[target_id] = None
                else:
                    user_ids[target_id] = None
                break
            if take == 1:
                bare = _TRAILING_PUNCT_RE.sub("", joined.lower())
                if bare in EVERYONE_TOKENS:
                    everyone = True
                elif bare == HERE_TOKEN:
                    everyone = True
                    here_only = True
                break

    return MentionResult(
        user_ids=list(user_ids),
        group_ids=list(group_ids),
        everyone=everyone,
        here_only=here_only,
    )


def matches_keywords(body: str, keywords: list[str]) -> bool:
    """Does this message body hit any of the user's keyword alerts?"""
    if not keywords:
        return False
    text = strip_code(body).lower()
    for keyword in keywords:
        needle = keyword.strip().lower()
        if not needle:
            continue
        # Word-boundary match so "ops" doesn't fire on "developops".
        pattern = rf"(^|[^\w]){re.escape(needle)}($|[^\w])"
        if re.search(pattern, text):
            return True
    return False
