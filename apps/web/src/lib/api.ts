/** Typed HTTP client. Every call goes through here so error shapes stay consistent. */

import type {
  AgentTask,
  AgentTaskPriority,
  AgentTaskStatus,
  Bootstrap,
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
  UserPrefs,
} from '@blob/shared';

/** Admin-only shapes. `AdminUser` carries email, which the public `User` omits. */
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  fullName: string | null;
  title: string | null;
  role: 'member' | 'admin' | 'owner';
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
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
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

export interface AdminPlugin {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  runtime: string;
  status: 'enabled' | 'disabled' | 'needs_review';
  version: string;
  requestUrl: string | null;
  /** Set when the app answers over AG-UI rather than a webhook. */
  aguiUrl: string | null;
  events: string[];
  scopes: string[];
  botUserId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  pendingDeliveries: number;
  failedDeliveries: number;
  /** Set only for an agent Blob deployed from a repository. */
  sourceRepo?: string | null;
  sourceRef?: string | null;
  deploymentStatus?: string | null;
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

export interface AdminPluginCatalog {
  scopes: Record<string, string>;
  events: Record<string, string>;
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

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = 'ApiError';
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
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
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
    const error = (payload as { error?: { code: string; message: string; field?: string } })?.error;
    throw new ApiError(
      res.status,
      error?.code ?? 'unknown',
      error?.message ?? 'Something went wrong.',
      error?.field,
    );
  }

  return payload as T;
}

const get = <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body);
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, body);
const del = <T>(path: string, body?: unknown) => request<T>('DELETE', path, body);

export const api = {
  auth: {
    state: () => get<{ needsSetup: boolean }>('/api/auth/state'),
    signup: (input: {
      email: string;
      password: string;
      displayName: string;
      workspaceName?: string;
      inviteToken?: string;
    }) => post<{ user: CurrentUser }>('/api/auth/signup', input),
    login: (email: string, password: string) =>
      post<{ user: CurrentUser }>('/api/auth/login', { email, password }),
    logout: () => post<{ ok: true }>('/api/auth/logout'),
    invite: (token: string) => get<{ email: string | null; workspace: string }>(`/api/invites/${token}`),
    createInvite: (input: { email?: string; role?: 'member' | 'admin'; expiresInDays?: number }) =>
      post<{ url: string; expiresAt: string }>('/api/invites', input),
    forgotPassword: (email: string) => post<{ ok: true }>('/api/auth/forgot-password', { email }),
    resetPassword: (token: string, password: string) =>
      post<{ ok: true }>('/api/auth/reset-password', { token, password }),
  },

  bootstrap: () => get<Bootstrap>('/api/bootstrap'),

  me: {
    update: (input: Record<string, unknown>) => patch<{ user: CurrentUser }>('/api/me', input),
    prefs: (input: Partial<UserPrefs>) => patch<{ prefs: UserPrefs }>('/api/me/prefs', input),
  },

  users: {
    list: () => get<{ users: User[] }>('/api/users'),
  },

  channels: {
    list: () => get<{ channels: ChannelWithState[] }>('/api/channels'),
    create: (input: {
      name: string;
      kind: 'public' | 'private';
      topic?: string;
      memberIds?: string[];
    }) => post<{ channel: ChannelWithState }>('/api/channels', input),
    update: (id: string, input: { name?: string; topic?: string | null }) =>
      patch<{ channel: ChannelWithState }>(`/api/channels/${id}`, input),
    join: (id: string) => post<{ channel: ChannelWithState }>(`/api/channels/${id}/join`),
    leave: (id: string) => post<{ ok: true }>(`/api/channels/${id}/leave`),
    archive: (id: string) => post<{ ok: true }>(`/api/channels/${id}/archive`),
    members: (id: string) => get<{ userIds: string[] }>(`/api/channels/${id}/members`),
    addMembers: (id: string, userIds: string[]) =>
      post<{ ok: true }>(`/api/channels/${id}/members`, { userIds }),
    setMembership: (id: string, input: { notifyLevel?: NotifyLevel; isStarred?: boolean }) =>
      patch<{ channel: ChannelWithState }>(`/api/channels/${id}/membership`, input),
    pins: (id: string) => get<{ messages: Message[] }>(`/api/channels/${id}/pins`),
    markRead: (id: string, lastReadMessageId: string) =>
      post<{ readState: { channelId: string; lastReadMessageId: string; mentionCount: number } }>(
        `/api/channels/${id}/read`,
        { lastReadMessageId },
      ),
  },

  dms: {
    open: (userIds: string[]) => post<{ channel: ChannelWithState }>('/api/dms', { userIds }),
  },

  messages: {
    history: (channelId: string, params: { before?: string; around?: string; limit?: number } = {}) => {
      const search = new URLSearchParams();
      if (params.before) search.set('before', params.before);
      if (params.around) search.set('around', params.around);
      search.set('limit', String(params.limit ?? 50));
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
    ) => post<{ message: Message }>(`/api/channels/${channelId}/messages`, input),
    edit: (id: string, body: string) => patch<{ message: Message }>(`/api/messages/${id}`, { body }),
    remove: (id: string) => del<{ ok: true }>(`/api/messages/${id}`),
    translate: (
      id: string,
      input: {
        targetLanguage?: string | null;
        forceRefresh?: boolean;
      } = {},
    ) => post<{ translation: MessageTranslation }>(`/api/messages/${id}/translate`, input),
    thread: (rootId: string) => get<{ messages: Message[] }>(`/api/messages/${rootId}/thread`),
    threads: () => get<{ messages: Message[] }>('/api/threads'),
    pin: (id: string, pinned: boolean) => put<{ message: Message }>(`/api/messages/${id}/pin`, { pinned }),
    react: (id: string, emoji: string) => put<{ ok: true }>(`/api/messages/${id}/reactions`, { emoji }),
    unreact: (id: string, emoji: string) =>
      del<{ ok: true }>(`/api/messages/${id}/reactions?emoji=${encodeURIComponent(emoji)}`),
  },

  agentic: {
    getThreadSummary: (messageId: string) =>
      get<{ summary: ThreadSummary | null }>(`/api/threads/${messageId}/summary`),
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
    listTasks: (params: { assignee?: string; status?: AgentTaskStatus } = {}) => {
      const search = new URLSearchParams();
      if (params.assignee) search.set('assignee', params.assignee);
      if (params.status) search.set('status', params.status);
      return get<{ tasks: AgentTask[] }>(`/api/tasks?${search}`);
    },
  },

  themes: {
    list: () => get<{ themes: Theme[]; groups: Record<string, string[]> }>('/api/themes'),
    save: (input: {
      id?: string;
      name: string;
      mode: 'light' | 'dark';
      tokens: Record<string, string>;
      isEnabled?: boolean;
    }) => put<{ theme: Theme }>('/api/admin/themes', input),
    remove: (id: string) => del<{ ok: true }>(`/api/admin/themes/${id}`),
  },

  admin: {
    users: (params: { q?: string; includeDeactivated?: boolean } = {}) => {
      const search = new URLSearchParams();
      if (params.q) search.set('q', params.q);
      if (params.includeDeactivated === false) search.set('include_deactivated', 'false');
      return get<{ users: AdminUser[]; total: number }>(`/api/admin/users?${search}`);
    },
    setRole: (id: string, role: 'member' | 'admin' | 'owner') =>
      put<{ ok: true }>(`/api/admin/users/${id}/role`, { role }),
    deactivate: (id: string) => post<{ ok: true }>(`/api/admin/users/${id}/deactivate`),
    reactivate: (id: string) => post<{ ok: true }>(`/api/admin/users/${id}/reactivate`),
    revokeSessions: (id: string) => post<{ ok: true }>(`/api/admin/users/${id}/revoke-sessions`),

    invites: () => get<{ invites: AdminInvite[] }>('/api/admin/invites'),
    revokeInvite: (id: string) => del<{ ok: true }>(`/api/admin/invites/${id}`),

    channels: () => get<{ channels: AdminChannel[] }>('/api/admin/channels'),
    archiveChannel: (id: string) => post<{ ok: true }>(`/api/admin/channels/${id}/archive`),

    audit: (params: { action?: string; actorId?: string } = {}) => {
      const search = new URLSearchParams();
      if (params.action) search.set('action', params.action);
      if (params.actorId) search.set('actor_id', params.actorId);
      return get<{ events: AuditEvent[] }>(`/api/admin/audit?${search}`);
    },

    settings: () => get<WorkspaceSettings>('/api/admin/settings'),
    updateSettings: (input: { name?: string; settings?: Record<string, unknown> }) =>
      patch<WorkspaceSettings>('/api/admin/settings', input),

    health: () => get<AdminHealth>('/api/admin/health'),

    webhooks: () => get<{ webhooks: AdminWebhook[] }>('/api/admin/webhooks'),
    createWebhook: (channelId: string, name: string) =>
      post<AdminWebhook>('/api/admin/webhooks', { channelId, name }),
    revokeWebhook: (id: string) => del<{ ok: true }>(`/api/admin/webhooks/${id}`),

    pluginCatalog: () => get<AdminPluginCatalog>('/api/admin/plugins/catalog'),
    plugins: () => get<{ plugins: AdminPlugin[] }>('/api/admin/plugins'),
    installPlugin: (input: {
      slug: string;
      name: string;
      description?: string | null;
      runtime: 'external';
      version: string;
      // One of these is required, not both: an app is reached by a webhook it serves,
      // by an AG-UI endpoint Blob calls, or by both. The server decides which.
      requestUrl?: string | null;
      aguiUrl?: string | null;
      events: string[];
      scopes: string[];
    }) =>
      post<{ plugin: AdminPlugin; signingSecret: string; botToken: string }>(
        '/api/admin/plugins',
        input,
      ),
    approvePlugin: (pluginId: string) =>
      post<{ plugin: AdminPlugin }>(`/api/admin/plugins/${pluginId}/approve`),
    setPluginEnabled: (pluginId: string, enabled: boolean) =>
      post<{ plugin: AdminPlugin }>(`/api/admin/plugins/${pluginId}/enabled`, { enabled }),
    rotatePluginSecret: (pluginId: string) =>
      post<{ signingSecret: string }>(`/api/admin/plugins/${pluginId}/secret`),
    issuePluginToken: (pluginId: string) =>
      post<{ botToken: string }>(`/api/admin/plugins/${pluginId}/token`),
    revokePluginTokens: (pluginId: string) =>
      del<{ ok: true }>(`/api/admin/plugins/${pluginId}/tokens`),
    pluginDeliveries: (pluginId: string, limit = 20) =>
      get<{ deliveries: AdminPluginDelivery[] }>(
        `/api/admin/plugins/${pluginId}/deliveries?limit=${limit}`,
      ),
    uninstallPlugin: (pluginId: string) => del<{ ok: true }>(`/api/admin/plugins/${pluginId}`),

    // Agents installed from a repository. Preview first: the scopes have to be seen
    // before anything is approved.
    previewRepo: (input: { repoUrl: string; ref?: string }) =>
      post<AgentRepoPreview>('/api/admin/plugins/preview-repo', input),
    installFromRepo: (input: {
      repoUrl: string;
      ref?: string;
      /** Passed to the container and not stored — see the console's Configuration rows. */
      env?: Record<string, string>;
    }) =>
      post<{ plugin: AdminPlugin; signingSecret: string; botToken: string }>(
        '/api/admin/plugins/from-repo',
        input,
      ),
    deployment: (pluginId: string) =>
      get<AgentDeployment>(`/api/admin/plugins/${pluginId}/deployment`),
    redeploy: (pluginId: string) =>
      post<AgentDeployment>(`/api/admin/plugins/${pluginId}/redeploy`),
    stopAgent: (pluginId: string) => post<{ ok: true }>(`/api/admin/plugins/${pluginId}/stop`),
    deploymentLogs: (pluginId: string) =>
      get<{ logs: string }>(`/api/admin/plugins/${pluginId}/logs`),
  },

  interact: (input: { messageId: string; actionId: string; value: string }) =>
    post<{ ok: true }>('/api/interactions', input),

  search: (q: string) =>
    get<{ messages: Message[]; total: number }>(`/api/search?q=${encodeURIComponent(q)}`),

  sync: (cursors: Record<string, string>) =>
    get<SyncResponse>(`/api/sync?cursors=${encodeURIComponent(JSON.stringify(cursors))}`),

  feedback: {
    submit: (input: {
      kind: 'bug' | 'feedback' | 'feature';
      title: string;
      body: string;
      environment: Record<string, string>;
      consoleLog: string;
      snapshot: string;
    }) => post<{ ticket: FeedbackTicket }>('/api/feedback', input),
    list: (status?: 'open' | 'closed') =>
      get<{ tickets: FeedbackTicket[] }>(
        `/api/admin/feedback${status ? `?status=${status}` : ''}`,
      ),
    setStatus: (id: string, status: 'open' | 'closed') =>
      patch<{ ticket: FeedbackTicket }>(`/api/admin/feedback/${id}`, { status }),
    remove: (id: string) => del<{ ok: true }>(`/api/admin/feedback/${id}`),
    snapshotUrl: (id: string) => `/api/admin/feedback/${id}/snapshot`,
  },

  uploads: {
    create: (input: { filename: string; mime: string; sizeBytes: number }) =>
      post<{
        attachmentId: string;
        uploadUrl: string;
        method: 'PUT';
        headers: Record<string, string>;
      }>('/api/uploads', input),
    complete: (id: string, dimensions: { width?: number; height?: number } = {}) =>
      post<{ ok: true }>(`/api/uploads/${id}/complete`, dimensions),
  },
};
