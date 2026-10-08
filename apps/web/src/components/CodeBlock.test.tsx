// @vitest-environment happy-dom
/**
 * A code block hands over its text exactly, says so, and stops saying so.
 *
 * The clipboard is the browser's, so it is replaced here by a recorder: what matters is
 * what was handed to it — the block's text, untrimmed and unescaped — and that the click
 * stays the copy's rather than also being a click on whatever the block sits inside.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CodeBlock } from './CodeBlock.tsx';
import { renderMarkdown } from '../lib/markdown.tsx';
import { useToasts } from '../lib/toasts.ts';

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const QUERY = 'SELECT *\n  FROM messages\n WHERE id < $1;';

describe('a code block', () => {
  it('copies its text exactly, indentation and all', async () => {
    render(<CodeBlock code={QUERY} language="sql" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy sql code' }));
    });
    expect(writeText).toHaveBeenCalledWith(QUERY);
  });

  it('says it copied, and goes back to offering a copy', async () => {
    vi.useFakeTimers();
    render(<CodeBlock code={QUERY} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Copied to the clipboard');

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('is not also a click on what it sits inside', async () => {
    // A search hit opens its message when clicked; copying its code must not navigate.
    const opened = vi.fn();
    // A React handler on a parent, as the search hit's row is — a native listener on
    // the container would not do: React listens at that same root, so stopping
    // propagation there cannot keep a sibling listener on it from firing.
    render(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands in for a clickable row
      <div onClick={opened}>
        <CodeBlock code="x" />
      </div>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    });
    expect(writeText).toHaveBeenCalledWith('x');
    expect(opened).not.toHaveBeenCalled();
  });

  it('says so when the browser refuses the clipboard', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'));
    render(<CodeBlock code="x" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    });
    expect(useToasts.getState().toasts.map((t) => t.text)).toEqual([
      'Could not copy — the browser refused the clipboard.',
    ]);
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
  });

  it('is what a fenced block in a message becomes, label and all', () => {
    const { container } = render(
      <div>
        {renderMarkdown('before\n```ts\nconst a = 1;\n```', {
          knownNames: new Map(),
          currentUserId: null,
          customEmoji: [],
        })}
      </div>,
    );
    expect(container.querySelector('.code-block pre code')?.textContent).toBe('const a = 1;');
    expect(container.querySelector('.code-block-lang')?.textContent).toBe('ts');
    expect(screen.getByRole('button', { name: 'Copy ts code' })).toBeTruthy();
  });
});

describe('a code block inside something that is itself a button', () => {
  it('offers no copy, because a button cannot hold another one', () => {
    const { container } = render(
      <div>
        {renderMarkdown('```sh\nnpm install\n```', {
          knownNames: new Map(),
          currentUserId: null,
          customEmoji: [],
          copyableCode: false,
        })}
      </div>,
    );
    expect(container.querySelector('.code-block pre code')?.textContent).toBe('npm install');
    expect(container.querySelector('.code-block-lang')?.textContent).toBe('sh');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is what a search hit draws: no button inside the row button', async () => {
    const { MessageResultRow } = await import('../features/messages/MessageResultRow.tsx');
    const { useStore } = await import('../lib/store.ts');
    useStore.setState({
      users: { u1: { id: 'u1', kind: 'human', displayName: 'Ana', deactivated: false } },
      channels: {},
    } as never);
    const message = {
      id: 'm1',
      channelId: 'c1',
      authorId: 'u1',
      body: 'the query:\n```sql\nSELECT 1;\n```',
      createdAt: '2026-10-08T10:00:00.000Z',
      reactions: [],
      attachments: [],
      mentionUserIds: [],
      mentionGroupIds: [],
    };
    const { container } = render(
      <MessageResultRow message={message as never} onOpen={vi.fn()} timestamp={null} />,
    );
    expect(container.querySelector('.code-block')).toBeTruthy();
    expect(container.querySelector('button button')).toBeNull();
  });
});
