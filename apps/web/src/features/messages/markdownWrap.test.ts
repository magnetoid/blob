import { describe, expect, it } from "vitest";
import { codeMarkers, wrapSelection } from "./markdownWrap.ts";

describe("wrapSelection", () => {
  it("wraps what is selected and keeps it selected", () => {
    const out = wrapSelection("say hello there", 4, 9, "**");
    expect(out.text).toBe("say **hello** there");
    expect(out.text.slice(out.selectionStart, out.selectionEnd)).toBe("hello");
  });

  it("unwraps when the markers are inside the selection", () => {
    const out = wrapSelection("say **hello** there", 4, 13, "**");
    expect(out.text).toBe("say hello there");
    expect(out.text.slice(out.selectionStart, out.selectionEnd)).toBe("hello");
  });

  it("unwraps when the markers are just outside it", () => {
    const out = wrapSelection("say **hello** there", 6, 11, "**");
    expect(out.text).toBe("say hello there");
    expect(out.text.slice(out.selectionStart, out.selectionEnd)).toBe("hello");
  });

  it("takes a different closing marker, as a link does", () => {
    const out = wrapSelection("see docs", 4, 8, "[", "](url)");
    expect(out.text).toBe("see [docs](url)");
  });
});

describe("codeMarkers", () => {
  it("is inline for one line and fenced for several", () => {
    expect(codeMarkers("x = 1")).toEqual(["`", "`"]);
    expect(codeMarkers("x = 1\ny = 2")).toEqual(["```\n", "\n```"]);
  });
});
