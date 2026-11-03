// @vitest-environment happy-dom
/** An app's last ten errors, under the banner that says what is wrong now. They are a
 * disclosure — closed, so a long record does not push the page down — whose button says
 * how many there are and whether they are showing. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RecentErrors } from './RecentErrors.tsx';

afterEach(cleanup);

const ERRORS = [
  { at: '2026-10-07T10:05:00.000Z', error: 'the agent answered 500' },
  { at: '2026-10-07T10:00:00.000Z', error: 'Circuit open: too many delivery failures.' },
];

describe('recent errors', () => {
  it('lists them newest first, each with when it happened', () => {
    render(<RecentErrors errors={ERRORS} />);
    const toggle = screen.getByRole('button', { name: '2 recent errors' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('the agent answered 500')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]!.textContent).toMatch(/the agent answered 500$/);
    expect(items[1]!.textContent).toMatch(/Circuit open/);
    expect(document.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-07T10:05:00.000Z');
  });

  it('says "1 recent error" for one', () => {
    render(<RecentErrors errors={[ERRORS[0]!]} />);
    expect(screen.getByRole('button', { name: '1 recent error' })).toBeTruthy();
  });

  it('puts them away again', () => {
    render(<RecentErrors errors={ERRORS} />);
    const toggle = screen.getByRole('button', { name: '2 recent errors' });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('draws nothing for an app that has never failed', () => {
    render(<RecentErrors errors={[]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
