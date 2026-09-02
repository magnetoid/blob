// @vitest-environment happy-dom
/** The guide, rendered from the running app rather than from prose about it.
 *
 * Two thirds of this page is generated: the keys come from `SHORTCUTS` and the commands
 * from what the server said on bootstrap. That is the property worth pinning, because
 * the alternative — a hand-written list — fails silently and stays wrong for as long as
 * nobody happens to try the key it describes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HelpView } from './HelpView.tsx';
import { useStore } from '../../lib/store.ts';
import { SECTIONS, allTopics } from '../../lib/help.ts';
import { SHORTCUTS } from '../../lib/shortcuts.ts';
import { LOCAL_COMMANDS } from '../../lib/commands.ts';

const member = {
  id: 'u1',
  displayName: 'Ana',
  email: 'ana@example.com',
  role: 'member',
  avatarUrl: null,
  prefs: { theme: 'system', density: 'comfortable' },
};

beforeEach(() => {
  useStore.setState({
    currentUser: member as never,
    commands: [
      { name: 'topic', usage: '[text]', summary: 'Set the channel topic, or clear it.' },
      { name: 'remind', usage: 'me to <text> <when>', summary: 'Send yourself a note later.' },
    ],
  });
});

afterEach(cleanup);

describe('the guide', () => {
  it('draws every section', () => {
    render(<HelpView />);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(SECTIONS.map((section) => section.title));
  });

  it('lists the sections as links to their own anchors', () => {
    render(<HelpView />);

    const nav = screen.getByRole('navigation', { name: 'Guide sections' });
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(SECTIONS.map((section) => `#${section.id}`));
  });

  it('gives every topic the id its anchor promises', () => {
    render(<HelpView />);

    for (const topic of allTopics()) {
      expect(document.getElementById(topic.id)).not.toBeNull();
    }
  });
});

describe('what the guide reads rather than repeats', () => {
  it('takes the keys from the bindings', () => {
    render(<HelpView />);

    // Every shortcut there is, labelled as the handler labels it. A hand-written list is
    // how a help dialog ends up documenting a key nobody bound.
    for (const shortcut of SHORTCUTS) {
      expect(screen.getAllByText(shortcut.label).length).toBeGreaterThan(0);
    }
  });

  it('takes the commands from the server', () => {
    render(<HelpView />);

    expect(screen.getByText(/Set the channel topic/)).toBeTruthy();
    // Including whatever an app installed here has added — the page never has its own
    // idea of what commands exist.
    useStore.setState({
      commands: [{ name: 'deploy', usage: '<env>', summary: 'Ship it somewhere.' }],
    });
    cleanup();
    render(<HelpView />);
    expect(screen.getByText('Ship it somewhere.')).toBeTruthy();
    expect(screen.queryByText(/Set the channel topic/)).toBeNull();
  });

  it('lists the commands the client answers itself, which bootstrap never mentions', () => {
    render(<HelpView />);

    for (const command of LOCAL_COMMANDS) {
      expect(screen.getAllByText(new RegExp(`/${command.name}`)).length).toBeGreaterThan(0);
    }
  });
});

describe('the filter', () => {
  it('narrows to what was typed', () => {
    render(<HelpView />);
    const before = screen.getAllByRole('heading', { level: 3 }).length;

    fireEvent.change(screen.getByLabelText('Search the guide'), {
      target: { value: 'zzzznothingmatchesthis' },
    });

    expect(screen.queryAllByRole('heading', { level: 3 }).length).toBeLessThan(before);
    expect(screen.getByText('Nothing here says that')).toBeTruthy();
  });

  it('finds a command by name even though no topic is written about it', () => {
    // The case the section-level filter has to survive: "topic" is a command, and
    // dropping generated sections while filtering would hide it.
    render(<HelpView />);

    fireEvent.change(screen.getByLabelText('Search the guide'), {
      target: { value: '/topic' },
    });

    expect(screen.getByText(/Set the channel topic/)).toBeTruthy();
  });

  it('finds a command no topic is written about', () => {
    // An app's own command is named nowhere in the prose. Filtering the generated
    // section on its heading alone made the only name it has unfindable.
    useStore.setState({
      commands: [{ name: 'deploy', usage: '<env>', summary: 'Ship it somewhere.' }],
    });
    render(<HelpView />);

    fireEvent.change(screen.getByLabelText('Search the guide'), {
      target: { value: 'deploy' },
    });

    expect(screen.getByText('Ship it somewhere.')).toBeTruthy();
  });

  it('finds a shortcut by the keys rather than only by its label', () => {
    render(<HelpView />);

    fireEvent.change(screen.getByLabelText('Search the guide'), {
      target: { value: 'esc' },
    });

    expect(screen.getAllByText(/Mark everything read|Close the thread/).length).toBeGreaterThan(0);
  });

  it('says how many topics matched', () => {
    render(<HelpView />);

    fireEvent.change(screen.getByLabelText('Search the guide'), {
      target: { value: 'zzzznothingmatchesthis' },
    });

    expect(screen.getByRole('status').textContent).toBe('0 topics match');
  });
});

describe('a route the reader cannot open', () => {
  it('is named but not offered to a member', () => {
    const gated = allTopics().filter((topic) => topic.audience && topic.path);
    if (gated.length === 0) return;

    render(<HelpView />);

    for (const topic of gated) {
      // Shown, because knowing the workspace has an admin console is useful. Not a
      // button, because every request behind it would answer 403 — the same bug the
      // account menu had when it offered /admin to any admin.
      expect(screen.queryByRole('button', { name: `Open ${topic.path}` })).toBeNull();
      expect(screen.getAllByText(topic.path as string).length).toBeGreaterThan(0);
    }
  });

  it('is a button for somebody whose role reaches it', () => {
    const gated = allTopics().filter((topic) => topic.audience === 'admins' && topic.path);
    if (gated.length === 0) return;

    useStore.setState({ currentUser: { ...member, role: 'admin' } as never });
    render(<HelpView />);

    expect(
      screen.getAllByRole('button', { name: `Open ${gated[0]!.path}` }).length,
    ).toBeGreaterThan(0);
  });
});
