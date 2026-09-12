/** The one rule the client checks before it asks the server for a channel.
 *
 * Lowercase, digits, hyphens and underscores — the convention every chat app converged
 * on. The server enforces the same rule in `schemas/requests.py` and answers 400 when it
 * is broken; this exists so the dialog can say what is wrong before the round trip, and
 * so the name it sends is already the name the server will store.
 */
export type ChannelNameCheck = { ok: true; name: string } | { ok: false; message: string };

export const CHANNEL_NAME_MAX = 64;

const CHANNEL_NAME = /^[a-z0-9][a-z0-9-_]*$/;

export function channelName(raw: string): ChannelNameCheck {
  const name = raw.trim().toLowerCase();
  if (name.length === 0) return { ok: false, message: 'Enter a channel name.' };
  if (name.length > CHANNEL_NAME_MAX) {
    return { ok: false, message: `Channel names are limited to ${CHANNEL_NAME_MAX} characters.` };
  }
  if (!CHANNEL_NAME.test(name)) {
    return { ok: false, message: 'Use lowercase letters, numbers, hyphens and underscores.' };
  }
  return { ok: true, name };
}
