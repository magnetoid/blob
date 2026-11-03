/** What agents and Blob's own model spent (M2 · A9): by agent, by the person each run was
 * answering, and Blob's own catch-ups and summaries — priced per model where the workspace
 * set a price.
 *
 * Two kinds of honesty the page keeps. Tokens are what the agents and the model provider
 * reported, so a run that reported nothing counted nothing, and the page says that rather
 * than letting it read as free. And a cost is only as complete as the prices: a model with
 * no price leaves its rows partly priced, never zero. Blob ships no price list — prices
 * change, and a contract is not the list price — so the admin enters their own.
 */

import { useId, useState } from 'react';
import { cn } from 'cn';
import {
  api,
  type ModelPrice,
  type UsageLine,
  type UsageModel,
  type UsagePrices,
  type UsageReport,
} from '../../../lib/api.ts';
import { formatCost, formatCount } from '../../../lib/format.ts';
import { Button } from '../../../components/ui/button.tsx';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '../../../components/ui/field.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../../components/ui/toggle-group.tsx';
import type { ConsoleSectionProps } from '../../console/ConsoleShell.tsx';
import { Card, CardFields, CardNotice, CardTable } from '../../console/Card.tsx';
import { useAdminData } from '../../console/hooks.ts';
import { UsageTable } from '../../console/UsageTable.tsx';

type Window = 1 | 7 | 30;

const WINDOWS: { days: Window; label: string }[] = [
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

const FEATURE_NAMES: Record<string, string> = {
  catchup: 'Catch-up',
  summary: 'Thread summaries',
};

export function UsageSection({ onError }: ConsoleSectionProps) {
  const [days, setDays] = useState<Window>(7);
  const { data, loading, reload } = useAdminData(
    () => api.admin.usage(days),
    [days],
    onError,
    'Could not load usage.',
  );

  // One window is always chosen: pressing the one that is would leave none.
  const picker = (
    <ToggleGroup
      aria-label="Window"
      variant="outline"
      spacing={0}
      value={[String(days)]}
      onValueChange={([next]) => {
        const chosen = WINDOWS.find((option) => String(option.days) === next);
        if (chosen) setDays(chosen.days);
      }}
    >
      {WINDOWS.map((option) => (
        <ToggleGroupItem key={option.days} value={String(option.days)}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Agents"
        description="Runs in the window and the tokens each agent reported. An agent that reports no tokens counts none — that is a fact about its report, not its cost."
        actions={picker}
      >
        {!data && loading && <CardNotice>Loading…</CardNotice>}
        {data && <Totals report={data} />}
        {data && data.agents.length === 0 && (
          <CardNotice>No agent ran in the last {windowWords(data.days)}.</CardNotice>
        )}
        {data && data.agents.length > 0 && (
          <UsageTable label="Agents" lines={data.agents} currency={data.currency} heading="Agent" />
        )}
      </Card>

      {data && data.people.length > 0 && (
        <Card
          title="People"
          description="Whose request the runs were answering — the person who started each one, however many agents it passed through."
        >
          <UsageTable label="People" lines={data.people} currency={data.currency} heading="Person" />
        </Card>
      )}

      {data && (
        <Card
          title="Blob’s own model"
          description="Catch-ups and thread summaries, when this server has a model configured."
        >
          {data.blob.length === 0 ? (
            <CardNotice>None used a model in the last {windowWords(data.days)}.</CardNotice>
          ) : (
            <UsageTable
              label="Blob’s own model"
              lines={data.blob}
              currency={data.currency}
              heading="Feature"
              unit="Calls"
              nameOf={(line) => FEATURE_NAMES[line.name] ?? line.name}
            />
          )}
        </Card>
      )}

      {data && <PricesCard models={data.models} onSaved={reload} onError={onError} />}
    </div>
  );
}

function windowWords(days: number): string {
  return days === 1 ? '24 hours' : `${days} days`;
}

/** A number in that line, read before the words around it. */
const FIGURE = 'font-semibold text-foreground';

/** The window in one line: what everything together cost, as far as it could be priced. */
function Totals({ report }: { report: UsageReport }) {
  const lines: UsageLine[] = [...report.agents, ...report.blob];
  const tokens = lines.reduce((sum, line) => sum + line.tokens, 0);
  const runs = report.agents.reduce((sum, line) => sum + line.runs, 0);
  const priced = lines.filter((line) => line.cost !== null);
  const cost = priced.reduce((sum, line) => sum + (line.cost ?? 0), 0);
  const partial = lines.some((line) => line.tokens > 0 && (line.cost === null || !line.costComplete));
  if (runs === 0 && tokens === 0) return null;
  return (
    <p className="m-0 text-sm text-muted-foreground tabular-nums">
      <strong className={FIGURE}>{formatCount(tokens)}</strong> tokens over {runs} run
      {runs === 1 ? '' : 's'}
      {priced.length > 0 && (
        <>
          {' · '}
          <strong className={FIGURE}>{formatCost(cost, report.currency)}</strong>
          {partial && ' and some tokens with no price'}
        </>
      )}
      {priced.length === 0 && tokens > 0 && ' · set prices below to see what they cost'}
    </p>
  );
}

interface PriceDraft {
  model: string;
  input: string;
  output: string;
  tokens: number;
}

/** A currency and a price per million tokens, per model. The models seen in the window are
 * offered whether priced or not; a model typed in by hand can be priced before it runs. */
function PricesCard({
  models,
  onSaved,
  onError,
}: {
  models: UsageModel[];
  onSaved: () => void;
  onError: (message: string | null) => void;
}) {
  const saved = useAdminData(
    () => api.admin.usagePrices(),
    [],
    onError,
    'Could not load the prices.',
  );
  // Here rather than in the form: a save reseeds the form, which would take it along.
  const [justSaved, setJustSaved] = useState(false);
  if (!saved.data) {
    return (
      <Card title="Prices">
        <CardNotice>Loading…</CardNotice>
      </Card>
    );
  }
  // Keyed on what was saved and which models the window shows, so a save or another
  // window seeds the form afresh rather than an effect fighting what is being typed.
  const key = JSON.stringify([saved.data, models.map((model) => [model.model, model.tokens])]);
  return (
    <PricesForm
      key={key}
      saved={saved.data}
      models={models}
      justSaved={justSaved}
      onEdited={() => setJustSaved(false)}
      onSaved={() => {
        setJustSaved(true);
        saved.reload();
        onSaved();
      }}
      onError={onError}
    />
  );
}

function PricesForm({
  saved,
  models,
  justSaved,
  onEdited,
  onSaved,
  onError,
}: {
  saved: UsagePrices;
  models: UsageModel[];
  justSaved: boolean;
  onEdited: () => void;
  onSaved: () => void;
  onError: (message: string | null) => void;
}) {
  const [currency, setCurrency] = useState(saved.currency ?? '');
  const [rows, setRows] = useState<PriceDraft[]>(() => mergeRows([], saved.prices, models));
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const fields = useId();

  const currencyOk = currency === '' || /^[A-Z]{3}$/.test(currency);
  const parsed = rows.map((row) => ({
    row,
    input: row.input.trim() === '' ? null : Number(row.input),
    output: row.output.trim() === '' ? null : Number(row.output),
  }));
  const invalid = parsed.some(
    ({ input, output }) =>
      (input === null) !== (output === null) ||
      (input !== null && !(input >= 0 && input <= 100_000)) ||
      (output !== null && !(output >= 0 && output <= 100_000)),
  );

  async function save() {
    if (!currencyOk || invalid || busy) return;
    setBusy(true);
    onEdited();
    onError(null);
    try {
      const prices: ModelPrice[] = parsed
        .filter(({ input, output }) => input !== null && output !== null)
        .map(({ row, input, output }) => ({
          model: row.model,
          inputPerMillion: input ?? 0,
          outputPerMillion: output ?? 0,
        }));
      await api.admin.setUsagePrices({ currency: currency || null, prices });
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'The prices could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const model = adding.trim();
    if (!model || rows.some((row) => row.model === model)) return;
    setRows((current) => [...current, { model, input: '', output: '', tokens: 0 }]);
    setAdding('');
  }

  const set = (model: string, field: 'input' | 'output', value: string) => {
    onEdited();
    setRows((current) =>
      current.map((row) => (row.model === model ? { ...row, [field]: value } : row)),
    );
  };

  return (
    <Card
      title="Prices"
      description="What your provider charges per million tokens, model by model. Blob ships no prices: they change, and yours may not be the list price."
      footer={
        <>
          {/* One live region for what the footer has to say, there before anything is said in
              it, so the words are announced when they arrive; first in the strip, so it
              reads first and Save keeps the end. Polite, not an alert: half a price is
              unfinished from the first keystroke, and an alert would speak over the typing. */}
          <span
            role="status"
            className={cn('text-sm', invalid ? 'text-destructive' : 'text-muted-foreground')}
          >
            {invalid ? 'Give a model both prices, from 0 to 100000.' : justSaved ? 'Saved.' : ''}
          </span>
          <Button disabled={!currencyOk || invalid || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save prices'}
          </Button>
        </>
      }
    >
      <CardFields>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={`${fields}-currency`}>Currency</FieldLabel>
            <FieldDescription id={`${fields}-currency-hint`}>
              Three letters, like EUR or USD.
            </FieldDescription>
          </FieldContent>
          <Input
            id={`${fields}-currency`}
            className="w-24 uppercase"
            value={currency}
            maxLength={3}
            placeholder="EUR"
            aria-invalid={!currencyOk || undefined}
            aria-describedby={`${fields}-currency-hint`}
            onChange={(event) => {
              onEdited();
              setCurrency(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''));
            }}
          />
        </Field>
      </CardFields>

      {rows.length === 0 ? (
        <CardNotice>
          No model has reported tokens yet. Add one by name to price it before it does.
        </CardNotice>
      ) : (
        <CardTable label="Model prices">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Model</TableHead>
              <TableHead scope="col" className="text-right">
                Seen
              </TableHead>
              <TableHead scope="col" className="text-right">
                Input / 1M
              </TableHead>
              <TableHead scope="col" className="text-right">
                Output / 1M
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.model}>
                <TableCell>
                  <code className="font-mono text-xs">{row.model}</code>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.tokens > 0 ? formatCount(row.tokens) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    className="w-28 text-right tabular-nums"
                    inputMode="decimal"
                    aria-label={`Input price for ${row.model}`}
                    value={row.input}
                    onChange={(event) => set(row.model, 'input', event.target.value)}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    className="w-28 text-right tabular-nums"
                    inputMode="decimal"
                    aria-label={`Output price for ${row.model}`}
                    value={row.output}
                    onChange={(event) => set(row.model, 'output', event.target.value)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </CardTable>
      )}

      <div className="flex max-w-xl gap-2">
        <Input
          value={adding}
          maxLength={80}
          placeholder="Another model, exactly as agents name it"
          aria-label="Model name"
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
        />
        <Button variant="outline" disabled={!adding.trim()} onClick={add}>
          Add
        </Button>
      </div>
    </Card>
  );
}

function mergeRows(current: PriceDraft[], saved: ModelPrice[], seen: UsageModel[]): PriceDraft[] {
  const byModel = new Map(current.map((row) => [row.model, row]));
  const tokens = new Map(seen.map((model) => [model.model, model.tokens]));
  for (const price of saved) {
    if (!byModel.has(price.model)) {
      byModel.set(price.model, {
        model: price.model,
        input: String(price.inputPerMillion),
        output: String(price.outputPerMillion),
        tokens: 0,
      });
    }
  }
  for (const model of seen) {
    if (!byModel.has(model.model)) {
      byModel.set(model.model, { model: model.model, input: '', output: '', tokens: 0 });
    }
  }
  return [...byModel.values()]
    .map((row) => ({ ...row, tokens: tokens.get(row.model) ?? 0 }))
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));
}
