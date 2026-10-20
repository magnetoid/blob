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

import { useCallback, useState, type FormEvent } from "react";
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
import { formatRelative } from "../../messages/messageFormatting.ts";
import type { ConsoleSectionProps } from "../../console/ConsoleShell.tsx";
import { Card, CardHeading, CardNotice } from "../../console/Card.tsx";
import { useAdminAction, useAdminData } from "../../console/hooks.ts";

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
    <div className="console-stack">
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

/** The credential fields, shared by connecting a server and changing one. */
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
  return (
    <>
      <label className="field">
        <span className="field-label">Credential</span>
        <select
          className="input"
          name="authKind"
          value={kind}
          onChange={(event) => onKind(event.target.value)}
        >
          {keepOption && <option value="keep">Keep the current one</option>}
          <option value="none">None</option>
          <option value="bearer">A bearer token</option>
          <option value="header">A header of its own</option>
        </select>
      </label>
      {kind === "bearer" && (
        <label className="field">
          <span className="field-label">Token</span>
          <input
            className="input"
            name="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
      )}
      {kind === "header" && (
        <>
          <label className="field">
            <span className="field-label">Header</span>
            <input
              className="input"
              name="header"
              placeholder="X-Api-Key"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Value</span>
            <input
              className="input"
              name="headerValue"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
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
      <form className="console-form-grid" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" name="name" placeholder="GitHub" maxLength={60} required />
        </label>
        <label className="field">
          <span className="field-label">Address</span>
          <input
            className="input"
            name="url"
            type="url"
            placeholder="https://example.com/mcp"
            spellCheck={false}
            required
          />
        </label>
        <CredentialFields kind={kind} onKind={setKind} />
        <div className="console-form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Connecting…" : "Connect"}
          </button>
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
      className="mcp-server"
      data-enabled={server.enabled}
      title={server.name}
      description={
        <>
          <span className="mcp-server-url">{server.url}</span> {status(server)}
        </>
      }
      actions={
        <>
          <button className="btn" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? "Asking…" : "Refresh tools"}
          </button>
          <button
            className="btn"
            onClick={() =>
              void act(() => api.admin.changeMcpServer(server.id, { enabled: !server.enabled }))
            }
          >
            {server.enabled ? "Switch off" : "Switch on"}
          </button>
          <button className="btn btn-ghost" onClick={onRemove}>
            Disconnect
          </button>
        </>
      }
    >
      {!server.enabled && (
        <CardNotice>Switched off: no agent is offered its tools until you switch it on.</CardNotice>
      )}
      {server.lastError && server.lastErrorAt && (
        <p className="mcp-server-error" role="status">
          Last failed {formatRelative(server.lastErrorAt)}: {server.lastError}
        </p>
      )}
      {skipped.length > 0 && (
        <p className="pref-hint">
          Left out, because Blob could not use them: {skipped.join("; ")}.
        </p>
      )}

      <section className="mcp-part">
        <CardHeading>Agents that may use it</CardHeading>
        <p className="pref-hint">
          An agent switched on here offers these tools to everyone who may ask it, and every
          call uses this server&apos;s credential.
        </p>
        {agents.length === 0 ? (
          <p className="pref-hint">No agent here answers over AG-UI yet.</p>
        ) : (
          agents.map((agent) => {
            const on = server.agentIds.includes(agent.id);
            return (
              <div className="pref-row" key={agent.id}>
                <div className="grow min-0">
                  <div className="pref-label">{agent.name}</div>
                </div>
                <button
                  className="toggle"
                  aria-pressed={on}
                  aria-label={`${agent.name} may use ${server.name}`}
                  onClick={() =>
                    void act(() =>
                      on
                        ? api.admin.revokeMcpServer(server.id, agent.id)
                        : api.admin.grantMcpServer(server.id, agent.id),
                    )
                  }
                >
                  <span />
                </button>
              </div>
            );
          })
        )}
      </section>

      <section className="mcp-part">
        <CardHeading>Tools</CardHeading>
        {server.tools.length === 0 ? (
          <p className="pref-hint">It listed no tools Blob could use.</p>
        ) : (
          <ul className="mcp-tools">
            {server.tools.map((tool) => (
              <li className="mcp-tool" key={tool.name}>
                <div className="grow min-0">
                  <div className="mcp-tool-name">
                    {tool.title ?? tool.name}
                    {tool.readOnly && (
                      <span className="role-pill" data-muted="">
                        reads only
                      </span>
                    )}
                  </div>
                  {tool.description && <p className="mcp-tool-desc">{tool.description}</p>}
                </div>
                <select
                  className="input"
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
                    <option key={policy} value={policy}>
                      {POLICY_LABELS[policy]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ChangeServer server={server} onError={onError} onListed={onListed} />
    </Card>
  );
}

function ChangeServer({
  server,
  onError,
  onListed,
}: {
  server: McpServer;
  onError: (message: string | null) => void;
  onListed: (server: McpServer) => void;
}) {
  const [kind, setKind] = useState("keep");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

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
      setOpen(false);
    } catch (err) {
      onError(failure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="mcp-change"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Change its name, address or credential</summary>
      {/* Keyed by what it shows, so a change saved here or anywhere else starts it afresh
          rather than leaving the old values in the fields. */}
      <form
        key={`${server.name}\n${server.url}`}
        className="console-form-grid"
        onSubmit={(event) => void submit(event)}
      >
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" name="name" defaultValue={server.name} maxLength={60} />
        </label>
        <label className="field">
          <span className="field-label">Address</span>
          <input
            className="input"
            name="url"
            type="url"
            defaultValue={server.url}
            spellCheck={false}
          />
        </label>
        <CredentialFields kind={kind} onKind={setKind} keepOption />
        <div className="console-form-actions">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Asking the server…" : "Save"}
          </button>
          <span className="pref-hint">
            A new address or credential is checked by listing its tools again.
          </span>
        </div>
      </form>
    </details>
  );
}
