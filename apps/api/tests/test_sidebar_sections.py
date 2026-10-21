"""Your own sections in the channel list (M3 · B3): kept with your preferences, so they
follow you to every device, and normalised rather than refused — a conversation sits in
one section, a section is named once."""

from __future__ import annotations

from .helpers import Client, sign_up


async def save(person: Client, sections: list[dict[str, object]]) -> object:
    return await person.patch("/api/me/prefs", {"sidebarSections": sections})


async def test_sections_are_kept_and_come_back(client: Client) -> None:
    ana = await sign_up(client, "Ana")
    general = (await ana.get("/api/channels")).body["channels"][0]["id"]
    sections = [{"id": "clients", "name": "Clients", "channelIds": [general], "collapsed": True}]
    saved = await save(ana, sections)
    assert saved.status == 200, saved.body
    prefs = (await ana.get("/api/bootstrap")).body["user"]["prefs"]
    assert prefs["sidebarSections"] == sections


async def test_a_conversation_keeps_its_first_place(client: Client) -> None:
    ana = await sign_up(client, "Ana")
    saved = await save(
        ana,
        [
            {"id": "a", "name": "  Clients  ", "channelIds": ["c1", "c2", "c1"]},
            {"id": "b", "name": "Launch", "channelIds": ["c2", "c3"]},
            {"id": "a", "name": "Again", "channelIds": ["c4"]},
        ],
    )
    assert saved.status == 200, saved.body
    assert saved.body["prefs"]["sidebarSections"] == [
        {"id": "a", "name": "Clients", "channelIds": ["c1", "c2"], "collapsed": False},
        {"id": "b", "name": "Launch", "channelIds": ["c3"], "collapsed": False},
    ]


async def test_too_many_or_malformed_is_refused(client: Client) -> None:
    ana = await sign_up(client, "Ana")
    many = [{"id": f"s{i}", "name": f"S{i}", "channelIds": []} for i in range(21)]
    assert (await save(ana, many)).status == 400
    assert (await save(ana, [{"id": "has space", "name": "X", "channelIds": []}])).status == 400
    assert (await save(ana, [{"id": "ok", "name": "x" * 41, "channelIds": []}])).status == 400


async def test_the_default_is_none(client: Client) -> None:
    ana = await sign_up(client, "Ana")
    assert (await ana.get("/api/bootstrap")).body["user"]["prefs"]["sidebarSections"] == []
