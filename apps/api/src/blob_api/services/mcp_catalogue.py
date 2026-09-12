"""The tool catalogue, once, for both kinds of principal.

An assistant reaching in over MCP and the workspace's own agent are the same kind of
principal — something acting for a person, holding exactly that person's reach — so
they read one table. `for_token` filters it by what an MCP token holds; `for_agent` by
the `plugin_grants` an admin gave the agent. Filtered rather than merely refused, both
times: a model offered a tool it may not use will call it, and the person reads a
permission error in the middle of an answer. The handlers that run the tools are in
`services/mcp.py`.
"""

from __future__ import annotations

from typing import Any

#: A page of anything, and the most a caller may ask for.
DEFAULT_LIMIT = 40
MAX_LIMIT = 100

_LIMIT_SCHEMA = {
    "type": "integer",
    "minimum": 1,
    "maximum": MAX_LIMIT,
    "description": f"How many to return. Default {DEFAULT_LIMIT}, most {MAX_LIMIT}.",
}

_CHANNEL_SCHEMA = {
    "type": "string",
    "description": "A channel id, or a name like #general.",
}

#: The tools, once. `scope` is what an MCP *token* must hold; `grant` is the
#: `plugin_grants` scope an *agent* must have been given for the same tool, because an
#: agent's permissions are the plugin system's and a token's are its own. `None` means a
#: tool that asks the server nothing about the workspace and so needs no grant.
CATALOGUE: list[dict[str, Any]] = [
    {
        "name": "whoami",
        "grant": None,
        "title": "Who this connection is",
        "description": (
            "Who this connection acts as, which workspace it is in, and whether it may "
            "post. Call this first if anything is ambiguous about identity."
        ),
        "inputSchema": {"type": "object", "properties": {}},
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "list_channels",
        "grant": "channels:read",
        "title": "List channels",
        "description": (
            "Channels this person is in, plus the public ones they could join. Private "
            "channels they are not in are not listed and cannot be read."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Only channels whose name contains this.",
                },
                "limit": _LIMIT_SCHEMA,
            },
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "read_channel",
        "grant": "messages:read",
        "title": "Read a channel",
        "description": (
            "The most recent messages in a channel, oldest first. Pass `before` with the "
            "id of the oldest message you were given to page further back."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "channel": _CHANNEL_SCHEMA,
                "limit": _LIMIT_SCHEMA,
                "before": {
                    "type": "string",
                    "description": "A message id; returns the messages before it.",
                },
            },
            "required": ["channel"],
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "read_thread",
        "grant": "messages:read",
        "title": "Read a thread",
        "description": "A thread in full: the message it started from and every reply.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "message_id": {
                    "type": "string",
                    "description": "The id of any message in the thread.",
                }
            },
            "required": ["message_id"],
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "search_messages",
        "grant": "messages:read",
        "title": "Search messages",
        "description": (
            "Full-text search across everything this person can see. Supports the same "
            "filters the app does: from:@name, in:#channel, before:2026-01-31, "
            "after:2026-01-01, has:link."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to search for."},
                "limit": _LIMIT_SCHEMA,
            },
            "required": ["query"],
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "list_people",
        "grant": "users:read",
        "title": "List people",
        "description": (
            "The people and agents in this workspace. A message names one by writing @ "
            "and their display name, which is what this returns."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Match part of a name."},
                "limit": _LIMIT_SCHEMA,
            },
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "post_message",
        "grant": "messages:write.anywhere",
        "title": "Post a message",
        "description": (
            "Post to a channel or a thread, as the person this connection belongs to. "
            "Everyone in the channel sees it under their name, so say what it is."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "channel": _CHANNEL_SCHEMA,
                "text": {"type": "string", "description": "What to say. Markdown works."},
                "thread_root_id": {
                    "type": "string",
                    "description": "Reply in this thread instead of the channel.",
                },
            },
            "required": ["channel", "text"],
        },
        "scope": "write",
        "readOnly": False,
    },
]


def for_token(scopes: frozenset[str]) -> list[dict[str, Any]]:
    """The tools this token may call, in the shape `tools/list` returns.

    Filtered rather than merely refused: a read-only token that saw `post_message` would
    have the model propose it, the call would fail, and the person would read a permission
    error they cannot act on from inside their assistant.
    """
    return [
        {
            "name": tool["name"],
            "title": tool["title"],
            "description": tool["description"],
            "inputSchema": tool["inputSchema"],
            "annotations": {
                "title": tool["title"],
                "readOnlyHint": tool["readOnly"],
                # Nothing here destroys anything: the worst a write does is add a message.
                "destructiveHint": False,
                "openWorldHint": False,
            },
        }
        for tool in CATALOGUE
        if tool["scope"] in scopes
    ]


def for_agent(scopes: frozenset[str]) -> list[dict[str, Any]]:
    """The same tools, offered to an agent, in the shape the model layer takes.

    One catalogue for both callers. An assistant reaching in over MCP and the workspace's
    own agent are the same kind of principal — something acting for a person, holding
    exactly that person's reach — so giving them separate tool tables would mean two
    definitions of what "read a channel" is, and the second one drifting.

    Filtered, not refused (the reason `catalogue` gives): a model offered a tool it may
    not use will call it, and the person reads a permission error in the middle of an
    answer.

    The read tools ride in on grants an agent already needs for other reasons.
    `post_message` does not: it hangs off `messages:write.anywhere`, which nothing is
    seeded with, because answering where it was asked and choosing where to speak are
    different powers and only the second one is what an injected instruction reaches for.
    """
    return [
        {
            "name": tool["name"],
            "description": tool["description"],
            "input_schema": tool["inputSchema"],
        }
        for tool in CATALOGUE
        if tool["grant"] is None or tool["grant"] in scopes
    ]
