"""Reading a linked page's title and meta tags (jobs/unfurl.read_head): what a preview
needs, in one linear pass — the page is whoever posted the link's to write.

The regular expressions this replaced put two `[^>]+` around a literal; on 54 KB of
`<meta property="og:title" ` repeated they did not finish in five minutes, which is a
worker slot held for a job's whole timeout by one message.
"""

from __future__ import annotations

import time

import pytest

from blob_api.jobs.unfurl import read_head


def test_the_title_and_meta_tags_are_read_whatever_their_case_and_order() -> None:
    head = read_head(
        "<html><head><TITLE>Hello &amp; welcome</TITLE>"
        '<meta content="Desc here" name="description">'
        '<META PROPERTY="og:title" CONTENT="The OG title">'
        '<meta property="og:title" content="a second one is ignored">'
        "</head><body><title>not the title</title></body></html>"
    )
    assert head.title == "Hello & welcome"
    assert head.meta == {"description": "Desc here", "og:title": "The OG title"}


@pytest.mark.parametrize(
    "hostile",
    [
        '<meta property="og:title" ' * 50_000,
        "<meta " + "a" * 500_000,
        "<title" * 100_000,
        '<meta content="x"' + " x=y" * 100_000,
    ],
)
def test_a_hostile_page_is_read_in_linear_time(hostile: str) -> None:
    started = time.perf_counter()
    read_head(hostile)
    assert time.perf_counter() - started < 3
