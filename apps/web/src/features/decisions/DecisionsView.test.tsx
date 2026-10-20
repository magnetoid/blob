// @vitest-environment happy-dom
/**
 * The decision log (M2 · A8): newest first, each with where it was made and who decided,
 * found by words or conversation, and changed only by its recorder or an admin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Decision } from "@blob/shared";
import { DecisionsView } from "./DecisionsView.tsx";
import { api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const decision = (overrides: Partial<Decision> = {}): Decision => ({
  id: "d1",
  channelId: "c1",
  channelName: "general",
  channelKind: "public",
  messageId: "m1",
  threadRootId: null,
  title: "Ship on Friday",
  rationale: "QA signs off Thursday.",
  decidedBy: "u1",
  proposedBy: null,
  proposedByName: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  revokedAt: null,
  revokedBy: null,
  ...overrides,
});

beforeEach(() => {
  useStore.setState({
    currentUser: { id: "u1", role: "member", displayName: "Ana" },
    users: {
      u1: { id: "u1", displayName: "Ana", kind: "human" },
      u2: { id: "u2", displayName: "Marko", kind: "human" },
    },
    channels: { c1: { id: "c1", name: "general", archivedAt: null } },
  } as never);
});

describe("the decision log", () => {
  it("lists what was decided, where, by whom and why", async () => {
    vi.spyOn(api.decisions, "list").mockResolvedValue({
      decisions: [
        decision(),
        decision({
          id: "d2",
          title: "Weekly demos",
          rationale: "",
          decidedBy: "u2",
          proposedBy: "p1",
          proposedByName: "Janus",
        }),
      ],
    });
    render(<DecisionsView />);
    const list = await screen.findByRole("list", { name: "Decisions" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(within(first!).getByText("Ship on Friday")).toBeTruthy();
    expect(within(first!).getByText("QA signs off Thursday.")).toBeTruthy();
    expect(
      within(first!).getByRole("button", { name: "#general" }),
    ).toBeTruthy();
    expect(first!.textContent).toContain("decided by Ana");
    expect(second!.textContent).toContain(
      "decided by Marko, proposed by Janus",
    );
    // Ana recorded the first and may change it; the second is Marko's.
    expect(within(first!).getByRole("button", { name: "Revoke" })).toBeTruthy();
    expect(
      within(second!).queryByRole("button", { name: "Revoke" }),
    ).toBeNull();
  });

  it("asks again with the words typed and the conversation chosen", async () => {
    const list = vi
      .spyOn(api.decisions, "list")
      .mockResolvedValue({ decisions: [] });
    render(<DecisionsView />);
    await screen.findByText("Nothing decided yet");
    fireEvent.change(screen.getByLabelText("Find a decision"), {
      target: { value: "friday" },
    });
    fireEvent.change(screen.getByLabelText("Conversation"), {
      target: { value: "c1" },
    });
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        q: "friday",
        channelId: "c1",
        revoked: false,
      }),
    );
    expect(await screen.findByText("Nothing matches")).toBeTruthy();
  });

  it("revokes one, and shows one that no longer stands struck through", async () => {
    const revoke = vi
      .spyOn(api.decisions, "revoke")
      .mockResolvedValue(decision());
    vi.spyOn(api.decisions, "list").mockResolvedValue({
      decisions: [
        decision(),
        decision({
          id: "d3",
          title: "Old plan",
          revokedAt: new Date().toISOString(),
        }),
      ],
    });
    render(<DecisionsView />);
    const list = await screen.findByRole("list", { name: "Decisions" });
    const [standing, gone] = within(list).getAllByRole("listitem");
    expect(gone!.getAttribute("data-standing")).toBe("false");
    expect(gone!.textContent).toContain("no longer stands");
    fireEvent.click(within(standing!).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("d1", true));
    fireEvent.click(within(gone!).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("d3", false));
  });

  it("rewords one in the dialog", async () => {
    const change = vi
      .spyOn(api.decisions, "change")
      .mockResolvedValue(decision());
    vi.spyOn(api.decisions, "list").mockResolvedValue({
      decisions: [decision()],
    });
    render(<DecisionsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const field = await screen.findByLabelText("What was decided");
    fireEvent.change(field, { target: { value: "Ship on Monday" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith("d1", {
        title: "Ship on Monday",
        rationale: "QA signs off Thursday.",
      }),
    );
  });
});
