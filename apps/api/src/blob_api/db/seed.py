"""Demo data.

Creates a workspace with a handful of people, channels and a realistic conversation so
the app has something to show on first run. Safe to re-run: it clears first.
"""

from __future__ import annotations

import asyncio
from datetime import date

from sqlalchemy import text

from ..lib.auth import hash_password
from ..lib.ids import new_id
from ..services import messages as message_service
from .engine import close_engine, transaction

PASSWORD = "correct-horse-battery"

PEOPLE = [
    ("Ana Petrov", "ana@example.com", "Engineering lead", "owner"),
    ("Marko Ilic", "marko@example.com", "Product", "admin"),
    ("Devin Cole", "devin@example.com", "Design", "member"),
    ("Priya Raman", "priya@example.com", "Infrastructure", "member"),
]

CHANNELS = [
    ("general", "Company-wide announcements and anything without a home yet"),
    ("random", "Non-work chatter"),
    ("engineering", "Builds, deploys, and code review"),
    ("design", "Work in progress, critique, and design decisions"),
]

#: (channel, author index, body, thread replies)
CONVERSATION: list[tuple[str, int, str, list[str]]] = [
    (
        "general",
        0,
        "Morning. Standup notes are up — I moved the two carryover items into "
        "#engineering so they stop getting lost in here.",
        [],
    ),
    (
        "general",
        1,
        "Thanks. I added the customer call summary underneath, worth a skim before Thursday.",
        [],
    ),
    (
        "general",
        2,
        "Reminder that the office is closed Friday. @Ana Petrov do we still want the "
        "retro that afternoon?",
        ["Let's move it to Monday morning.", "Monday works. I'll send a new invite."],
    ),
    (
        "engineering",
        3,
        "Deploy went out at 09:40. Error rate is flat, p99 down about 12ms — the index "
        "on `(channel_id, id DESC)` is doing what we hoped.",
        [],
    ),
    (
        "engineering",
        0,
        "Nice. That was the one keeping history pagination honest.\n\n```sql\n"
        "SELECT * FROM messages\n WHERE channel_id = $1 AND id < $2\n"
        " ORDER BY id DESC LIMIT 50;\n```",
        [],
    ),
    (
        "engineering",
        1,
        "Do we have a number for how far back search stays fast?",
        [
            "Tested to about 2M messages on a laptop — 30ms cold. We are nowhere near "
            "needing Meilisearch.",
            'Good. Filing that under "problems for next year".',
        ],
    ),
    (
        "design",
        2,
        "Pushed the paper palette to the shared file. The green reads better against "
        "the warm neutrals than the blue did.",
        [],
    ),
    ("design", 1, "Agreed, it stops the whole thing looking like every other chat app.", []),
    (
        "random",
        3,
        "Someone has left an extremely good sourdough in the kitchen and I need to know "
        "who to thank.",
        [],
    ),
    ("random", 2, "That would be me. There is more.", []),
]

TRUNCATE = """
TRUNCATE workspaces, users, sessions, invites, password_resets, channels,
         channel_members, messages, reactions, attachments, custom_emoji,
         read_states, thread_subscriptions, push_subscriptions, webhooks,
         audit_events, workspace_settings
RESTART IDENTITY CASCADE
"""


async def seed() -> None:
    print("clearing existing data…")
    workspace_id = new_id()
    password_hash = await hash_password(PASSWORD)
    user_ids: list[str] = []
    channel_ids: dict[str, str] = {}

    async with transaction() as (session, _):
        await session.execute(text(TRUNCATE))
        await session.execute(
            text("INSERT INTO workspaces (id, name, slug) VALUES (:id, :name, :slug)"),
            {"id": workspace_id, "name": "Northwind", "slug": "northwind"},
        )

        for name, email, title, role in PEOPLE:
            user_id = new_id()
            user_ids.append(user_id)
            await session.execute(
                text(
                    """
                    INSERT INTO users
                      (id, workspace_id, email, password_hash, display_name, title, role,
                       timezone)
                    VALUES (:id, :ws, :email, :hash, :name, :title, :role, 'Europe/Belgrade')
                    """
                ),
                {
                    "id": user_id,
                    "ws": workspace_id,
                    "email": email,
                    "hash": password_hash,
                    "name": name,
                    "title": title,
                    "role": role,
                },
            )

        for name, topic in CHANNELS:
            channel_id = new_id()
            channel_ids[name] = channel_id
            await session.execute(
                text(
                    """
                    INSERT INTO channels (id, workspace_id, kind, name, topic, created_by)
                    VALUES (:id, :ws, 'public', :name, :topic, :created_by)
                    """
                ),
                {
                    "id": channel_id,
                    "ws": workspace_id,
                    "name": name,
                    "topic": topic,
                    "created_by": user_ids[0],
                },
            )
            await session.execute(
                text(
                    """
                    INSERT INTO channel_members (channel_id, user_id)
                    SELECT :channel_id, unnest(cast(:ids AS uuid[]))
                    """
                ),
                {"channel_id": channel_id, "ids": user_ids},
            )

    print("writing conversation…")
    for channel_name, author_index, body, replies in CONVERSATION:
        channel_id = channel_ids[channel_name]
        async with transaction() as (session, _):
            result = await message_service.send(
                session,
                workspace_id=workspace_id,
                channel_id=channel_id,
                author_id=user_ids[author_index],
                body=body,
                client_msg_id=new_id(),
            )
        for index, reply in enumerate(replies):
            async with transaction() as (session, _):
                await message_service.send(
                    session,
                    workspace_id=workspace_id,
                    channel_id=channel_id,
                    author_id=user_ids[(author_index + index + 1) % len(user_ids)],
                    body=reply,
                    client_msg_id=new_id(),
                    thread_root_id=result.message.id,
                )

    # A couple of reactions so the UI isn't uniformly bare.
    async with transaction() as (session, _):
        first = (
            await session.execute(
                text("SELECT id FROM messages WHERE thread_root_id IS NULL ORDER BY id LIMIT 1")
            )
        ).fetchone()
        if first is not None:
            for emoji in ("👍", "🎉"):
                for user_id in user_ids[1:3]:
                    await message_service.add_reaction(session, first.id, user_id, emoji)

    print(f"\nSeeded the Northwind workspace ({date.today():%Y-%m-%d}).")
    print(f"  Sign in as any of: {', '.join(email for _, email, _, _ in PEOPLE)}")
    print(f"  Password: {PASSWORD}\n")


def main() -> None:
    asyncio.run(_run())


async def _run() -> None:
    try:
        await seed()
    finally:
        await close_engine()


if __name__ == "__main__":
    main()
