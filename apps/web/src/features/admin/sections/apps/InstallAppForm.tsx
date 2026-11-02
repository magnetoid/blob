/** Register an external app by hand: endpoints, event subscriptions, scopes. */

import { useId, useState } from "react";
import { api, ApiError, type AdminPluginCatalog } from "../../../../lib/api.ts";
import { Button } from "../../../../components/ui/button.tsx";
import { Checkbox } from "../../../../components/ui/checkbox.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../../../../components/ui/field.tsx";
import { Input } from "../../../../components/ui/input.tsx";

export function InstallAppForm({
  catalog,
  onError,
  onInstalled,
}: {
  catalog: AdminPluginCatalog | null;
  onError: (message: string | null) => void;
  onInstalled: (notice: {
    pluginName: string;
    signingSecret?: string;
    botToken?: string;
  }) => void;
}) {
  const [form, setForm] = useState({
    slug: "",
    name: "",
    description: "",
    version: "1.0.0",
    requestUrl: "",
    aguiUrl: "",
    events: [] as string[],
    scopes: [] as string[],
  });
  const ids = useId();

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        onError(null);
        void api.admin
          .installPlugin({
            slug: form.slug.trim(),
            name: form.name.trim(),
            description: form.description.trim() || null,
            runtime: "external",
            version: form.version.trim() || "1.0.0",
            requestUrl: form.requestUrl.trim() || null,
            aguiUrl: form.aguiUrl.trim() || null,
            events: form.events,
            scopes: form.scopes,
          })
          .then((installed) => {
            onInstalled({
              pluginName: installed.plugin.name,
              signingSecret: installed.signingSecret,
              botToken: installed.botToken,
            });
            setForm({
              slug: "",
              name: "",
              description: "",
              version: "1.0.0",
              requestUrl: "",
              aguiUrl: "",
              events: [],
              scopes: [],
            });
          })
          .catch((err) => {
            onError(
              err instanceof ApiError
                ? err.message
                : "Could not install the app.",
            );
          });
      }}
    >
      <Field>
        <FieldLabel htmlFor={`${ids}-slug`}>Slug</FieldLabel>
        <Input
          id={`${ids}-slug`}
          value={form.slug}
          onChange={(e) =>
            setForm((current) => ({ ...current, slug: e.target.value }))
          }
          placeholder="standup-bot"
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${ids}-name`}>Name</FieldLabel>
        <Input
          id={`${ids}-name`}
          value={form.name}
          onChange={(e) =>
            setForm((current) => ({ ...current, name: e.target.value }))
          }
          placeholder="Standup Bot"
          required
        />
      </Field>
      <Field className="sm:col-span-2">
        <FieldLabel htmlFor={`${ids}-description`}>Description</FieldLabel>
        <Input
          id={`${ids}-description`}
          value={form.description}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              description: e.target.value,
            }))
          }
          placeholder="Collects standup notes every morning"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${ids}-version`}>Version</FieldLabel>
        <Input
          id={`${ids}-version`}
          value={form.version}
          onChange={(e) =>
            setForm((current) => ({ ...current, version: e.target.value }))
          }
          placeholder="1.0.0"
          required
        />
      </Field>
      <Field className="sm:col-span-2">
        <FieldLabel htmlFor={`${ids}-request`}>Request URL</FieldLabel>
        <Input
          id={`${ids}-request`}
          type="url"
          value={form.requestUrl}
          aria-describedby={`${ids}-request-hint`}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              requestUrl: e.target.value,
            }))
          }
          placeholder="https://apps.example.com/blob/events"
        />
        <FieldDescription id={`${ids}-request-hint`}>
          Where Blob POSTs the events this app subscribed to.
        </FieldDescription>
      </Field>
      <Field className="sm:col-span-2">
        <FieldLabel htmlFor={`${ids}-agui`}>AG-UI URL</FieldLabel>
        <Input
          id={`${ids}-agui`}
          type="url"
          value={form.aguiUrl}
          aria-describedby={`${ids}-agui-hint`}
          onChange={(e) =>
            setForm((current) => ({ ...current, aguiUrl: e.target.value }))
          }
          placeholder="https://agent.example.com/agui"
        />
        <FieldDescription id={`${ids}-agui-hint`}>
          For an agent that speaks AG-UI. Blob calls it when someone mentions the
          app, and posts what it streams back — no webhook handler needed. Give one
          of these two URLs, or both.
        </FieldDescription>
      </Field>

      <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
        <Choices
          legend="Event subscriptions"
          idPrefix={`${ids}-event`}
          choices={catalog?.events ?? {}}
          chosen={form.events}
          onToggle={(key) =>
            setForm((current) => ({
              ...current,
              events: toggleChoice(current.events, key),
            }))
          }
        />
        <Choices
          legend="Granted scopes"
          idPrefix={`${ids}-scope`}
          choices={catalog?.scopes ?? {}}
          chosen={form.scopes}
          onToggle={(key) =>
            setForm((current) => ({
              ...current,
              scopes: toggleChoice(current.scopes, key),
            }))
          }
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:col-span-2">
        <p className="m-0 text-sm text-muted-foreground">
          Blob only installs external apps here. Local plugins remain
          deploy-time code.
        </p>
        <Button type="submit">Install app</Button>
      </div>
    </form>
  );
}

/** One list of things to tick — events, scopes — each named by its key and saying what it
 * is for, which is what someone ticking it needs to read. */
function Choices({
  legend,
  idPrefix,
  choices,
  chosen,
  onToggle,
}: {
  legend: string;
  idPrefix: string;
  choices: Record<string, string>;
  chosen: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <div className="grid gap-2.5">
        {Object.entries(choices).map(([key, description]) => (
          <Field
            key={key}
            orientation="horizontal"
            className="rounded-lg border bg-muted/50 p-3"
          >
            <Checkbox
              id={`${idPrefix}-${key}`}
              aria-describedby={`${idPrefix}-${key}-hint`}
              checked={chosen.includes(key)}
              onCheckedChange={() => onToggle(key)}
            />
            <FieldContent>
              <FieldLabel htmlFor={`${idPrefix}-${key}`}>{key}</FieldLabel>
              <FieldDescription id={`${idPrefix}-${key}-hint`}>
                {description}
              </FieldDescription>
            </FieldContent>
          </Field>
        ))}
      </div>
    </FieldSet>
  );
}

function toggleChoice(items: string[], value: string): string[] {
  return items.includes(value)
    ? items.filter((item) => item !== value)
    : [...items, value];
}
