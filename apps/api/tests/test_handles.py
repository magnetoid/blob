"""Allocating a mentionable name.

Display names and group handles are resolved against one map, so two things must never
answer to one name. A pair of application checks cannot guarantee that — not because of a
race, but through a supported flow: `users_display_name_uniq` is partial on
`deactivated_at IS NULL`, so a group-create check has to ignore deactivated people or a
departed account holds a name for ever. Deactivate, create a group with that handle,
reactivate, and both checks have passed while the collision exists.

So the name is allocated: winning `(workspace_id, handle_lower)` is what makes it yours.
These pin the invariant that makes that work — a row for every active person and none for
anybody else — plus the rename path, which until now answered a taken name with a 500.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory

from .helpers import PASSWORD, Client, invite_and_sign_up, sign_up


@pytest_asyncio.fixture
async def owner(client: Client) -> Client:
    return await sign_up(client, "Owner")


async def handles_in(workspace_id: str) -> dict[str, str | None]:
    """handle_lower -> user_id, straight from the table."""
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT handle_lower, user_id FROM workspace_handles
                     WHERE workspace_id = :ws
                    """
                ),
                {"ws": workspace_id},
            )
        ).fetchall()
    return {row.handle_lower: row.user_id for row in rows}


async def workspace_of(client: Client) -> str:
    return str((await client.get("/api/bootstrap")).body["workspace"]["id"])


async def join_as(owner: Client, display_name: str, email: str) -> Client:
    """Join with a chosen address.

    `invite_and_sign_up` derives the email from the display name, so it cannot be used to
    test two people *wanting* the same name — the email unique constraint would refuse
    them first and the display-name path would never run.
    """
    invite = await owner.post("/api/invites", {"expiresInDays": 1})
    token = invite.body["url"].split("/join/")[1]
    return await sign_up(owner.fork(), display_name, invite_token=token, email=email)


class TestTheInvariant:
    async def test_every_active_person_holds_exactly_one_handle(self, owner: Client) -> None:
        await invite_and_sign_up(owner, "Ana")
        await invite_and_sign_up(owner, "Bruno")

        handles = await handles_in(await workspace_of(owner))
        assert set(handles) == {"owner", "ana", "bruno"}
        # One row each: the partial unique index on user_id is what stops a rename that
        # claims a new name and forgets the old one leaving somebody with two.
        assert len(set(handles.values())) == 3

    async def test_the_name_is_lowercased_by_postgres_not_python(self, owner: Client) -> None:
        # Python's full case mapping expands "İ" to two code points; Postgres' simple
        # mapping returns "i". The stored key has to be the SQL one, because that is what
        # the resolver compares against.
        await invite_and_sign_up(owner, "İvan")

        handles = await handles_in(await workspace_of(owner))
        assert "ivan" in handles, sorted(handles)


class TestRenaming:
    async def test_a_rename_moves_the_handle(self, owner: Client) -> None:
        ana = await invite_and_sign_up(owner, "Ana")
        assert (await ana.patch("/api/me", {"displayName": "Ana Maria"})).status == 200

        handles = await handles_in(await workspace_of(owner))
        assert "ana maria" in handles
        # Released, or she would answer to both names and mis-ping silently.
        assert "ana" not in handles

    async def test_taking_a_name_somebody_else_holds_is_a_conflict(self, owner: Client) -> None:
        ana = await invite_and_sign_up(owner, "Ana")
        await invite_and_sign_up(owner, "Bruno")

        response = await ana.patch("/api/me", {"displayName": "Bruno"})
        # This used to be a 500: the route imported only `not_found`, so losing the
        # display-name index surfaced through the catch-all handler.
        assert response.status == 409, response.body
        assert response.body["error"]["code"] == "name_taken"

    async def test_a_failed_rename_changes_nothing(self, owner: Client) -> None:
        ana = await invite_and_sign_up(owner, "Ana")
        await invite_and_sign_up(owner, "Bruno")
        await ana.patch("/api/me", {"displayName": "Bruno"})

        assert (await ana.get("/api/bootstrap")).body["user"]["displayName"] == "Ana"
        handles = await handles_in(await workspace_of(owner))
        assert "ana" in handles and "bruno" in handles

    async def test_changing_only_the_case_of_your_own_name_works(self, owner: Client) -> None:
        ana = await invite_and_sign_up(owner, "Ana")
        # Releasing before claiming is what makes this work: claiming first would
        # collide with the row she already holds, and this is a rename somebody does on
        # their first day.
        response = await ana.patch("/api/me", {"displayName": "ANA"})
        assert response.status == 200, response.body

    async def test_editing_something_else_leaves_the_handle_alone(self, owner: Client) -> None:
        ana = await invite_and_sign_up(owner, "Ana")
        assert (await ana.patch("/api/me", {"title": "Engineer"})).status == 200

        handles = await handles_in(await workspace_of(owner))
        assert "ana" in handles


class TestLeavingAndComingBack:
    async def test_deactivating_frees_the_name(self, owner: Client) -> None:
        ana = await invite_and_sign_up(owner, "Ana")
        assert (await owner.post(f"/api/admin/users/{ana.user_id}/deactivate")).status == 200

        handles = await handles_in(await workspace_of(owner))
        # The display-name index is partial and already frees it; the handle table has to
        # agree, or a departed account holds the name against everybody for ever.
        assert "ana" not in handles

    async def test_the_freed_name_can_be_taken(self, owner: Client) -> None:
        ana = await invite_and_sign_up(owner, "Ana")
        await owner.post(f"/api/admin/users/{ana.user_id}/deactivate")

        second = await join_as(owner, "Ana", "ana.second@example.com")
        assert second.user_id != ana.user_id

    async def test_reactivating_re_claims_it(self, owner: Client) -> None:
        ana = await invite_and_sign_up(owner, "Ana")
        await owner.post(f"/api/admin/users/{ana.user_id}/deactivate")
        assert (await owner.post(f"/api/admin/users/{ana.user_id}/reactivate")).status == 200

        handles = await handles_in(await workspace_of(owner))
        assert handles.get("ana") == ana.user_id

    async def test_reactivating_into_a_taken_name_is_refused(self, owner: Client) -> None:
        ana = await invite_and_sign_up(owner, "Ana")
        await owner.post(f"/api/admin/users/{ana.user_id}/deactivate")
        await join_as(owner, "Ana", "ana.second@example.com")

        response = await owner.post(f"/api/admin/users/{ana.user_id}/reactivate")
        assert response.status == 409, response.body


class TestSigningUp:
    async def test_two_people_cannot_share_a_name(self, owner: Client) -> None:
        await invite_and_sign_up(owner, "Ana")

        invite = await owner.post("/api/invites", {"expiresInDays": 1})
        token = invite.body["url"].split("/join/")[1]
        response = await owner.fork().post(
            "/api/auth/signup",
            {
                "email": "other@example.com",
                "password": PASSWORD,
                "displayName": "Ana",
                "inviteToken": token,
            },
        )
        assert response.status == 409

    @pytest.mark.parametrize("name", ["Ana", "ana", "ANA"])
    async def test_the_clash_ignores_case(self, owner: Client, name: str) -> None:
        await invite_and_sign_up(owner, "Ana")

        invite = await owner.post("/api/invites", {"expiresInDays": 1})
        token = invite.body["url"].split("/join/")[1]
        response = await owner.fork().post(
            "/api/auth/signup",
            {
                "email": "other@example.com",
                "password": PASSWORD,
                "displayName": name,
                "inviteToken": token,
            },
        )
        assert response.status == 409
