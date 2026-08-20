from __future__ import annotations

import pytest

from blob_api.lib import net

from .helpers import Client, invite_and_sign_up, send_message, sign_up

APP_WITH_AGENTIC = {
    "slug": "agent-coordinator",
    "name": "Agent Coordinator",
    "description": "Coordinates thread summaries and task handoffs",
    "runtime": "external",
    "version": "1.0.0",
    "requestUrl": "https://apps.example.com/blob/agentic",
    "events": ["task.created", "task.updated", "thread.summary.updated"],
    "scopes": [
        "channels:read",
        "channels:join",
        "messages:read",
        "summaries:read",
        "summaries:write",
        "tasks:read",
        "tasks:write",
    ],
}

APP_MESSAGES = {
    "slug": "audit-bot",
    "name": "Audit Bot",
    "description": "Posts into channels",
    "runtime": "external",
    "version": "1.0.0",
    "requestUrl": "https://apps.example.com/blob/audit",
    "events": ["message.created"],
    "scopes": ["messages:read", "messages:write", "channels:read", "channels:join"],
}


async def install(owner: Client, manifest: dict) -> dict:
    response = await owner.post("/api/admin/plugins", manifest)
    assert response.status == 201, response.body
    return response.body


def bot_client(owner: Client, token: str) -> Client:
    app_client = owner.fork()
    app_client._http.headers["authorization"] = f"Bearer {token}"
    return app_client


@pytest.fixture(autouse=True)
def _resolve_the_example_host(monkeypatch: pytest.MonkeyPatch) -> None:
    real = net.is_private_host

    async def only_that_host(hostname: str) -> bool:
        return False if hostname == "apps.example.com" else await real(hostname)

    monkeypatch.setattr(net, "is_private_host", only_that_host)


async def test_thread_summary_is_generated_and_audited(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    root = await send_message(owner, general, "We decided to ship the agent handoff next sprint.")
    await send_message(
        owner,
        general,
        "@Owner please follow up on the rollout checklist?",
        threadRootId=root.body["message"]["id"],
    )

    created = await owner.post(f"/api/threads/{root.body['message']['id']}/summary")
    assert created.status == 200
    assert created.body["summary"]["messageCount"] == 2
    assert created.body["summary"]["decisions"]

    fetched = await owner.get(f"/api/threads/{root.body['message']['id']}/summary")
    assert fetched.status == 200
    assert fetched.body["summary"]["id"] == created.body["summary"]["id"]

    audit = await owner.get("/api/admin/audit?action=agent.summary_generated")
    assert audit.status == 200
    assert audit.body["events"][0]["targetId"] == root.body["message"]["id"]


async def test_member_cannot_assign_a_task_directly_to_a_bot(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    root = await send_message(owner, general, "Need an agent to compile release notes.")
    installed = await install(owner, APP_MESSAGES)

    response = await member.post(
        f"/api/threads/{root.body['message']['id']}/tasks",
        {
            "title": "Prepare release notes",
            "instructions": "Summarize the thread and draft notes.",
            "assigneeUserId": installed["plugin"]["botUserId"],
        },
    )
    assert response.status == 403
    assert response.body["error"]["message"] == "Only admins can assign work directly to an agent."


async def test_human_task_lifecycle_is_audited(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    root = await send_message(owner, general, "Please prepare the customer recap.")

    created = await owner.post(
        f"/api/threads/{root.body['message']['id']}/tasks",
        {
            "title": "Draft customer recap",
            "instructions": "Use the thread as source context.",
            "assigneeUserId": member.user_id,
            "priority": "high",
        },
    )
    assert created.status == 201
    assert created.body["task"]["assigneeUserId"] == member.user_id

    updated = await member.patch(
        f"/api/tasks/{created.body['task']['id']}",
        {"status": "done", "outcome": "Recap shared with the sales team."},
    )
    assert updated.status == 200
    assert updated.body["task"]["status"] == "done"
    assert updated.body["task"]["completedAt"] is not None

    audit = await owner.get("/api/admin/audit?action=agent.task_updated")
    assert audit.status == 200
    assert audit.body["events"][0]["targetId"] == created.body["task"]["id"]


async def test_bot_message_posts_are_audited(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    installed = await install(owner, APP_MESSAGES)
    app = bot_client(owner, installed["botToken"])

    joined = await app.post("/api/v1/conversations.join", {"channel": general})
    assert joined.status == 200

    posted = await app.post(
        "/api/v1/chat.postMessage",
        {"channel": general, "text": "Agent audit trail check."},
    )
    assert posted.status == 201

    audit = await owner.get("/api/admin/audit?action=bot.message_posted")
    assert audit.status == 200
    assert audit.body["events"][0]["targetId"] == posted.body["message"]["id"]


async def test_bot_can_summarize_and_manage_assigned_tasks(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    root = await send_message(owner, general, "We need a concise thread recap and action plan.")
    await send_message(
        owner,
        general,
        "Please collect action items for launch.",
        threadRootId=root.body["message"]["id"],
    )

    installed = await install(owner, APP_WITH_AGENTIC)
    app = bot_client(owner, installed["botToken"])

    summary = await app.post(
        "/api/v1/threads.summarize",
        {"messageId": root.body["message"]["id"]},
    )
    assert summary.status == 200
    assert summary.body["summary"]["messageCount"] == 2

    created = await app.post(
        f"/api/v1/tasks.create?thread_root_id={root.body['message']['id']}",
        {
            "title": "Compile launch action items",
            "instructions": "Summarize owners and deadlines from the thread.",
            "assigneeUserId": installed["plugin"]["botUserId"],
            "summaryId": summary.body["summary"]["id"],
        },
    )
    assert created.status == 201
    assert created.body["task"]["assigneeUserId"] == installed["plugin"]["botUserId"]

    updated = await app.post(
        f"/api/v1/tasks.update?task_id={created.body['task']['id']}",
        {"status": "done", "outcome": "Action items captured and posted back."},
    )
    assert updated.status == 200
    assert updated.body["task"]["status"] == "done"

    listed = await app.get("/api/v1/tasks.list")
    assert listed.status == 200
    assert listed.body["tasks"][0]["id"] == created.body["task"]["id"]
