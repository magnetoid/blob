/** The time zone this account keeps, and how to offer it.
 *
 * The account has carried a `timezone` column since the port, and `PATCH /api/me` has
 * always accepted it — but no screen ever set it, so every real account sat on the `UTC`
 * default. Quiet hours are evaluated in that zone and so is every `/remind` phrase, which
 * made "remind me tomorrow at 9" mean 09:00 UTC for everybody. The confirmation is
 * rendered in the same zone, so it read "09:00" and never gave the mismatch away: the
 * feature was wrong in a way that looked right.
 */

/** Every zone this browser knows, or a short list where it will not say. */
export function knownZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported === 'function') {
    try {
      const zones = supported('timeZone');
      if (Array.isArray(zones) && zones.length > 0) return zones;
    } catch {
      // Fall through to the short list.
    }
  }
  // Enough to cover most people, for a browser too old to enumerate. Anybody outside
  // this list still keeps whatever their account already holds.
  return [
    'UTC',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Belgrade',
    'Europe/Moscow',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Africa/Lagos',
    'Africa/Johannesburg',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
}

/** What this device thinks it is, or null when it will not say. */
export function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * The current time in a zone, for the hint beside the picker.
 *
 * Showing the clock is the whole point of the control: "Europe/Belgrade" means nothing
 * to most people and "14:32" means everything, and it is the fastest way to see that the
 * stored zone is wrong.
 */
export function timeIn(zone: string, now: Date): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(now);
  } catch {
    return null;
  }
}

/** Whether a zone name is one this browser can actually resolve. */
export function isValidZone(zone: string): boolean {
  return timeIn(zone, new Date(0)) !== null;
}
