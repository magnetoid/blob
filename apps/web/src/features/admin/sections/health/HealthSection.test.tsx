// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  it("loads the live widgets and drills into the selected metric", async () => {
    render(<HealthSection onError={vi.fn()} />);

    expect(await screen.findByText("Summary metrics")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Focus Messages" }));

    expect(await screen.findByText("Messages detail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open detailed report" }));
    expect(navigate).toHaveBeenCalledWith("/admin/audit");
  });

  it("refreshes when the websocket reports live activity", async () => {
    render(<HealthSection onError={vi.fn()} />);
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
    const view = render(<HealthSection onError={vi.fn()} />);
    await screen.findByText("Recent activity");

    fireEvent.click(screen.getByLabelText("Hide activity widget"));
    expect(screen.getByRole("button", { name: "Add activity" })).toBeTruthy();

    view.unmount();
    render(<HealthSection onError={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Add activity" })).toBeTruthy();
  });
});
