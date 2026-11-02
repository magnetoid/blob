// @vitest-environment happy-dom
/** The card every console page is read in. What these pin is the semantics a screen
 * reader gets and the order of a card's parts: the title is a heading, the card is not a
 * landmark, a one-field card's title can be that field's label, a heading inside a card
 * takes its level from whether the card has a title, and what closes a card comes last. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Card, CardFields, CardHeading, CardNotice, CardRow, CardRows, CardTable } from './Card.tsx';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.tsx';

afterEach(cleanup);

/** The card around something drawn in it: shadcn's, which marks each of its parts. */
const cardOf = (node: Element) => node.closest('[data-slot="card"]');

describe('a console card', () => {
  it('titles itself with a heading, and says what it is for under it', () => {
    render(
      <Card title="Server name" description="Shown in the top bar.">
        <input aria-label="unused" />
      </Card>,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Server name' });
    const description = screen.getByText('Shown in the top bar.');
    // Title then description, together, ahead of what the card holds.
    expect(heading.parentElement).toBe(description.parentElement);
    expect(heading.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      description.compareDocumentPosition(screen.getByRole('textbox')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(cardOf(heading)).toBe(cardOf(screen.getByRole('textbox')));
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
    const heading = screen.getByRole('heading', { name: 'Agents' });
    const install = screen.getByRole('button', { name: 'Install' });
    // Beside the title, in the header the title is in.
    expect(heading.parentElement?.contains(install)).toBe(true);
    expect(install.compareDocumentPosition(screen.getByText('rows')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The footer is the card's last part, so it can run to the card's edges.
    const save = screen.getByRole('button', { name: 'Save' });
    const card = cardOf(save);
    expect(card?.lastElementChild?.contains(save)).toBe(true);
    expect(card?.lastElementChild?.contains(screen.getByText('rows'))).toBe(false);
  });

  // A list or a table on its own needs no title — its rows say what it is — and an
  // empty header would still take the card's first slot and its spacing.
  it('draws no header when there is nothing to put in one', () => {
    render(
      <Card>
        <p>just rows</p>
      </Card>,
    );
    const card = cardOf(screen.getByText('just rows'));
    expect(card?.firstElementChild?.textContent).toBe('just rows');
    expect(screen.queryByRole('heading')).toBeNull();
  });

  // And the other way round: a card that is only its title and actions — a page's one
  // switch in its header — ends with the header, not with an empty part taking a gap.
  it('draws no content part when it holds nothing', () => {
    render(<Card title="Members" actions={<button>Invite</button>}>{false}</Card>);
    const card = cardOf(screen.getByRole('heading', { name: 'Members' }));
    expect(card?.children).toHaveLength(1);
  });

  it('keeps its own classes beside a caller’s', () => {
    render(<Card className="janus-part" title="Skills" />);
    const card = cardOf(screen.getByRole('heading', { name: 'Skills' }));
    expect(card?.classList.contains('janus-part')).toBe(true);
    expect(card?.classList.contains('rounded-xl')).toBe(true);
    // Clipped, not hidden: `hidden` would make the card a scroll container that focusing
    // a control near its edge could scroll sideways.
    expect(card?.classList.contains('overflow-clip')).toBe(true);
    expect(card?.classList.contains('overflow-hidden')).toBe(false);
  });

  // A title can be data — a handle, an app's name — and one unbroken word must wrap
  // inside the header's grid column rather than widen it past the card.
  it('lets a long title and description wrap rather than widen the card', () => {
    render(<Card title="@some-long-handle-with-no-break-in-it" description="https://x.test/a/very/long/path" />);
    const title = screen.getByRole('heading', { name: '@some-long-handle-with-no-break-in-it' });
    expect(title.classList.contains('min-w-0')).toBe(true);
    expect(title.classList.contains('wrap-anywhere')).toBe(true);
    expect(screen.getByText('https://x.test/a/very/long/path').classList.contains('min-w-0')).toBe(true);
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
    expect(screen.getByRole('heading', { level: 3, name: 'New group' })).toBeTruthy();
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

  // A caller that still draws it in the legacy style says so with its own class.
  it('wears a caller’s class in place of its own', () => {
    render(
      <Card title="Activity">
        <CardHeading className="section-label">Deliveries</CardHeading>
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Deliveries' }).className).toBe(
      'section-label',
    );
  });
});

describe('the notice a card shows in place of its rows', () => {
  it('is one paragraph, the same for nothing yet and still loading', () => {
    render(
      <>
        <CardNotice>Loading…</CardNotice>
        <CardNotice>No webhooks yet.</CardNotice>
      </>,
    );
    const notices = [screen.getByText('Loading…'), screen.getByText('No webhooks yet.')];
    for (const notice of notices) {
      expect(notice.tagName).toBe('P');
      // Muted, from the theme: a workspace palette repaints it.
      expect(notice.className).toBe(notices[0]!.className);
      expect(notice.className).toContain('text-muted-foreground');
    }
  });
});

// A list of things — passkeys, tokens, agents — runs from one edge of the card to the other
// and is ruled from row to row, where a card's settings sit inside its padding.
describe('rows a card holds', () => {
  it('is a list of rows, each ruled from the next, the last ruled from nothing', () => {
    render(
      <Card title="Tokens">
        <CardRows>
          <CardRow>first</CardRow>
          <CardRow>second</CardRow>
        </CardRows>
      </Card>,
    );
    const list = screen.getByRole('list');
    const [first, second] = screen.getAllByRole('listitem');
    expect(list.contains(first!) && list.contains(second!)).toBe(true);
    expect(cardOf(list)).toBe(cardOf(first!));
    // Past the card's padding to its edges, and padded again to line up with its title.
    expect(list.classList.contains('-mx-(--card-spacing)')).toBe(true);
    expect(first!.classList.contains('px-(--card-spacing)')).toBe(true);
    expect(first!.classList.contains('border-b')).toBe(true);
    expect(second!.classList.contains('last:border-b-0')).toBe(true);
  });

  it('wears a caller’s class beside its own, on the list and on a row', () => {
    render(
      <CardRows className="agents">
        <CardRow className="agent">pip</CardRow>
      </CardRows>,
    );
    expect(screen.getByRole('list').classList.contains('agents')).toBe(true);
    expect(screen.getByRole('listitem').classList.contains('agent')).toBe(true);
  });
});

describe('settings a card holds', () => {
  it('is a run of fields ruled from each other, inside the card’s padding', () => {
    render(
      <Card title="Notifications">
        <CardFields>
          <div data-slot="field">one</div>
          <div data-slot="field">two</div>
        </CardFields>
      </Card>,
    );
    const group = screen.getByText('one').parentElement!;
    expect(group.getAttribute('data-slot')).toBe('field-group');
    expect(group.classList.contains('divide-y')).toBe(true);
    expect(cardOf(group)).toBe(cardOf(screen.getByRole('heading', { name: 'Notifications' })));
  });
});

// Records in columns — groups, emoji — run from one edge of the card to the other, like a
// list, and are named for a screen reader because the card's title is not on the table.
describe('a table a card holds', () => {
  function drawn() {
    render(
      <Card title="Groups">
        <CardTable label="User groups">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Handle</TableHead>
              <TableHead scope="col">People</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>@platform</TableCell>
              <TableCell>3</TableCell>
            </TableRow>
          </TableBody>
        </CardTable>
      </Card>,
    );
    return screen.getByRole('table', { name: 'User groups' });
  }

  it('is named by its label, which is a caption a screen reader reads and the page does not draw', () => {
    const table = drawn();
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Handle',
      'People',
    ]);
    const caption = table.querySelector('caption')!;
    expect(caption.textContent).toBe('User groups');
    expect(caption.classList.contains('sr-only')).toBe(true);
    expect(cardOf(table)).toBe(cardOf(screen.getByRole('heading', { name: 'Groups' })));
  });

  it('runs to the card’s edges and gives the padding back to the first and last cell of a row', () => {
    const table = drawn();
    // Past the padding to the edges, around the table's own scrolling box.
    expect(table.closest('[data-slot="table-container"]')!.parentElement!.classList.contains('-mx-(--card-spacing)')).toBe(true);
    expect(table.classList.contains('[&_tr>:first-child]:pl-(--card-spacing)')).toBe(true);
    expect(table.classList.contains('[&_tr>:last-child]:pr-(--card-spacing)')).toBe(true);
  });

  it('wears a caller’s class beside its own', () => {
    render(
      <CardTable label="Emoji" className="emoji">
        <TableBody />
      </CardTable>,
    );
    expect(screen.getByRole('table', { name: 'Emoji' }).classList.contains('emoji')).toBe(true);
  });
});
