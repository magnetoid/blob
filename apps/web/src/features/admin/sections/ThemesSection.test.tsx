// @vitest-environment happy-dom
/**
 * The theme editor on shadcn's names: swatches come from `--primary`, a colour input
 * shows an oklch() value as the hex it is, and the help text stays out of Blob's old
 * token vocabulary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Theme } from "@blob/shared";
import { api } from "../../../lib/api.ts";
import { useStore } from "../../../lib/store.ts";
import { ThemesSection } from "./ThemesSection.tsx";

function theme(slug: string, mode: Theme["mode"], tokens: Record<string, string>): Theme {
  return { id: slug, slug, name: slug, mode, tokens, isPreset: false, isEnabled: true };
}

const THEMES = [
  theme("linen", "light", { "--primary": "#7a4f22" }),
  theme("slate", "dark", { "--primary": "oklch(0.205 0 0)", "--background": "oklch(1 0 0)" }),
  theme("plain-light", "light", {}),
  theme("plain-dark", "dark", {}),
];

const GROUPS = {
  Surfaces: ["--background"],
  Text: ["--foreground"],
  Brand: ["--primary", "--primary-foreground"],
};

beforeEach(() => {
  vi.spyOn(api.themes, "list").mockResolvedValue({ themes: THEMES, groups: GROUPS });
  useStore.setState({ themes: THEMES, currentUser: null } as never);
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function swatch(name: string): HTMLElement {
  const row = screen.getByLabelText(`Duplicate ${name}`).closest(".admin-row")!;
  return row.querySelector<HTMLElement>(".theme-swatch")!;
}

describe("the theme list", () => {
  it("draws each swatch from the theme's --primary, else b0's for its mode", async () => {
    render(<ThemesSection onError={vi.fn()} />);
    await screen.findByLabelText("Duplicate linen");

    expect(swatch("linen").style.background).toBe("#7a4f22");
    expect(swatch("plain-light").style.background).toBe("#171717");
    expect(swatch("plain-dark").style.background).toBe("#e5e5e5");
  });
});

describe("editing", () => {
  it("shows an oklch() value in the colour input as the hex it names", async () => {
    render(<ThemesSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText("Duplicate slate"));

    const primary = await screen.findByLabelText<HTMLInputElement>("--primary");
    expect(primary.value).toBe("#171717");
    expect(screen.getByLabelText<HTMLInputElement>("--background").value).toBe("#ffffff");
  });

  it("no longer talks about --accent-hover", async () => {
    render(<ThemesSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText("Duplicate linen"));

    await waitFor(() => expect(screen.getByLabelText("--primary")).toBeTruthy());
    expect(document.body.textContent).not.toContain("--accent-hover");
  });

  it("holds Save while a pair is unreadable, naming the pair", async () => {
    // happy-dom loads no stylesheet, so stand in for the built-in palette.
    const root = document.documentElement;
    root.style.setProperty("--background", "oklch(1 0 0)");
    root.style.setProperty("--foreground", "oklch(0.145 0 0)");
    root.style.setProperty("--primary", "oklch(0.205 0 0)");
    root.style.setProperty("--primary-foreground", "oklch(0.985 0 0)");

    render(<ThemesSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText("Duplicate plain-light"));
    const save = (await screen.findByRole("button", { name: "Save" })) as HTMLButtonElement;
    expect(screen.queryByRole("alert")).toBeNull();
    expect(save.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("--foreground"), { target: { value: "#eeeeee" } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("primary text on page is 1.16:1");
    expect(save.disabled).toBe(true);
  });

  it("saves a theme opened and left untouched exactly as it was stored", async () => {
    // Opening an editor must not round-trip a value through the colour input: that only
    // takes #rrggbb, so a pass through it would drop a translucent colour's alpha and
    // rewrite oklch() as hex. The tokens posted are the stored ones, byte for byte.
    //
    // `expected` is its own frozen literal and the theme gets a copy of it, so an editor
    // that mutated the stored tokens in place would change the copy and not the thing the
    // posted tokens are compared with — and could not touch `expected` at all.
    const expected = Object.freeze({
      "--primary": "oklch(0.205 0 0)",
      "--border": "oklch(1 0 0 / 10%)",
      "--input": "oklch(1 0 0 / 15%)",
      "--ring": "rgba(23, 23, 23, 0.5)",
      "--sidebar": "#FAFAFA",
    });
    const translucent = theme("translucent", "light", { ...expected });
    vi.spyOn(api.themes, "list").mockResolvedValue({
      themes: [...THEMES, translucent],
      groups: { ...GROUPS, Lines: ["--border", "--input", "--ring", "--sidebar"] },
    });
    useStore.setState({ themes: [...THEMES, translucent] } as never);
    const saved = vi.spyOn(api.themes, "save").mockResolvedValue({ theme: translucent });
    // happy-dom loads no stylesheet, so stand in for the built-in palette.
    const root = document.documentElement;
    root.style.setProperty("--background", "oklch(1 0 0)");
    root.style.setProperty("--foreground", "oklch(0.145 0 0)");
    root.style.setProperty("--primary-foreground", "oklch(0.985 0 0)");

    render(<ThemesSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText("Edit translucent"));
    const save = (await screen.findByRole("button", { name: "Save" })) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const posted = saved.mock.calls[0]![0];
    expect(posted.id).toBe("translucent");
    expect(posted.mode).toBe("light");
    expect(posted.tokens).toEqual(expected);
    expect(JSON.stringify(posted.tokens)).toBe(JSON.stringify(expected));
    // And the stored theme itself was not edited in place on the way through.
    expect(translucent.tokens).toEqual(expected);
  });
});
