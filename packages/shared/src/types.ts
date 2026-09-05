/** Domain types shared by the server and every client. */

export type UserRole = 'member' | 'admin' | 'owner';
export type UserKind = 'human' | 'bot';
export type ChannelKind = 'public' | 'private' | 'dm' | 'group_dm';
export type NotifyLevel = 'all' | 'mentions' | 'none';
export type MessageKind = 'user' | 'system' | 'bot';
export type PresenceState = 'active' | 'away' | 'offline';
export type AgentTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type AgentTaskPriority = 'low' | 'medium' | 'high' | 'critical';

/** Public shape of a user. Never includes password_hash or email of other users. */
export interface User {
  id: string;
  kind: UserKind;
  displayName: string;
  fullName: string | null;
  title: string | null;
  avatarUrl: string | null;
  timezone: string;
  role: UserRole;
  statusEmoji: string | null;
  statusText: string | null;
  statusExpiresAt: string | null;
  deactivated: boolean;
}

/** The signed-in user sees more of themselves than of others. */
export interface CurrentUser extends User {
  email: string;
  prefs: UserPrefs;
}

export interface UserPrefs {
  theme: 'light' | 'dark' | 'system';
  density: 'comfortable' | 'compact' | 'airy';
  /** Which named theme fills each side; `theme` still decides which side applies. */
  themeLight: string;
  themeDark: string;
  /** Words that trigger a notification anywhere in the workspace. */
  keywords: string[];
  /** Quiet hours; notifications are suppressed outside [start, end) local time. */
  dnd: { enabled: boolean; startHour: number; endHour: number; days: number[] } | null;
  /** Manual snooze until this ISO timestamp. */
  snoozeUntil: string | null;
  enterToSend: boolean;
  language: string | null;
  autoTranslate: boolean;
}

export const DEFAULT_PREFS: UserPrefs = {
  theme: 'system',
  density: 'comfortable',
  themeLight: 'paper',
  themeDark: 'midnight',
  keywords: [],
  dnd: null,
  snoozeUntil: null,
  enterToSend: true,
  language: null,
  autoTranslate: false,
};

export interface Channel {
  id: string;
  kind: ChannelKind;
  /** null for DMs — clients render the other member's name instead. */
  name: string | null;
  topic: string | null;
  description: string | null;
  createdBy: string | null;
  archivedAt: string | null;
  lastMessageId: string | null;
  createdAt: string;
  /** Present only for dm / group_dm. */
  memberIds?: string[];
  /** Set when this is a work channel: the assignment behind it. */
  workId: string | null;
}

/** One assignment, living in a private channel spun from a conversation. */
export interface Work {
  id: string;
  channelId: string;
  rootMessageId: string | null;
  rootChannelId: string | null;
  title: string;
  status: 'open' | 'done';
  createdBy: string | null;
  createdAt: string;
  doneBy: string | null;
  doneAt: string | null;
  artifactCount: number;
}

export type WorkArtifactKind = 'diff' | 'html' | 'markdown';

/** Something made in a work channel. Text, drawn by the client — never executed by it,
 * except an `html` page in a sandboxed frame on request. */
export interface WorkArtifact {
  id: string;
  workId: string;
  runId: string | null;
  kind: WorkArtifactKind;
  title: string;
  body: string;
  authorUserId: string | null;
  createdAt: string;
}

/** A channel as it appears in the sidebar, with this user's own state folded in. */
/** A message written now and waiting to be sent. Only ever your own. */
export interface ScheduledMessage {
  id: string;
  channelId: string;
  body: string;
  threadRootId: string | null;
  sendAt: string;
  createdAt: string;
  lastError: string | null;
  /** How it repeats, or null for the schedule that happens once. */
  repeat: ScheduleRepeat | null;
  /** When a repeating one last went out. `sendAt` is always the *next* occurrence. */
  lastSentAt: string | null;
}

/** What a schedule may repeat as. The server holds the same list, and so does a CHECK. */
export type ScheduleRepeat = "daily" | "weekdays" | "weekly";

/** A public channel as the directory lists it — what exists, how busy, am I in it. */
export interface BrowsableChannel {
  id: string;
  name: string | null;
  topic: string | null;
  description: string | null;
  createdAt: string;
  archivedAt: string | null;
  memberCount: number;
  joined: boolean;
}

export interface ChannelWithState extends Channel {
  membership: {
    notifyLevel: NotifyLevel;
    isStarred: boolean;
    joinedAt: string;
  } | null;
  hasUnread: boolean;
  mentionCount: number;
  lastReadMessageId: string | null;
}

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  url: string;
  thumbUrl: string | null;
}

/** Structured message content. Seven types, closed deliberately — see plugins/blocks.py. */
export interface BlockText {
  text: string;
  markdown?: boolean;
}

export interface BlockButton {
  type: 'button';
  actionId: string;
  text: string;
  value?: string;
  style?: 'default' | 'primary' | 'danger';
}

export interface BlockSelect {
  type: 'select';
  actionId: string;
  placeholder?: string;
  options: { label: string; value: string }[];
}

export type BlockElement = BlockButton | BlockSelect;

export type MessageBlock =
  | { type: 'section'; text: BlockText }
  | { type: 'fields'; fields: BlockText[] }
  | { type: 'divider' }
  | { type: 'context'; elements: BlockText[] }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'actions'; elements: BlockElement[] }
  | { type: 'input'; actionId: string; label: string; placeholder?: string };

export interface Reaction {
  emoji: string;
  /** Users who reacted, in the order they reacted. */
  userIds: string[];
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string | null;
  kind: MessageKind;
  body: string;
  threadRootId: string | null;
  alsoInChannel: boolean;
  replyCount: number;
  replyUserIds: string[];
  lastReplyAt: string | null;
  mentionUserIds: string[];
  /**
   * Groups this message named, kept as groups.
   *
   * Deliberately not flattened into `mentionUserIds`, which means "people this message
   * named directly" — the server resolves a group to people at notify time, against
   * current membership, so an edit cannot rewrite who was pinged.
   */
  mentionGroupIds: string[];
  mentionsEveryone: boolean;
  clientMsgId: string;
  editedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
  createdAt: string;
  reactions: Reaction[];
  attachments: Attachment[];
  /** Structured content beside `body`, which stays the plain-text fallback. */
  blocks?: MessageBlock[] | null;
  /** Which app posted this, when one did. */
  pluginId?: string | null;
  linkPreview: LinkPreview | null;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

/** Everything the client needs on boot, in one round trip. */
/** A named set of token overrides on top of the built-in palette. */
export interface Theme {
  id: string;
  slug: string;
  name: string;
  mode: 'light' | 'dark';
  tokens: Record<string, string>;
  isPreset: boolean;
  isEnabled: boolean;
}

export interface ThreadSummaryDecision {
  text: string;
  messageId: string | null;
}

export interface ThreadSummaryActionItem {
  text: string;
  assigneeUserId: string | null;
  sourceMessageId: string | null;
}

export interface ThreadSummary {
  id: string;
  channelId: string;
  threadRootId: string;
  createdBy: string | null;
  provider: string;
  overview: string;
  decisions: ThreadSummaryDecision[];
  actionItems: ThreadSummaryActionItem[];
  openQuestions: string[];
  participantIds: string[];
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTask {
  id: string;
  channelId: string;
  threadRootId: string | null;
  createdBy: string | null;
  assigneeUserId: string | null;
  assigneeKind: UserKind | null;
  summaryId: string | null;
  title: string;
  instructions: string;
  status: AgentTaskStatus;
  priority: AgentTaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  outcome: string | null;
  externalRef: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTranslation {
  id: string;
  messageId: string;
  requestedBy: string | null;
  provider: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  translatedText: string;
  cached: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * What running a slash command produced.
 *
 * `ephemeral` is shown to the person who ran it and nobody else, and is never stored —
 * it rides back on the same request rather than over the socket, because its only reader
 * is already holding the response. `message` is set when the command posted for real,
 * and is the same shape a send returns so the optimistic path is unchanged.
 */
export interface CommandResult {
  ephemeral: string | null;
  message: Message | null;
  /** Somewhere the command wants you taken — `/join #design`. The socket delivers the
   *  channel row; this says which one to open. */
  channel: ChannelWithState | null;
}

/** A workspace's own emoji. Mirrors `blob_api.schemas.models.CustomEmoji`. */
export interface CustomEmoji {
  /** Shortcode without the colons — what `:name:` in a body or a reaction refers to. */
  name: string;
  url: string;
}

/** One slash command, as the composer's autocomplete describes it. */
export interface CommandSpec {
  name: string;
  /** Argument shape, e.g. `<text>` or `[text]`. Empty when the command takes none. */
  usage: string;
  summary: string;
}

export interface Bootstrap {
  workspace: Workspace;
  user: CurrentUser;
  users: User[];
  channels: ChannelWithState[];
  customEmoji: CustomEmoji[];
  /** The server owns the command namespace; the client only renders what it is told. */
  commands: CommandSpec[];
  themes: Theme[];
  /**
   * Which messages you have put aside — ids only.
   *
   * Enough to label one menu item, "Save for later" against "Remove from later",
   * without a per-user field on `Message` itself: that type is what every broadcast
   * is built from, and a broadcast has no single reader to be per-user for.
   */
  savedMessageIds: string[];
  /** Every group here — a message can name one you are not in, and it still renders. */
  groups: UserGroup[];
  /** Which of them are yours, so "mentions you" can include being named as a team. */
  myGroupIds: string[];
  mutedGroupIds: string[];
  /** The commit the server is running, when its host said which. Null when nobody did. */
  serverCommit: string | null;
}

/** A named set of people, mentionable as one handle: `@platform-team`. */
export interface UserGroup {
  id: string;
  /** What a message says after the `@`. Lowercase, no spaces. */
  handle: string;
  name: string;
  description: string | null;
  memberCount: number;
}

/** A bug report, feature request or note, filed from the user menu. */
export interface FeedbackTicket {
  id: string;
  kind: 'bug' | 'feedback' | 'feature';
  title: string;
  body: string;
  status: 'open' | 'closed';
  reporterId: string | null;
  environment: Record<string, string>;
  consoleLog: string;
  /** The snapshot is fetched by its own endpoint; a list never carries the markup. */
  hasSnapshot: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

// ─── agent runs ──────────────────────────────────────────────────────────────

export type AgentRunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  /** Never started: the agent was over its daily budget when the mention arrived. */
  | 'refused'
  /** Stopped to ask something and nobody answered within a day. */
  | 'expired';

/** The live view of what an agent is doing, folded server-side from AG-UI events. */
export interface AgentRunCard {
  steps: Array<{ name: string; status: 'running' | 'done' }>;
  tools: Array<{
    name: string;
    status: 'running' | 'done';
    args: string;
    result: string | null;
  }>;
  activity: string | null;
  reasoning: string | null;
  textChars: number;
  dropped: number;
}

export interface AgentRunView {
  id: string;
  pluginId: string;
  agentName: string;
  channelId: string;
  threadRootId: string | null;
  triggerMessageId: string | null;
  status: AgentRunStatus;
  error: string | null;
  postCount: number;
  startedAt: string;
  finishedAt: string | null;
  card: AgentRunCard | null;
  /** The person's message that rooted the chain this run is in. A root run's own trigger. */
  chainId: string;
  /** The run whose reply caused this one, or null at the root. */
  parentRunId: string | null;
  /** Hops from the person: 0 when they mentioned the agent themselves. */
  depth: number;
  /** The agent whose reply asked this one, when depth > 0. */
  askedBy: string | null;
  /** Set once the decision an interrupted run was waiting on has been made. */
  answeredAt: string | null;
  /** When a waiting decision stops waiting. */
  expiresAt: string | null;
}

export type LaterState = 'in_progress' | 'archived' | 'done';

export interface LaterItem {
  message: Message;
  state: LaterState;
  remindAt: string | null;
  remindedAt: string | null;
  note: string | null;
}
