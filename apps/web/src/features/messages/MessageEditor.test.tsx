// @vitest-environment happy-dom
/**
 * Finishing an edit with the keyboard.
 *
 * `↑, retype, Enter` is one reflex, and the editor answered the first two thirds of it:
 * ↑ from an empty composer opened it, with the right text, focused. Then Enter inserted
 * a newline. Escape was the only key it handled, so the only way to finish an edit that
 * kept the words was to leave the keyboard and click Save.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Message } from "@blob/shared";

const edit = vi.fn<(id: string, body: string) => Promise<unknown>>();

vi.mock("../../lib/api.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api.ts")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      messages: {
        ...actual.api.messages,
        edit: (id: string, body: string) => edit(id, body),
      },
    },
  };
});

const { MessageEditor } = await import("./MessageEditor.tsx");
const { useStore } = await import("../../lib/store.ts");

afterEach(() => {
  cleanup();
  edit.mockClear();
});

const MESSAGE = {
  id: "m1",
  channelId: "c1",
  authorId: "u1",
  body: "the original",
} as unknown as Message;

function open(enterToSend = true) {
  useStore.setState({
    currentUser: { id: "u1", prefs: { enterToSend } },
  } as never);
  const onClose = vi.fn();
  render(<MessageEditor message={MESSAGE} onClose={onClose} />);
  return { onClose, box: screen.getByRole("textbox") as HTMLTextAreaElement };
}

describe("finishing an edit", () => {
  it("saves on Enter", async () => {
    const { box, onClose } = open();
    fireEvent.change(box, { target: { value: "the correction" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith("m1", "the correction"),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("breaks the line on Shift+Enter instead", () => {
    const { box } = open();
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });

    expect(edit).not.toHaveBeenCalled();
  });

  it("obeys the preference the composer obeys", () => {
    // Somebody who turned Enter into a newline for sending did not ask for it to save
    // here. Two gestures that look identical must not disagree about one key.
    const { box } = open(false);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(edit).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(edit).toHaveBeenCalled();
  });

  it("still abandons the edit on Escape", () => {
    const { box, onClose } = open();
    fireEvent.change(box, { target: { value: "never mind" } });
    fireEvent.keyDown(box, { key: "Escape" });

    expect(edit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("does not save an edit emptied to nothing", () => {
    // Deleting is a separate, confirmed action. An edit to whitespace should not become
    // a silent one.
    const { box } = open();
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(edit).not.toHaveBeenCalled();
  });
});
