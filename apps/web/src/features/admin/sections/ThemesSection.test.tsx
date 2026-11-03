// @vitest-environment happy-dom
/**
 * The theme editor on shadcn's names: swatches come from `--primary`, a colour input
 * shows an oklch() value as the hex it is, the help text stays out of Blob's old token
 * vocabulary, and a saved theme keeps the colour names the server allowlists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Theme } from "@blob/shared";
import { api } from "../../../lib/api.ts";
import { useStore } from "../../../lib/store.ts";
import { ThemesSection } from "./ThemesSection.tsx";

function theme(slug: string, mode: Theme["mode"], tokens: Record<string, string>, isPreset = false): Theme {
  return { id: slug, slug, name: slug, mode, tokens, isPreset, isEnabled: true };
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

/** A theme's row in the list: the one that holds its Duplicate button. */
function row(name: string): HTMLElement {
  const button = screen.getByRole("button", { name: `Duplicate ${name}` });
  return button.closest('[role="listitem"]') as HTMLElement;
}

/** The colour a row's swatch carries, as the custom property it is painted from. */
function swatch(name: string): string {
  const media = row(name).querySelector<HTMLElement>('[data-slot="item-media"] > *')!;
  return media.style.getPropertyValue("--swatch");
}

/** The list with a preset in it, which is the one row that cannot be edited. */
function withPreset() {
  const preset = theme("b0", "light", {}, true);
  vi.spyOn(api.themes, "list").mockResolvedValue({ themes: [...THEMES, preset], groups: GROUPS });
  useStore.setState({ themes: [...THEMES, preset] } as never);
}

describe("the theme list", () => {
  it("draws each swatch from the theme's --primary, else b0's for its mode", async () => {
    render(<ThemesSection onError={vi.fn()} />);
    await screen.findByRole("button", { name: "Duplicate linen" });

    expect(swatch("linen")).toBe("#7a4f22");
    expect(swatch("plain-light")).toBe("#171717");
    expect(swatch("plain-dark")).toBe("#e5e5e5");
  });

  it("is a list: a name, its mode, and how much of the palette it overrides", async () => {
    withPreset();
    render(<ThemesSection onError={vi.fn()} />);
    await screen.findByRole("button", { name: "Duplicate linen" });

    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(within(row("linen")).getByText("light")).toBeTruthy();
    expect(within(row("linen")).getByText("1 tokens overridden")).toBeTruthy();
    expect(within(row("slate")).getByText("dark")).toBeTruthy();
    expect(within(row("plain-dark")).getByText("The built-in palette, unchanged")).toBeTruthy();
    expect(within(row("b0")).getByText("preset")).toBeTruthy();
  });

  it("offers a preset only Duplicate, and anything else Edit and Delete too", async () => {
    withPreset();
    render(<ThemesSection onError={vi.fn()} />);
    await screen.findByRole("button", { name: "Duplicate linen" });

    expect(within(row("b0")).queryByRole("button", { name: "Edit b0" })).toBeNull();
    expect(within(row("b0")).queryByRole("button", { name: "Delete b0" })).toBeNull();
    expect(within(row("linen")).getByRole("button", { name: "Edit linen" })).toBeTruthy();
    expect(within(row("linen")).getByRole("button", { name: "Delete linen" })).toBeTruthy();
  });
});

describe("editing", () => {
  it("shows an oklch() value in the colour input as the hex it names", async () => {
    render(<ThemesSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate slate" }));

    const primary = await screen.findByLabelText<HTMLInputElement>("primary");
    expect(primary.value).toBe("#171717");
    expect(screen.getByLabelText<HTMLInputElement>("background").value).toBe("#ffffff");
  });

  it("names a colour by the words beside it, and its Reset by the same ones", async () => {
    render(<ThemesSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate plain-light" }));

    // Left alone, there is nothing to reset.
    await screen.findByLabelText("primary");
    expect(screen.queryByRole("button", { name: /^Reset/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("primary"), { target: { value: "#123456" } });
    const reset = screen.getByRole("button", { name: "Reset primary to the built-in value" });
    fireEvent.click(reset);
    expect(screen.queryByRole("button", { name: /^Reset/ })).toBeNull();
  });

  it("groups its fields as the server does, one card to a group, in the server's order", async () => {
    render(<ThemesSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate linen" }));
    await screen.findByLabelText("primary");

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Surfaces",
      "Text",
      "Brand",
    ]);
    const brand = screen.getByRole("heading", { name: "Brand" }).closest('[data-slot="card"]') as HTMLElement;
    expect(within(brand).getByLabelText("primary")).toBeTruthy();
    expect(within(brand).getByLabelText("primary-foreground")).toBeTruthy();
    expect(within(brand).queryByLabelText("background")).toBeNull();
  });

  it("names the two fields that are not colours", async () => {
    render(<ThemesSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate linen" }));

    const name = await screen.findByRole("textbox", { name: "Theme name" });
    expect((name as HTMLInputElement).value).toBe("linen copy");
    expect((screen.getByRole("combobox", { name: "Mode" }) as HTMLSelectElement).value).toBe("light");
  });

  it("no longer talks about --accent-hover", async () => {
    render(<ThemesSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate linen" }));

    await waitFor(() => expect(screen.getByLabelText("primary")).toBeTruthy());
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
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate plain-light" }));
    const save = (await screen.findByRole("button", { name: "Save" })) as HTMLButtonElement;
    expect(screen.queryByRole("alert")).toBeNull();
    expect(save.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("foreground"), { target: { value: "#eeeeee" } });
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
    fireEvent.click(await screen.findByRole("button", { name: "Edit translucent" }));
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

  // The colour names are the server's (`services/themes.py` allowlists them by string and
  // groups the editor by their index), so an editor that renamed one — the label shows it
  // without its dashes, the input's value is a hex — would save a theme the server throws
  // away. Whatever it loaded under, it saves under.
  it("saves a theme under the same colour names it loaded", async () => {
    const loaded = theme("loaded", "light", {
      "--background": "#ffffff",
      "--primary": "#7a4f22",
      "--sidebar": "#f5f5f5",
    });
    vi.spyOn(api.themes, "list").mockResolvedValue({
      themes: [...THEMES, loaded],
      groups: {
        Surfaces: ["--background", "--sidebar"],
        Text: ["--foreground"],
        Brand: ["--primary", "--primary-foreground"],
      },
    });
    useStore.setState({ themes: [...THEMES, loaded] } as never);
    const saved = vi.spyOn(api.themes, "save").mockResolvedValue({ theme: loaded });
    // happy-dom loads no stylesheet, so stand in for the built-in palette the names it
    // was not given fall back to.
    const root = document.documentElement;
    root.style.setProperty("--foreground", "oklch(0.145 0 0)");
    root.style.setProperty("--primary-foreground", "oklch(0.985 0 0)");

    render(<ThemesSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit loaded" }));
    fireEvent.change(await screen.findByLabelText("primary"), { target: { value: "#123456" } });
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const posted = saved.mock.calls[0]![0];
    expect(Object.keys(posted.tokens).sort()).toEqual(Object.keys(loaded.tokens).sort());
    expect(posted.tokens["--primary"]).toBe("#123456");
    // The two it was not asked to touch are still the stored values.
    expect(posted.tokens["--background"]).toBe("#ffffff");
    expect(posted.tokens["--sidebar"]).toBe("#f5f5f5");
  });
});
