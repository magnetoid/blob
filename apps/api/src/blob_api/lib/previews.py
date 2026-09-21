"""Which stored files the side panel can show, and as what.

Two answers and nothing else. **Text** — anything whose bytes are words: a page, a
document, a table, code. It is served as `text/plain` whatever it is, and the client
decides how to draw it. **PDF** — served as itself for the browser's own viewer.
Everything else (archives, office files, audio, video) has no preview and is
downloaded, which is what it was before the panel existed.

A web page is text, and also the one kind with a second way out: `is_page` says it may
be served as itself, under a policy that makes it a sandbox with no network wherever it
is opened (`routers/files.page`). The client needs that rather than drawing the text
into a `srcdoc` frame, because a `srcdoc` document inherits the app's own policy and the
app's `script-src 'self'` refuses every inline script a page has.

Decided from the stored type and the name together, because an agent that did not say
what a file was left us only the name, and a `.py` arrives as `text/x-python` from one
place and `application/octet-stream` from another.
"""

from __future__ import annotations

from typing import Literal

PreviewKind = Literal["text", "pdf"]

_TEXT_TYPES = frozenset(
    {
        "application/json",
        "application/ld+json",
        "application/x-ndjson",
        "application/xml",
        "application/xhtml+xml",
        "application/yaml",
        "application/x-yaml",
        "application/toml",
        "application/javascript",
        "application/sql",
        "image/svg+xml",
    }
)

_TEXT_EXTENSIONS = frozenset(
    {
        # Documents and data.
        "md", "markdown", "txt", "text", "log", "csv", "tsv", "json", "jsonl", "ndjson",
        "yaml", "yml", "toml", "ini", "cfg", "conf", "xml", "rst", "adoc", "tex",
        # Pages and pictures made of text.
        "html", "htm", "svg", "css", "scss", "less",
        # Code.
        "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt",
        "kts", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "php", "sql", "lua", "pl",
        "r", "scala", "dart", "vue", "svelte", "graphql", "gql", "proto", "diff", "patch",
    }
)  # fmt: skip


_PAGE_TYPES = frozenset({"text/html", "application/xhtml+xml"})
_PAGE_EXTENSIONS = frozenset({"html", "htm", "xhtml"})


def is_page(filename: str, mime: str) -> bool:
    """Whether this file is a web page — the one kind served as itself, in a sandbox."""
    bare = mime.lower().split(";", 1)[0].strip()
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return extension in _PAGE_EXTENSIONS or bare in _PAGE_TYPES


def kind_of(filename: str, mime: str) -> PreviewKind | None:
    """How the panel may show this file, or None when it can only be downloaded."""
    bare = mime.lower().split(";", 1)[0].strip()
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if bare == "application/pdf" or extension == "pdf":
        return "pdf"
    if bare.startswith("text/") or bare in _TEXT_TYPES or extension in _TEXT_EXTENSIONS:
        return "text"
    return None
