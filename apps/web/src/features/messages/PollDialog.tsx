/** Asking a poll (ADR 0041): a question and two to ten answers, sent as one message whose
 * text is the question — so search, notifications and agents read it like any other. */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog.tsx';
import { api, ApiError } from '../../lib/api.ts';

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;
export const MAX_OPTION_CHARS = 120;

export function PollDialog({
  channelId,
  threadRootId = null,
  initialQuestion = '',
  onClose,
  onSent,
}: {
  channelId: string;
  threadRootId?: string | null;
  /** What was in the composer, which is usually the question being asked. */
  initialQuestion?: string;
  onClose: () => void;
  /** Called once the poll is posted, with the question it asked. */
  onSent?: (question: string) => void;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questionRef = useRef<HTMLInputElement>(null);
  // Set when an option is added, so the new field takes the focus as it mounts.
  const focusAdded = useRef(false);

  useEffect(() => {
    questionRef.current?.focus();
  }, []);

  function setOption(index: number, value: string) {
    setOptions((current) => current.map((option, at) => (at === index ? value : option)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const asked = question.trim();
    const answers = options.map((option) => option.trim()).filter(Boolean);
    if (!asked) {
      setError('Ask a question.');
      return;
    }
    if (answers.length < MIN_OPTIONS) {
      setError('Give it at least two options.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.messages.send(channelId, {
        body: asked,
        clientMsgId: crypto.randomUUID(),
        threadRootId,
        poll: { options: answers, multiple, anonymous },
      });
      onSent?.(asked);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That poll did not send. Try again.');
      setBusy(false);
    }
  }

  return (
    <Dialog label="Create a poll" onClose={onClose}>
      <form className="dialog poll-dialog" onSubmit={submit}>
        <h2 className="dialog-title">Create a poll</h2>
        <label className="field">
          <span className="field-label">Question</span>
          <input
            ref={questionRef}
            className="input"
            value={question}
            maxLength={500}
            placeholder="Where should the offsite be?"
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        <fieldset className="poll-edit-options">
          <legend className="field-label">Options</legend>
          {options.map((option, index) => (
            <div className="poll-edit-option" key={index}>
              <input
                ref={
                  index === options.length - 1
                    ? (element) => {
                        if (element && focusAdded.current) {
                          focusAdded.current = false;
                          element.focus();
                        }
                      }
                    : undefined
                }
                className="input"
                aria-label={`Option ${index + 1}`}
                value={option}
                maxLength={MAX_OPTION_CHARS}
                onChange={(event) => setOption(index, event.target.value)}
              />
              {options.length > MIN_OPTIONS && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={`Remove option ${index + 1}`}
                  onClick={() => setOptions((current) => current.filter((_, at) => at !== index))}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {options.length < MAX_OPTIONS && (
            <button
              type="button"
              className="btn btn-ghost poll-edit-add"
              onClick={() => {
                focusAdded.current = true;
                setOptions((current) => [...current, '']);
              }}
            >
              Add an option
            </button>
          )}
        </fieldset>
        <label className="pref-row">
          <span className="pref-label grow">People can choose more than one</span>
          <input
            type="checkbox"
            checked={multiple}
            onChange={(event) => setMultiple(event.target.checked)}
          />
        </label>
        <label className="pref-row">
          <span className="pref-label grow">
            Anonymous
            <span className="pref-hint block">
              Only the counts are shown — nobody sees who chose what, you included. It cannot
              be changed once the poll is sent.
            </span>
          </span>
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(event) => setAnonymous(event.target.checked)}
          />
        </label>
        {error && (
          <p className="error-text" data-refused="true">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send poll'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
