"""Mention parsing.

Kept deliberately close to the client's copy in `packages/shared/src/mentions.ts`, so
what highlights in the composer is exactly what notifies on the server.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

EVERYONE_TOKENS = ("channel", "everyone")
HERE_TOKEN = "here"

#: Longest display name we will try to match, in words.
MAX_NAME_WORDS = 4

_MENTION_RE = re.compile(r"@([^\W_][\w.'-]*(?:\s+[^\W_][\w.'-]*)*)", re.UNICODE)
_FENCED_RE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
_TRAILING_PUNCT_RE = re.compile(r"[.,!?;:]+$")


@dataclass(slots=True)
class MentionResult:
    #: Ids of users named directly.
    user_ids: list[str] = field(default_factory=list)
    #: True when @channel or @here appeared.
    everyone: bool = False
    #: True specifically for @here (notify only active members).
    here_only: bool = False


def strip_code(body: str) -> str:
    """Remove fenced blocks and inline code so their contents never mention anyone."""
    return _INLINE_CODE_RE.sub(" ", _FENCED_RE.sub(" ", body))


def parse_mentions(body: str, name_to_id: dict[str, str]) -> MentionResult:
    """Extract mentions from raw markdown.

    `name_to_id` keys must be lowercased display names. Names may contain spaces, so we
    match greedily against the known-name set rather than by regex alone.
    """
    text = strip_code(body)
    user_ids: dict[str, None] = {}  # ordered set
    everyone = False
    here_only = False

    for match in _MENTION_RE.finditer(text):
        candidate = match.group(1)
        if not candidate:
            continue
        words = candidate.split()[:MAX_NAME_WORDS]

        # Prefer the longest matching name: "@Ana Maria" beats "@Ana".
        for take in range(len(words), 0, -1):
            phrase = " ".join(words[:take]).lower()
            bare = _TRAILING_PUNCT_RE.sub("", phrase)
            user_id = name_to_id.get(bare)
            if user_id is not None:
                user_ids[user_id] = None
                break
            if take == 1:
                if bare in EVERYONE_TOKENS:
                    everyone = True
                elif bare == HERE_TOKEN:
                    everyone = True
                    here_only = True
                break

    return MentionResult(user_ids=list(user_ids), everyone=everyone, here_only=here_only)


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
