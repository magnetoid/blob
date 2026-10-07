// @vitest-environment happy-dom
/** An app's last ten errors, under the banner that says what is wrong now. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RecentErrors } from './RecentErrors.tsx';

afterEach(cleanup);

describe('recent errors', () => {
  it('lists them newest first, each with when it happened', () => {
    render(
      <RecentErrors
        errors={[
          { at: '2026-10-07T10:05:00.000Z', error: 'the agent answered 500' },
          { at: '2026-10-07T10:00:00.000Z', error: 'Circuit open: too many delivery failures.' },
        ]}
      />,
    );
    expect(screen.getByText('2 recent errors')).toBeTruthy();
    const items = [...document.querySelectorAll('.recent-errors li')].map((li) => li.textContent);
    expect(items[0]).toMatch(/the agent answered 500$/);
    expect(items[1]).toMatch(/Circuit open/);
    expect(document.querySelector('time')?.getAttribute('dateTime')).toBe(
      '2026-10-07T10:05:00.000Z',
    );
  });

  it('draws nothing for an app that has never failed', () => {
    render(<RecentErrors errors={[]} />);
    expect(document.querySelector('details')).toBeNull();
  });
});
