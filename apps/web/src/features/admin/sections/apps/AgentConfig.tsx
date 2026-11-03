/** What a hosted agent is configured with, and how to change it.
 *
 * The declarative half of setting an agent up: the values it needs to work — a model
 * name, a provider key, a timeout. The other half is the terminal, and the split is by
 * what the operation actually *is* rather than by taste. A key is a field. A device-code
 * login prints a URL, waits, and completes out of band; no arrangement of text inputs
 * expresses that.
 *
 * Two things here are load-bearing rather than decorative:
 *
 * **Secrets are described, not printed.** A key comes back as "73 characters, ending
 * a4f2" — enough to tell the key you pasted from the one that is still empty, which is
 * the question anyone opening this screen is actually asking. This is hygiene rather than
 * a boundary: the same admin can read the real value through the terminal. What it buys
 * is that a console left open or screen-shared does not have an API key on it.
 *
 * **A duplicated key is shown, loudly.** The runner's environment API appends rather than
 * upserts, so a key can exist twice with two different values and Docker will take one of
 * them without saying which. That is not hypothetical — it is why an agent here spent
 * days failing to authenticate against a key the dashboard displayed as correct. Saving
 * repairs it, because a write deletes every row for the key before creating one.
 */

import { useCallback, useEffect, useState } from 'react';
import { cn } from 'cn';
import { api, ApiError, type AgentEnvVar } from '../../../../lib/api.ts';
import { Alert, AlertDescription } from '../../../../components/ui/alert.tsx';
import { Badge } from '../../../../components/ui/badge.tsx';
import { Button } from '../../../../components/ui/button.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableRow,
} from '../../../../components/ui/table.tsx';

interface Props {
  pluginId: string;
  onError: (message: string | null) => void;
}

export function AgentConfig({ pluginId, onError }: Props) {
  const [rows, setRows] = useState<AgentEnvVar[] | null>(null);
  const [reserved, setReserved] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<string[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const fail = useCallback(
    (err: unknown, fallback: string) => onError(err instanceof ApiError ? err.message : fallback),
    [onError],
  );

  const apply = useCallback((next: { env: AgentEnvVar[]; reserved: string[] }) => {
    setRows(next.env);
    setReserved(next.reserved);
    setEdits({});
    setRemoving([]);
    setNewKey('');
    setNewValue('');
  }, []);

  useEffect(() => {
    let current = true;
    api.admin
      .agentEnv(pluginId)
      .then((next) => {
        if (current) apply(next);
      })
      .catch((err: unknown) => {
        if (current) fail(err, 'Could not read this agent’s configuration.');
      });
    return () => {
      current = false;
    };
  }, [pluginId, apply, fail]);

  const duplicates = [...new Set((rows ?? []).filter((r) => r.duplicated).map((r) => r.key))];
  const pending =
    Object.keys(edits).length > 0 || removing.length > 0 || (newKey.trim() && newValue.trim());

  async function save(restart: boolean) {
    if (busy) return;
    setBusy(true);
    onError(null);
    const set = { ...edits };
    if (newKey.trim() && newValue.trim()) set[newKey.trim().toUpperCase()] = newValue;
    try {
      apply(await api.admin.saveAgentEnv(pluginId, { set, remove: removing, restart }));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      fail(err, 'Those values could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) {
    return <p className="m-0 text-sm text-muted-foreground">Reading configuration…</p>;
  }

  // One row per key, not per stored row: a duplicated key is one thing to fix, and
  // showing it twice would invite editing each copy separately — which is how it got
  // this way.
  const byKey = new Map<string, AgentEnvVar>();
  for (const row of rows) if (!byKey.has(row.key)) byKey.set(row.key, row);

  return (
    <div className="flex flex-col gap-3">
      {duplicates.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <strong>Set twice: {duplicates.join(', ')}.</strong> The runner stores each of
            these more than once, and the container uses one of them without saying which —
            so the agent may be running on a value this screen is not showing. Saving the key
            fixes it.
          </AlertDescription>
        </Alert>
      )}

      <Table>
        <TableCaption className="sr-only">Configuration</TableCaption>
        <TableBody>
          {[...byKey.values()].map((row) => {
            const gone = removing.includes(row.key);
            return (
              <TableRow key={row.key} className="hover:bg-transparent">
                {/* Struck through rather than removed on click: a row that vanishes gives
                    nothing to undo, and the change has not been saved yet. */}
                <TableCell className="w-px">
                  <div className="flex items-center gap-1.5">
                    <code
                      className={cn(
                        'font-mono text-xs',
                        gone && 'line-through opacity-50',
                      )}
                    >
                      {row.key}
                    </code>
                    {row.duplicated && <Badge variant="destructive">set twice</Badge>}
                    {row.managed && <Badge variant="outline">runner</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  {row.managed ? (
                    // Editable in principle and pointless in practice: the runner rewrites
                    // these on every deploy, so an edit here disappears without failing.
                    <span className="text-sm text-muted-foreground">{row.value ?? row.hint}</span>
                  ) : (
                    <Input
                      aria-label={row.key}
                      type={row.secret ? 'password' : 'text'}
                      disabled={gone}
                      placeholder={row.secret ? (row.hint ?? 'not set') : ''}
                      value={edits[row.key] ?? (row.secret ? '' : (row.value ?? ''))}
                      onChange={(event) =>
                        setEdits((prev) => ({ ...prev, [row.key]: event.target.value }))
                      }
                    />
                  )}
                </TableCell>
                <TableCell className="w-px text-right">
                  {!row.managed && (
                    <Button
                      variant="ghost"
                      aria-label={`${gone ? 'Keep' : 'Remove'} ${row.key}`}
                      onClick={() =>
                        setRemoving((prev) =>
                          gone ? prev.filter((k) => k !== row.key) : [...prev, row.key],
                        )
                      }
                    >
                      {gone ? 'Keep' : 'Remove'}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Input
          aria-label="New key"
          placeholder="NEW_KEY"
          value={newKey}
          spellCheck={false}
          onChange={(event) => setNewKey(event.target.value)}
        />
        <Input
          aria-label="New value"
          placeholder="value"
          value={newValue}
          onChange={(event) => setNewValue(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={busy || !pending} onClick={() => void save(true)}>
          Save and restart
        </Button>
        <Button
          variant="ghost"
          disabled={busy || !pending}
          onClick={() => void save(false)}
        >
          Save only
        </Button>
        {/* There before anything is said in it, so the word is announced when it arrives. */}
        <span role="status" className="text-sm text-muted-foreground">
          {saved ? 'Saved' : ''}
        </span>
      </div>

      <p className="m-0 text-sm text-muted-foreground">
        {/* Said plainly because the alternative is an operator staring at a value the
            agent does not have and concluding the save did not work. */}
        Configuration only reaches the container when it starts, so a change is not live
        until you restart it. {reserved.length > 0 && `Blob sets ${reserved.join(', ')} itself.`}
      </p>
    </div>
  );
}
