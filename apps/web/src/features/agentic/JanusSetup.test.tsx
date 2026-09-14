// @vitest-environment happy-dom
/** The instructions a Janus agent gets, and the ones it must not get.
 *
 * The page used to print the bridge setup for every socket agent — a script to
 * download, a signing secret, an AG-UI URL — and Janus needs none of it: it speaks
 * Blob's socket protocol itself. The two lines that matter are pinned verbatim, with
 * the token in them, and the bridge's words are pinned absent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { JanusSetup } from './JanusSetup.tsx';

afterEach(cleanup);
vi.stubGlobal('location', { origin: 'https://chat.example.com' });

describe('JanusSetup', () => {
  it('prints the two values Janus reads, with the token written in', () => {
    render(<JanusSetup agentName="Janus" botToken="blob-bot-abc" />);
    const block = screen.getByText(/BLOB_URL=/).textContent ?? '';
    expect(block).toContain('export BLOB_URL=https://chat.example.com');
    expect(block).toContain('export BLOB_BOT_TOKEN=blob-bot-abc');
    expect(block).toContain('janus gateway start');
  });

  it('never mentions the bridge', () => {
    render(<JanusSetup agentName="Janus" botToken="blob-bot-abc" />);
    expect(screen.queryByText(/agent_bridge/)).toBeNull();
    expect(screen.queryByText(/AGENT_AGUI_URL/)).toBeNull();
    expect(screen.queryByText(/SIGNING_SECRET/)).toBeNull();
  });

  it('offers the same thing as config.yaml', () => {
    render(<JanusSetup agentName="Janus" botToken="blob-bot-abc" />);
    fireEvent.click(screen.getByRole('button', { name: 'config.yaml' }));
    const block = screen.getByText(/platforms:/).textContent ?? '';
    expect(block).toContain('token: blob-bot-abc');
    expect(block).toContain('url: https://chat.example.com');
  });
});
