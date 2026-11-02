/** Your own agents.
 *
 * Until this existed a personal agent was something an admin installed and then handed
 * to you. This is the member's door: name an agent, get the token it dials in with, run
 * the bridge beside it on your machine. It is yours from the first mention — it answers
 * you and whoever you lend it to with /allow, and nobody else — because the server sets
 * the owner in the same transaction that creates it.
 *
 * What it may do is not up for choosing here. The scopes are the four an answering agent
 * needs, the workspace's policy still applies, and an admin still sees it in Apps &
 * agents. The one decision that is yours is where it goes: only channels you are in are
 * offered, for the same reason an admin may not add an app somewhere they cannot read.
 */

import { useState, type ReactNode } from "react";
import { api, type AgentLoan, type AppChannel, type MyAgent } from "../../lib/api.ts";
import { DesktopAgentSetup } from '../agentic/DesktopAgentSetup.tsx';
import { MemoryList } from "../agentic/MemoryList.tsx";
import { NoteList } from "../agentic/NoteList.tsx";
import type { ConsoleSectionProps } from "../console/ConsoleShell.tsx";
import { Card, CardNotice, CardRow, CardRows } from "../console/Card.tsx";
import { useAdminAction, useAdminData } from "../console/hooks.ts";
import { UsageTable } from "../console/UsageTable.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { ItemActions, ItemContent, ItemDescription, ItemTitle } from "../../components/ui/item.tsx";

interface Minted {
  name: string;
  botToken: string;
  signingSecret: string;
}

export function MyAgentsSection({ onError }: ConsoleSectionProps) {
  const { data, loading, reload } = useAdminData(
    () => api.agents.mine(),
    [],
    onError,
    "Could not load your agents.",
  );
  const act = useAdminAction(onError, reload);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<Minted | null>(null);
  const agents = data?.agents ?? [];
  const usable = name.trim().length >= 3 && !busy;

  async function attach() {
    if (!usable) return;
    setBusy(true);
    onError(null);
    try {
      const attached = await api.agents.attach(name.trim());
      setMinted({
        name: attached.agent.name,
        botToken: attached.botToken,
        signingSecret: attached.signingSecret,
      });
      setName("");
      reload();
    } catch (err) {
      onError(
        err instanceof Error
          ? err.message
          : "That agent could not be registered.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Connect an agent"
        description={
          <>
            For an agent running on your laptop or a private network. It dials
            Blob, so it needs no public address, and it answers only you — lend it
            to somebody in a channel with <code>/allow</code>.
          </>
        }
      >
        <div className="flex gap-2">
          <Input
            value={name}
            placeholder="What is it called?"
            aria-label="Agent name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void attach();
            }}
          />
          <Button disabled={!usable} onClick={() => void attach()}>
            {busy ? "Registering…" : "Get a token"}
          </Button>
        </div>
      </Card>

      {minted && (
        // The setup is the agents console's own markup (features/agentic/), still drawn by
        // the legacy stylesheet, so it sits in an island.
        <div data-legacy>
          <DesktopAgentSetup
            agentName={minted.name}
            botToken={minted.botToken}
            signingSecret={minted.signingSecret}
            bridgeHref="/api/agents/bridge"
          />
        </div>
      )}

      <Card title="Your agents">
        {loading && agents.length === 0 && <CardNotice>Loading…</CardNotice>}
        {!loading && agents.length === 0 && (
          <CardNotice>None yet. Connect one above and it will appear here.</CardNotice>
        )}
        {agents.length > 0 && (
          <CardRows>
            {agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                onError={onError}
                onRemoved={reload}
                act={act}
              />
            ))}
          </CardRows>
        )}
      </Card>

      {agents.length > 0 && <SpendCard onError={onError} />}
      <RememberedCard onError={onError} />
      <NotesCard onError={onError} />
    </div>
  );
}

/**
 * `MemoryList` and `NoteList` are the agents console's own markup (`features/agentic/`),
 * still drawn by the legacy stylesheet — so an island, run to the card's edges as their
 * rows were, with the padding those rows read from the card they used to sit in.
 */
function LegacyRows({ children }: { children: ReactNode }) {
  return (
    <div data-legacy className="-mx-(--card-spacing) [--card-pad-x:var(--card-spacing)]">
      {children}
    </div>
  );
}

/** What your own agents spent this week, whoever asked them (M2 · A9) — priced the way
 *  the workspace prices it, if it does. */
function SpendCard({ onError }: { onError: (message: string | null) => void }) {
  const { data } = useAdminData(
    () => api.agents.usage(7),
    [],
    onError,
    "Could not load what your agents spent.",
  );
  if (!data) return null;
  return (
    <Card
      title="What they spent"
      description="The last 7 days: runs, and the tokens each agent reported — an agent that reports none counts none."
    >
      {data.agents.length === 0 ? (
        <CardNotice>None of your agents ran this week.</CardNotice>
      ) : (
        <UsageTable
          lines={data.agents}
          currency={data.currency}
          heading="Agent"
          showOwner={false}
        />
      )}
    </Card>
  );
}

/** The notes agents kept of your own conversations with them (M2 · A8): yours to read,
 *  reword and remove, beside what they remember. */
function NotesCard({ onError }: { onError: (message: string | null) => void }) {
  const { data, reload } = useAdminData(
    () => api.agents.notes(),
    [],
    onError,
    "Could not load the notes agents kept.",
  );
  const act = useAdminAction(onError, reload);
  const notes = data?.notes ?? [];
  return (
    <Card title="Notes agents kept of you">
      {data && notes.length === 0 && (
        <CardNotice>
          None yet. An agent you own, or one lent to you, can note what it should know next
          time — a preference, a name — and it appears here for you to correct or remove.
        </CardNotice>
      )}
      {notes.length > 0 && (
        <LegacyRows>
          <NoteList
            notes={notes}
            showAgent
            onReword={(note, body) => act(() => api.agents.rewordNote(note.id, body))}
            onForget={(note) => void act(() => api.agents.forgetNote(note.id))}
          />
        </LegacyRows>
      )}
    </Card>
  );
}

/**
 * What agents remember of your own conversations with them: an agent you own keeps a
 * memory per person, and so does one lent to you (migration 0050). Yours to read and to
 * clear. The workspace's agents remember conversations rather than people — those are an
 * admin's to clear, on the agent's page.
 */
function RememberedCard({ onError }: { onError: (message: string | null) => void }) {
  const { data, reload } = useAdminData(
    () => api.agents.memory(),
    [],
    onError,
    "Could not load what agents remember.",
  );
  const act = useAdminAction(onError, reload);
  const [confirming, setConfirming] = useState(false);
  const memories = data?.memories ?? [];

  return (
    <Card
      title="What agents remember of you"
      // Once there is something to forget, the way to forget all of it closes the card.
      footer={
        memories.length > 0 ? (
          confirming ? (
            <>
              <Button
                variant="destructive"
                onClick={() =>
                  void act(async () => {
                    await api.agents.forgetAllMemory();
                    setConfirming(false);
                  })
                }
              >
                Forget all of it
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              Forget everything
            </Button>
          )
        ) : undefined
      }
    >
      {data && memories.length === 0 && (
        <CardNotice>
          Nothing yet. An agent you own, or one lent to you, keeps what it learns in your
          conversations here — yours, not the room&rsquo;s.
        </CardNotice>
      )}
      {memories.length > 0 && (
        <LegacyRows>
          <MemoryList
            memories={memories}
            showAgent
            onForget={(memory) => void act(() => api.agents.forgetMemory(memory.id))}
          />
        </LegacyRows>
      )}
    </Card>
  );
}

function AgentRow({
  agent,
  onError,
  onRemoved,
  act,
}: {
  agent: MyAgent;
  onError: (message: string | null) => void;
  onRemoved: () => void;
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [lendingOpen, setLendingOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Who it is lent to — the loans `/allow` made, listed so one made months ago is not
  // something to remember, and ended here as `/disallow` ends them in a channel.
  const loans = useAdminData(
    () => (lendingOpen ? api.agents.loans(agent.id) : Promise.resolve({ loans: [] })),
    [lendingOpen, agent.id],
    onError,
    "Could not load who it is lent to.",
  );
  const loanAct = useAdminAction(onError, loans.reload);
  const channels = useAdminData(
    () =>
      open ? api.agents.channels(agent.id) : Promise.resolve({ channels: [] }),
    [open, agent.id],
    onError,
    "Could not load channels.",
  );
  const channelAct = useAdminAction(onError, channels.reload);

  // A row of the "Your agents" list, with its channels opening under it.
  return (
    <CardRow>
      <ItemContent>
        <ItemTitle>
          {agent.name}
          <Badge
            variant={agent.online ? "secondary" : "outline"}
            title={
              agent.online
                ? "Holding a connection to Blob"
                : "Not connected — run the bridge next to the agent"
            }
          >
            {agent.online ? "connected" : "not connected"}
          </Badge>
          {agent.status !== "enabled" && (
            <Badge variant="outline">{agent.status.replace("_", " ")}</Badge>
          )}
        </ItemTitle>
        <ItemDescription>
          {agent.description || agent.slug} · answers you, and whoever you
          /allow
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {/* The label stays; `aria-expanded` says which way the press goes. */}
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Channels
        </Button>
        <Button
          variant="ghost"
          aria-expanded={lendingOpen}
          onClick={() => setLendingOpen((v) => !v)}
        >
          Lent to
        </Button>
        {confirming ? (
          <>
            <Button
              variant="destructive"
              onClick={() =>
                void act(async () => {
                  await api.agents.detach(agent.id);
                  onRemoved();
                })
              }
            >
              Remove {agent.name}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )}
      </ItemActions>

      {open && (
        <div className="flex basis-full flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Mentioning {agent.name} reaches it only in channels it has been
            added to. Only channels you are in are offered.
          </p>
          {(channels.data?.channels ?? []).map((channel: AppChannel) => (
            <div className="flex items-center gap-3" key={channel.id}>
              <span className="min-w-0 flex-1 font-medium wrap-anywhere">
                #{channel.name ?? channel.id}
              </span>
              <Button
                variant={channel.joined ? "ghost" : "outline"}
                onClick={() =>
                  void channelAct(() =>
                    channel.joined
                      ? api.agents.leaveChannel(agent.id, channel.id)
                      : api.agents.joinChannel(agent.id, channel.id),
                  )
                }
              >
                {channel.joined ? "Remove" : "Add"}
              </Button>
            </div>
          ))}
          {channels.data && channels.data.channels.length === 0 && (
            <p className="text-sm text-muted-foreground">
              You are not in any channel it could join.
            </p>
          )}
        </div>
      )}

      {lendingOpen && (
        <div className="flex basis-full flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Lend it with /allow @{agent.name} @someone in a channel. Each person it is
            lent to keeps a memory of their own with it, never yours.
          </p>
          {(loans.data?.loans ?? []).map((loan: AgentLoan) => (
            <div className="flex items-center gap-3" key={loan.id}>
              <span className="min-w-0 flex-1 font-medium wrap-anywhere">
                {loan.granteeName} ·{" "}
                {loan.channelId === null
                  ? "everywhere it is"
                  : `#${loan.channelName ?? "a channel"}`}
              </span>
              <Button
                variant="ghost"
                onClick={() => void loanAct(() => api.agents.endLoan(agent.id, loan.id))}
              >
                End
              </Button>
            </div>
          ))}
          {loans.data && loans.data.loans.length === 0 && (
            <p className="text-sm text-muted-foreground">Nobody else may use it.</p>
          )}
        </div>
      )}
    </CardRow>
  );
}
