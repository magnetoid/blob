// @vitest-environment happy-dom
/**
 * The one place Blob runs something an agent wrote, so the contract is pinned exactly:
 * nothing runs until a person asks; when it runs it is in a frame that allows scripts and
 * nothing else; and the document carries a policy that forbids every kind of network.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WorkArtifact } from "@blob/shared";
import { WorkPreview } from "./WorkPreview.tsx";
import { PREVIEW_CSP, framedDocument } from "./preview.ts";

afterEach(cleanup);

function artifact(overrides: Partial<WorkArtifact> = {}): WorkArtifact {
  return {
    id: "a1",
    workId: "w1",
    runId: null,
    kind: "html",
    title: "Preview",
    body: '<h1>hello</h1><script>fetch("https://evil.example")</script>',
    authorUserId: "bot1",
    createdAt: "2026-09-05T10:00:00.000Z",
    ...overrides,
  };
}

describe("framing the document", () => {
  it("puts the policy first in an existing head", () => {
    const out = framedDocument(
      "<html><head><title>x</title></head><body>hi</body></html>",
    );
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(
      out.indexOf("<title>"),
    );
  });

  it("adds a head when the page has none, and wraps a fragment", () => {
    expect(framedDocument("<html><body>hi</body></html>")).toContain(
      "<head><meta http-equiv",
    );
    const fragment = framedDocument("<p>just this</p>");
    expect(fragment.startsWith("<!doctype html>")).toBe(true);
    expect(fragment).toContain("<p>just this</p>");
  });

  it("the policy forbids every kind of network", () => {
    expect(PREVIEW_CSP).toContain("default-src 'none'");
    expect(PREVIEW_CSP).toContain("connect-src 'none'");
    expect(PREVIEW_CSP).toContain("form-action 'none'");
    expect(PREVIEW_CSP).toContain("frame-src 'none'");
    expect(PREVIEW_CSP).not.toContain("allow-same-origin");
  });
});

describe("running a page", () => {
  it("does nothing until asked", () => {
    render(<WorkPreview artifact={artifact()} />);
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("button", { name: /run preview/i })).toBeTruthy();
  });

  it("runs in a frame that allows scripts and nothing else", () => {
    render(<WorkPreview artifact={artifact()} />);
    fireEvent.click(screen.getByRole("button", { name: /run preview/i }));

    const frame = document.querySelector("iframe");
    expect(frame).not.toBeNull();
    // Exactly `allow-scripts`. `allow-same-origin` beside it would hand the page the
    // person's session; `allow-top-navigation` would let it walk out of the box.
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame?.getAttribute("srcdoc")).toContain("Content-Security-Policy");
    expect(frame?.getAttribute("src")).toBeNull();
  });

  it("renders markdown as a document, never as a frame", () => {
    // The message renderer's subset: no headings, so `# Plan` stays literal text — a
    // document here reads like a message would, which is the point of sharing the renderer.
    render(
      <WorkPreview
        artifact={artifact({ kind: "markdown", body: "**Plan**\n\nstep one" })}
      />,
    );
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText("step one")).toBeTruthy();
  });
});
