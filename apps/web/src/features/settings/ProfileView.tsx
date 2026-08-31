/** Your profile: the parts of you other people see.
 *
 * Separate from Preferences, which is how the app behaves for you. This is what the
 * workspace sees — the name on your messages, what you do, and where you are.
 */

import { useRef, useState } from 'react';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { Avatar } from '../../components/Avatar.tsx';
import { uploadFile } from '../../lib/attachments.ts';
import { showError } from '../../lib/toasts.ts';

export function ProfileView() {
  const currentUser = useStore((s) => s.currentUser);
  const applyEvent = useStore((s) => s.applyEvent);

  const [displayName, setDisplayName] = useState(currentUser?.displayName ?? '');
  const [fullName, setFullName] = useState(currentUser?.fullName ?? '');
  const [title, setTitle] = useState(currentUser?.title ?? '');
  const [statusEmoji, setStatusEmoji] = useState(currentUser?.statusEmoji ?? '');
  const [statusText, setStatusText] = useState(currentUser?.statusText ?? '');
  const [busy, setBusy] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
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
    <main className="pane">
      <div style={{ overflowY: 'auto' }}>
        <div className="profile-page">
          {/* The shared page heading, rather than a third copy of it: these two were
              inlined here verbatim, declaration for declaration, so they would not have
              followed any change to the ones every console page uses. */}
          <h1 className="page-title">Your profile</h1>
          <p className="page-sub">{currentUser.email}</p>

          <div className="profile-preview">
            <Avatar user={currentUser} />
            <div>
              <div className="profile-preview-name">{displayName || currentUser.displayName}</div>
              <div className="profile-preview-meta">
                {[statusEmoji, statusText].filter(Boolean).join(' ') || title || 'No status set'}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <input
                ref={avatarInputRef}
                type="file"
                name="avatar"
                aria-label="Choose a profile photo"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  setUploadingAvatar(true);
                  try {
                    const attachmentId = await uploadFile(file, file.type || 'image/png');
                    const { user } = await api.me.update({ avatarAttachmentId: attachmentId });
                    applyEvent({ t: 'user.updated', user });
                  } catch (err) {
                    showError(err);
                  } finally {
                    setUploadingAvatar(false);
                  }
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={uploadingAvatar}
                onClick={() => avatarInputRef.current?.click()}
              >
                {uploadingAvatar ? 'Uploading…' : currentUser.avatarUrl ? 'Change photo' : 'Add a photo'}
              </button>
              {currentUser.avatarUrl && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={uploadingAvatar}
                  onClick={async () => {
                    try {
                      const { user } = await api.me.update({ avatarAttachmentId: null });
                      applyEvent({ t: 'user.updated', user });
                    } catch (err) {
                      showError(err);
                    }
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <div className="profile-fields">
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
          </div>

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
    </main>
  );
}
