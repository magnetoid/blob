// @vitest-environment happy-dom
/**
 * The clock beside Send, which opens shadcn's Popover (Base UI's) from a module of its own
 * (`lazyPopups.ts`). It was a menu holding a select and a time field, whose arrow keys a
 * menu would take; what is pinned here is that it is a dialog with a form in it, that the
 * form keeps its keys, that one Escape closes one layer and gives focus back to the clock,
 * and that what each choice sends is what it sent before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SchedulePicker } from './SchedulePicker.tsx';
import { SchedulePopup } from './lazyPopups.ts';
import { useEscape } from '../../lib/useEscape.ts';
import '../../test/overlayChunk.ts';

await SchedulePopup.preload();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clock = () => screen.getByRole('button', { name: 'Schedule this message' });

function draw(onSchedule = vi.fn().mockResolvedValue(true), holdingFiles = false) {
  render(<SchedulePicker disabled={false} holdingFiles={holdingFiles} onSchedule={onSchedule} />);
  return onSchedule;
}

async function open() {
  const spy = draw();
  fireEvent.click(clock());
  const dialog = await screen.findByRole('dialog', { name: 'Schedule this message' });
  return { dialog, onSchedule: spy };
}

describe('the send-later clock’s popover', () => {
  it('opens a dialog from the clock, named for scheduling', async () => {
    draw();
    expect(clock().getAttribute('aria-haspopup')).toBe('dialog');

    fireEvent.click(clock());

    expect(await screen.findByRole('dialog', { name: 'Schedule this message' })).toBeTruthy();
    expect(clock().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tomorrow at 9:00' })).toBeTruthy();
  });

  it('leaves the arrow keys to the Repeat select', async () => {
    // A select steps its option on ArrowDown, and a synthetic key moves nothing either way,
    // so what is pinned is that nothing in the popover takes the key from it: not prevented,
    // and focus still on the select once the key has gone all the way up. A menu would have
    // taken both, as Blob's did until it learned to step aside for a form control.
    await open();
    const select = screen.getByRole('combobox', { name: 'Repeat' });
    select.focus();

    const unhandled = fireEvent.keyDown(select, { key: 'ArrowDown' });

    expect(unhandled).toBe(true);
    await act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
    expect(document.activeElement).toBe(select);
  });

  it('closes on Escape from the time field and gives focus back to the clock', async () => {
    await open();
    const field = screen.getByLabelText('Or pick a time');
    field.focus();

    fireEvent.keyDown(field, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(clock()));
  });

  it('takes one Escape beside an open file panel: the popover closes and the panel stays', async () => {
    // A panel behind the popover is a layer on the stack that was there first.
    const closePanel = vi.fn();
    function Panel() {
      useEscape(closePanel);
      return null;
    }
    render(<Panel />);
    await open();
    const field = screen.getByLabelText('Or pick a time');
    field.focus();

    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(closePanel).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(closePanel).toHaveBeenCalledTimes(1);
  });

  it('schedules a preset and closes', async () => {
    const { onSchedule } = await open();

    fireEvent.click(screen.getByRole('button', { name: 'Tomorrow at 9:00' }));

    await waitFor(() => expect(onSchedule).toHaveBeenCalledTimes(1));
    const [when, repeat] = onSchedule.mock.calls[0] as [Date, string | null];
    expect(when.getHours()).toBe(9);
    expect(repeat).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('sends the repeat and the picked time together', async () => {
    const { onSchedule } = await open();
    fireEvent.change(screen.getByRole('combobox', { name: 'Repeat' }), {
      target: { value: 'weekdays' },
    });
    const field = screen.getByLabelText('Or pick a time') as HTMLInputElement;
    const send = screen.getByRole('button', { name: 'Schedule' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: '2099-03-05T14:30' } });

    fireEvent.click(send);

    await waitFor(() => expect(onSchedule).toHaveBeenCalledTimes(1));
    const [when, repeat] = onSchedule.mock.calls[0] as [Date, string | null];
    expect(when.getTime()).toBe(new Date('2099-03-05T14:30').getTime());
    expect(repeat).toBe('weekdays');
  });

  it('steps aside while the tray holds a file, and says why', () => {
    draw(undefined, true);
    const stepped = screen.getByRole('button', { name: /can’t be scheduled — send this now/ });

    expect((stepped as HTMLButtonElement).disabled).toBe(true);
    expect(stepped.getAttribute('data-tooltip')).toContain('can’t be scheduled');
  });
});
