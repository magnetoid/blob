/** MCP servers: tools from outside Blob that agents may use (ADR 0027).
 *
 * Blob is the client here. A server is asked for its tools before it is kept, so one that
 * cannot answer is never added and the admin reads why; its credential goes in and never
 * comes back out; and every call an agent makes goes through Blob, which shows the person
 * who asked what would be sent whenever the tool's policy says to ask.
 *
 * One card per server, in the order an admin works through it: is it answering, which
 * agents may use it, and — tool by tool — whether a call waits for the person. A tool
 * starts where the server's own description puts it (read-only runs without asking,
 * anything else asks), and the select beside it is where that is decided for real.
 */

import { useCallback, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  api,
  ApiError,
  type AdminPlugin,
  type McpServer,
  type McpServerAuthInput,
  type McpToolPolicy,
} from "../../../lib/api.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";
import { Alert, AlertDescription } from "../../../components/ui/alert.tsx";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Field, FieldLabel } from "../../../components/ui/field.tsx";
import { Input } from "../../../components/ui/input.tsx";
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "../../../components/ui/item.tsx";
import { NativeSelect, NativeSelectOption } from "../../../components/ui/native-select.tsx";
import { Switch } from "../../../components/ui/switch.tsx";
import { formatRelative } from "../../messages/messageFormatting.ts";
import type { ConsoleSectionProps } from "../../console/ConsoleShell.tsx";
import { Card, CardHeading, CardNotice, CardRow, CardRows } from "../../console/Card.tsx";
import { useAdminAction, useAdminData } from "../../console/hooks.ts";
import { useDisclosure } from "./apps/useDisclosure.ts";

/** The same words the agent page uses for when a post waits, so one decision reads alike. */
const POLICY_LABELS: Record<McpToolPolicy, string> = {
  ask: "Ask the person every time",
  auto_in_dm: "Without asking in its DM with them; ask elsewhere",
  auto_everywhere: "Without asking, anywhere",
  off: "Off — agents are not offered it",
};

const POLICY_ORDER: McpToolPolicy[] = ["ask", "auto_in_dm", "auto_everywhere", "off"];

/** An app that can be offered tools: it answers over AG-UI or holds a socket. */
function isAgent(plugin: Pick<AdminPlugin, "aguiUrl" | "runtime">): boolean {
  return Boolean(plugin.aguiUrl) || plugin.runtime === "socket";
}

interface Loaded {
  servers: McpServer[];
  agents: AdminPlugin[];
}

function failure(err: unknown): string {
  return err instanceof ApiError ? err.message : "That did not work.";
}

export function McpServersSection({ onError }: ConsoleSectionProps) {
  const load = useCallback(
    () =>
      Promise.all([api.admin.mcpServers(), api.admin.plugins()]).then(
        ([listed, installed]): Loaded => ({
          servers: listed.servers,
          agents: installed.plugins.filter(isAgent),
        }),
      ),
    [],
  );
  const { data, loading, reload } = useAdminData(
    load,
    [],
    onError,
    "Could not load the MCP servers.",
  );
  const act = useAdminAction(onError, reload);
  const [removing, setRemoving] = useState<McpServer | null>(null);
  // What a listing left out is said once, beside the server it was listed for.
  const [skipped, setSkipped] = useState<Record<string, string[]>>({});

  function listed(server: McpServer) {
    setSkipped((now) => ({ ...now, [server.id]: server.skipped }));
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <ConnectCard onError={onError} onConnected={listed} />

      {/* No data and no request in flight means the load failed: the error above says
          so, and "no servers yet" would be a claim about servers it never read. */}
      {data === null ? (
        loading && (
          <Card>
            <CardNotice>Loading…</CardNotice>
          </Card>
        )
      ) : data.servers.length === 0 ? (
        <Card>
          <CardNotice>
            No servers yet. Connect one above, then choose which agents may use it.
          </CardNotice>
        </Card>
      ) : (
        data.servers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            agents={data.agents}
            skipped={skipped[server.id] ?? []}
            act={act}
            onError={onError}
            onListed={listed}
            onRemove={() => setRemoving(server)}
          />
        ))
      )}

      <DialogPresence when={removing}>
        {(server) => (
          <ConfirmDialog
            title={`Disconnect ${server.name}?`}
            body="Agents stop being offered its tools from their next run, and the credential Blob holds for it is deleted."
            confirmLabel="Disconnect"
            danger
            onClose={() => setRemoving(null)}
            onConfirm={() => {
              setRemoving(null);
              void act(() => api.admin.removeMcpServer(server.id));
            }}
          />
        )}
      </DialogPresence>
    </div>
  );
}

// ─── connecting ──────────────────────────────────────────────────────────────────────

/** Fields on a grid, two across where they fit. */
const FORM_GRID =
  "grid max-w-3xl grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-x-5 gap-y-4";

/** The credential fields, shared by connecting a server and changing one.
 *
 * What is typed into the token and the value is never drawn: they are password fields that
 * nothing is read back into, taken from the form when it is sent, and gone when it is reset. */
function CredentialFields({
  kind,
  onKind,
  keepOption,
}: {
  kind: string;
  onKind: (kind: string) => void;
  /** Changing a server: the first choice keeps what it has. */
  keepOption?: boolean;
}) {
  const id = useId();
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${id}-kind`}>Credential</FieldLabel>
        <NativeSelect
          id={`${id}-kind`}
          className="w-full"
          name="authKind"
          value={kind}
          onChange={(event) => onKind(event.target.value)}
        >
          {keepOption && <NativeSelectOption value="keep">Keep the current one</NativeSelectOption>}
          <NativeSelectOption value="none">None</NativeSelectOption>
          <NativeSelectOption value="bearer">A bearer token</NativeSelectOption>
          <NativeSelectOption value="header">A header of its own</NativeSelectOption>
        </NativeSelect>
      </Field>
      {kind === "bearer" && (
        <Field>
          <FieldLabel htmlFor={`${id}-token`}>Token</FieldLabel>
          <Input
            id={`${id}-token`}
            name="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </Field>
      )}
      {kind === "header" && (
        <>
          <Field>
            <FieldLabel htmlFor={`${id}-header`}>Header</FieldLabel>
            <Input
              id={`${id}-header`}
              name="header"
              placeholder="X-Api-Key"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-value`}>Value</FieldLabel>
            <Input
              id={`${id}-value`}
              name="headerValue"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </Field>
        </>
      )}
    </>
  );
}

function credentialOf(form: HTMLFormElement, kind: string): McpServerAuthInput | undefined {
  const value = (name: string) =>
    (form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim() ?? "";
  if (kind === "keep") return undefined;
  if (kind === "bearer") return { kind: "bearer", value: value("token") };
  if (kind === "header") {
    return { kind: "header", header: value("header"), value: value("headerValue") };
  }
  return { kind: "none" };
}

function ConnectCard({
  onError,
  onConnected,
}: {
  onError: (message: string | null) => void;
  onConnected: (server: McpServer) => void;
}) {
  const [kind, setKind] = useState("none");
  const [busy, setBusy] = useState(false);
  const fields = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const url = (form.elements.namedItem("url") as HTMLInputElement).value.trim();
    if (!name || !url) return;
    onError(null);
    setBusy(true);
    try {
      const server = await api.admin.addMcpServer({
        name,
        url,
        auth: credentialOf(form, kind) ?? { kind: "none" },
      });
      form.reset();
      setKind("none");
      onConnected(server);
    } catch (err) {
      onError(failure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Connect a server"
      description="Its tools become ones you can let agents use. Blob asks it for them first, holds the credential, and makes every call itself."
    >
      <form className={FORM_GRID} onSubmit={(event) => void submit(event)}>
        <Field>
          <FieldLabel htmlFor={`${fields}-name`}>Name</FieldLabel>
          <Input id={`${fields}-name`} name="name" placeholder="GitHub" maxLength={60} required />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${fields}-url`}>Address</FieldLabel>
          <Input
            id={`${fields}-url`}
            name="url"
            type="url"
            placeholder="https://example.com/mcp"
            spellCheck={false}
            required
          />
        </Field>
        <CredentialFields kind={kind} onKind={setKind} />
        <div className="col-span-full">
          <Button type="submit" disabled={busy}>
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ─── one server ──────────────────────────────────────────────────────────────────────

function status(server: McpServer): string {
  const speaks = server.protocolVersion ? `Speaks MCP ${server.protocolVersion}.` : "";
  const count = `${server.tools.length} ${server.tools.length === 1 ? "tool" : "tools"}`;
  const listedAt = server.checkedAt ? `, listed ${formatRelative(server.checkedAt)}` : "";
  return `${speaks} ${count}${listedAt}.`.trim();
}

/** A line a card says about its server that is not a row: what is true of it, in the page's
 * small muted type. */
function Said({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="m-0 text-sm text-muted-foreground wrap-anywhere">
      {children}
    </p>
  );
}

function ServerCard({
  server,
  agents,
  skipped,
  act,
  onError,
  onListed,
  onRemove,
}: {
  server: McpServer;
  agents: AdminPlugin[];
  skipped: string[];
  act: (run: () => Promise<unknown>) => Promise<void>;
  onError: (message: string | null) => void;
  onListed: (server: McpServer) => void;
  onRemove: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const titleId = useId();
  const agentsHint = useId();

  async function refresh() {
    onError(null);
    setRefreshing(true);
    try {
      onListed(await api.admin.refreshMcpServer(server.id));
    } catch (err) {
      onError(failure(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Card
      // A server that is switched off greys its title. The attribute is the card's own
      // statement, and the rule waits for it, so the title is dimmed without being told to.
      className="data-[enabled=false]:**:data-[slot=card-title]:text-muted-foreground"
      data-enabled={server.enabled}
      title={<span id={titleId}>{server.name}</span>}
      description={
        <>
          <span className="block font-mono text-xs wrap-anywhere">{server.url}</span>{" "}
          {status(server)}
        </>
      }
      // Several servers share this page and every one has these three, so each says whose.
      actions={
        <>
          <Button
            variant="outline"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {/* The server's name follows the words on the button, whichever they are, so the
                name starts with what is read on it. */}
            {refreshing ? "Asking…" : "Refresh tools"}
            <span className="sr-only">
              {refreshing ? ` ${server.name} for its tools` : ` of ${server.name}`}
            </span>
          </Button>
          <Button
            variant="outline"
            aria-label={`${server.enabled ? "Switch off" : "Switch on"} ${server.name}`}
            onClick={() =>
              void act(() => api.admin.changeMcpServer(server.id, { enabled: !server.enabled }))
            }
          >
            {server.enabled ? "Switch off" : "Switch on"}
          </Button>
          <Button variant="ghost" aria-label={`Disconnect ${server.name}`} onClick={onRemove}>
            Disconnect
          </Button>
        </>
      }
    >
      {!server.enabled && (
        <Said>Switched off: no agent is offered its tools until you switch it on.</Said>
      )}
      {server.lastError && server.lastErrorAt && (
        // Polite, not an alert: it is where the server stood when the page opened, and
        // would otherwise be read out once for every server that has ever failed.
        <Alert variant="destructive" role="status">
          <AlertDescription className="wrap-anywhere">
            Last failed {formatRelative(server.lastErrorAt)}: {server.lastError}
          </AlertDescription>
        </Alert>
      )}
      {skipped.length > 0 && <Said>Left out, because Blob could not use them: {skipped.join("; ")}.</Said>}

      <div className="flex flex-col gap-3">
        <CardHeading>Agents that may use it</CardHeading>
        <Said id={agentsHint}>
          An agent switched on here offers these tools to everyone who may ask it, and every
          call uses this server&apos;s credential.
        </Said>
        {agents.length === 0 ? (
          <Said>No agent here answers over AG-UI yet.</Said>
        ) : (
          <CardRows
            aria-label={`Agents that may use ${server.name}`}
            aria-describedby={agentsHint}
          >
            {agents.map((agent) => {
              const on = server.agentIds.includes(agent.id);
              return (
                <CardRow key={agent.id}>
                  <ItemContent>
                    <ItemTitle>{agent.name}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    {/* Named for the server as well: the agent's name is on every card. */}
                    <Switch
                      checked={on}
                      aria-label={`${agent.name} may use ${server.name}`}
                      onCheckedChange={() =>
                        void act(() =>
                          on
                            ? api.admin.revokeMcpServer(server.id, agent.id)
                            : api.admin.grantMcpServer(server.id, agent.id),
                        )
                      }
                    />
                  </ItemActions>
                </CardRow>
              );
            })}
          </CardRows>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <CardHeading>Tools</CardHeading>
        {server.tools.length === 0 ? (
          <Said>It listed no tools Blob could use.</Said>
        ) : (
          <CardRows aria-label={`Tools of ${server.name}`}>
            {server.tools.map((tool) => (
              <CardRow key={tool.name}>
                <ItemContent>
                  <ItemTitle>
                    {tool.title ?? tool.name}
                    {tool.readOnly && <Badge variant="outline">reads only</Badge>}
                  </ItemTitle>
                  {/* Whole, and wrapped anywhere: a URL in it is one word, and the card
                      clips what runs past it. */}
                  {tool.description && (
                    <ItemDescription className="wrap-anywhere">{tool.description}</ItemDescription>
                  )}
                </ItemContent>
                {/* On a line of its own on a phone, where the choices are as long as the row. */}
                <ItemActions className="max-sm:basis-full">
                  <NativeSelect
                    className="w-full sm:w-72"
                    aria-label={`When an agent uses ${tool.title ?? tool.name}`}
                    value={tool.policy}
                    onChange={(event) =>
                      void act(() =>
                        api.admin.setMcpToolPolicy(
                          server.id,
                          tool.name,
                          event.target.value as McpToolPolicy,
                        ),
                      )
                    }
                  >
                    {POLICY_ORDER.map((policy) => (
                      <NativeSelectOption key={policy} value={policy}>
                        {POLICY_LABELS[policy]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </ItemActions>
              </CardRow>
            ))}
          </CardRows>
        )}
      </div>

      <ChangeServer server={server} subjectId={titleId} onError={onError} onListed={onListed} />
    </Card>
  );
}

function ChangeServer({
  server,
  subjectId,
  onError,
  onListed,
}: {
  server: McpServer;
  /** The element that titles the server, so the button is named for it. */
  subjectId: string;
  onError: (message: string | null) => void;
  onListed: (server: McpServer) => void;
}) {
  const [kind, setKind] = useState("keep");
  const [busy, setBusy] = useState(false);
  const disclosure = useDisclosure(subjectId);
  const opener = useRef<HTMLButtonElement>(null);
  const fields = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const url = (form.elements.namedItem("url") as HTMLInputElement).value.trim();
    const auth = credentialOf(form, kind);
    onError(null);
    setBusy(true);
    try {
      onListed(
        await api.admin.changeMcpServer(server.id, {
          ...(name && name !== server.name ? { name } : {}),
          ...(url && url !== server.url ? { url } : {}),
          ...(auth ? { auth } : {}),
        }),
      );
      setKind("keep");
      // Saved: the form closes, and focus goes back to the button that opened it, since
      // the one that was pressed is about to leave the page.
      opener.current?.focus();
      disclosure.setOpen(false);
    } catch (err) {
      onError(failure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Button ref={opener} variant="ghost" size="sm" {...disclosure.buttonProps}>
        Change its name, address or credential
      </Button>
      {disclosure.open && (
        // Keyed by what it shows, so a change saved here or anywhere else starts it afresh
        // rather than leaving the old values in the fields.
        <form
          id={disclosure.panelId}
          key={`${server.name}\n${server.url}`}
          className={`${FORM_GRID} w-full`}
          onSubmit={(event) => void submit(event)}
        >
          <Field>
            <FieldLabel htmlFor={`${fields}-name`}>Name</FieldLabel>
            <Input id={`${fields}-name`} name="name" defaultValue={server.name} maxLength={60} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fields}-url`}>Address</FieldLabel>
            <Input
              id={`${fields}-url`}
              name="url"
              type="url"
              defaultValue={server.url}
              spellCheck={false}
            />
          </Field>
          <CredentialFields kind={kind} onKind={setKind} keepOption />
          <div className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              variant="outline"
              type="submit"
              disabled={busy}
              aria-describedby={`${fields}-note`}
            >
              {busy ? "Asking the server…" : "Save"}
            </Button>
            <span id={`${fields}-note`} className="text-sm text-muted-foreground">
              A new address or credential is checked by listing its tools again.
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
