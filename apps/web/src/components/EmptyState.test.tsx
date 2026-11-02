// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState.tsx';
import { navigate } from '../lib/router.ts';

afterEach(cleanup);

/** The parts shadcn's Empty names, in the order they are drawn. */
const parts = (container: HTMLElement) =>
  Array.from(container.querySelector('.empty-state')!.children).map(
    (el) => (el as HTMLElement).dataset.slot ?? el.tagName,
  );

describe('EmptyState', () => {
  it("is shadcn's Empty", () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    const root = container.querySelector<HTMLElement>('.empty-state')!;
    expect(root.dataset.slot).toBe('empty');
  });

  it('renders the title alone when that is all there is', () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(screen.getByText('Nothing here').closest('[data-slot]')?.getAttribute('data-slot')).toBe(
      'empty-title',
    );
    expect(parts(container)).toEqual(['empty-title']);
  });

  it('keeps the mark out of the accessibility tree and the action after the body', () => {
    const { container } = render(
      <EmptyState mark="#" title="Start" action={<button type="button">Go</button>} aria-live="polite">
        Say hello.
      </EmptyState>,
    );
    const mark = container.querySelector('[data-slot="empty-icon"]');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(parts(container)).toEqual(['empty-icon', 'empty-title', 'empty-description', 'empty-content']);
    expect(screen.getByRole('button', { name: 'Go' }).closest('[data-slot]')?.getAttribute('data-slot')).toBe(
      'empty-content',
    );
    expect(container.querySelector('.empty-state')?.getAttribute('aria-live')).toBe('polite');
  });

  it('draws nothing for an action that is not there', () => {
    // `permalinkFailure && <button …>` is how Workspace passes one: false is no action, and
    // an empty row under the body would still take its margin.
    const { container } = render(<EmptyState title="Finding that message…" action={false} />);
    expect(parts(container)).toEqual(['empty-title']);
  });

  it("hands a caller's own markup back to the legacy stylesheet", () => {
    // Inside a shadcn component preflight's reset holds, and the repair in base.css stops
    // at `[data-slot]`. The body's `<code>` and the action's `.btn` are the callers' legacy
    // markup, so they sit in `data-legacy` islands, as a dialog's body does.
    const { container } = render(
      <EmptyState title="Search the whole history" action={<button className="btn">Retry</button>}>
        Narrow results with <code>from:</code>.
      </EmptyState>,
    );
    expect(container.querySelector('code')!.closest('[data-legacy]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' }).closest('[data-legacy]')).not.toBeNull();
  });

  it("keys its card variant on shadcn's card, where a console card's children now sit", () => {
    // A console card's rows and notices are children of shadcn's content part, not of a
    // `.console-card`, so the variant that draws a notice at the card's measure names that part.
    const { container } = render(
      <div data-slot="card-content">
        <EmptyState title="Nothing yet">Connect one and it will appear here.</EmptyState>
      </div>,
    );
    const root = container.querySelector<HTMLElement>('.empty-state')!;
    expect(root.className).toContain('[[data-slot=card-content]>&]:py-[24px]');
    expect(root.querySelector('[data-slot="empty-title"]')!.className).toContain(
      '[[data-slot=card-content]>.empty-state_&]:text-(length:--text-title)',
    );
    expect(root.className).not.toContain('console-card');
  });

  it("keeps a caller's class beside its own", () => {
    const { container } = render(<EmptyState title="Nothing" className="call-empty" />);
    const root = container.querySelector<HTMLElement>('.empty-state')!;
    expect(root.classList.contains('call-empty')).toBe(true);
  });
});

/**
 * An empty state arrives on the view the app opened onto and nowhere after: every later
 * one was switched to, and a switch stays instant. In order, because the first move is
 * one-way for the life of the page, as it is for the module under test.
 */
describe('an empty state arriving', () => {
  const arriving = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('.empty-state')!.dataset.arriving;

  it('arrives on the view the app opened onto', () => {
    const { container } = render(<EmptyState title="Nothing saved yet" />);
    expect(arriving(container)).toBe('true');
  });

  it('still does after the app rewrites its own address, which is not a move', () => {
    // What Workspace does on arrival — canonicalise the URL, open #general — and what a
    // search does per keystroke.
    navigate('/later', { replace: true });
    const { container } = render(<EmptyState title="Nothing saved yet" />);
    expect(arriving(container)).toBe('true');
  });

  it('just appears once somebody has gone somewhere', () => {
    navigate('/threads');
    const { container } = render(<EmptyState title="No threads yet" />);
    expect(arriving(container)).toBeUndefined();
  });
});
