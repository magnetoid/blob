/** Which toolsets Janus may use.
 *
 * The one rule here that is not obvious from the screen: a `PUT` of `toolsets` **replaces**
 * the enabled list, so anything left out of it is turned off. A page that sent only the
 * boxes it had drawn would therefore disable, silently, any toolset that is enabled and no
 * longer in `available` — a toolset renamed upstream, or one this build of Janus dropped.
 * So the extras are drawn too, marked, and go back with the rest unless somebody unchecks
 * them on purpose.
 */

import { useId, useState } from "react";
import { Alert, AlertDescription } from "../../../../components/ui/alert.tsx";
import { Button } from "../../../../components/ui/button.tsx";
import { Checkbox } from "../../../../components/ui/checkbox.tsx";
import { Field, FieldContent, FieldDescription, FieldLabel } from "../../../../components/ui/field.tsx";
import { Card, CardNotice } from "../../../console/Card.tsx";
import { type JanusSave } from "./apply.ts";
import { Issues } from "./Issues.tsx";
import type { JanusConfig } from "./config.ts";

/** What this form's Save points `aria-describedby` at when Janus has answered. */
const ISSUES_ID = "janus-toolsets-issues";

export function Toolsets({
  config,
  disabled,
  save,
}: {
  config: JanusConfig;
  disabled: boolean;
  save: JanusSave;
}) {
  const { available, enabled: saved, error } = config.toolsets;
  const [enabled, setEnabled] = useState(saved);
  const ids = useId();

  const dead = disabled || save.saving;
  // Order is Janus's, and a click never reorders: `enabled` keeps the order Janus sent and
  // appends. That is what makes the request body a stable thing to read in a log.
  const rows = [...available, ...enabled.filter((name) => !available.includes(name))];
  const changed =
    enabled.length !== saved.length || enabled.some((name) => !saved.includes(name));

  function toggle(name: string) {
    setEnabled((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
    );
  }

  return (
    <Card
      title="Toolsets"
      description="What Janus can reach during a run, for every workspace on this server. One that needs a key of its own and has not been given one comes back as a warning here when you save."
      footer={
        <Button
          aria-describedby={save.issues.length > 0 ? ISSUES_ID : undefined}
          disabled={dead || !changed}
          // The whole list, always: Janus drops what a `PUT` leaves out.
          onClick={() => void save.run({ toolsets: enabled })}
        >
          Save toolsets
        </Button>
      }
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="wrap-anywhere">{error}</AlertDescription>
        </Alert>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-2.5">
          {rows.map((name, index) => {
            const gone = !available.includes(name);
            return (
              <Field
                key={name}
                orientation="horizontal"
                className="items-start rounded-lg border bg-muted/50 px-3 py-2.5"
              >
                <Checkbox
                  id={`${ids}-${index}`}
                  checked={enabled.includes(name)}
                  disabled={dead}
                  aria-describedby={gone ? `${ids}-${index}-gone` : undefined}
                  onCheckedChange={() => toggle(name)}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`${ids}-${index}`} className="wrap-anywhere">
                    {name}
                  </FieldLabel>
                  {gone && (
                    <FieldDescription id={`${ids}-${index}-gone`}>
                      Enabled, and not offered by this Janus.
                    </FieldDescription>
                  )}
                </FieldContent>
              </Field>
            );
          })}
        </div>
      )}

      {rows.length === 0 && (
        <CardNotice>Janus listed no toolsets.</CardNotice>
      )}

      <Issues id={ISSUES_ID} issues={save.issues} />
    </Card>
  );
}
