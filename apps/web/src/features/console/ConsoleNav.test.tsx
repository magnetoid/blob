// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConsoleNav } from './ConsoleNav.tsx';
import type { NavGroup, SectionEntry } from './registry.ts';

// vitest globals are off, so RTL's automatic cleanup never runs. Without this, one
// test's markup is still in the document while the next one queries it.
afterEach(cleanup);

const GROUPS: NavGroup[] = [
  {
    id: 'people',
    label: 'People',
    sections: [
      { id: 'people', label: 'Members', keywords: ['roles'] } as SectionEntry,
      { id: 'invitations', label: 'Invitations', badge: 'new' } as SectionEntry,
    ],
  },
  {
    id: 'system',
    label: 'System',
    note: 'Only you can see these.',
    sections: [
      { id: 'audit', label: 'Audit log', ownerOnly: true } as SectionEntry,
      { id: 'retention', label: 'Retention', planned: true },
    ],
  },
];

function renderNav(section: 'people' | 'audit' = 'people') {
  return render(<ConsoleNav groups={GROUPS} section={section} isOwner />);
}

describe('the console nav', () => {
  it('shows the groups and their rows', () => {
    renderNav();
    expect(screen.getByText('People')).toBeTruthy();
    expect(screen.getByText('System')).toBeTruthy();
    expect(screen.getByText('Members')).toBeTruthy();
    expect(screen.getByText('Audit log')).toBeTruthy();
  });

  // Where you are has to be marked, not merely coloured — that is what a screen reader
  // reads out, and it is the one thing the old chip row got right.
  it('marks the current section', () => {
    renderNav('audit');
    const current = screen.getByText('Audit log').closest('button');
    expect(current?.getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('Members').closest('button')?.getAttribute('aria-current')).toBe(
      'false',
    );
  });

  it('narrows to what was typed, and drops the emptied group', () => {
    renderNav();
    fireEvent.change(screen.getByLabelText('Filter sections'), { target: { value: 'audit' } });
    expect(screen.queryByText('Members')).toBeNull();
    expect(screen.queryByText('People')).toBeNull();
    expect(screen.getByText('Audit log')).toBeTruthy();
  });

  it('finds a section by keyword rather than label alone', () => {
    renderNav();
    fireEvent.change(screen.getByLabelText('Filter sections'), { target: { value: 'roles' } });
    expect(screen.getByText('Members')).toBeTruthy();
  });

  it('says so when nothing matched', () => {
    renderNav();
    fireEvent.change(screen.getByLabelText('Filter sections'), { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing matched.')).toBeTruthy();
  });

  it('shows a planned section as coming rather than hiding it', () => {
    renderNav();
    const planned = screen.getByText('Retention').closest('button') as HTMLButtonElement;
    expect(planned.disabled).toBe(true);
    expect(screen.getByText('Soon')).toBeTruthy();
  });

  it('badges a newly shipped section', () => {
    renderNav();
    expect(screen.getByText('New')).toBeTruthy();
  });

  // An owner-only row can now sit in a group an admin also uses, so the restriction has
  // to be on the row. Without it, an owner has no way to tell which pages their admins
  // cannot reach, and finds out by being asked.
  it('marks a row only the owner can reach', () => {
    renderNav();
    const restricted = screen.getByText('Audit log').closest('button');
    expect(restricted?.textContent).toContain('Owner');
    expect(screen.getByText('Members').closest('button')?.textContent).not.toContain('Owner');
  });

  it('explains a group that is the owner\u2019s alone', () => {
    renderNav();
    expect(screen.getByText('Only you can see these.')).toBeTruthy();
  });

  it('offers a way back to the workspace', () => {
    renderNav();
    expect(screen.getByText('Back to workspace')).toBeTruthy();
  });

  it('closes the drawer when a section is chosen', () => {
    const onNavigate = vi.fn();
    render(<ConsoleNav groups={GROUPS} section="people" isOwner onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Audit log'));
    expect(onNavigate).toHaveBeenCalled();
  });
});
