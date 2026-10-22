"""Reading a Slack export (lib/slack_export, ADR 0042): what is in the zip Slack's export
page gives an admin, read in place and bounded before anything is decompressed."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from blob_api.lib import slack_export
from blob_api.lib.slack_export import ExportError, open_export

from .slack_fixture import build_export, channel, message, user


def _team(tmp_path: Path, **kwargs: object) -> Path:
    return build_export(
        tmp_path / "export.zip",
        users=[
            user("U1", "Ana Petrov", email="Ana@Example.com", display="ana"),
            user("U2", "Bo Lind", email="bo@example.com"),
            user("U3", "Gone Person", deleted=True),
            user("B1", "GitHub", bot=True),
        ],
        channels=[channel("C1", "general", ["U1", "U2"]), channel("C2", "quiet", ["U1"])],
        groups=[channel("G1", "leads", ["U1", "U2"])],
        dms=[{"id": "D1", "created": 1_600_000_000, "members": ["U1", "U2"]}],
        mpims=[channel("G2", "mpdm-ana--bo--gone-1", ["U1", "U2", "U3"])],
        days={
            "general": {
                "2024-01-02": [message("U2", "1704200000.000200", "second day")],
                "2024-01-01": [message("U1", "1704100000.000100", "first day"), "not a row"],
            },
            "leads": {"2024-01-01": [message("U1", "1704100000.000300", "private")]},
            "D1": {"2024-01-03": [message("U2", "1704300000.000400", "a dm")]},
            "mpdm-ana--bo--gone-1": {"2024-01-04": []},
        },
        **kwargs,  # type: ignore[arg-type]
    )


def test_people_are_read_with_the_name_slack_shows_and_a_lowercase_address(tmp_path: Path) -> None:
    with open_export(str(_team(tmp_path))) as export:
        ana = export.users["U1"]
        assert (ana.name, ana.real_name, ana.email) == ("ana", "Ana Petrov", "ana@example.com")
        # No display name: the real name, as Slack's client shows it.
        assert export.users["U2"].name == "Bo Lind"
        assert export.users["U3"].deleted and export.users["U3"].email is None
        assert export.users["B1"].is_bot


def test_each_kind_of_conversation_is_found_in_its_folder_with_its_days_in_order(
    tmp_path: Path,
) -> None:
    with open_export(str(_team(tmp_path))) as export:
        found = {c.id: c for c in export.conversations}
        assert {c.id: c.kind for c in export.conversations} == {
            "C1": "public",
            "C2": "public",
            "G1": "private",
            "D1": "dm",
            "G2": "group_dm",
        }
        # A channel by its name, a direct message by its id.
        assert found["C1"].folder == "general"
        assert found["C1"].days == ("2024-01-01.json", "2024-01-02.json")
        assert found["D1"].folder == "D1" and found["D1"].name is None
        assert found["G1"].topic == "leads topic" and found["G1"].purpose == "What leads is for"
        # Nobody spoke in it: no folder, no days, still a channel.
        assert found["C2"].folder is None and found["C2"].days == ()
        # The day's rows, without the one that is not a message.
        rows = export.messages(found["C1"], "2024-01-01.json")
        assert [row["text"] for row in rows] == ["first day"]


def test_an_export_zipped_again_inside_a_folder_is_read_the_same(tmp_path: Path) -> None:
    with open_export(str(_team(tmp_path, wrap="Slack export Jan 2024/"))) as export:
        general = next(c for c in export.conversations if c.id == "C1")
        assert export.root == "Slack export Jan 2024/"
        assert general.days == ("2024-01-01.json", "2024-01-02.json")


def test_what_is_not_a_slack_export_is_refused_with_a_reason(tmp_path: Path) -> None:
    not_zip = tmp_path / "notes.zip"
    not_zip.write_text("just some text")
    with pytest.raises(ExportError, match="not a zip"):
        open_export(str(not_zip))

    other = tmp_path / "other.zip"
    with zipfile.ZipFile(other, "w") as zf:
        zf.writestr("readme.txt", "hello")
    with pytest.raises(ExportError, match=r"no users\.json"):
        open_export(str(other))

    no_channels = tmp_path / "half.zip"
    with zipfile.ZipFile(no_channels, "w") as zf:
        zf.writestr("users.json", "[]")
    with pytest.raises(ExportError, match=r"no channels\.json"):
        open_export(str(no_channels))


def test_a_member_is_refused_on_its_declared_size_before_it_is_unpacked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = _team(tmp_path)
    monkeypatch.setattr(slack_export, "MAX_MEMBER_BYTES", 10)
    with pytest.raises(ExportError, match="too large"):
        open_export(str(path))


def test_a_member_that_expands_like_a_bomb_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = build_export(
        tmp_path / "bomb.zip",
        users=[],
        channels=[],
        extra={"general/2024-01-01.json": b"[" + b" " * 2_000_000 + b"]"},
    )
    monkeypatch.setattr(slack_export, "MAX_RATIO", 50)
    with pytest.raises(ExportError, match="expands"):
        open_export(str(path))
