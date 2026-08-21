/**
 * Rendering structured message content.
 *
 * A switch over a closed union that produces React elements and nothing else. Text goes
 * through the same markdown renderer message bodies use, so there is exactly one place
 * in this app where user content becomes markup — a block cannot introduce an escaping
 * hole that a message body does not already have.
 *
 * Unknown types render nothing rather than throwing. The server refuses to store them,
 * so seeing one means a client is older than the server, and an older client showing
 * slightly less is better than one showing an error.
 */

import { useState } from 'react';
import type { MessageBlock } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { renderMarkdown, type RenderOptions } from '../../lib/markdown.tsx';

interface Props {
  messageId: string;
  blocks: MessageBlock[];
  options: RenderOptions;
}

export function BlockRenderer({ messageId, blocks, options }: Props) {
  // One at a time: a second click while the first is in flight would send the action
  // twice, and an app cannot tell those apart.
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  async function trigger(actionId: string, value: string) {
    if (pending) return;
    setPending(actionId);
    setFailed(null);
    try {
      await api.interact({ messageId, actionId, value });
    } catch {
      setFailed(actionId);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="blocks">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;

        switch (block.type) {
          case 'section':
            return (
              <div key={key} className="block-section">
                {renderMarkdown(block.text.text, options)}
              </div>
            );

          case 'fields':
            return (
              <div key={key} className="block-fields">
                {block.fields.map((field, i) => (
                  <div key={i}>{renderMarkdown(field.text, options)}</div>
                ))}
              </div>
            );

          case 'divider':
            return <hr key={key} className="block-divider" />;

          case 'context':
            return (
              <div key={key} className="block-context">
                {block.elements.map((element, i) => (
                  <span key={i}>{renderMarkdown(element.text, options)}</span>
                ))}
              </div>
            );

          case 'image':
            return (
              <img key={key} className="block-image" src={block.url} alt={block.alt ?? ''} />
            );

          case 'actions':
            return (
              <div key={key} className="block-actions">
                {block.elements.map((element) =>
                  element.type === 'button' ? (
                    <button
                      key={element.actionId}
                      className="btn"
                      data-style={element.style ?? 'default'}
                      disabled={pending !== null}
                      onClick={() => void trigger(element.actionId, element.value ?? '')}
                    >
                      {pending === element.actionId ? 'Working…' : element.text}
                    </button>
                  ) : (
                    <select
                      key={element.actionId}
                      className="input block-select"
                      defaultValue=""
                      disabled={pending !== null}
                      aria-label={element.placeholder || 'Choose an option'}
                      onChange={(event) => void trigger(element.actionId, event.target.value)}
                    >
                      <option value="" disabled>
                        {element.placeholder || 'Choose…'}
                      </option>
                      {element.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ),
                )}
              </div>
            );

          case 'input':
            return (
              <label key={key} className="block-input">
                <span className="field-label">{block.label}</span>
                <input
                  className="input"
                  value={inputs[block.actionId] ?? ''}
                  placeholder={block.placeholder}
                  disabled={pending !== null}
                  onChange={(event) =>
                    setInputs((current) => ({ ...current, [block.actionId]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void trigger(block.actionId, inputs[block.actionId] ?? '');
                  }}
                />
              </label>
            );

          default:
            return null;
        }
      })}

      {failed && <p className="error-text">That did not go through. Try again.</p>}
    </div>
  );
}
