// @vitest-environment happy-dom
/** A diff is text drawn with colour. The first character is the whole grammar. */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffView } from "./DiffView.tsx";
import { classify, diffStats, parseDiff } from "./diff.ts";

const SAMPLE = [
  "diff --git a/x.py b/x.py",
  "--- a/x.py",
  "+++ b/x.py",
  "@@ -1,2 +1,3 @@",
  " x = 1",
  "-y = 2",
  "+y = 3",
  "+limit = 30",
  "\\ No newline at end of file",
].join("\n");

describe("classifying lines", () => {
  it("tells files, hunks, additions, removals, context and notes apart", () => {
    expect(classify("--- a/x")).toBe("file");
    expect(classify("+++ b/x")).toBe("file");
    expect(classify("@@ -1 +1 @@")).toBe("hunk");
    expect(classify("+added")).toBe("add");
    expect(classify("-removed")).toBe("del");
    expect(classify(" context")).toBe("ctx");
    expect(classify("\\ No newline at end of file")).toBe("meta");
    expect(classify("diff --git a b")).toBe("meta");
  });

  it("counts only real additions and removals, not file headers", () => {
    // `---`/`+++` start with the same characters as a removal and an addition. A naive
    // count would report every diff as one line longer on each side than it is.
    expect(diffStats(parseDiff(SAMPLE))).toEqual({ added: 2, removed: 1 });
  });

  it("accepts Windows line endings", () => {
    expect(parseDiff("+a\r\n-b\r\n").map((l) => l.kind)).toEqual([
      "add",
      "del",
      "ctx",
    ]);
  });
});

describe("the view", () => {
  it("renders every line as text with its kind, and the totals", () => {
    render(<DiffView body={SAMPLE} />);
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("−1")).toBeTruthy();
    expect(document.querySelectorAll(".diff-add")).toHaveLength(2);
    expect(document.querySelectorAll(".diff-del")).toHaveLength(1);
    // Text, not markup: a diff line that looks like HTML stays a diff line.
    render(<DiffView body={"+<script>alert(1)</script>"} />);
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("+<script>alert(1)</script>")).toBeTruthy();
  });
});
