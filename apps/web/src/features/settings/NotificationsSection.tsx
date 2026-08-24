/** When Blob is allowed to interrupt you.
 *
 * Split out of the old `/settings` page rather than left with the appearance controls:
 * "how it looks" and "when it pings me" are two different questions, and the second is
 * the one people go looking for after being woken up.
 *
 * Yours, so every member sees it. Nothing here is a workspace-wide setting.
 */

import { useState } from 'react';
import { useStore } from '../../lib/store.ts';

export function NotificationsSection() {
  const currentUser = useStore((s) => s.currentUser);
  const setPrefs = useStore((s) => s.setPrefs);
  const [keywordDraft, setKeywordDraft] = useState('');

  const prefs = currentUser?.prefs;
  if (!prefs) return null;

  const dnd = prefs.dnd ?? { enabled: false, startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] };

  return (
    <section style={{ maxWidth: 620 }}>
      <div className="pref-row">
        <div style={{ flex: 1 }}>
          <div className="pref-label">Quiet hours</div>
          <div className="pref-hint">
            Outside {String(dnd.startHour).padStart(2, '0')}:00–
            {String(dnd.endHour).padStart(2, '0')}:00 nothing will notify you. Unread counts
            still update.
          </div>
        </div>
        <button
          className="toggle"
          aria-pressed={dnd.enabled}
          aria-label="Quiet hours"
          onClick={() => void setPrefs({ dnd: { ...dnd, enabled: !dnd.enabled } })}
        >
          <span />
        </button>
      </div>

      <div style={{ padding: '17px 0', borderBottom: '1px solid var(--hairline-soft)' }}>
        <div className="pref-label">Keyword alerts</div>
        <div className="pref-hint">
          Notify me whenever one of these words appears anywhere I can see.
        </div>
        <div className="chip-row" style={{ marginTop: 10 }}>
          {prefs.keywords.map((keyword) => (
            <button
              key={keyword}
              className="chip"
              aria-pressed
              title="Remove"
              onClick={() =>
                void setPrefs({ keywords: prefs.keywords.filter((k) => k !== keyword) })
              }
            >
              {keyword} ✕
            </button>
          ))}
        </div>
        <form
          style={{ display: 'flex', gap: 8, marginTop: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            const word = keywordDraft.trim();
            if (!word || prefs.keywords.includes(word)) return;
            void setPrefs({ keywords: [...prefs.keywords, word] });
            setKeywordDraft('');
          }}
        >
          <input
            className="input"
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            placeholder="Add a word"
            style={{ maxWidth: 240 }}
          />
          <button className="btn" type="submit">
            Add
          </button>
        </form>
      </div>
    </section>
  );
}
