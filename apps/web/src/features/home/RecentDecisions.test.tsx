// @vitest-environment happy-dom
/** Home's "Decided recently": drawn only when something was decided in the last two weeks. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Decision } from "@blob/shared";
import { RecentDecisions } from "./RecentDecisions.tsx";
import { api } from "../../lib/api.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const at = (daysAgo: number, title: string): Decision =>
  ({
    id: title,
    channelId: "c1",
    channelName: "general",
    messageId: null,
    title,
    createdAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    revokedAt: null,
  }) as Decision;

describe("decided recently", () => {
  it("shows the last two weeks’ decisions, and the way to the rest", async () => {
    vi.spyOn(api.decisions, "list").mockResolvedValue({
      decisions: [
        at(1, "Ship on Friday"),
        at(3, "Weekly demos"),
        at(30, "Old news"),
      ],
    });
    render(<RecentDecisions />);
    expect(await screen.findByText("Ship on Friday")).toBeTruthy();
    expect(screen.getByText("Weekly demos")).toBeTruthy();
    expect(screen.queryByText("Old news")).toBeNull();
    expect(screen.getByRole("button", { name: "All decisions" })).toBeTruthy();
  });

  it("draws nothing when nothing was decided lately", async () => {
    const list = vi
      .spyOn(api.decisions, "list")
      .mockResolvedValue({ decisions: [at(40, "Long ago")] });
    const { container } = render(<RecentDecisions />);
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.textContent).toBe("");
  });
});
