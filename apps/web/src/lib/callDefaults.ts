/** What a workspace that never opened the Calls pages gets — the server's defaults. */
import type { CallSettings } from '@blob/shared';

export const DEFAULT_CALL_SETTINGS: CallSettings = {
  huddles: { enabled: true, cameras: true, screenShare: true, maxParticipants: 50 },
  meetups: { enabled: true, camerasOnJoin: true, maxParticipants: 50 },
};
