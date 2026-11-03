/** An app's last ten errors, newest first, with when each happened.
 *
 * The banner above it says what is wrong now; this says what has gone wrong lately,
 * which is the question when an agent fails three different ways in an hour. Switching
 * the app back on clears the banner and leaves this, so a fixed failure still has a
 * record. Shared by the app page and the Janus page.
 *
 * Closed until asked for, as it was: a record of ten lines would otherwise push the page's
 * own controls down. The button says how many there are, and `aria-expanded` whether they
 * are showing.
 */

import type { AppRecentError } from "../../../../lib/api.ts";
import { Button } from "../../../../components/ui/button.tsx";
import { formatRelative } from "../../../messages/messageFormatting.ts";
import { useDisclosure } from "./useDisclosure.ts";

export function RecentErrors({ errors }: { errors: AppRecentError[] }) {
  const disclosure = useDisclosure();
  if (errors.length === 0) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="ghost" size="sm" {...disclosure.buttonProps}>
        {errors.length === 1 ? "1 recent error" : `${errors.length} recent errors`}
      </Button>
      {disclosure.open && (
        <ol
          id={disclosure.panelId}
          className="m-0 flex list-decimal flex-col gap-1 pl-8 text-sm wrap-anywhere"
        >
          {errors.map((entry, index) => (
            <li key={`${entry.at}:${index}`}>
              <time className="text-muted-foreground" dateTime={entry.at}>
                {formatRelative(entry.at)}
              </time>{" "}
              {entry.error}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
