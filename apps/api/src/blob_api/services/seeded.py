"""Who the agent Blob seeds is — the one question six modules have to agree on.

`services/janus_agent` is where this lived and where it belongs by subject: that module
seeds the row, and the two constants are its manifest's. It cannot stay there, because
`services/channels.create_channel` is now a reader and `janus_agent` imports
`channels.add_members` — the identity in the module that owns the seeder means an import
cycle in the module that founds a channel.

So the identity is its own module, importing nothing from `services/`, and `janus_agent`
re-exports it so every existing `janus_agent.SEEDED_AGENT` and `janus_agent.AGENT_SLUG`
still resolves. One definition, six readers, no cycle:

* `janus_agent.existing_id` — the row the seeder owns, never merely one wearing the slug.
* `jobs/agui_admission` — whose stored instructions a run may carry.
* `services/users.list_users` — which bot is the resident agent, for the home view.
* `services/channels.create_channel` — which bot is seated in a channel founded now.
* `services/janus_console._installs` — which workspaces the console page lists.
* `routers/plugins` — which row the workspace may instruct and place.
"""

from __future__ import annotations

from typing import Any

#: Fixed. The seeder matches on it to stay idempotent and the bot's address derives from
#: it, so it is not something to make configurable — the display name is.
AGENT_SLUG = "janus"

#: Fixed too, and load-bearing beyond the manifest: with the slug it is what tells the
#: seeder's row apart from the other rows that can wear the name. See `existing_id`.
AGENT_RUNTIME = "external"

#: The seeded agent's identity, as SQL over a `plugins` row aliased `p`.
#:
#: The slug alone is not identity — see `janus_agent.existing_id` for the two live rows it
#: would wrongly adopt — and `owner_user_id IS NULL` is the half that keeps a person's
#: agent out: theirs answers them, not the workspace (ADR 0018).
SEEDED_AGENT = (
    f"(p.slug = '{AGENT_SLUG}' AND p.runtime = '{AGENT_RUNTIME}' AND p.owner_user_id IS NULL)"
)


def is_seeded_row(row: Any) -> bool:
    """The same question as `SEEDED_AGENT`, asked of a row already in hand.

    For the routes, which hold no SQL: they have fetched the plugin to authorize it, and
    a second query to ask who it is would be a query for an answer they are holding.
    """
    return (
        getattr(row, "slug", None) == AGENT_SLUG
        and getattr(row, "runtime", None) == AGENT_RUNTIME
        and getattr(row, "owner_user_id", None) is None
    )
