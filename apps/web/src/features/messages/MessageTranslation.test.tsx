// @vitest-environment happy-dom
/** Auto-translate, and the loop it used to spin.
 *
 * `translationBusy` is a dependency of the effect that fires the request, and the
 * request's own `finally` sets it back to false. So a failure re-ran the effect, which
 * saw no translation and fired the same failing request again — every visible row
 * hammering its own endpoint for as long as it stayed on screen, which is what kept the
 * route's rate limit tripped in the first place.
 *
 * Adding `translationError` to the guard would not have been enough: the reset effect
 * clears it whenever the `message` prop identity changes, and a store update re-creates
 * that object. So the attempt is keyed on the message revision and the target language,
 * which is also what makes an edit, or a change of language, try again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';

const translate = vi.fn();

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: { messages: { translate: (...args: unknown[]) => translate(...(args as [])) } },
  };
});

const { MessageTranslation } = await import('./MessageTranslation.tsx');
const { useStore } = await import('../../lib/store.ts');

// A distinct id per test. `translationCache` is module-level and outlives a test, so a
// shared id would let one test's cached success silence the next test's request.
let nextId = 0;

function aMessage(overrides: Record<string, unknown> = {}) {
  return { ...MESSAGE, id: `m${(nextId += 1)}`, ...overrides };
}

const MESSAGE = {
  id: 'm0',
  channelId: 'c1',
  authorId: 'someone-else',
  body: 'bonjour',
  createdAt: '2026-09-01T09:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  kind: 'user',
  reactions: [],
  attachments: [],
};

function signedIn() {
  useStore.setState({
    currentUser: {
      id: 'u1',
      kind: 'human',
      displayName: 'Ana',
      role: 'owner',
      prefs: { autoTranslate: true, language: 'en' },
    },
  } as never);
}

beforeEach(() => {
  translate.mockReset();
  signedIn();
});

afterEach(cleanup);

describe('auto-translate', () => {
  it('asks once', async () => {
    translate.mockResolvedValue({
      translation: { targetLanguage: 'en', body: 'hello', sourceLanguage: 'fr' },
    });

    render(<MessageTranslation message={aMessage() as never} pending={false} editing={false} />);

    await waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
  });

  it('does not ask again after a failure', async () => {
    translate.mockRejectedValue(new Error('no translator configured'));

    render(<MessageTranslation message={aMessage() as never} pending={false} editing={false} />);

    await waitFor(() => expect(translate).toHaveBeenCalled());
    // Long enough for the loop to have run many times, if there were one.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('and not even when the message object is re-created underneath it', async () => {
    // What a store update does: same message, new identity. It clears the error, which
    // is why guarding on the error alone would have restarted the loop.
    translate.mockRejectedValue(new Error('no translator configured'));

    const message = aMessage();
    const { rerender } = render(
      <MessageTranslation message={message as never} pending={false} editing={false} />,
    );
    await waitFor(() => expect(translate).toHaveBeenCalled());

    rerender(
      <MessageTranslation message={{ ...message } as never} pending={false} editing={false} />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('tries again once the message is actually edited', async () => {
    translate.mockRejectedValue(new Error('no translator configured'));

    const message = aMessage();
    const { rerender } = render(
      <MessageTranslation message={message as never} pending={false} editing={false} />,
    );
    await waitFor(() => expect(translate).toHaveBeenCalledTimes(1));

    rerender(
      <MessageTranslation
        message={{ ...message, editedAt: '2026-09-01T10:00:00.000Z' } as never}
        pending={false}
        editing={false}
      />,
    );

    // A new revision is a different thing to translate, so the key changes and the
    // one attempt it is allowed is a fresh one.
    await waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
  });
});
