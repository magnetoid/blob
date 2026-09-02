"""The guide must not describe a command this server does not answer.

`apps/web/src/lib/help.ts` is prose, and prose is the one thing in this repo that can be
wrong without anything failing. A topic citing `/pin` renders a `/pin` chip, teaches
somebody to type it, and the composer answers "no such command" — no error, no red test,
just an app that appears to have a feature it does not have.

Two thirds of the page is generated to avoid exactly this: the keys come from
`SHORTCUTS` and the command table from what bootstrap sent. The remaining third is the
citations a topic makes by name, and those cross the language boundary — so they are
checked the way the socket vocabulary is, by parsing the TypeScript.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from blob_api.services import commands as command_service

WEB_SRC = Path(__file__).resolve().parents[3] / "apps" / "web" / "src"
HELP_TS = WEB_SRC / "lib" / "help.ts"
COMMANDS_TS = WEB_SRC / "lib" / "commands.ts"


@pytest.fixture(scope="module")
def help_source() -> str:
    assert HELP_TS.is_file(), f"{HELP_TS} has moved; this test needs the new path"
    return HELP_TS.read_text(encoding="utf-8")


def _cited_commands(source: str) -> set[str]:
    """Every name in a `commands: ['a', 'b']` field of a topic."""
    names: set[str] = set()
    for block in re.findall(r"commands:\s*\[([^\]]*)\]", source):
        names.update(re.findall(r"'([a-z0-9_-]+)'", block))
    return names


def _local_commands() -> set[str]:
    """The names the client answers itself, which never reach this server."""
    source = COMMANDS_TS.read_text(encoding="utf-8")
    start = source.find("LOCAL_COMMANDS")
    assert start != -1, "LOCAL_COMMANDS is no longer declared in commands.ts"
    end = source.find("];", start)
    return set(re.findall(r"name:\s*'([a-z0-9_-]+)'", source[start:end]))


def test_every_command_the_guide_cites_exists(help_source: str) -> None:
    known = set(command_service.COMMANDS) | _local_commands()
    cited = _cited_commands(help_source)

    assert cited, "the guide cites no commands at all, which means the parse broke"
    assert cited <= known, f"the guide describes commands nobody implements: {cited - known}"


def test_the_guide_covers_the_commands_that_change_something(help_source: str) -> None:
    """Not every command needs a topic — but the ones with consequences do.

    `/shrug` is self-explanatory and `/help` explains itself. Archiving a channel,
    removing somebody from one, or setting a reminder are things people want to read
    about *before* typing them, and the command table's one-line summary is not where
    that explanation fits.
    """
    should_be_explained = {"archive", "remind", "invite", "remove", "dm", "mute", "status"}
    cited = _cited_commands(help_source)

    assert should_be_explained <= cited, (
        "commands that change something, with no topic explaining them: "
        f"{should_be_explained - cited}"
    )
