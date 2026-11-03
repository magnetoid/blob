// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const health = vi.fn();
const serverLogs = vi.fn();
const audit = vi.fn();
const navigate = vi.fn();
let socketListener: ((event: { t: string }) => void) | null = null;
let statusListener: ((status: "connecting" | "online" | "offline") => void) | null =
  null;

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
}

const storage = new MemoryStorage();
Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

vi.mock("../../../../lib/api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api.ts")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      admin: {
        ...actual.api.admin,
        health,
        serverLogs,
        audit,
        clientErrors: vi.fn(async () => ({ errors: [] })),
      },
    },
  };
});

vi.mock("../../../../lib/socket.ts", () => ({
  socket: {
    subscribe: (listener: (event: { t: string }) => void) => {
      socketListener = listener;
      return () => {
        socketListener = null;
      };
    },
    onStatus: (listener: (status: "connecting" | "online" | "offline") => void) => {
      statusListener = listener;
      return () => {
        statusListener = null;
      };
    },
  },
}));

vi.mock("../../../../lib/router.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/router.ts")>();
  return {
    ...actual,
    navigate,
  };
});

const { HealthSection } = await import("./HealthSection.tsx");

function seed() {
  health.mockResolvedValue({
    database: true,
    redis: true,
    mail: "ok",
    push: true,
    storage: "ok",
    queueDepth: 3,
    connections: 12,
    usersOnline: 7,
    messageCount: 420,
    storageBytes: 4096,
    version: "0.1.0",
  });
  serverLogs.mockResolvedValue({
    capacity: 500,
    entries: [
      {
        at: "2026-09-08T10:00:00.000Z",
        level: "WARNING",
        logger: "blob.worker",
        message: "Queue is backing up",
        detail: null,
        path: null,
        method: null,
      },
    ],
  });
  audit.mockResolvedValue({
    events: [
      {
        id: "a1",
        action: "settings.updated",
        actorId: "u1",
        actorName: "Marko",
        targetType: "workspace",
        targetId: "w1",
        targetLabel: "Blob",
        metadata: {},
        ip: "127.0.0.1",
        createdAt: "2026-09-08T10:01:00.000Z",
      },
    ],
  });
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  health.mockReset();
  serverLogs.mockReset();
  audit.mockReset();
  navigate.mockReset();
  socketListener = null;
  statusListener = null;
  window.localStorage.clear();
  seed();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the health dashboard", () => {
  it("gives an admin who does not run the server everything but the server's log", async () => {
    const onError = vi.fn();
    render(<HealthSection onError={onError} />);
    expect(await screen.findByText("Database")).toBeTruthy();
    expect(serverLogs).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalledWith(expect.any(String));
    // The tiles are not links to a page this viewer cannot open, and there is no Logs filter.
    expect(screen.getByText("Database").closest("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Logs" })).toBeNull();
  });

  it("loads the live widgets and drills into the selected metric", async () => {
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);

    expect(await screen.findByText("Summary metrics")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Focus Messages" }));

    expect(await screen.findByText("Messages detail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open detailed report" }));
    expect(navigate).toHaveBeenCalledWith("/admin/audit");
  });

  it("refreshes when the websocket reports live activity", async () => {
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await screen.findByText("Realtime trends");

    health.mockResolvedValueOnce({
      database: true,
      redis: true,
      mail: "ok",
      push: true,
      storage: "ok",
      queueDepth: 4,
      connections: 14,
      usersOnline: 8,
      messageCount: 421,
      storageBytes: 4096,
      version: "0.1.0",
    });

    socketListener?.({ t: "message.new" });
    await new Promise((resolve) => window.setTimeout(resolve, 300));

    await waitFor(() => expect(health).toHaveBeenCalledTimes(2));
    expect(statusListener).toBeTruthy();
  });

  it("persists hidden widgets across sessions", async () => {
    const view = render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await screen.findByText("Recent activity");

    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide activity widget" }));
    expect(screen.getByRole("button", { name: "Add activity" })).toBeTruthy();

    view.unmount();
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);

    expect(await screen.findByRole("button", { name: "Add activity" })).toBeTruthy();
  });

  it("keeps the layout controls out of the way until the layout is being edited", async () => {
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await screen.findByText("Recent activity");

    expect(screen.queryByRole("button", { name: "Hide activity widget" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset layout" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    expect(screen.getByRole("button", { name: "Hide activity widget" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset layout" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: "Hide activity widget" })).toBeNull();
  });
});

/** The card a widget is drawn in, by its title. */
function widget(title: string) {
  return within(screen.getByRole("heading", { name: title }).closest('[data-slot="card"]')! as HTMLElement);
}

/** The page once it has its first reading: every widget is drawn. */
async function loaded() {
  await screen.findByRole("heading", { name: "Recent activity" });
}

describe("the widgets", () => {
  it("draws each as a card with a heading, and says when it has not heard yet", async () => {
    let answer: (value: unknown) => void = () => undefined;
    health.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    expect(screen.getByText("Waiting for the first live sample.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Service status" })).toBeNull();

    answer({
      database: true,
      redis: true,
      mail: "ok",
      push: true,
      storage: "ok",
      queueDepth: 3,
      connections: 12,
      usersOnline: 7,
      messageCount: 420,
      storageBytes: 4096,
      version: "0.1.0",
    });
    for (const title of [
      "Service status",
      "Summary metrics",
      "Realtime trends",
      "Live sockets detail",
      "Recent activity",
      "Errors in browsers",
    ]) {
      expect((await screen.findByRole("heading", { name: title })).tagName).toBe("H2");
    }
  });

  it("says health is unavailable when the first reading fails, and tells the frame why", async () => {
    health.mockRejectedValue(new Error("Health is down."));
    const onError = vi.fn();
    render(<HealthSection onError={onError} isInstanceAdmin />);
    expect(await screen.findByText("Health unavailable.")).toBeTruthy();
    expect(onError).toHaveBeenCalledWith("Health is down.");
  });

  it("reads each service in words, and goes to the log from a tile only for the server's admin", async () => {
    health.mockResolvedValue({
      database: false,
      redis: true,
      mail: "unconfigured",
      push: false,
      storage: "private",
      queueDepth: 3,
      connections: 12,
      usersOnline: 7,
      messageCount: 420,
      storageBytes: 4096,
      version: "0.1.0",
    });
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await loaded();
    const services = widget("Service status");
    expect(await services.findByText("Down")).toBeTruthy();
    expect(services.getByText("Not configured")).toBeTruthy();
    expect(services.getByText("No keys")).toBeTruthy();
    expect(services.getByText("Not public")).toBeTruthy();
    // A tile that is a control says so, and goes to the server's log.
    fireEvent.click(services.getByRole("button", { name: /Database/ }));
    expect(navigate).toHaveBeenCalledWith("/server/logs");
  });

  it("offers a backup now only to the server's admin, and only when backups are on", async () => {
    health.mockResolvedValue({
      database: true,
      redis: true,
      mail: "ok",
      push: true,
      storage: "ok",
      queueDepth: 0,
      connections: 0,
      usersOnline: 0,
      messageCount: 0,
      storageBytes: 0,
      version: "0.1.0",
      backup: { enabled: true, at: null, ok: true, bytes: null, error: null },
    });
    const plain = render(<HealthSection onError={vi.fn()} />);
    await screen.findByText("Database");
    expect(screen.queryByRole("button", { name: "Back up now" })).toBeNull();
    plain.unmount();

    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    expect(await screen.findByRole("button", { name: "Back up now" })).toBeTruthy();
  });

  it("keeps focus on Move later when the widget reaches the end, where it goes inert", async () => {
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await screen.findByText("Recent activity");
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
    // The detail widget is second from last: one move later makes it last, so the button
    // that was just pressed has nowhere left to go.
    const later = screen.getByRole("button", { name: "Move later, detail widget" });
    later.focus();
    fireEvent.click(later);

    const now = screen.getByRole("button", { name: "Move later, detail widget" });
    expect(now.getAttribute("aria-disabled")).toBe("true");
    // Inert, not natively disabled: a browser drops focus from a button that becomes so.
    expect(now.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(now);
    fireEvent.click(now);
    const order = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(order.indexOf("Live sockets detail")).toBeGreaterThan(order.indexOf("Recent activity"));
  });

  it("moves, resizes and hides a widget from its own buttons, named by the widget", async () => {
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await screen.findByText("Recent activity");
    fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));

    // The first cannot move earlier and the last cannot move later.
    expect(
      screen.getByRole("button", { name: "Move earlier, services widget" }).getAttribute("aria-disabled") ??
        (screen.getByRole("button", { name: "Move earlier, services widget" }) as HTMLButtonElement).disabled,
    ).toBeTruthy();

    const detail = screen.getByRole("heading", { name: "Live sockets detail" }).closest('[data-slot="card"]')!;
    expect(detail.getAttribute("data-widget-size")).toBe("standard");
    fireEvent.click(within(detail as HTMLElement).getByRole("button", { name: "Wide, detail widget" }));
    expect(detail.getAttribute("data-widget-size")).toBe("wide");
    expect(within(detail as HTMLElement).getByRole("button", { name: "Standard width, detail widget" })).toBeTruthy();

    const trends = screen.getByRole("heading", { name: "Realtime trends" }).closest('[data-slot="card"]')!;

    const order = () =>
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(order().indexOf("Realtime trends")).toBeLessThan(order().indexOf("Live sockets detail"));
    fireEvent.click(within(trends as HTMLElement).getByRole("button", { name: "Move later, trends widget" }));
    expect(order().indexOf("Realtime trends")).toBeGreaterThan(order().indexOf("Live sockets detail"));
  });
});

describe("busy", () => {
  it("is said for the first load only, and not on every refresh after it", async () => {
    const seen = {
      database: true,
      redis: true,
      mail: "ok",
      push: true,
      storage: "ok",
      queueDepth: 3,
      connections: 12,
      usersOnline: 7,
      messageCount: 420,
      storageBytes: 4096,
      version: "0.1.0",
    };
    let answer: (value: unknown) => void = () => undefined;
    health.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const { container } = render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    // The first reading is on its way: the cards standing in for the widgets are busy.
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);

    answer(seen);
    await loaded();
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);

    // A socket event asks again, as it does most of the time the page is open; while that
    // request is out the page says so in words and no widget is announced as busy.
    let second: (value: unknown) => void = () => undefined;
    health.mockReturnValueOnce(new Promise((resolve) => (second = resolve)));
    socketListener?.({ t: "message.new" });
    expect(await screen.findByText(/Refreshing now…/)).toBeTruthy();
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
    second(seen);
    await waitFor(() => expect(screen.queryByText(/Refreshing now…/)).toBeNull());
  });
});

describe("the activity feed", () => {
  it("says the level of a log in words, not only in the colour down its edge", async () => {
    serverLogs.mockResolvedValue({
      capacity: 500,
      entries: [
        {
          at: "2026-09-08T10:00:00.000Z",
          level: "ERROR",
          logger: "blob.api",
          message: "Unhandled error",
          detail: null,
          path: null,
          method: null,
        },
        {
          at: "2026-09-08T10:00:30.000Z",
          level: "WARNING",
          logger: "blob.worker",
          message: "Queue is backing up",
          detail: null,
          path: null,
          method: null,
        },
        {
          at: "2026-09-08T10:00:40.000Z",
          level: "INFO",
          logger: "blob.worker",
          message: "Plain note",
          detail: null,
          path: null,
          method: null,
        },
      ],
    });
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await loaded();
    const list = await widget("Recent activity").findByRole("list", { name: "Recent activity" });
    const row = (text: string) => within(list).getByText(text).closest('[role="listitem"]') as HTMLElement;
    expect(within(row("Unhandled error")).getByText("Error")).toBeTruthy();
    expect(within(row("Queue is backing up")).getByText("Warning")).toBeTruthy();
    // An ordinary record and an audit event have no level to say.
    expect(within(row("Plain note")).queryByText(/^(Error|Warning)$/)).toBeNull();
    expect(within(row("settings updated")).queryByText(/^(Error|Warning)$/)).toBeNull();
  });

  it("merges logs and audit, and filters to one kind, pressed shown", async () => {
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await loaded();
    const feed = widget("Recent activity");
    const list = await feed.findByRole("list", { name: "Recent activity" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Queue is backing up")).toBeTruthy();
    expect(within(list).getByText("settings updated")).toBeTruthy();

    const filter = feed.getByRole("group", { name: "Show" });
    expect(within(filter).getByRole("button", { name: "Everything", pressed: true })).toBeTruthy();
    fireEvent.click(within(filter).getByRole("button", { name: "Audit" }));
    expect(within(filter).getByRole("button", { name: "Audit", pressed: true })).toBeTruthy();
    expect(within(feed.getByRole("list", { name: "Recent activity" })).getAllByRole("listitem")).toHaveLength(1);

    // The one that is chosen stays chosen.
    fireEvent.click(within(filter).getByRole("button", { name: "Audit" }));
    expect(within(filter).getByRole("button", { name: "Audit", pressed: true })).toBeTruthy();

    fireEvent.click(within(filter).getByRole("button", { name: "Logs" }));
    expect(feed.getByText("Queue is backing up")).toBeTruthy();
    expect(feed.queryByText("settings updated")).toBeNull();
  });
});

describe("the trend chart", () => {
  it("draws a bar per sample: a whole column to press, with the bar drawn inside it", async () => {
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await loaded();
    const chart = widget("Realtime trends");
    const column = await chart.findByRole("button", { name: /^Live sockets at .*: 12$/ });
    const bar = column.querySelector("span")!;
    // happy-dom has no layout, so what is pinned is the classes that give the sizes.
    //
    // The button is the target: the plot's full height whatever the value, so a low bar is
    // as easy to press as a high one, and its focus ring and pinned outline are drawn on a
    // box that is not scaled. It carries no scale and no colour of its own.
    expect(column.className).toContain("self-stretch");
    expect(column.className).toContain("flex-1");
    expect(column.className).not.toContain("scale-y");
    expect(column.className).not.toContain("bg-chart");
    expect(column.className).toContain("group");
    expect(column.className).toContain("focus-visible:ring-3");
    // Not a bare `outline-none`: it sets the style variable the pinned outline reads, and the
    // outline would never be drawn.
    expect(column.className.split(" ")).not.toContain("outline-none");
    expect(column.className).toContain("aria-pressed:outline-2");
    expect(bar.className).toContain("self-stretch");

    // The bar is the part that is scaled, from the bottom, by its share of the largest —
    // data, so it rides in a custom property — and it is coloured from the theme's chart
    // palette, never a literal. It is decoration: the button is what is named.
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(bar.className).toContain("origin-bottom");
    expect(bar.className).toContain("scale-y-(--bar-scale)");
    expect(bar.className).toContain("bg-chart-2");
    expect(bar.style.getPropertyValue("--bar-scale")).toBe("1");
    // Tailwind's `scale-y-*` sets the `scale` property, so that is what has to transition;
    // `transition-transform` listing `transform` would leave the height jumping.
    expect(bar.className).toContain("transition-[scale,background-color]");
    expect(bar.className).not.toContain("transition-[transform");
    // Hover, focus and the pinned moment move the bar's colour from the column it is in.
    for (const state of ["group-hover:", "group-focus-visible:", "group-aria-pressed:"]) {
      expect(bar.className).toContain(state);
    }
    expect(column.getAttribute("aria-pressed")).toBe("false");
  });

  it("lets the bars shrink to fit, so the newest are never cut off", async () => {
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await loaded();
    const chart = widget("Realtime trends");
    const column = await chart.findByRole("button", { name: /^Live sockets at / });
    const plot = column.closest('[data-slot="trend-plot"]')!;
    // 96 columns of 14px with 6px between them are two thousand pixels in a box that clips:
    // the right-hand end, the newest samples, went first. A column may now be as narrow as
    // it has to be, and the space between bars is part of the column — a margin on the bar,
    // so it shrinks with it — rather than a gap that cannot. (No layout here: classes.)
    expect(column.className).toContain("min-w-0");
    expect(column.className).not.toContain("min-w-3.5");
    expect(plot.className).not.toMatch(/\bgap-/);
    expect(column.querySelector("span")!.className).toContain("w-4/5");
  });

  it("chooses the series by its name, and the window it shows", async () => {
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await loaded();
    const chart = widget("Realtime trends");
    const series = await chart.findByRole("group", { name: "Metric" });
    expect(within(series).getByRole("button", { name: "Live sockets", pressed: true })).toBeTruthy();
    fireEvent.click(within(series).getByRole("button", { name: "Messages" }));
    expect(within(series).getByRole("button", { name: "Messages", pressed: true })).toBeTruthy();
    expect(await chart.findByRole("button", { name: /^Messages at .*: 420$/ })).toBeTruthy();

    const zoom = chart.getByRole("combobox", { name: "Window" }) as HTMLSelectElement;
    expect(zoom.value).toBe("24");
    fireEvent.change(zoom, { target: { value: "12" } });
    expect(zoom.value).toBe("12");
    // Fewer samples than the window, so there is nowhere older or newer to go.
    expect(chart.getByRole("button", { name: "Older" }).hasAttribute("disabled")).toBe(true);
    expect(chart.getByRole("button", { name: "Newer" }).hasAttribute("disabled")).toBe(true);
  });

  it("pins a moment, filters the feed to what came after, and lets go of it", async () => {
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await loaded();
    const chart = widget("Realtime trends");
    const bar = await chart.findByRole("button", { name: /^Live sockets at / });
    fireEvent.click(bar);
    expect(bar.getAttribute("aria-pressed")).toBe("true");
    expect(chart.getByText(/Activity is currently filtered to items after this point/)).toBeTruthy();
    // The samples are from now and the fixtures from September, so nothing is after it.
    expect(widget("Recent activity").getByText("No items match the current filters.")).toBeTruthy();

    fireEvent.click(chart.getByRole("button", { name: "Clear chart filter" }));
    expect(bar.getAttribute("aria-pressed")).toBe("false");
    expect(widget("Recent activity").getByRole("list", { name: "Recent activity" })).toBeTruthy();
  });
});

describe("the summary metrics", () => {
  it("presses the metric the chart is showing, and names each tile by what it focuses", async () => {
    render(<HealthSection onError={vi.fn()} isInstanceAdmin />);
    await loaded();
    const metrics = widget("Summary metrics");
    expect(await metrics.findByRole("button", { name: "Focus Live sockets", pressed: true })).toBeTruthy();
    expect(metrics.getByRole("button", { name: "Focus Messages", pressed: false })).toBeTruthy();
    fireEvent.click(metrics.getByRole("button", { name: "Focus People online" }));
    expect(metrics.getByRole("button", { name: "Focus People online", pressed: true })).toBeTruthy();
    expect(metrics.getByRole("button", { name: "Focus Live sockets", pressed: false })).toBeTruthy();
  });
});
