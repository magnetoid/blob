// @vitest-environment happy-dom
/**
 * The Storage page. Pinned: each kind is a row with its count and size; a sweep that has
 * never run says so rather than reading as one that removed nothing; a sweep that ran
 * says what went; and the bucket's probe is read in words.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { api, type AdminStorage } from "../../../lib/api.ts";
import { StorageSection } from "./StorageSection.tsx";

const KEPT: AdminStorage = {
  probe: "ok",
  totalBytes: 3 * 1024 * 1024 + 50 * 1024,
  byKind: [
    { kind: "file", count: 12, bytes: 3 * 1024 * 1024 },
    { kind: "voice", count: 1, bytes: 50 * 1024 },
  ],
  orphans: 2,
  lastSweep: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function card(title: string) {
  return within(
    screen.getByRole("heading", { name: title }).closest("section")!,
  );
}

describe("what is kept", () => {
  it("lists each kind with its count and size, and the total", async () => {
    vi.spyOn(api.admin, "storage").mockResolvedValue(KEPT);
    render(<StorageSection onError={vi.fn()} isOwner />);

    const files = (
      await screen.findByRole("rowheader", { name: "Files" })
    ).closest("tr")!;
    expect(within(files).getByText("12")).toBeTruthy();
    expect(within(files).getByText("3.0 MB")).toBeTruthy();

    const voice = screen
      .getByRole("rowheader", { name: "Voice messages" })
      .closest("tr")!;
    expect(within(voice).getByText("1")).toBeTruthy();
    expect(within(voice).getByText("50 KB")).toBeTruthy();

    const total = screen
      .getByRole("rowheader", { name: "Total" })
      .closest("tr")!;
    expect(within(total).getByText("13")).toBeTruthy();
    expect(within(total).getByText("3.0 MB")).toBeTruthy();

    expect(
      card("What is kept").getByText(/2 uploads began and never reached/),
    ).toBeTruthy();
    expect(card("Bucket").getByText("Reachable from a browser.")).toBeTruthy();
  });

  it("says the sweep has never run rather than that it removed nothing", async () => {
    vi.spyOn(api.admin, "storage").mockResolvedValue(KEPT);
    render(<StorageSection onError={vi.fn()} isOwner />);
    await screen.findByRole("heading", { name: "Last sweep" });
    expect(card("Last sweep").getByText("Never run yet.")).toBeTruthy();
    expect(screen.queryByTestId("sweep-outcome")).toBeNull();
  });

  it("says what the last sweep removed", async () => {
    vi.spyOn(api.admin, "storage").mockResolvedValue({
      ...KEPT,
      orphans: 0,
      lastSweep: {
        ranAt: "2026-10-28T04:00:00Z",
        removed: 3,
        bytes: 4096,
        error: null,
      },
    });
    render(<StorageSection onError={vi.fn()} isOwner />);
    const outcome = await screen.findByTestId("sweep-outcome");
    expect(outcome.textContent).toMatch(/removed 3 uploads \(4 KB\)/);
    expect(
      card("What is kept").getByText("No upload is waiting to be swept."),
    ).toBeTruthy();
  });

  it("shows a failed sweep with its reason", async () => {
    vi.spyOn(api.admin, "storage").mockResolvedValue({
      ...KEPT,
      probe: "unreachable",
      lastSweep: {
        ranAt: "2026-10-28T04:00:00Z",
        removed: 0,
        bytes: 0,
        error: "bucket gone",
      },
    });
    render(<StorageSection onError={vi.fn()} isOwner />);
    const outcome = await screen.findByTestId("sweep-outcome");
    expect(outcome.textContent).toMatch(/Failed .*: bucket gone/);
    expect(card("Bucket").getByText(/Unreachable from a browser/)).toBeTruthy();
  });
});
