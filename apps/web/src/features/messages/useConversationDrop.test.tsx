// @vitest-environment happy-dom
/**
 * A file dropped anywhere on the conversation reaches the composer that belongs to it.
 *
 * happy-dom has no DataTransfer to drag with, so the events here carry a stand-in with
 * the two things the hook reads — what kinds of thing are being dragged, and the files.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { useConversationDrop, type DropArea } from './useConversationDrop.ts';

afterEach(cleanup);

function drag(type: string, target: EventTarget, kinds: string[], files: File[] = []) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: kinds, files, dropEffect: 'none' },
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** A conversation pane with a message area and, inside it, a composer — the hook's anchor. */
function setup(onFiles: (files: File[]) => void) {
  const seen: { area: DropArea | null } = { area: null };
  function Composer() {
    const ref = useRef<HTMLDivElement>(null);
    seen.area = useConversationDrop(ref, onFiles);
    return <div ref={ref} className="composer" />;
  }
  const { container } = render(
    <main className="pane">
      <div className="message-list">
        <p className="message">hello</p>
      </div>
      <Composer />
    </main>,
  );
  return {
    seen,
    pane: container.querySelector('.pane')!,
    message: container.querySelector('.message')!,
  };
}

describe('dropping a file on the conversation', () => {
  it('takes a file dropped on the messages, not only on the composer', () => {
    const onFiles = vi.fn();
    const { seen, message } = setup(onFiles);
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });

    drag('dragenter', message, ['Files']);
    expect(seen.area).not.toBeNull();
    // Accepting the drop is what preventing dragover's default means to a browser.
    expect(drag('dragover', message, ['Files']).defaultPrevented).toBe(true);

    const dropped = drag('drop', message, ['Files'], [file]);
    expect(dropped.defaultPrevented).toBe(true);
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(seen.area).toBeNull();
  });

  it('keeps the overlay while the pointer crosses children, and puts it away on leaving', () => {
    // Every child crossed fires its own enter and leave; only the last leave is the exit.
    const { seen, pane, message } = setup(vi.fn());
    drag('dragenter', pane, ['Files']);
    drag('dragenter', message, ['Files']);
    drag('dragleave', pane, ['Files']);
    expect(seen.area).not.toBeNull();
    drag('dragleave', message, ['Files']);
    expect(seen.area).toBeNull();
  });

  it('ignores a drag that carries no files — text, a link', () => {
    const onFiles = vi.fn();
    const { seen, message } = setup(onFiles);
    drag('dragenter', message, ['text/plain']);
    expect(seen.area).toBeNull();
    expect(drag('dragover', message, ['text/plain']).defaultPrevented).toBe(false);
    drag('drop', message, ['text/plain']);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('puts the overlay away when the drag ends anywhere', () => {
    // Escape, or a release outside the window, can end a drag with no leave here.
    const { seen, message } = setup(vi.fn());
    drag('dragenter', message, ['Files']);
    expect(seen.area).not.toBeNull();
    drag('dragend', window, ['Files']);
    expect(seen.area).toBeNull();
  });
});
