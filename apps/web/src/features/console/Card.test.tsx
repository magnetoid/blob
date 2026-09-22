// @vitest-environment happy-dom
/** The card every console page is read in. What these pin is the markup app.css keys on
 * and the semantics a screen reader gets: the title is a heading, the card is not a
 * landmark, a one-field card's title can be that field's label, and a heading inside a
 * card takes its level from whether the card has a title. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Card, CardHeading, CardNotice } from './Card.tsx';

afterEach(cleanup);

describe('a console card', () => {
  it('titles itself with a heading, and says what it is for under it', () => {
    render(
      <Card title="Server name" description="Shown in the top bar.">
        <input aria-label="unused" />
      </Card>,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Server name' });
    expect(heading.className).toBe('console-card-title');
    expect(screen.getByText('Shown in the top bar.').className).toBe('console-card-desc');
    expect(heading.closest('.console-card-header')).toBeTruthy();
  });

  // A named section is a landmark, and a page of eight landmarks is a list nobody can
  // use. The heading is how a screen reader moves through the page.
  it('is not a landmark', () => {
    render(<Card title="Members" />);
    expect(screen.queryByRole('region')).toBeNull();
  });

  // A card that is one field: its title is the field's label — a real one, so a click on
  // it puts the cursor in the field — and the line under the title is the field's hint.
  it('can be titled by the label of the one field it holds', () => {
    render(
      <Card
        title={<label htmlFor="f">Server name</label>}
        description="Shown everywhere."
        descriptionId="d"
      >
        <input id="f" aria-describedby="d" />
      </Card>,
    );
    const input = screen.getByRole('textbox', { name: 'Server name' });
    expect(screen.getByRole('heading', { level: 2, name: 'Server name' })).toBeTruthy();
    expect(screen.getByText('Server name').closest('label')?.htmlFor).toBe(input.id);
    expect(input.getAttribute('aria-describedby')).toBe('d');
    expect(document.getElementById('d')?.textContent).toBe('Shown everywhere.');
  });

  it('puts card-wide controls in its header and what closes it in its footer', () => {
    render(
      <Card
        title="Agents"
        actions={<button>Install</button>}
        footer={<button>Save</button>}
      >
        <p>rows</p>
      </Card>,
    );
    expect(screen.getByRole('button', { name: 'Install' }).closest('.console-card-actions')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.closest('footer')?.className).toBe('console-card-footer');
    // The footer is the card's last child, so it can run to the card's edges.
    const card = save.closest('.console-card');
    expect(card?.lastElementChild?.tagName).toBe('FOOTER');
  });

  // A list or a table on its own needs no title — its rows say what it is — and an
  // empty header would still take the card's first slot and its spacing.
  it('draws no header when there is nothing to put in one', () => {
    const { container } = render(
      <Card>
        <p>just rows</p>
      </Card>,
    );
    expect(container.querySelector('.console-card-header')).toBeNull();
    expect(container.querySelector('.console-card')?.firstElementChild?.textContent).toBe(
      'just rows',
    );
  });

  it('keeps its own classes beside a caller’s', () => {
    const { container } = render(<Card className="janus-part" title="Skills" />);
    expect(container.querySelector('section')?.className).toBe('console-card janus-part');
  });
});

// A part of a card — "New group" — is drawn in a titled card on one page and an untitled
// one on another, and the outline must not skip a level in either.
describe('a heading for a part of a card', () => {
  it('sits a level under the card’s title', () => {
    render(
      <Card title="User groups">
        <CardHeading>New group</CardHeading>
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'New group' }).className).toBe(
      'section-label',
    );
  });

  it('takes the title’s level in a card that has none', () => {
    render(
      <Card>
        <CardHeading>New group</CardHeading>
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'New group' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  // A description alone is not a title: the part's heading is still the first under the page's.
  it('counts only a title, not a description, as the card’s heading', () => {
    render(
      <Card description="Teams that can be mentioned as one name.">
        <CardHeading>New group</CardHeading>
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'New group' })).toBeTruthy();
  });
});

describe('the notice a card shows in place of its rows', () => {
  it('is one paragraph, the same for nothing yet and still loading', () => {
    const { container } = render(
      <>
        <CardNotice>Loading…</CardNotice>
        <CardNotice>No webhooks yet.</CardNotice>
      </>,
    );
    const notices = [...container.querySelectorAll('p.console-notice')];
    expect(notices.map((notice) => notice.textContent)).toEqual(['Loading…', 'No webhooks yet.']);
  });
});
