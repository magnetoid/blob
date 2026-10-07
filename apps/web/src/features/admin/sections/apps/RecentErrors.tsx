/** An app's last ten errors, newest first, with when each happened.
 *
 * The banner above it says what is wrong now; this says what has gone wrong lately,
 * which is the question when an agent fails three different ways in an hour. Switching
 * the app back on clears the banner and leaves this, so a fixed failure still has a
 * record. Shared by the app page and the Janus page.
 */

import type { AppRecentError } from "../../../../lib/api.ts";
import { formatRelative } from "../../../messages/messageFormatting.ts";

export function RecentErrors({ errors }: { errors: AppRecentError[] }) {
  if (errors.length === 0) return null;
  return (
    <details className="run-log-detail">
      <summary>
        {errors.length === 1 ? "1 recent error" : `${errors.length} recent errors`}
      </summary>
      <ol className="recent-errors">
        {errors.map((entry, index) => (
          <li key={`${entry.at}:${index}`}>
            <time className="recent-error-at" dateTime={entry.at}>
              {formatRelative(entry.at)}
            </time>{" "}
            {entry.error}
          </li>
        ))}
      </ol>
    </details>
  );
}
