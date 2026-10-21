// @vitest-environment happy-dom
/** A sensitive action refused for want of a recent sign-in is asked about once, then sent
 *  again — or left refused, with nothing changed, when the person says no (M3 · B1). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmItsYou, setAsker } from './stepUp.ts';
import { api, ApiError } from './api.ts';

const REFUSED = { error: { code: 'reauth_required', message: 'Confirm it’s you to continue.' } };
const MINTED = {
  token: { id: 't1', name: 'Editor', scopes: ['read'] },
  secret: 'the-secret',
  url: 'https://blob.example/api/mcp',
};

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  vi.unstubAllGlobals();
});

describe('asking', () => {
  it('says no when nothing is mounted to ask', async () => {
    expect(await confirmItsYou()).toBe(false);
  });

  it('asks once for requests refused at the same moment', async () => {
    let asked = 0;
    let answer: (confirmed: boolean) => void = () => {};
    stop = setAsker(() => {
      asked += 1;
      return new Promise<boolean>((resolve) => {
        answer = resolve;
      });
    });
    const first = confirmItsYou();
    const second = confirmItsYou();
    answer(true);
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(asked).toBe(1);
    // And asks again the next time — the question is not remembered as answered.
    const third = confirmItsYou();
    answer(false);
    expect(await third).toBe(false);
    expect(asked).toBe(2);
  });
});

describe('a refused request', () => {
  it('is sent again, unchanged, once the person confirms', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(403, REFUSED))
      .mockResolvedValueOnce(respond(200, MINTED));
    vi.stubGlobal('fetch', fetchMock);
    stop = setAsker(async () => true);

    const made = await api.assistants.create('Editor', false, 90);
    expect(made.secret).toBe('the-secret');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls as [[string, RequestInit], [string, RequestInit]];
    expect(second[0]).toBe(first[0]);
    expect(second[1].method).toBe('POST');
    expect(second[1].body).toBe(first[1].body);
  });

  it('stays refused when the person cancels, as a code nothing reports', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(403, REFUSED));
    vi.stubGlobal('fetch', fetchMock);
    stop = setAsker(async () => false);

    const failure = await api.assistants.create('Editor', false, 90).catch((err) => err);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe('reauth_cancelled');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is not asked about twice in a row', async () => {
    // A server that still refuses after a confirmation must not loop the prompt.
    const fetchMock = vi.fn().mockImplementation(async () => respond(403, REFUSED));
    vi.stubGlobal('fetch', fetchMock);
    const asker = vi.fn(async () => true);
    stop = setAsker(asker);

    const failure = await api.assistants.create('Editor', false, 90).catch((err) => err);
    expect((failure as ApiError).code).toBe('reauth_required');
    expect(asker).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('leaves every other refusal alone', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(403, { error: { code: 'forbidden', message: 'No.' } }));
    vi.stubGlobal('fetch', fetchMock);
    const asker = vi.fn(async () => true);
    stop = setAsker(asker);

    const failure = await api.assistants.create('Editor', false, 90).catch((err) => err);
    expect((failure as ApiError).code).toBe('forbidden');
    expect(asker).not.toHaveBeenCalled();
  });
});
