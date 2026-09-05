"""The blocks under "Needs a decision", minted by Blob.

An agent that stops to ask something ends its run with `outcome: interrupt`. Until now
Blob posted the question as text and that was the end of it: there was no way to answer.
This is the answering half's shape — buttons when the agent declared choices, a text box
when it did not, and the settled card once somebody has answered or nobody did.

Blob builds these, never the agent. The block union is closed to apps for a reason (a
stream that could mint interactive UI would be a rendering surface nobody reviewed), and
that reason does not weaken because the UI is a question. The agent declares what it
needs in the interrupt's `responseSchema`; Blob decides how that looks.

The action id is the whole routing story: `agent_answer:{run_id}:{choice}` is what the
button carries back through `/api/interactions`, and it is how that route knows to hand
the press to the run rather than webhook it to the agent as an interaction the agent
never published.
"""

from __future__ import annotations

from typing import Any

from ..lib.errors import bad_request
from . import blocks
from .agui import Decision

ACTION_PREFIX = "agent_answer:"
TEXT_MARKER = "text"

#: A TextSpan carries at most this much; an agent's prompt is cut to fit rather than
#: refused, because a long question is still a question somebody has to answer.
_PROMPT_MAX = 3000
_BUTTON_MAX = 80


def decision_blocks(run_id: str, decision: Decision) -> list[dict[str, Any]]:
    """The question, and the way to answer it."""
    raw: list[dict[str, Any]] = [_prompt_block(decision)]
    if decision.free_text:
        raw.append(
            {
                "type": "input",
                "actionId": f"{ACTION_PREFIX}{run_id}:{TEXT_MARKER}",
                "label": "Your answer",
                "placeholder": "Type an answer and press Enter",
            }
        )
    else:
        raw.append(
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "actionId": f"{ACTION_PREFIX}{run_id}:{index}",
                        "text": _clip(choice.label, _BUTTON_MAX),
                        "value": _clip(str(choice.value), 500),
                        "style": "primary" if index == 0 else "default",
                    }
                    for index, choice in enumerate(decision.choices)
                ],
            }
        )
    return blocks.validate_blocks(raw) or []


def settled_blocks(decision: Decision, *, answered_by: str, answer: str) -> list[dict[str, Any]]:
    """The same question, closed: who answered and what they said. No buttons."""
    return (
        blocks.validate_blocks(
            [
                _prompt_block(decision),
                _context(f"{answered_by} answered: {_clip(answer, 2000)}"),
            ]
        )
        or []
    )


def expired_blocks(decision: Decision) -> list[dict[str, Any]]:
    return (
        blocks.validate_blocks([_prompt_block(decision), _context("Nobody answered within a day.")])
        or []
    )


def run_id_of(action_id: str) -> str | None:
    """The run an action id belongs to, or None if it is some app's ordinary button."""
    if not action_id.startswith(ACTION_PREFIX):
        return None
    rest = action_id[len(ACTION_PREFIX) :]
    run_id, _, choice = rest.rpartition(":")
    if not run_id or not choice:
        return None
    return run_id


def payload_for(decision: Decision, action_id: str | None, value: str) -> tuple[str, Any]:
    """What to post as the person's message, and what to hand the agent as `payload`.

    A button answers with the choice it named — the label is what the channel reads,
    the declared value is what the agent receives, and the two differ when a schema says
    `{"const": true, "title": "Yes"}`. Free text answers with itself.
    """
    if action_id is None or action_id.endswith(f":{TEXT_MARKER}"):
        answer = value.strip()
        if not answer:
            raise bad_request("An answer needs some text.")
        return answer, answer
    _, _, choice = action_id.rpartition(":")
    if not choice.isdigit() or int(choice) >= len(decision.choices):
        raise bad_request("That choice is not on offer.", code="unknown_action")
    chosen = decision.choices[int(choice)]
    return chosen.label, chosen.value


def _prompt_block(decision: Decision) -> dict[str, Any]:
    return {"type": "section", "text": {"text": _clip(decision.prompt, _PROMPT_MAX)}}


def _context(text: str) -> dict[str, Any]:
    return {"type": "context", "elements": [{"text": text, "markdown": False}]}


def _clip(text: str, limit: int) -> str:
    text = text.strip() or "…"
    return text if len(text) <= limit else text[: limit - 1] + "…"


__all__ = [
    "ACTION_PREFIX",
    "decision_blocks",
    "expired_blocks",
    "payload_for",
    "run_id_of",
    "settled_blocks",
]
