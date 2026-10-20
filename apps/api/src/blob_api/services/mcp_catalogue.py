"""The tool catalogue, once.

Every tool a person's assistant may call over `/api/mcp` (ADR 0016) is defined here and
nowhere else, and `for_token` filters the table by what that token holds. Filtered rather
than merely refused: a model offered a tool it may not use will call it, and the person
reads a permission error in the middle of an answer. The handlers that run the tools are
in `services/mcp.py`.

There is a second reader (ADR 0022): an agent answering a mention may be offered the same
tools over AG-UI, as client-executed tools, run as the person who asked and bounded to the
room it was asked in (`jobs/agui_tools.py`). Same names, same schemas, same executors —
`whoami` aside, which describes a token, and `post_message` aside, which an agent runs as
itself and only after the person approves. One definition of what a tool does, whoever
asks for it.
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

_CLIENT_ID_SCHEMA = {
    "type": "string",
    "maxLength": 64,
    "description": (
        "An id of your own for this post, up to 64 characters. Calling again with the same "
        "id posts nothing new and answers with the message already posted — so a retry "
        "after a dropped response is safe."
    ),
}

_PERSON_SCHEMA = {
    "type": "string",
    "description": "A person's display name, with or without @, or their user id.",
}

#: The tools, once. `scope` is what the calling token must hold — "read" for everything
#: that only looks, "write" for the one that speaks.
CATALOGUE: list[dict[str, Any]] = [
    {
        "name": "whoami",
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
        "name": "read_file",
        "title": "Read a file",
        "description": (
            "The text of a file attached to a message — a document, notes, code, a CSV or "
            "JSON. Name the message it came with; if that message carries more than one "
            "file, name the file too. Images, PDFs and other binary files cannot be read "
            "as text, and a file over 512 KB is too long."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "message_id": {
                    "type": "string",
                    "description": "The id of the message the file is attached to.",
                },
                "name": {
                    "type": "string",
                    "description": "The file's name, when the message carries several.",
                },
            },
            "required": ["message_id"],
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "list_tasks",
        "title": "List tasks",
        "description": (
            "Tasks this person can see — the work a team has agreed to do, each with its "
            "owner, status and due date — newest first. Narrow by channel, by status, or "
            "to the ones assigned to this person."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "channel": {**_CHANNEL_SCHEMA, "description": "Only tasks in this channel."},
                "status": {
                    "type": "string",
                    "enum": ["todo", "in_progress", "blocked", "done", "cancelled"],
                    "description": "Only tasks with this status.",
                },
                "mine": {
                    "type": "boolean",
                    "description": "Only tasks assigned to the person this connection is.",
                },
                "limit": _LIMIT_SCHEMA,
            },
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "list_decisions",
        "title": "List decisions",
        "description": (
            "What the team decided, newest first — each decision with where it was made, "
            "who recorded it, and why when somebody said. Narrow by channel or by words in "
            "it. Decisions that no longer stand are left out unless asked for. Not "
            "answer_decision, which answers a question an agent asked."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "channel": {
                    **_CHANNEL_SCHEMA,
                    "description": "Only decisions made in this channel.",
                },
                "query": {
                    "type": "string",
                    "description": "Only decisions whose words match this.",
                },
                "include_revoked": {
                    "type": "boolean",
                    "description": "Also list decisions that no longer stand.",
                },
                "limit": _LIMIT_SCHEMA,
            },
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "search_messages",
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
                "cursor": {
                    "type": "string",
                    "description": (
                        "The cursor a previous search answered with, for its next page."
                    ),
                },
            },
            "required": ["query"],
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "list_people",
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
        "name": "list_agents",
        "title": "List agents",
        "description": (
            "The agents this person may ask — the workspace's, their own, and any lent to "
            "them — with what each says it does. Name a channel to see which of them are "
            "in it; an agent answers only where it is a member. Ask one with ask_agent."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "channel": {
                    **_CHANNEL_SCHEMA,
                    "description": "Say which agents are in this channel.",
                },
            },
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "post_message",
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
                "client_msg_id": _CLIENT_ID_SCHEMA,
            },
            "required": ["channel", "text"],
        },
        "scope": "write",
        "readOnly": False,
    },
    {
        "name": "record_decision",
        "title": "Record a decision",
        "description": (
            "Add something a conversation settled to the team's decision log, in the name "
            "of the person this connection belongs to. Say what was decided in one line, "
            "and why if anybody said. Point it at the message it was settled in, when "
            "there is one: that message then shows it is a decision."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "channel": {**_CHANNEL_SCHEMA, "description": "Where it was decided."},
                "title": {
                    "type": "string",
                    "description": "What was decided, in one line of at most 200 characters.",
                },
                "rationale": {"type": "string", "description": "Why, if anybody said."},
                "message_id": {
                    "type": "string",
                    "description": "The message it was settled in, if there is one.",
                },
                "client_msg_id": _CLIENT_ID_SCHEMA,
            },
            "required": ["channel", "title"],
        },
        "scope": "write",
        "readOnly": False,
    },
    {
        "name": "inbox",
        "title": "What needs this person",
        "description": (
            "Conversations with messages this person has not read — the ones that mention "
            "them first — and their latest mentions. Start here to catch them up."
        ),
        "inputSchema": {"type": "object", "properties": {"limit": _LIMIT_SCHEMA}},
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "list_threads",
        "title": "Threads they follow",
        "description": (
            "Threads this person follows, most recently active first, marking the ones with "
            "replies they have not read. Read one with read_thread."
        ),
        "inputSchema": {"type": "object", "properties": {"limit": _LIMIT_SCHEMA}},
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "message_person",
        "title": "Message a person directly",
        "description": (
            "Send a direct message to one person, as this person — opening the DM if they "
            "have none yet. They see it under this person's name."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "to": _PERSON_SCHEMA,
                "text": {"type": "string", "description": "What to say. Markdown works."},
                "client_msg_id": _CLIENT_ID_SCHEMA,
            },
            "required": ["to", "text"],
        },
        "scope": "write",
        "readOnly": False,
    },
    {
        "name": "add_reaction",
        "title": "React to a message",
        "description": "React to a message with an emoji, as this person.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "message_id": {"type": "string", "description": "The message to react to."},
                "emoji": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "The emoji itself, like 👍, or a custom one like :shipit:.",
                },
            },
            "required": ["message_id", "emoji"],
        },
        "scope": "write",
        "readOnly": False,
    },
    {
        "name": "ask_agent",
        "title": "Ask an agent",
        "description": (
            "Ask one of the workspace's agents something, in a channel or thread, as this "
            "person — the same as them mentioning it there, so it answers in the room and "
            "on their authority. Answers with the message that asked; follow the agent's "
            "run with run_status."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent": {
                    "type": "string",
                    "description": "The agent's display name, with or without @.",
                },
                "channel": _CHANNEL_SCHEMA,
                "text": {"type": "string", "description": "What to ask it."},
                "thread_root_id": {
                    "type": "string",
                    "description": "Ask in this thread instead of the channel.",
                },
                "client_msg_id": _CLIENT_ID_SCHEMA,
            },
            "required": ["agent", "channel", "text"],
        },
        "scope": "write",
        "readOnly": False,
    },
    {
        "name": "run_status",
        "title": "How an agent's run is going",
        "description": (
            "What an agent is doing or did about one message: still running, finished — "
            "with what it answered — failed and why, or stopped on a question waiting for "
            "an answer, with the choices it offers."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "message_id": {
                    "type": "string",
                    "description": "The message that asked the agent — what ask_agent answers.",
                },
                "run_id": {"type": "string", "description": "Or the run itself."},
            },
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "answer_decision",
        "title": "Answer an agent's question",
        "description": (
            "Answer the question an agent's run stopped to ask — only the person it asked "
            "may. Give the place of one of the choices run_status lists, or words when it "
            "asked for words. The answer is posted as this person and the agent carries on."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string", "description": "The run that is waiting."},
                "choice": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "The place of the choice, counting from 0.",
                },
                "text": {"type": "string", "description": "Words, for a question without choices."},
            },
            "required": ["run_id"],
        },
        "scope": "write",
        "readOnly": False,
    },
    {
        "name": "stop_run",
        "title": "Stop an agent's run",
        "description": (
            "Stop an agent's run that is still going, and any it set going in turn. Anyone "
            "who can see the conversation may."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"run_id": {"type": "string", "description": "The run to stop."}},
            "required": ["run_id"],
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
