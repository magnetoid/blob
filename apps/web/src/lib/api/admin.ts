/** `api.admin` — see `lib/api.ts` for the assembled client. */

import type {
  AgentRunCard,
  AgentRunSeen,
  AgentRunView,
  UserGroup,
  CallSettings,
  MediaServerStatus,
} from "@blob/shared";
import type { ExportEntry } from "./me.ts";
import type { UsageReport, AgentNote, AgentMemory, AppChannel } from "./agents.ts";
import type { AssistantToken } from "./assistants.ts";
import type { OAuthGrant } from "./oauth.ts";
import { get, post, patch, put, del } from "./client.ts";

/** One account anywhere on the server, with the workspace it belongs to. */
export interface InstanceUser {
  id: string;
  email: string;
  displayName: string;
  role: "member" | "admin" | "owner" | "guest";
  kind: "human" | "bot";
  workspaceId: string;
  workspaceName: string;
  deactivated: boolean;
  createdAt: string;
}

/** One of the workspace's own emoji, as the admin console lists them. */
export interface WorkspaceEmoji {
  name: string;
  url: string;
  createdByName: string | null;
  createdAt: string;
}

/** What a workspace may do to the machine it runs on. Instance admins only. */
export interface WorkspacePolicy {
  workspaceId: string;
  mayHostAgents: boolean;
  mayUsePrivateEndpoints: boolean;
  mayConnectSocketAgents: boolean;
  deniedScopes: string[];
  maxApps: number | null;
  /** Hops an agent's reply may carry a chain past the person who started it. 0 = off. */
  agentChainMaxDepth: number;
  /** What the environment permits at all. Policy narrows this and can never widen it. */
  serverAllowsHosting: boolean;
  serverAllowsPrivateEndpoints: boolean;
  serverChainMaxDepth: number;
}

type WorkspacePolicyInput = Pick<
  WorkspacePolicy,
  | "mayHostAgents"
  | "mayUsePrivateEndpoints"
  | "mayConnectSocketAgents"
  | "deniedScopes"
  | "agentChainMaxDepth"
> & { maxApps: number | null };

/** A connection as an admin sees it: whose it is, too. */
export interface WorkspaceAssistantToken extends AssistantToken {
  ownerId: string;
  ownerName: string;
}

export interface ModelPrice {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface UsagePrices {
  currency: string | null;
  prices: ModelPrice[];
}

/** A connected app as an admin sees it: whose it is, too. */
export interface WorkspaceOAuthGrant extends OAuthGrant {
  ownerId: string;
  ownerName: string;
}

/** One workspace on the server, with enough to tell them apart at a glance. */
export interface InstanceWorkspace {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  channelCount: number;
  appCount: number;
  createdAt: string;
}

/** Admin-only shapes. `AdminUser` carries email, which the public `User` omits. */
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  fullName: string | null;
  title: string | null;
  role: "member" | "admin" | "owner" | "guest";
  deactivatedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  sessionCount: number;
  channelCount: number;
  messageCount: number;
  /** Their sign-in asks for a passkey after the password (ADR 0032). */
  twoStep: boolean;
  /** An account an import kept for somebody not yet invited (ADR 0042). */
  placeholder: boolean;
  /** A placeholder whose address can be invited: a person, with a real address. */
  invitable: boolean;
}

export interface AdminInvite {
  id: string;
  email: string | null;
  role: string;
  createdByName: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByName: string | null;
  revokedAt: string | null;
  status: "pending" | "accepted" | "expired" | "revoked";
}

export interface AdminChannel {
  id: string;
  kind: string;
  name: string | null;
  topic: string | null;
  createdAt: string;
  archivedAt: string | null;
  memberCount: number;
  messageCount: number;
  lastMessageAt: string | null;
}

export interface AuditEvent {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

interface WorkspaceSettings {
  name: string;
  slug: string;
  settings: Record<string, unknown>;
}

export interface AdminWebhook {
  id: string;
  name: string;
  channelId: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Present only in the creation response; the raw token is never recoverable. */
  url: string | null;
}

export interface AdminHealth {
  database: boolean;
  redis: boolean;
  /** "ok" | "unreachable" | "unconfigured" — whether mail can leave the server at all. */
  mail: string;
  /** Whether push keys are set. Without them a closed tab is told nothing. */
  push: boolean;
  /** "ok" | "unconfigured" | "private" | "unreachable" — whether a browser can reach
   *  object storage, which is what an upload actually needs. */
  storage: string;
  queueDepth: number;
  connections: number;
  usersOnline: number;
  messageCount: number;
  storageBytes: number;
  version: string;
  /** The last nightly database backup (M3 · B4). */
  backup?: {
    enabled: boolean;
    at: string | null;
    ok: boolean | null;
    bytes: number | null;
    error: string | null;
  } | null;
}

/** One captured warning or error from the server, newest first in the list. */
export interface ServerLogEntry {
  at: string;
  level: string;
  logger: string;
  message: string;
  /** Traceback, when the record carried an exception. */
  detail: string | null;
  /** The endpoint being served, on records from the unhandled-error handler. */
  path: string | null;
  method: string | null;
}

export interface AdminPlugin {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  runtime: string;
  status: "enabled" | "disabled" | "needs_review" | "failed";
  version: string;
  requestUrl: string | null;
  /** Set when the app answers over AG-UI rather than a webhook. */
  aguiUrl: string | null;
  events: string[];
  scopes: string[];
  /** The subset of `scopes` still awaiting approval — what the consent screen lists. */
  pendingScopes: string[];
  botUserId: string | null;
  /**
   * Whose agent this is, or null for the workspace's own.
   *
   * Unowned answers everybody, which is what the shared assistant should do. Owned
   * answers its owner and whoever they have lent it to with `/allow`.
   */
  ownerUserId: string | null;
  lastError: string | null;
  /**
   * The newest ten errors, newest first. History: switching the app back on clears
   * `lastError` and leaves these.
   */
  recentErrors: AppRecentError[];
  /** When its signing secret was last rotated. */
  secretRotatedAt: string | null;
  /** When any of its live bot tokens was last used; null if none ever has been. */
  tokenLastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  pendingDeliveries: number;
  failedDeliveries: number;
  /** Daily caps (null = uncapped) and what the trailing day actually cost. */
  budgetRunsPerDay: number | null;
  budgetSecondsPerDay: number | null;
  /** Tokens the agent may report in a trailing day (M2 · A9); its own count, so an agent
   * that reports none is never stopped by it. */
  budgetTokensPerDay: number | null;
  runsLastDay: number;
  secondsLastDay: number;
  /**
   * Tokens the agent reported over the same day. AG-UI 1.0 carries them on a run's last
   * event; an agent that reports none shows 0, which says nothing about what it cost.
   */
  tokensLastDay: number;
  /**
   * The AG-UI version the agent last declared, or null if it never has. A run is sent
   * 1.0's fields — the version itself, the files as content parts — only once it has.
   */
  aguiVersion: string | null;
  /** Whether its run cards show the channel a tail of its reasoning. Off by default. */
  showsReasoning: boolean;
  /**
   * What it may do with Blob's tools (ADR 0022). `read`: list, read and search, as the
   * person who asked and only inside the room. `write`: also post, as itself, each post
   * waiting for that person's approval. `none` by default.
   */
  toolAccess: "none" | "read" | "write";
  /**
   * Which of its posts wait for the person it works for (migration 0054): `ask` — every
   * one, the default; `auto_in_dm` — none asked for in its own DM with them; or
   * `auto_everywhere` — none. Never widens where a post may go.
   */
  writeApproval: "ask" | "auto_in_dm" | "auto_everywhere";
  /** The console table's numbers: a week of runs, runs in flight, public channels joined. */
  runsLastWeek: number;
  runningNow: number;
  channelCount: number;
  /**
   * Whether the bot is seated in public channels founded from now on.
   *
   * Where it goes next, and nothing else: no channel that already exists gains it or
   * loses it when this changes. Only the agent Blob seeds takes the flag — the routes
   * refuse it for anything else.
   */
  inEveryPublicChannel: boolean;
  /**
   * What this workspace tells its agent, sent with every run as
   * `forwardedProps.instructions`. Null when it has nothing to say.
   */
  instructions: string | null;
  /** Set only for an agent Blob deployed from a repository. */
  sourceRepo?: string | null;
  sourceRef?: string | null;
  deploymentStatus?: string | null;
  /**
   * Whether a dial-in agent is holding a connection right now, or `null` for every other
   * runtime — where the question is meaningless and `false` would read as "broken".
   */
  online?: boolean | null;
}

/**
 * One of Janus's own routes, as the overview carries it: its answer, or the reason
 * there isn't one.
 *
 * Every part is fetched separately and none of them is required for the page to draw,
 * so a dead `/v1/skills` costs the skills list and nothing else.
 */
export interface JanusPart<T = unknown> {
  data: T | null;
  error: string | null;
}

/** One workspace on this server that has Janus installed. */
export interface JanusInstall {
  workspaceId: string;
  workspaceName: string;
  pluginId: string;
  status: string;
  channelCount: number;
  runsLastWeek: number;
  isThisWorkspace: boolean;
}

/**
 * What the server's admin sees of Janus itself: whether it is up, what it runs on, and
 * where it is installed. Never a key — the value passes through Blob to Janus and is
 * gone; nothing here can carry one back.
 */
export interface JanusOverview {
  health: JanusPart;
  capabilities: JanusPart;
  config: JanusPart;
  skills: JanusPart;
  toolsets: JanusPart;
  /** What this stack was told to call, or empty when it was told nothing. */
  aguiUrl: string | null;
  secretSet: boolean;
  installs: JanusInstall[];
}

/** The camelCase twin of Janus's own `PUT /v1/config` body. Every field optional. */
export interface JanusConfigChange {
  model?: Record<string, unknown> | null;
  agent?: Record<string, unknown> | null;
  /** The **full** enabled list: an entry left out is dropped at the far end. */
  toolsets?: string[] | null;
  /** Name → value. Passed through to Janus and never stored or echoed here. */
  apiKeys?: Record<string, string> | null;
  raw?: string | null;
  restart?: boolean | null;
}

/** Janus's answer to a write: what landed, what it warns about, whether it is going. */
export interface JanusApplied {
  applied: Record<string, unknown>;
  warnings: Record<string, unknown>[];
  restarting: boolean;
  drainTimeoutSeconds: number;
}

export interface AgentRepoPreview {
  repoUrl: string;
  ref: string;
  slug: string;
  name: string;
  description: string | null;
  version: string;
  build: string;
  events: string[];
  scopes: string[];
}

export interface AgentDeployment {
  deploymentId: string | null;
  status: string;
  url: string | null;
}

export interface AgentEnvVar {
  key: string;
  /** Absent for a secret — see `hint`. */
  value: string | null;
  /** How a secret is described instead of shown: its length and last four characters. */
  hint: string | null;
  secret: boolean;
  /** Written by the runner and rewritten on every deploy, so editing it is pointless. */
  managed: boolean;
  /** The runner holds more than one row for this key, and they may disagree. */
  duplicated: boolean;
}

interface AgentEnv {
  env: AgentEnvVar[];
  /** Names Blob sets itself, shown as fixed rather than appearing to have gone missing. */
  reserved: string[];
}

/** A channel an agent follows: it hears people's messages there without a mention (ADR 0026). */
export interface FollowedChannel {
  id: string;
  name: string | null;
  kind: string;
  since: string;
  /** What it hears there: every message, only files, or questions nobody answered within
   * `quietMinutes` (M4, ADR 0026's addendum). */
  hears: FollowHears;
  quietMinutes: number | null;
}

export type FollowHears = 'everything' | 'files' | 'unanswered';

/** What an admin decided for one tool on an MCP server (ADR 0027): `off`, or when a call
 * waits for the person who asked — every time, only outside the agent's DM, or never. */
export type McpToolPolicy = "off" | "ask" | "auto_in_dm" | "auto_everywhere";

export interface McpTool {
  name: string;
  title: string | null;
  description: string;
  /** What the server says of it. It set the starting policy and nothing more. */
  readOnly: boolean;
  policy: McpToolPolicy;
}

/** A server whose tools chosen agents may use, through Blob (ADR 0027). */
export interface McpServer {
  id: string;
  name: string;
  /** The prefix of its tools' names as agents see them: `<slug>__<tool>`. */
  slug: string;
  url: string;
  enabled: boolean;
  auth: "none" | "bearer" | "header";
  /** The header's name when `auth` is `header`. A secret is never sent back. */
  authHeader: string | null;
  era: "modern" | "legacy" | null;
  protocolVersion: string | null;
  serverName: string | null;
  serverVersion: string | null;
  checkedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  tools: McpTool[];
  agentIds: string[];
  /** Tools the server listed that Blob left out, with why — only right after a listing. */
  skipped: string[];
}

export interface McpServerAuthInput {
  kind: "none" | "bearer" | "header";
  value?: string;
  header?: string;
}

export interface AdminPluginCatalog {
  scopes: Record<string, string>;
  events: Record<string, string>;
}

/** One attempt by an agent to answer a mention. */
export interface AdminAgentRun {
  id: string;
  channelId: string;
  channelName: string | null;
  threadRootId: string | null;
  triggerMessageId: string | null;
  triggerUserName: string | null;
  transport: string;
  /**
   * running | succeeded | failed | interrupted | cancelled | refused | expired — one per
   * way a run can end, plus the one that is still waiting on a person.
   */
  status: string;
  error: string | null;
  postCount: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** Hops from the person who rooted the chain; 0 when they mentioned it themselves. */
  depth: number;
  /** The agent whose reply asked this one, when depth > 0. */
  askedBy: string | null;
  /** Tokens the agent reported for the run, or null if it reported none. */
  tokens: number | null;
  /** What it did — the card it left — for opening one run in the log. */
  card: AgentRunCard | null;
  /** What it was shown. Null for a run from before it was kept. */
  seen: AgentRunSeen | null;
}

export interface AppRecentError {
  at: string;
  error: string;
}

/** One AG-UI event a run streamed, as the run's log keeps it — cut down, never whole. */
export interface AdminRunEvent {
  /** Milliseconds from the start of the run. */
  ms: number;
  /** Which round of a run that used Blob's tools it arrived in, from 0. */
  round: number;
  event: { type?: string } & Record<string, unknown>;
}

export interface AdminRunEvents {
  /** The run was in a room you cannot see, so what it streamed is kept from you. */
  hidden: boolean;
  /** How many events the run streamed; `events` is the newest 200 of them. */
  total: number;
  events: AdminRunEvent[];
  /** When the nightly sweep empties them. The run itself is kept for thirty days. */
  keptUntil: string;
}

export interface AdminPluginDelivery {
  id: string;
  event: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt?: string | null;
}

export interface AdminPluginDeliveryDetail extends AdminPluginDelivery {
  nextAttemptAt: string | null;
  /** The body the app was (or will be) sent; null when it came from a conversation this
   * admin cannot see, whose words are not theirs to read here. */
  payload: Record<string, unknown> | null;
  hidden?: boolean;
}

export interface AdminWorkspaceDelivery extends AdminPluginDelivery {
  pluginId: string;
  pluginName: string;
}

/** A provider as the server's administrator sees it. The client secret never comes back. */
export interface SsoProvider {
  id: string;
  slug: string;
  name: string;
  issuer: string;
  clientId: string;
  scopes: string;
  allowedDomains: string[];
  linkByEmail: boolean;
  joinWorkspaceId: string | null;
  enabled: boolean;
  hasSecret: boolean;
  linked: number;
}

export interface SsoProviderInput {
  name: string;
  issuer: string;
  clientId: string;
  /** Blank keeps the one already set. */
  clientSecret?: string;
  scopes?: string;
  allowedDomains: string[];
  linkByEmail: boolean;
  joinWorkspaceId: string | null;
  enabled: boolean;
}

/** A message's earlier words, as a legal hold kept them (ADR 0039 addendum). */
export interface KeptVersions {
  /** Oldest first. */
  /** `replacedAt` is when the words ended: an edit replaced them, or a delete took them. */
  versions: { body: string; writtenAt: string; replacedAt: string; endedBy: 'edit' | 'delete' }[];
  /** Whether an edit now would keep the words it replaces. */
  held: boolean;
}

/** What a Slack export holds, read before anything is written (ADR 0042). */
export interface ImportPreview {
  publicChannels: number;
  privateChannels: number;
  directMessages: number;
  groupMessages: number;
  /** One conversation's one day each, as Slack's export counts them. */
  publicDays: number;
  privateDays: number;
  /** Slack's people, not its apps, and not those deleted in Slack. */
  people: number;
  /** Of those, already members here, matched by address. */
  matched: number;
  /** Of those, arriving as placeholders until they are invited. */
  placeholders: number;
  withoutAddress: number;
  apps: number;
  /** Public channels that already exist here; their history merges into them. */
  merging: string[];
}

export interface ImportProgress {
  conversations: number;
  conversationsTotal: number;
  messages: number;
  filesCopied: number;
  filesSkipped: number;
  peopleCreated: number;
  peopleMatched: number;
}

/** A Slack import, from upload to done (ADR 0042). */
export interface ImportRecord {
  id: string;
  status: "uploading" | "reading" | "ready" | "running" | "done" | "failed" | "cancelled";
  bytes: number | null;
  includePrivate: boolean;
  copyFiles: boolean;
  preview: ImportPreview | null;
  progress: ImportProgress;
  problems: string[];
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  requestedByName: string;
}

export interface ImportState {
  current: ImportRecord | null;
  /** The largest zip this server takes, and the largest file an import copies. */
  maxBytes: number;
  maxFileBytes: number;
}

/** Somebody an import brought over who has not claimed their account yet. */
export interface ImportedPerson {
  userId: string;
  name: string;
  email: string;
  /** An invitation to this address is out and not yet accepted. */
  invited: boolean;
}

/** A workspace's retention windows and legal holds, as its admins see them (ADR 0039). */
export interface RetentionView {
  /** Days a message, and a file, is kept; null keeps it for good. */
  messageDays: number | null;
  fileDays: number | null;
  changedAt: string | null;
  /** While the last change is still waiting its day: when it starts to count. */
  takesEffectAt: string | null;
  /** The first sweep that applies the windows as they stand; null with none set. */
  nextSweepAt: string | null;
  lastSweep: { at: string; messages: number; files: number } | null;
  heldConversations: {
    id: string;
    kind: string;
    name: string | null;
    heldAt: string;
    heldBy: string | null;
  }[];
  heldPeople: { id: string; displayName: string; heldAt: string; heldBy: string | null }[];
}

/** One line of the console's Security page (M3 · C3). */
export interface SecurityCheck {
  id: string;
  title: string;
  /** `attention` is worth a look; `info` is a choice either way. */
  state: "ok" | "attention" | "info";
  detail: string;
}

/** What an agent waits on, for Admin → Approvals: a question nobody has answered, or a run
 * that said it would come back (ADR 0040). `run.decision`, `run.card` and
 * `run.comesBackFor` are left out where `visible` is false — the room's own words. */
export interface PendingApproval {
  run: AgentRunView;
  channelName: string | null;
  channelKind: string;
  /** Whom it waits on: the person the run is for. */
  personName: string | null;
  /** Whether the viewer can read the room it is in. */
  visible: boolean;
}

/** A fault the client threw in somebody's browser, as the workspace's admins see it. */
export interface ClientErrorEntry {
  fingerprint: string;
  message: string;
  stack: string;
  path: string;
  release: string | null;
  browser: string;
  count: number;
  firstAt: string;
  lastAt: string;
}

/** About what the first sweep under some windows would remove. */
export interface RetentionPreview {
  messages: number;
  files: number;
  /** The counts stopped at their ceiling: "more than". */
  capped: boolean;
}

export const admin = {
  /**
   * The whole server, not one workspace.
   *
   * Separate from `users` above deliberately: that one is scoped to the caller's
   * workspace and is what the workspace console shows. These answer "what is on this
   * machine", which is the instance console's question.
   */
  /** The workspace's own emoji. The picker has always rendered these; now they can be added. */
  groups: () => get<{ groups: UserGroup[] }>("/api/admin/groups"),
  createGroup: (input: {
    handle: string;
    name: string;
    description?: string | null;
  }) => post<{ group: UserGroup }>("/api/admin/groups", input),
  updateGroup: (
    id: string,
    input: { handle?: string; name?: string; description?: string | null },
  ) => patch<{ group: UserGroup }>(`/api/admin/groups/${id}`, input),
  deleteGroup: (id: string) => del<{ ok: true }>(`/api/admin/groups/${id}`),
  groupMembers: (id: string) =>
    get<{ userIds: string[] }>(`/api/admin/groups/${id}/members`),
  addGroupMember: (id: string, userId: string) =>
    put<{ ok: true }>(`/api/admin/groups/${id}/members/${userId}`),
  removeGroupMember: (id: string, userId: string) =>
    del<{ ok: true }>(`/api/admin/groups/${id}/members/${userId}`),

  customEmoji: () => get<{ emoji: WorkspaceEmoji[] }>("/api/admin/emoji"),
  addCustomEmoji: (name: string, attachmentId: string) =>
    post<WorkspaceEmoji>("/api/admin/emoji", { name, attachmentId }),
  removeCustomEmoji: (name: string) =>
    del<{ ok: true }>(`/api/admin/emoji/${encodeURIComponent(name)}`),
  instanceUsers: () =>
    get<{ users: InstanceUser[] }>("/api/admin/instance/users"),
  instanceWorkspaces: () =>
    get<{ workspaces: InstanceWorkspace[] }>(
      "/api/admin/instance/workspaces",
    ),
  /**
   * What one workspace is allowed to do to this machine.
   *
   * Reads what is *written down*, not what the guards compute — the two differ when a
   * capability is off server-wide, and the console shows both so a switch never
   * appears to turn itself off after being saved.
   */
  workspacePolicy: (workspaceId: string) =>
    get<WorkspacePolicy>(
      `/api/admin/instance/workspaces/${workspaceId}/policy`,
    ),
  setWorkspacePolicy: (
    workspaceId: string,
    patch: Partial<WorkspacePolicyInput>,
  ) =>
    put<WorkspacePolicy>(
      `/api/admin/instance/workspaces/${workspaceId}/policy`,
      patch,
    ),
  users: (params: { q?: string; includeDeactivated?: boolean } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.includeDeactivated === false)
      search.set("include_deactivated", "false");
    return get<{ users: AdminUser[]; total: number }>(
      `/api/admin/users?${search}`,
    );
  },
  setRole: (id: string, role: "member" | "admin" | "owner" | "guest") =>
    put<{ ok: true }>(`/api/admin/users/${id}/role`, { role }),
  deactivate: (id: string) =>
    post<{ ok: true }>(`/api/admin/users/${id}/deactivate`),
  reactivate: (id: string) =>
    post<{ ok: true }>(`/api/admin/users/${id}/reactivate`),
  resetLink: (userId: string) =>
    post<{ url: string; expiresAt: string }>(
      `/api/admin/users/${userId}/reset-link`,
    ),
  revokeSessions: (id: string) =>
    post<{ ok: true }>(`/api/admin/users/${id}/revoke-sessions`),
  /** Stop asking somebody for a passkey after their password. */
  endTwoStep: (id: string) =>
    post<{ ok: true }>(`/api/admin/users/${id}/two-step/end`),

  ssoProviders: () =>
    get<{ providers: SsoProvider[]; callbackUrl: string }>("/api/admin/instance/sso"),
  createSso: (input: SsoProviderInput & { slug: string }) =>
    post<SsoProvider>("/api/admin/instance/sso", input),
  updateSso: (id: string, input: SsoProviderInput) =>
    put<SsoProvider>(`/api/admin/instance/sso/${id}`, input),
  deleteSso: (id: string) => del<{ ok: true }>(`/api/admin/instance/sso/${id}`),
  checkSso: (id: string) =>
    post<{ ok: boolean; message: string }>(`/api/admin/instance/sso/${id}/check`),

  invites: () => get<{ invites: AdminInvite[] }>("/api/admin/invites"),
  revokeInvite: (id: string) => del<{ ok: true }>(`/api/admin/invites/${id}`),

  channels: () => get<{ channels: AdminChannel[] }>("/api/admin/channels"),
  archiveChannel: (id: string) =>
    post<{ ok: true }>(`/api/admin/channels/${id}/archive`),
  unarchiveChannel: (id: string) =>
    post<{ ok: true }>(`/api/admin/channels/${id}/unarchive`),

  serverLogs: (params: { level?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.level) query.set("level", params.level);
    if (params.limit) query.set("limit", String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return get<{ entries: ServerLogEntry[]; capacity: number }>(
      `/api/admin/instance/logs${suffix}`,
    );
  },
  clearServerLogs: () => del<{ ok: true }>("/api/admin/instance/logs"),

  audit: (
    params: {
      action?: string;
      actorId?: string;
      before?: string;
      limit?: number;
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.action) search.set("action", params.action);
    if (params.actorId) search.set("actor_id", params.actorId);
    if (params.before) search.set("before", params.before);
    if (params.limit) search.set("limit", String(params.limit));
    return get<{ events: AuditEvent[] }>(`/api/admin/audit?${search}`);
  },

  settings: () => get<WorkspaceSettings>("/api/admin/settings"),
  updateSettings: (input: {
    name?: string;
    settings?: Record<string, unknown>;
  }) => patch<WorkspaceSettings>("/api/admin/settings", input),

  workspaceDeliveries: (limit = 50) =>
    get<{ deliveries: AdminWorkspaceDelivery[] }>(
      `/api/admin/deliveries?limit=${limit}`,
    ),

  health: () => get<AdminHealth>("/api/admin/health"),
  /** The workspace's public conversations, for its admins (M3 · B4). */
  exports: () => get<{ exports: ExportEntry[] }>("/api/admin/exports"),
  startExport: () => post<{ exports: ExportEntry[] }>("/api/admin/exports", {}),
  /** What a legal hold kept of a message's earlier words (ADR 0039 addendum). */
  messageVersions: (id: string) =>
    get<KeptVersions>(`/api/admin/messages/${id}/versions`),
  /** Bringing a Slack export in (ADR 0042). */
  importState: () => get<ImportState>("/api/admin/import"),
  createImport: (sizeBytes: number) =>
    post<{ current: ImportRecord; uploadUrl: string }>("/api/admin/import", { sizeBytes }),
  importUploaded: (id: string) => post<ImportState>(`/api/admin/import/${id}/uploaded`, {}),
  startImport: (id: string, choices: { includePrivate: boolean; copyFiles: boolean }) =>
    post<ImportState>(`/api/admin/import/${id}/start`, choices),
  cancelImport: (id: string) => post<ImportState>(`/api/admin/import/${id}/cancel`, {}),
  importPeople: (id: string) =>
    get<{ people: ImportedPerson[] }>(`/api/admin/import/${id}/people`),
  inviteImported: (id: string, userIds: string[]) =>
    post<{ invited: number }>(`/api/admin/import/${id}/invite`, { userIds }),
  /** A database backup now, rather than tonight (M3 · B4). The server's administrators. */
  backupNow: () => post<{ ok: true }>("/api/admin/instance/backup", {}),

  /** How long messages and files are kept, and what is on legal hold (ADR 0039). */
  retention: () => get<RetentionView>("/api/admin/retention"),
  setRetention: (input: { messageDays: number | null; fileDays: number | null }) =>
    put<RetentionView>("/api/admin/retention", input),
  retentionPreview: (input: { messageDays: number | null; fileDays: number | null }) => {
    const query = new URLSearchParams();
    if (input.messageDays !== null) query.set("messageDays", String(input.messageDays));
    if (input.fileDays !== null) query.set("fileDays", String(input.fileDays));
    return get<RetentionPreview>(`/api/admin/retention/preview?${query}`);
  },
  holdConversation: (id: string, held: boolean) =>
    put<{ ok: true }>(`/api/admin/channels/${id}/legal-hold`, { held }),
  holdPerson: (id: string, held: boolean) =>
    put<{ ok: true }>(`/api/admin/users/${id}/legal-hold`, { held }),

  /** What agents are waiting on across the workspace (Admin → Approvals). */
  pendingApprovals: () => get<{ pending: PendingApproval[] }>("/api/admin/approvals"),

  /** Where the workspace stands, and the server for whoever runs it (M3 · C3). */
  security: () =>
    get<{ workspace: SecurityCheck[]; server: SecurityCheck[] | null }>("/api/admin/security"),

  /** Errors the client threw in people's browsers here (ADR 0025's addendum). */
  clientErrors: () => get<{ errors: ClientErrorEntry[] }>("/api/admin/client-errors"),
  clearClientErrors: () => del<{ ok: true }>("/api/admin/client-errors"),

  /**
   * Janus itself: up or down, what it runs on, and every workspace here that has it.
   *
   * Instance admins only — a workspace admin gets 403 — so a caller that needs the
   * page to stand for both has to treat a failure as "not mine to see" rather than as
   * an error. The workspace's own half of the Janus page reads none of this.
   */
  janus: () => get<JanusOverview>("/api/admin/janus"),
  /** Changed fields only: what is not sent is not touched at the far end. */
  updateJanus: (change: JanusConfigChange) =>
    put<JanusApplied>("/api/admin/janus/config", change),
  restartJanus: () => post<JanusApplied>("/api/admin/janus/restart"),

  // Unused today — not dead code. `useCallSettings.ts` reads the workspace's call
  // settings live from the store instead, kept current by every `calls.settings`
  // broadcast (R37): a GET here could still answer with what an earlier save already
  // overwrote. Mirrors the real `GET /api/admin/calls`.
  callSettings: () => get<CallSettings>("/api/admin/calls"),
  setCallSettings: (settings: CallSettings) =>
    put<CallSettings>("/api/admin/calls", settings),
  /** The instance admin's view of LiveKit. 403 for anybody else. */
  mediaServer: () => get<MediaServerStatus>("/api/admin/calls/server"),

  webhooks: () => get<{ webhooks: AdminWebhook[] }>("/api/admin/webhooks"),
  createWebhook: (channelId: string, name: string) =>
    post<AdminWebhook>("/api/admin/webhooks", { channelId, name }),
  revokeWebhook: (id: string) =>
    del<{ ok: true }>(`/api/admin/webhooks/${id}`),

  pluginCatalog: () => get<AdminPluginCatalog>("/api/admin/plugins/catalog"),
  plugins: () => get<{ plugins: AdminPlugin[] }>("/api/admin/plugins"),
  /** Runs per day over the trailing week, for the console's chart. Zeros included. */
  activity: () =>
    get<{ days: { date: string; runs: number }[] }>("/api/admin/plugins/activity"),
  installPlugin: (input: {
    slug: string;
    name: string;
    description?: string | null;
    // 'socket' is an agent that dials in and holds the connection, for one that has no
    // address to be called at — on a laptop, behind NAT. It declares no URL at all;
    // the server refuses one, because the connection is where it is.
    runtime: "external" | "socket";
    version: string;
    // One of these is required, not both: an app is reached by a webhook it serves,
    // by an AG-UI endpoint Blob calls, or by both. The server decides which.
    requestUrl?: string | null;
    aguiUrl?: string | null;
    events: string[];
    scopes: string[];
  }) =>
    post<{ plugin: AdminPlugin; signingSecret: string; botToken: string }>(
      "/api/admin/plugins",
      input,
    ),
  approvePlugin: (pluginId: string) =>
    post<AdminPlugin>(`/api/admin/plugins/${pluginId}/approve`),
  declinePluginScopes: (pluginId: string) =>
    post<AdminPlugin>(`/api/admin/plugins/${pluginId}/decline`),
  setPluginEnabled: (pluginId: string, enabled: boolean) =>
    post<AdminPlugin>(`/api/admin/plugins/${pluginId}/enabled`, { enabled }),
  /** Give an agent to a person, or pass null to hand it back to the workspace. */
  setPluginOwner: (pluginId: string, userId: string | null) =>
    put<{ ok: true }>(`/api/admin/plugins/${pluginId}/owner`, { userId }),
  setPluginBudget: (
    pluginId: string,
    budget: {
      runsPerDay: number | null;
      secondsPerDay: number | null;
      tokensPerDay?: number | null;
    },
  ) => post<AdminPlugin>(`/api/admin/plugins/${pluginId}/budget`, budget),
  /** What agents and Blob's own model spent over a window, priced (M2 · A9). */
  usage: (days: 1 | 7 | 30) => get<UsageReport>(`/api/admin/usage?days=${days}`),
  usagePrices: () => get<UsagePrices>("/api/admin/usage/prices"),
  setUsagePrices: (prices: UsagePrices) =>
    put<UsagePrices>("/api/admin/usage/prices", prices),
  /**
   * What this workspace tells its agent, or null to clear it.
   *
   * `text` is always sent, even as null. The server makes it required with no default,
   * so a body without the key is a 400 `invalid_input` rather than anything else — and
   * that refusal is the point: `extra="ignore"` is the wire's rule, so a key misspelt
   * or left out would otherwise have read as "clear it" and wiped the workspace's
   * prompt with nothing on screen to say why.
   */
  setPluginInstructions: (pluginId: string, text: string | null) =>
    post<AdminPlugin>(`/api/admin/plugins/${pluginId}/instructions`, { text }),
  /** Whether the agent joins public channels founded from now on. */
  setPluginEverywhere: (pluginId: string, enabled: boolean) =>
    post<AdminPlugin>(`/api/admin/plugins/${pluginId}/everywhere`, { enabled }),
  /** Whether the agent's run cards show the channel a tail of its reasoning. */
  setPluginReasoning: (pluginId: string, shown: boolean) =>
    post<AdminPlugin>(`/api/admin/plugins/${pluginId}/reasoning`, { shown }),
  /** What the agent may do with Blob's tools. Every post still waits for approval. */
  setPluginTools: (
    pluginId: string,
    access: AdminPlugin["toolAccess"],
    approval?: AdminPlugin["writeApproval"],
  ) =>
    post<AdminPlugin>(
      `/api/admin/plugins/${pluginId}/tools`,
      approval ? { access, approval } : { access },
    ),
  rotatePluginSecret: (pluginId: string) =>
    post<{ signingSecret: string }>(`/api/admin/plugins/${pluginId}/secret`),
  issuePluginToken: (pluginId: string) =>
    post<{ botToken: string }>(`/api/admin/plugins/${pluginId}/token`),
  revokePluginTokens: (pluginId: string) =>
    del<{ ok: true }>(`/api/admin/plugins/${pluginId}/tokens`),
  pluginRuns: (pluginId: string, limit = 20) =>
    get<{ runs: AdminAgentRun[] }>(
      `/api/admin/plugins/${pluginId}/runs?limit=${limit}`,
    ),
  /** What the agent streamed in one run, where you can see the room it ran in. */
  runEvents: (pluginId: string, runId: string) =>
    get<AdminRunEvents>(
      `/api/admin/plugins/${pluginId}/runs/${runId}/events`,
    ),
  /** Every assistant connected to this workspace as one of its people. */
  assistantTokens: () =>
    get<{ tokens: WorkspaceAssistantToken[] }>("/api/admin/mcp-tokens"),
  revokeAssistantToken: (tokenId: string) =>
    del<{ ok: true }>(`/api/admin/mcp-tokens/${tokenId}`),
  /** Every app signed in as one of the workspace's people. */
  oauthGrants: () =>
    get<{ grants: WorkspaceOAuthGrant[] }>("/api/admin/oauth-grants"),
  disconnectOAuthGrant: (grantId: string) =>
    del<{ ok: true }>(`/api/admin/oauth-grants/${grantId}`),
  /** What this agent remembers of conversations you can see. */
  agentMemory: (pluginId: string) =>
    get<{ memories: AgentMemory[] }>(`/api/admin/plugins/${pluginId}/memory`),
  agentNotes: (pluginId: string) =>
    get<{ notes: AgentNote[] }>(`/api/admin/plugins/${pluginId}/notes`),
  rewordAgentNote: (pluginId: string, noteId: string, body: string) =>
    patch<AgentNote>(`/api/admin/plugins/${pluginId}/notes/${noteId}`, { body }),
  forgetAgentNote: (pluginId: string, noteId: string) =>
    del<{ ok: true }>(`/api/admin/plugins/${pluginId}/notes/${noteId}`),
  forgetAgentMemory: (pluginId: string, memoryId: string) =>
    del<{ ok: true }>(`/api/admin/plugins/${pluginId}/memory/${memoryId}`),
  /** Every conversation's memory of it, rooms you are not in included. */
  forgetAllAgentMemory: (pluginId: string) =>
    del<{ ok: true }>(`/api/admin/plugins/${pluginId}/memory`),
  pluginDeliveries: (pluginId: string, limit = 20) =>
    get<{ deliveries: AdminPluginDelivery[] }>(
      `/api/admin/plugins/${pluginId}/deliveries?limit=${limit}`,
    ),
  pluginDelivery: (pluginId: string, deliveryId: string) =>
    get<AdminPluginDeliveryDetail>(
      `/api/admin/plugins/${pluginId}/deliveries/${deliveryId}`,
    ),
  replayPluginDelivery: (pluginId: string, deliveryId: string) =>
    post<AdminPluginDelivery>(
      `/api/admin/plugins/${pluginId}/deliveries/${deliveryId}/replay`,
    ),
  uninstallPlugin: (pluginId: string) =>
    del<{ ok: true }>(`/api/admin/plugins/${pluginId}`),

  // Where an app can speak. An installed app is inert until its bot joins a channel,
  // and the app itself cannot always arrange that — an AG-UI agent never calls us.
  appChannels: (pluginId: string) =>
    get<{ channels: AppChannel[] }>(
      `/api/admin/plugins/${pluginId}/channels`,
    ),
  appJoinChannel: (pluginId: string, channelId: string) =>
    post<{ ok: true }>(
      `/api/admin/plugins/${pluginId}/channels/${channelId}`,
    ),
  appLeaveChannel: (pluginId: string, channelId: string) =>
    del<{ ok: true }>(`/api/admin/plugins/${pluginId}/channels/${channelId}`),

  // Channels an agent follows (ADR 0026): it is sent people's messages there without a
  // mention, marked as not addressed to it. An admin's switch, per agent and channel.
  agentFollows: (pluginId: string) =>
    get<{ channels: FollowedChannel[] }>(`/api/admin/plugins/${pluginId}/follows`),
  followChannel: (
    pluginId: string,
    channelId: string,
    hearing?: { hears: FollowHears; quietMinutes?: number },
  ) =>
    put<{ channels: FollowedChannel[] }>(
      `/api/admin/plugins/${pluginId}/follows/${channelId}`,
      hearing,
    ),
  unfollowChannel: (pluginId: string, channelId: string) =>
    del<{ channels: FollowedChannel[] }>(
      `/api/admin/plugins/${pluginId}/follows/${channelId}`,
    ),

  // MCP servers (ADR 0027): tools from outside Blob that chosen agents may use. Blob
  // lists a server before keeping it, holds its credential, and makes every call.
  mcpServers: () => get<{ servers: McpServer[] }>("/api/admin/mcp-servers"),
  addMcpServer: (input: { name: string; url: string; auth: McpServerAuthInput }) =>
    post<McpServer>("/api/admin/mcp-servers", input),
  changeMcpServer: (
    serverId: string,
    input: { name?: string; url?: string; auth?: McpServerAuthInput; enabled?: boolean },
  ) => patch<McpServer>(`/api/admin/mcp-servers/${serverId}`, input),
  refreshMcpServer: (serverId: string) =>
    post<McpServer>(`/api/admin/mcp-servers/${serverId}/refresh`),
  removeMcpServer: (serverId: string) =>
    del<{ ok: true }>(`/api/admin/mcp-servers/${serverId}`),
  setMcpToolPolicy: (serverId: string, name: string, policy: McpToolPolicy) =>
    put<McpServer>(`/api/admin/mcp-servers/${serverId}/tools`, { name, policy }),
  grantMcpServer: (serverId: string, pluginId: string) =>
    put<McpServer>(`/api/admin/mcp-servers/${serverId}/agents/${pluginId}`),
  revokeMcpServer: (serverId: string, pluginId: string) =>
    del<McpServer>(`/api/admin/mcp-servers/${serverId}/agents/${pluginId}`),

  // Agents installed from a repository. Preview first: the scopes have to be seen
  // before anything is approved.
  previewRepo: (input: { repoUrl: string; ref?: string }) =>
    post<AgentRepoPreview>("/api/admin/plugins/preview-repo", input),
  installFromRepo: (input: {
    repoUrl: string;
    ref?: string;
    /** Passed to the container and not stored — see the console's Configuration rows. */
    env?: Record<string, string>;
  }) =>
    post<{ plugin: AdminPlugin; signingSecret: string; botToken: string }>(
      "/api/admin/plugins/from-repo",
      input,
    ),
  deployment: (pluginId: string) =>
    get<AgentDeployment>(`/api/admin/plugins/${pluginId}/deployment`),
  redeploy: (pluginId: string) =>
    post<AgentDeployment>(`/api/admin/plugins/${pluginId}/redeploy`),
  stopAgent: (pluginId: string) =>
    post<{ ok: true }>(`/api/admin/plugins/${pluginId}/stop`),
  deploymentLogs: (pluginId: string) =>
    get<{ logs: string }>(`/api/admin/plugins/${pluginId}/logs`),
  agentEnv: (pluginId: string) =>
    get<AgentEnv>(`/api/admin/plugins/${pluginId}/env`),
  saveAgentEnv: (
    pluginId: string,
    input: {
      set?: Record<string, string>;
      remove?: string[];
      restart?: boolean;
    },
  ) => put<AgentEnv>(`/api/admin/plugins/${pluginId}/env`, input),
};
