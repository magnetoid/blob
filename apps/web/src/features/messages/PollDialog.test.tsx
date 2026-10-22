// @vitest-environment happy-dom
/**
 * Asking a poll (ADR 0041): a question and two to ten options, sent as one message.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { api, ApiError } from '../../lib/api.ts';
import { PollDialog } from './PollDialog.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('asking a poll', () => {
  it('starts from the composer’s words and sends the question with its options', async () => {
    const send = vi.spyOn(api.messages, 'send').mockResolvedValue({ message: {} as Message });
    const sent = vi.fn();
    const closed = vi.fn();
    render(
      <PollDialog
        channelId="c1"
        threadRootId="t1"
        initialQuestion="Where should the offsite be?"
        onClose={closed}
        onSent={sent}
      />,
    );
    expect((screen.getByLabelText('Question') as HTMLInputElement).value).toBe(
      'Where should the offsite be?',
    );
    fill('Option 1', 'Lisbon');
    fill('Option 2', ' Belgrade ');
    fireEvent.click(screen.getByLabelText(/People can choose more than one/));
    fireEvent.click(screen.getByRole('button', { name: 'Send poll' }));

    await waitFor(() => expect(sent).toHaveBeenCalledWith('Where should the offsite be?'));
    expect(send).toHaveBeenCalledWith('c1', {
      body: 'Where should the offsite be?',
      clientMsgId: expect.any(String),
      threadRootId: 't1',
      poll: { options: ['Lisbon', 'Belgrade'], multiple: true, anonymous: false },
    });
    expect(closed).toHaveBeenCalled();
  });

  it('asks for a question and two options before sending anything', () => {
    const send = vi.spyOn(api.messages, 'send');
    render(<PollDialog channelId="c1" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send poll' }));
    expect(screen.getByText('Ask a question.')).toBeTruthy();

    fill('Question', 'Lunch?');
    fill('Option 1', 'Yes');
    fireEvent.click(screen.getByRole('button', { name: 'Send poll' }));
    expect(screen.getByText('Give it at least two options.')).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it('grows to ten options and never shrinks below two', () => {
    render(<PollDialog channelId="c1" onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /Remove option/ })).toBeNull();
    for (let added = 0; added < 8; added += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Add an option' }));
    }
    expect(screen.getByLabelText('Option 10')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add an option' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove option 10' }));
    expect(screen.queryByLabelText('Option 10')).toBeNull();
  });

  it('says what the server refused, and keeps what was typed', async () => {
    vi.spyOn(api.messages, 'send').mockRejectedValue(
      new ApiError(400, 'invalid_input', 'Two options say the same thing.'),
    );
    render(<PollDialog channelId="c1" initialQuestion="Lunch?" onClose={() => {}} />);
    fill('Option 1', 'Yes');
    fill('Option 2', 'yes');
    fireEvent.click(screen.getByRole('button', { name: 'Send poll' }));
    expect(await screen.findByText('Two options say the same thing.')).toBeTruthy();
    expect((screen.getByLabelText('Option 2') as HTMLInputElement).value).toBe('yes');
  });
});
