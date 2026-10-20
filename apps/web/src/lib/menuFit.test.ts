/** Where a menu's panel goes: below, above, or capped (components/Menu.tsx). */
import { describe, expect, it } from "vitest";
import { fitPanel } from "./menuFit.ts";

const VIEW = { top: 100, bottom: 800 };

describe("fitting a menu to the room it has", () => {
  it("stays below its trigger when it fits there", () => {
    expect(fitPanel({ height: 300 }, { top: 200, bottom: 230 }, VIEW)).toEqual({
      above: false,
      maxHeight: null,
    });
  });

  it("goes above at the foot of a scroll area — the newest message’s •••", () => {
    expect(fitPanel({ height: 300 }, { top: 700, bottom: 730 }, VIEW)).toEqual({
      above: true,
      maxHeight: null,
    });
  });

  it("takes the roomier side and scrolls when it fits on neither", () => {
    expect(fitPanel({ height: 900 }, { top: 500, bottom: 530 }, VIEW)).toEqual({
      above: true,
      maxHeight: 396,
    });
    expect(fitPanel({ height: 900 }, { top: 300, bottom: 330 }, VIEW)).toEqual({
      above: false,
      maxHeight: 466,
    });
  });

  it("never caps a panel shorter than is worth scrolling", () => {
    expect(
      fitPanel(
        { height: 900 },
        { top: 150, bottom: 180 },
        { top: 100, bottom: 260 },
      ),
    ).toEqual({
      above: false,
      maxHeight: 120,
    });
  });
});
