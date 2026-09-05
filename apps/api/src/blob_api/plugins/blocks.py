"""Structured message content.

Seven types, and no more. A block vocabulary grows until it is a layout engine, and a
layout engine in a chat message is a rendering surface nobody can review — so the list is
closed and each type is small enough to render in a switch statement.

`body` stays the plain-text fallback and remains the only thing the search index reads.
A client that does not understand blocks still shows something true.

The security story is one sentence: an interaction is only accepted if its `actionId`
appears in the blocks stored on that message. Because the server holds the blocks, a
client cannot invent an action, and a plugin cannot be handed an id it never published.
"""

from __future__ import annotations

import logging
import re
from typing import Annotated, Literal

from pydantic import Field, field_validator

from ..lib.errors import bad_request
from ..schemas.base import CamelModel

log = logging.getLogger("blob.plugins")

#: A message carries a handful of blocks, not a document.
MAX_BLOCKS = 30
MAX_ELEMENTS = 5
MAX_FIELDS = 10

_ACTION_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")


class TextSpan(CamelModel):
    """Text inside a block.

    Rendered through the same inline renderer message bodies use, so the escaping story
    is identical — there is no second place where user content becomes markup.
    """

    text: str = Field(min_length=1, max_length=3000)
    #: Markdown is the default because that is what everything else in a message is.
    markdown: bool = True


class SectionBlock(CamelModel):
    type: Literal["section"]
    text: TextSpan


class FieldsBlock(CamelModel):
    """Two-column key/value pairs — a build result, a deploy summary."""

    type: Literal["fields"]
    fields: list[TextSpan] = Field(min_length=1, max_length=MAX_FIELDS)


class DividerBlock(CamelModel):
    type: Literal["divider"]


class ContextBlock(CamelModel):
    """Small print: who triggered this, when, from where."""

    type: Literal["context"]
    elements: list[TextSpan] = Field(min_length=1, max_length=MAX_ELEMENTS)


class ImageBlock(CamelModel):
    type: Literal["image"]
    #: Relative, so it routes through /api/files and its permission check. An absolute
    #: URL would let a block pull from anywhere and leak the reader's address to it.
    url: str = Field(min_length=1, max_length=500)
    alt: str = Field(default="", max_length=200)

    @field_validator("url")
    @classmethod
    def _stays_on_this_workspace(cls, value: str) -> str:
        """The comment above was the whole enforcement, which is to say there was none.

        An app with `messages:write` could post an image block pointing anywhere, and
        every member who scrolled past it fetched that URL — handing the app's author
        each reader's address, user agent and the moment they read it, from a channel
        the app's own bot may not even be in. A tracking pixel with a message around it.

        A protocol-relative `//host/x` is absolute too, and the backslash case is here
        because browsers normalise a leading slash-backslash to a network path.
        """
        url = value.strip()
        if not url.startswith("/") or url.startswith("//") or url.startswith("/\\") or "://" in url:
            raise ValueError('An image url is a path on this workspace, like "/api/files/<key>".')
        return url


class ButtonElement(CamelModel):
    type: Literal["button"]
    action_id: str
    text: str = Field(min_length=1, max_length=80)
    value: str = Field(default="", max_length=500)
    style: Literal["default", "primary", "danger"] = "default"


class SelectOption(CamelModel):
    label: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=200)


class SelectElement(CamelModel):
    type: Literal["select"]
    action_id: str
    placeholder: str = Field(default="", max_length=80)
    options: list[SelectOption] = Field(min_length=1, max_length=20)


ActionElement = Annotated[ButtonElement | SelectElement, Field(discriminator="type")]


class ActionsBlock(CamelModel):
    type: Literal["actions"]
    elements: list[ActionElement] = Field(min_length=1, max_length=MAX_ELEMENTS)


class InputBlock(CamelModel):
    """A labelled single-line input. Submitted by the action beside it."""

    type: Literal["input"]
    action_id: str
    label: str = Field(min_length=1, max_length=80)
    placeholder: str = Field(default="", max_length=80)


Block = Annotated[
    SectionBlock
    | FieldsBlock
    | DividerBlock
    | ContextBlock
    | ImageBlock
    | ActionsBlock
    | InputBlock,
    Field(discriminator="type"),
]


def validate_blocks(raw: list[dict[str, object]] | None) -> list[dict[str, object]] | None:
    """Parse and re-serialize, so what is stored is what the schema allows.

    Storing the caller's dictionary verbatim would keep whatever extra keys it sent, and
    those keys would reach the renderer. Round-tripping through the models drops them.
    """
    if raw is None:
        return None
    if len(raw) > MAX_BLOCKS:
        raise bad_request(f"A message carries at most {MAX_BLOCKS} blocks.", code="too_many_blocks")

    from pydantic import TypeAdapter, ValidationError

    adapter: TypeAdapter[list[Block]] = TypeAdapter(list[Block])
    try:
        parsed = adapter.validate_python(raw)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        raise bad_request(f"That block is not valid at {where}: {first['msg']}") from exc

    for action_id in collect_action_ids(parsed):
        if not _ACTION_ID_RE.match(action_id):
            raise bad_request(
                "An action id is up to 80 characters of letters, numbers, dot, colon, "
                "underscore or hyphen.",
                code="bad_action_id",
            )

    return [block.model_dump(by_alias=True, exclude_none=True) for block in parsed]


def collect_action_ids(blocks: list[Block]) -> set[str]:
    found: set[str] = set()
    for block in blocks:
        if isinstance(block, ActionsBlock):
            found.update(element.action_id for element in block.elements)
        elif isinstance(block, InputBlock):
            found.add(block.action_id)
    return found


def action_ids_of(raw: list[dict[str, object]] | None) -> set[str]:
    """The ids a stored message actually published. The whole interaction check.

    This reads rows that were written under whatever the rules were *then*, and the rules
    tighten: the image-url validator added later makes an absolute url invalid, and every
    block already stored with one would fail this parse. Re-validating on read is how a
    new rule reaches back and kills a button on a message from last week — a 500 from the
    catch-all handler, on a message the client still renders perfectly.

    So a stored block that no longer validates is *read* rather than refused. What matters
    here is only which action ids the message published, and that question has the same
    answer whether or not an image beside them points somewhere it may not point today.
    """
    if not raw:
        return set()

    from pydantic import TypeAdapter, ValidationError

    adapter: TypeAdapter[list[Block]] = TypeAdapter(list[Block])
    try:
        return collect_action_ids(adapter.validate_python(raw))
    except ValidationError:
        log.info("stored blocks no longer validate; reading their action ids directly")
        return _action_ids_from_raw(raw)


def _action_ids_from_raw(raw: list[dict[str, object]]) -> set[str]:
    """The same answer, without the models. Shapes it does not recognise contribute none."""

    def add(holder: dict[str, object], into: set[str]) -> None:
        # Both spellings: what a plugin sends over the wire and what is stored after the
        # models round-trip it.
        for key in ("action_id", "actionId"):
            value = holder.get(key)
            if isinstance(value, str) and value:
                into.add(value)

    found: set[str] = set()
    for block in raw:
        if not isinstance(block, dict):
            continue
        # An input block carries its id itself; an actions block carries one per element.
        add(block, found)
        elements = block.get("elements")
        if not isinstance(elements, list):
            continue
        for element in elements:
            if not isinstance(element, dict):
                continue
            add(element, found)
    return found


__all__ = [
    "MAX_BLOCKS",
    "Block",
    "action_ids_of",
    "collect_action_ids",
    "validate_blocks",
]
