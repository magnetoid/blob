/** Your profile: the parts of you other people see.
 *
 * Separate from Preferences, which is how the app behaves for you. This is what the
 * workspace sees — the name on your messages, what you do, and where you are.
 */

import { useState } from 'react';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { Avatar } from '../../components/Avatar.tsx';

export function ProfileView() {
  const currentUser = useStore((s) => s.currentUser);
  const applyEvent = useStore((s) => s.applyEvent);

  const [displayName, setDisplayName] = useState(currentUser?.displayName ?? '');
  const [fullName, setFullName] = useState(currentUser?.fullName ?? '');
  const [title, setTitle] = useState(currentUser?.title ?? '');
  const [statusEmoji, setStatusEmoji] = useState(currentUser?.statusEmoji ?? '');
  const [statusText, setStatusText] = useState(currentUser?.statusText ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!currentUser) return null;

  const dirty =
    displayName !== (currentUser.displayName ?? '') ||
    fullName !== (currentUser.fullName ?? '') ||
    title !== (currentUser.title ?? '') ||
    statusEmoji !== (currentUser.statusEmoji ?? '') ||
    statusText !== (currentUser.statusText ?? '');

  async function save() {
    if (!displayName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Empty means "clear it", and the server distinguishes absent from null — so the
      // optional fields go as null rather than as an empty string.
      const { user } = await api.me.update({
        displayName: displayName.trim(),
        fullName: fullName.trim() || null,
        title: title.trim() || null,
        statusEmoji: statusEmoji.trim() || null,
        statusText: statusText.trim() || null,
      });
      applyEvent({ t: 'user.updated', user });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pane">
      <div style={{ overflowY: 'auto' }}>
        <div style={{ maxWidth: 620, padding: '44px 26px 60px' }}>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--text-xl)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            Your profile
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 'var(--text-row)', color: 'var(--text-4)' }}>
            {currentUser.email}
          </p>

          <div className="profile-preview">
            <Avatar user={currentUser} />
            <div>
              <div className="profile-preview-name">{displayName || currentUser.displayName}</div>
              <div className="profile-preview-meta">
                {[statusEmoji, statusText].filter(Boolean).join(' ') || title || 'No status set'}
              </div>
            </div>
          </div>

          <label className="field">
            <span className="field-label">Display name</span>
            <input
              className="input"
              value={displayName}
              maxLength={40}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <span className="pref-hint">This is the name on your messages and mentions.</span>
          </label>

          <label className="field">
            <span className="field-label">Full name</span>
            <input
              className="input"
              value={fullName}
              maxLength={80}
              placeholder="Optional"
              onChange={(event) => setFullName(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">What you do</span>
            <input
              className="input"
              value={title}
              maxLength={80}
              placeholder="Optional"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <div className="field">
            <span className="field-label">Status</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                style={{ width: 72, textAlign: 'center' }}
                value={statusEmoji}
                maxLength={8}
                placeholder="🎧"
                aria-label="Status emoji"
                onChange={(event) => setStatusEmoji(event.target.value)}
              />
              <input
                className="input"
                style={{ flex: 1 }}
                value={statusText}
                maxLength={100}
                placeholder="Heads down until 3"
                aria-label="Status text"
                onChange={(event) => setStatusText(event.target.value)}
              />
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="dialog-actions" style={{ justifyContent: 'flex-start', marginTop: 18 }}>
            <button
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={!dirty || !displayName.trim() || busy}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="pref-hint">Saved.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
