/** Connecting an agent that runs somewhere Blob cannot reach.
 *
 * The other two ways of adding an agent both end with an address: paste a URL, or paste
 * a repository and let the runner produce one. Neither works for the agent on your own
 * machine — there is no hostname to give, no certificate, and no route in through your
 * router. This one inverts it: Blob mints a token, the agent dials in with it and holds
 * the connection, and runs are written down that pipe.
 *
 * So this form registers an agent that does not exist yet. What you get back is a token,
 * and the agent becomes real the moment something connects with it. That is also the
 * whole of "importing" one — it announces its own name and description on the way in,
 * rather than being described by hand here.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiError } from '../../../../lib/api.ts';
import { Button } from '../../../../components/ui/button.tsx';
import { Checkbox } from '../../../../components/ui/checkbox.tsx';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '../../../../components/ui/field.tsx';
import { Input } from '../../../../components/ui/input.tsx';

interface Props {
  scopeCatalog: Record<string, string>;
  onConnected: (name: string, botToken: string, signingSecret: string) => void;
  onError: (message: string | null) => void;
}

/** What an agent answering mentions actually needs, and nothing beyond it. */
const DEFAULT_SCOPES = ['messages:read', 'messages:write', 'channels:read', 'channels:join'];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function ConnectAgentForm({ scopeCatalog, onConnected, onError }: Props) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  const slug = slugify(name);
  // Three characters is the server's minimum, and failing here beats a 400 that lands
  // after someone has already picked scopes.
  const usable = slug.length >= 3 && !busy;

  async function submit() {
    if (!usable) return;
    setBusy(true);
    onError(null);
    try {
      const installed = await api.admin.installPlugin({
        slug,
        name: name.trim(),
        runtime: 'socket',
        version: '1.0.0',
        events: [],
        scopes,
      });
      // The signing secret matters here, and it used to be dropped on the floor. The
      // bridge runs beside the agent and POSTs runs to it, signed with this — and a real
      // agent verifies. Janus goes further and does not even *register* its AG-UI route
      // without the secret configured, so an unsigned bridge gets a 404 or a 401 on every
      // run, which reaches the person as "the agent could not be reached".
      onConnected(installed.plugin.name, installed.botToken, installed.signingSecret);
      setName('');
      setScopes(DEFAULT_SCOPES);
      setOpen(false);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'That agent could not be registered.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Connect an agent on your machine
        </Button>
        <p className="m-0 text-sm text-muted-foreground">
          For an agent running on your laptop or a private network. It dials Blob, so it
          needs no public address.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h4 className="m-0 text-sm font-semibold">Connect an agent on your machine</h4>
        <p className="m-0 text-sm text-muted-foreground">
          Blob gives you a token. Your agent opens a WebSocket to{' '}
          <code>{location.origin.replace(/^http/, 'ws')}/ws/agent</code> with it, and says
          what it is when it connects.
        </p>
      </div>

      <Field>
        <FieldLabel htmlFor={`${ids}-name`}>What is it called?</FieldLabel>
        <Input
          id={`${ids}-name`}
          value={name}
          aria-describedby={slug ? `${ids}-slug` : undefined}
          // Focused in an effect rather than with `autoFocus`, which steals focus on
          // mount wherever the element happens to render. Here the form only exists
          // because someone just clicked to open it, so moving the caret into it is
          // finishing their action rather than interrupting one.
          ref={nameRef}
          placeholder="Desktop Claude"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
        {slug && (
          <FieldDescription id={`${ids}-slug`}>
            Known as <code>{slug}</code>, which cannot change later.
          </FieldDescription>
        )}
      </Field>

      <FieldSet aria-describedby={`${ids}-scopes-hint`}>
        <FieldLegend variant="label">What may it do?</FieldLegend>
        {Object.entries(scopeCatalog).map(([scope, description]) => (
          <Field key={scope} orientation="horizontal">
            <Checkbox
              id={`${ids}-${scope}`}
              aria-describedby={`${ids}-${scope}-hint`}
              checked={scopes.includes(scope)}
              onCheckedChange={() =>
                setScopes((current) =>
                  current.includes(scope)
                    ? current.filter((s) => s !== scope)
                    : [...current, scope],
                )
              }
            />
            <FieldContent>
              <FieldLabel htmlFor={`${ids}-${scope}`}>
                <code>{scope}</code>
              </FieldLabel>
              <FieldDescription id={`${ids}-${scope}-hint`}>{description}</FieldDescription>
            </FieldContent>
          </Field>
        ))}
        <FieldDescription id={`${ids}-scopes-hint`}>
          An agent cannot widen this by asking on connect. Changing it later goes through
          the same approval an app update does.
        </FieldDescription>
      </FieldSet>

      <div className="flex flex-wrap gap-2">
        <Button disabled={!usable} onClick={() => void submit()}>
          {busy ? 'Registering…' : 'Get a token'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
