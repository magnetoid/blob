/** The time now, refreshed once a minute while `on` — for a deadline shown as time left.
 *
 * Shared by the run card and Home, which both count a question down: reading the clock
 * during render is impure (React's purity rule), so the time is state, set at once and
 * then every minute while somebody is looking at a deadline.
 */

import { useEffect, useState } from 'react';

export function useMinute(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    // At once as well as every minute: a card that started waiting long after it was
    // first drawn would otherwise count down from the moment it mounted.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [on]);
  return now;
}
