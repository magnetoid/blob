/** Typed HTTP client. Every call goes through here so error shapes stay consistent. */

import type {
  BrowsableChannel,
  ScheduledMessage,
  ScheduleRepeat,
  LaterItem,
  LaterState,
  AgentRunView,
  AgentTask,
  AgentTaskPriority,
  AgentTaskStatus,
  Bootstrap,
  CommandResult,
  Theme,
  ChannelWithState,
  CurrentUser,
  FeedbackTicket,
  Message,
  MessageTranslation,
  NotifyLevel,
  SyncResponse,
  ThreadSummary,
  User,
  UserGroup,
  UserPrefs,
  Work,
  WorkArtifact,
  WorkArtifactKind,
} from "@blob/shared";

/** One account anywhere on the server, with the workspace it belongs to. */
export interface InstanceUser {
  id: string;
  email: string;
  displayName: string;
  role: "member" | "admin" | "owner";
  kind: "human" | "bot";
  workspaceId: string;
  workspaceName: string;
  deactivated: boolean;
  createdAt: string;
}

/** One workspace this person can reach, and who they are inside it. */
export interface WorkspaceMembership {
  id: string;
  name: string;
  slug: string;
  role: "member" | "admin" | "owner";
  current: boolean;
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

export type WorkspacePolicyInput = Pick<
  WorkspacePolicy,
  | "mayHostAgents"
  | "mayUsePrivateEndpoints"
  | "mayConnectSocketAgents"
  | "deniedScopes"
  | "agentChainMaxDepth"
> & { maxApps: number | null };

/** An agent that belongs to the signed-in member. */
export interface MyAgent {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  /** Holding its connection right now. */
  online: boolean;
  botUserId: string | null;
  createdAt: string;
}

/** An agent a member may bring into a piece of work: the workspace's, or their own. */
export interface WorkspaceAgent {
  id: string;
  name: string;
  botUserId: string;
  mine: boolean;
  online: boolean | null;
}

export interface AttachedAgent {
  agent: MyAgent;
  /** Shown once: what the bridge dials in with, and what it signs runs with. */
  botToken: string;
  signingSecret: string;
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
  role: "member" | "admin" | "owner";
  deactivatedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  sessionCount: number;
  channelCount: number;
  messageCount: number;
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

export interface WorkspaceSettings {
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
  queueDepth: number;
  connections: number;
  usersOnline: number;
  messageCount: number;
  storageBytes: number;
  version: string;
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
  status: "enabled" | "disabled" | "needs_review";
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
  createdAt: string;
  updatedAt: string;
  pendingDeliveries: number;
  failedDeliveries: number;
  /** Daily caps (null = uncapped) and what the trailing day actually cost. */
  budgetRunsPerDay: number | null;
  budgetSecondsPerDay: number | null;
  runsLastDay: number;
  secondsLastDay: number;
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

export interface AgentEnv {
  env: AgentEnvVar[];
  /** Names Blob sets itself, shown as fixed rather than appearing to have gone missing. */
  reserved: string[];
}

export interface AppChannel {
  id: string;
  name: string | null;
  kind: string;
  joined: boolean;
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
}

export interface AdminPluginDeliveryDetail extends AdminPluginDelivery {
  nextAttemptAt: string | null;
  /** The body the app was (or will be) sent. */
  payload: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const error = (
      payload as { error?: { code: string; message: string; field?: string } }
    )?.error;
    throw new ApiError(
      res.status,
      error?.code ?? "unknown",
      error?.message ?? "Something went wrong.",
      error?.field,
    );
  }

  return payload as T;
}

const get = <T>(path: string, signal?: AbortSignal) =>
  request<T>("GET", path, undefined, signal);
const post = <T>(path: string, body?: unknown) =>
  request<T>("POST", path, body);
const patch = <T>(path: string, body?: unknown) =>
  request<T>("PATCH", path, body);
const put = <T>(path: string, body?: unknown) => request<T>("PUT", path, body);
const del = <T>(path: string, body?: unknown) =>
  request<T>("DELETE", path, body);

export interface AuthSession {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export const api = {
  auth: {
    state: () => get<{ needsSetup: boolean }>("/api/auth/state"),
    signup: (input: {
      email: string;
      password: string;
      displayName: string;
      workspaceName?: string;
      inviteToken?: string;
    }) => post<{ user: CurrentUser }>("/api/auth/signup", input),
    login: (email: string, password: string) =>
      post<{ user: CurrentUser }>("/api/auth/login", { email, password }),
    logout: () => post<{ ok: true }>("/api/auth/logout"),
    sessions: () => get<{ sessions: AuthSession[] }>("/api/auth/sessions"),
    logoutOthers: () => post<{ ok: true }>("/api/auth/logout-others"),
    invite: (token: string) =>
      get<{ email: string | null; workspace: string }>(`/api/invites/${token}`),
    createInvite: (input: {
      email?: string;
      role?: "member" | "admin";
      expiresInDays?: number;
    }) => post<{ url: string; expiresAt: string }>("/api/invites", input),
    forgotPassword: (email: string) =>
      post<{ ok: true }>("/api/auth/forgot-password", { email }),
    resetPassword: (token: string, password: string) =>
      post<{ ok: true }>("/api/auth/reset-password", { token, password }),
  },

  bootstrap: () => get<Bootstrap>("/api/bootstrap"),

  me: {
    update: (input: Record<string, unknown>) =>
      patch<{ user: CurrentUser }>("/api/me", input),
    prefs: (input: Partial<UserPrefs>) =>
      patch<{ prefs: UserPrefs }>("/api/me/prefs", input),
    pushPublicKey: () => get<{ key: string | null }>("/api/me/push-public-key"),
    subscribePush: (subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    }) => post<{ ok: true }>("/api/me/push-subscription", subscription),
    unsubscribePush: (endpoint: string) =>
      del<{ ok: true }>("/api/me/push-subscription", { endpoint }),
    pushTest: () => post<{ ok: true; sent: number }>("/api/me/push-test"),
  },

  users: {
    list: () => get<{ users: User[] }>("/api/users"),
  },

  later: {
    list: (state: LaterState = "in_progress") =>
      get<{ items: LaterItem[] }>(`/api/later?state=${state}`),
    update: (
      messageId: string,
      input: {
        state?: LaterState;
        remindAt?: string | null;
        note?: string | null;
      },
    ) => patch<{ ok: true }>(`/api/saved/${messageId}`, input),
  },

  /** Work channels: a conversation that became a place to build something. */
  work: {
    start: (input: { rootMessageId: string; title: string; agentPluginIds: string[] }) =>
      post<{ work: Work; channel: ChannelWithState | null }>("/api/work", input),
    byChannel: (channelId: string) =>
      get<{ work: Work; artifacts: WorkArtifact[] }>(`/api/channels/${channelId}/work`),
    get: (workId: string) =>
      get<{ work: Work; artifacts: WorkArtifact[] }>(`/api/work/${workId}`),
    publish: (workId: string, input: { kind: WorkArtifactKind; title: string; body: string }) =>
      post<{ artifact: WorkArtifact }>(`/api/work/${workId}/artifacts`, input),
    done: (workId: string) => post<{ work: Work }>(`/api/work/${workId}/done`),
  },

  agentRuns: {
    forChannel: (channelId: string) =>
      get<{ runs: AgentRunView[] }>(`/api/channels/${channelId}/agent-runs`),
    cancel: (runId: string) =>
      post<{ ok: true }>(`/api/agent-runs/${runId}/cancel`),
    /** Answer the decision an interrupted run is waiting on. Only its asker may. */
    answer: (runId: string, value: string, clientActionId?: string) =>
      post<{ ok: true }>(`/api/agent-runs/${runId}/answer`, {
        value,
        clientActionId,
      }),
  },

  groups: {
    setMuted: (groupId: string, muted: boolean) =>
      put<{ ok: true }>(`/api/groups/${groupId}/mute`, { muted }),
  },

  workspaces: {
    /** Every workspace this address has a live account in. */
    mine: () =>
      get<{ workspaces: WorkspaceMembership[] }>("/api/workspaces/mine"),
    /**
     * Move this browser to the account held in another workspace.
     *
     * The session cookie is swapped server-side, so everything cached from the old one
     * is now wrong — the caller reloads rather than trying to reconcile two workspaces
     * of state in a store built for one.
     */
    switch: (id: string) =>
      post<{ workspaceId: string; userId: string }>(
        `/api/workspaces/${id}/switch`,
      ),
  },

  channels: {
    list: () => get<{ channels: ChannelWithState[] }>("/api/channels"),
    create: (input: {
      name: string;
      kind: "public" | "private";
      topic?: string;
      memberIds?: string[];
    }) => post<{ channel: ChannelWithState }>("/api/channels", input),
    update: (id: string, input: { name?: string; topic?: string | null }) =>
      patch<{ channel: ChannelWithState }>(`/api/channels/${id}`, input),
    join: (id: string) =>
      post<{ channel: ChannelWithState }>(`/api/channels/${id}/join`),
    leave: (id: string) => post<{ ok: true }>(`/api/channels/${id}/leave`),
    archive: (id: string) => post<{ ok: true }>(`/api/channels/${id}/archive`),
    members: (id: string) =>
      get<{ userIds: string[] }>(`/api/channels/${id}/members`),
    addMembers: (id: string, userIds: string[]) =>
      post<{ ok: true }>(`/api/channels/${id}/members`, { userIds }),
    setMembership: (
      id: string,
      input: { notifyLevel?: NotifyLevel; isStarred?: boolean },
    ) =>
      patch<{ channel: ChannelWithState }>(
        `/api/channels/${id}/membership`,
        input,
      ),
    pins: (id: string) =>
      get<{ messages: Message[] }>(`/api/channels/${id}/pins`),
    browse: (query: string, archived: boolean) =>
      get<{ channels: BrowsableChannel[] }>(
        `/api/channels/browse?q=${encodeURIComponent(query)}&archived=${archived}`,
      ),
    markUnread: (id: string, messageId: string) =>
      post<{
        readState: {
          channelId: string;
          lastReadMessageId: string | null;
          mentionCount: number;
        };
      }>(`/api/channels/${id}/unread`, { messageId }),
    markRead: (id: string, lastReadMessageId: string) =>
      post<{
        readState: {
          channelId: string;
          lastReadMessageId: string;
          mentionCount: number;
        };
      }>(`/api/channels/${id}/read`, { lastReadMessageId }),
    schedule: (
      channelId: string,
      input: {
        body: string;
        sendAt: string;
        clientMsgId: string;
        threadRootId?: string | null;
        repeat?: ScheduleRepeat | null;
        timezone?: string;
      },
    ) =>
      post<{ scheduled: ScheduledMessage }>(
        `/api/channels/${channelId}/schedule`,
        input,
      ),
    /** Everything, everywhere. Answers with only the channels that actually moved. */
    markAllRead: () =>
      post<{
        readStates: Array<{
          channelId: string;
          lastReadMessageId: string;
          mentionCount: number;
        }>;
      }>("/api/read-states/all", {}),
  },

  dms: {
    open: (userIds: string[]) =>
      post<{ channel: ChannelWithState }>("/api/dms", { userIds }),
  },

  messages: {
    history: (
      channelId: string,
      params: { before?: string; around?: string; limit?: number } = {},
    ) => {
      const search = new URLSearchParams();
      if (params.before) search.set("before", params.before);
      if (params.around) search.set("around", params.around);
      search.set("limit", String(params.limit ?? 50));
      return get<{ messages: Message[]; hasMore: boolean }>(
        `/api/channels/${channelId}/messages?${search}`,
      );
    },
    send: (
      channelId: string,
      input: {
        body: string;
        clientMsgId: string;
        threadRootId?: string | null;
        alsoInChannel?: boolean;
        attachmentIds?: string[];
      },
    ) =>
      post<{ message: Message }>(`/api/channels/${channelId}/messages`, input),
    /**
     * Run a slash command.
     *
     * The whole text goes up with the leading slash still on it: the server owns the
     * command namespace, so a client that has never heard of `/deploy` still routes it
     * correctly and gets back an ephemeral answer either way.
     */
    command: (input: {
      channelId: string;
      text: string;
      clientMsgId: string;
    }) => post<CommandResult>("/api/commands", input),
    edit: (id: string, body: string) =>
      patch<{ message: Message }>(`/api/messages/${id}`, { body }),
    remove: (id: string) => del<{ ok: true }>(`/api/messages/${id}`),
    translate: (
      id: string,
      input: {
        targetLanguage?: string | null;
        forceRefresh?: boolean;
      } = {},
    ) =>
      post<{ translation: MessageTranslation }>(
        `/api/messages/${id}/translate`,
        input,
      ),
    get: (id: string) => get<{ message: Message }>(`/api/messages/${id}`),
    thread: (rootId: string) =>
      get<{ messages: Message[] }>(`/api/messages/${rootId}/thread`),
    threads: () =>
      get<{ messages: Message[]; unreadRootIds: string[] }>("/api/threads"),
    /** Whether you are following a thread, and the write that changes it. */
    threadFollowing: (rootId: string) =>
      get<{ following: boolean }>(`/api/messages/${rootId}/thread/following`),
    followThread: (rootId: string, following: boolean) =>
      put<{ following: boolean }>(`/api/messages/${rootId}/thread/following`, {
        following,
      }),
    markThreadRead: (rootId: string) =>
      post<{ ok: true }>(`/api/messages/${rootId}/thread/read`),
    pin: (id: string, pinned: boolean) =>
      put<{ message: Message }>(`/api/messages/${id}/pin`, { pinned }),
    save: (id: string, saved: boolean) =>
      put<{ ok: true }>(`/api/messages/${id}/save`, { saved }),
    saved: () => get<{ messages: Message[] }>("/api/saved"),
    react: (id: string, emoji: string) =>
      put<{ ok: true }>(`/api/messages/${id}/reactions`, { emoji }),
    unreact: (id: string, emoji: string) =>
      del<{ ok: true }>(
        `/api/messages/${id}/reactions?emoji=${encodeURIComponent(emoji)}`,
      ),
  },

  scheduled: {
    list: () => get<{ scheduled: ScheduledMessage[] }>("/api/scheduled"),
    cancel: (id: string) => del<{ ok: true }>(`/api/scheduled/${id}`),
  },

  agents: {
    /** Which agent `/cli` would open a terminal into, or a typed refusal saying why
     *  there isn't one (`not_hosted` for an agent Blob does not host). */
    terminalTarget: (userId: string) =>
      get<{ pluginId: string; agentName: string }>(
        `/api/agents/terminal/${userId}`,
      ),
    /** The agents you may bring into a piece of work. */
    list: () => get<{ agents: WorkspaceAgent[] }>("/api/agents"),
    /** Your own agents: attached by you, owned by you, answering only you. */
    mine: () => get<{ agents: MyAgent[] }>("/api/agents/mine"),
    attach: (name: string) => post<AttachedAgent>("/api/agents/mine", { name }),
    detach: (agentId: string) => del<{ ok: true }>(`/api/agents/mine/${agentId}`),
    channels: (agentId: string) =>
      get<{ channels: AppChannel[] }>(`/api/agents/mine/${agentId}/channels`),
    joinChannel: (agentId: string, channelId: string) =>
      post<{ ok: true }>(`/api/agents/mine/${agentId}/channels/${channelId}`),
    leaveChannel: (agentId: string, channelId: string) =>
      del<{ ok: true }>(`/api/agents/mine/${agentId}/channels/${channelId}`),
  },

  agentic: {
    catchup: (channelId: string | null) =>
      post<{
        summaries: Array<{
          channelId: string;
          channelName: string | null;
          text: string;
          messageCount: number;
          upToMessageId: string;
        }>;
      }>("/api/catchup", { channelId }),
    getThreadSummary: (messageId: string) =>
      get<{ summary: ThreadSummary | null }>(
        `/api/threads/${messageId}/summary`,
      ),
    refreshThreadSummary: (messageId: string) =>
      post<{ summary: ThreadSummary }>(`/api/threads/${messageId}/summary`),
    listThreadTasks: (messageId: string) =>
      get<{ tasks: AgentTask[] }>(`/api/threads/${messageId}/tasks`),
    createThreadTask: (
      messageId: string,
      input: {
        title: string;
        instructions?: string;
        assigneeUserId?: string | null;
        priority?: AgentTaskPriority;
        dueAt?: string | null;
        summaryId?: string | null;
        externalRef?: Record<string, string>;
      },
    ) => post<{ task: AgentTask }>(`/api/threads/${messageId}/tasks`, input),
    updateTask: (
      taskId: string,
      input: {
        assigneeUserId?: string | null;
        status?: AgentTaskStatus;
        priority?: AgentTaskPriority;
        dueAt?: string | null;
        outcome?: string | null;
        instructions?: string;
      },
    ) => patch<{ task: AgentTask }>(`/api/tasks/${taskId}`, input),
    listTasks: (
      params: { assignee?: string; status?: AgentTaskStatus } = {},
    ) => {
      const search = new URLSearchParams();
      if (params.assignee) search.set("assignee", params.assignee);
      if (params.status) search.set("status", params.status);
      return get<{ tasks: AgentTask[] }>(`/api/tasks?${search}`);
    },
  },

  themes: {
    list: () =>
      get<{ themes: Theme[]; groups: Record<string, string[]> }>("/api/themes"),
    save: (input: {
      id?: string;
      name: string;
      mode: "light" | "dark";
      tokens: Record<string, string>;
      isEnabled?: boolean;
    }) => put<{ theme: Theme }>("/api/admin/themes", input),
    remove: (id: string) => del<{ ok: true }>(`/api/admin/themes/${id}`),
  },

  admin: {
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
    createWorkspace: (name: string) =>
      post<{ id: string; name: string; slug: string }>(
        "/api/admin/instance/workspaces",
        {
          name,
        },
      ),
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
    setRole: (id: string, role: "member" | "admin" | "owner") =>
      put<{ ok: true }>(`/api/admin/users/${id}/role`, { role }),
    deactivate: (id: string) =>
      post<{ ok: true }>(`/api/admin/users/${id}/deactivate`),
    reactivate: (id: string) =>
      post<{ ok: true }>(`/api/admin/users/${id}/reactivate`),
    revokeSessions: (id: string) =>
      post<{ ok: true }>(`/api/admin/users/${id}/revoke-sessions`),

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
      params: { action?: string; actorId?: string; before?: string } = {},
    ) => {
      const search = new URLSearchParams();
      if (params.action) search.set("action", params.action);
      if (params.actorId) search.set("actor_id", params.actorId);
      if (params.before) search.set("before", params.before);
      return get<{ events: AuditEvent[] }>(`/api/admin/audit?${search}`);
    },

    settings: () => get<WorkspaceSettings>("/api/admin/settings"),
    updateSettings: (input: {
      name?: string;
      settings?: Record<string, unknown>;
    }) => patch<WorkspaceSettings>("/api/admin/settings", input),

    health: () => get<AdminHealth>("/api/admin/health"),

    webhooks: () => get<{ webhooks: AdminWebhook[] }>("/api/admin/webhooks"),
    createWebhook: (channelId: string, name: string) =>
      post<AdminWebhook>("/api/admin/webhooks", { channelId, name }),
    revokeWebhook: (id: string) =>
      del<{ ok: true }>(`/api/admin/webhooks/${id}`),

    pluginCatalog: () => get<AdminPluginCatalog>("/api/admin/plugins/catalog"),
    plugins: () => get<{ plugins: AdminPlugin[] }>("/api/admin/plugins"),
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
      budget: { runsPerDay: number | null; secondsPerDay: number | null },
    ) => post<AdminPlugin>(`/api/admin/plugins/${pluginId}/budget`, budget),
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
    pluginDeliveries: (pluginId: string, limit = 20) =>
      get<{ deliveries: AdminPluginDelivery[] }>(
        `/api/admin/plugins/${pluginId}/deliveries?limit=${limit}`,
      ),
    pluginDelivery: (pluginId: string, deliveryId: string) =>
      get<AdminPluginDeliveryDetail>(
        `/api/admin/plugins/${pluginId}/deliveries/${deliveryId}`,
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
  },

  interact: (input: { messageId: string; actionId: string; value: string }) =>
    post<{ ok: true }>("/api/interactions", input),

  search: (q: string, cursor?: string) =>
    get<{ messages: Message[]; total: number; nextCursor: string | null }>(
      `/api/search?q=${encodeURIComponent(q)}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""),
    ),

  sync: (cursors: Record<string, string>) =>
    get<SyncResponse>(
      `/api/sync?cursors=${encodeURIComponent(JSON.stringify(cursors))}`,
    ),

  feedback: {
    submit: (input: {
      kind: "bug" | "feedback" | "feature";
      title: string;
      body: string;
      environment: Record<string, string>;
      consoleLog: string;
      snapshot: string;
    }) => post<{ ticket: FeedbackTicket }>("/api/feedback", input),
    list: (status?: "open" | "closed") =>
      get<{ tickets: FeedbackTicket[] }>(
        `/api/admin/feedback${status ? `?status=${status}` : ""}`,
      ),
    setStatus: (id: string, status: "open" | "closed") =>
      patch<{ ticket: FeedbackTicket }>(`/api/admin/feedback/${id}`, {
        status,
      }),
    remove: (id: string) => del<{ ok: true }>(`/api/admin/feedback/${id}`),
    snapshotUrl: (id: string) => `/api/admin/feedback/${id}/snapshot`,
  },

  uploads: {
    create: (input: { filename: string; mime: string; sizeBytes: number }) =>
      post<{
        attachmentId: string;
        uploadUrl: string;
        method: "PUT";
        headers: Record<string, string>;
      }>("/api/uploads", input),
    complete: (
      id: string,
      dimensions: { width?: number; height?: number } = {},
    ) => post<{ ok: true }>(`/api/uploads/${id}/complete`, dimensions),
  },
};
