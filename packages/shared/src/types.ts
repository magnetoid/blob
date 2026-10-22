/** Domain types shared by the server and every client. */

/** `guest` is in the workspace for the channels they were invited to, and nothing else. */
export type UserRole = 'member' | 'admin' | 'owner' | 'guest';
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
  /**
   * An agent whose app is switched off. False for every person.
   *
   * Its own field rather than folded into `deactivated`, which means retirement:
   * deactivating a bot releases its handle, so a disabled agent would lose its name to
   * whoever claimed it next.
   */
  agentDisabled: boolean;
  /**
   * The workspace's resident agent — seeded, in every public channel, addressed by its
   * DM. The home view targets it: any other bot may be somebody's own agent or an app
   * that is not in #general, where a mention is dropped with no reply and no error.
   */
  agentResident: boolean;
  /**
   * Somebody an import brought over who has not been invited yet (ADR 0042): a name on
   * old messages, deactivated, and theirs to claim through an invitation to its address.
   */
  placeholder: boolean;
}

/** The signed-in user sees more of themselves than of others. */
export interface CurrentUser extends User {
  email: string;
  prefs: UserPrefs;
  /**
   * Administers the server — their address is in `instance_admins` — rather than only
   * holding a role in this workspace. A fact about the person across every workspace, so
   * `role` cannot stand in for it: an owner here may not run the server, and the person
   * who does may be a plain admin here. The admin console offers the server's own pages
   * by it, because the server gates them by it (`require_instance_admin`).
   */
  isInstanceAdmin: boolean;
}

/** A section of your own in the channel list (M3 · B3). */
export interface SidebarSection {
  id: string;
  name: string;
  /** Channels and direct messages, each in at most one section. */
  channelIds: string[];
  collapsed: boolean;
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
  /** Be reminded when a question of mine goes a day without an answer. */
  nudges: boolean;
  /** Email about what was addressed to me while I had no Blob open, bundled at most once
   * per window (ADR 0036). */
  emailWhenAway: 'quarter_hour' | 'hourly' | 'off';
  /** Your own sections in the channel list, in the order they show. */
  sidebarSections: SidebarSection[];
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
  nudges: true,
  emailWhenAway: 'quarter_hour',
  sidebarSections: [],
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
  /** Who may post at the top level: everyone, or the workspace's admins — an
   * announcement channel, where everybody else replies in threads (M3 · B3). */
  posting?: 'everyone' | 'admins';
  /** On legal hold since (ADR 0039): kept past the workspace's retention. Its members see
   * it; it is not a secret from the people in it. */
  legalHoldAt?: string | null;
  createdAt: string;
  /** Present only for dm / group_dm. */
  /** Present only for dm / group_dm; null everywhere else, never absent. */
  memberIds: string[] | null;
  /** Set when this is a work channel: the assignment behind it. */
  workId: string | null;
  /** The room's switch for nudging whoever asked a question nobody answered. */
  nudgeUnanswered: boolean;
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
/** One person's verdict on one version of an artifact (M2 · A10). */
export interface WorkReview {
  userId: string;
  verdict: 'approved' | 'changes';
  /** Why, when changes were asked for. */
  note: string | null;
  at: string;
}

export interface WorkArtifact {
  id: string;
  workId: string;
  runId: string | null;
  kind: WorkArtifactKind;
  title: string;
  body: string;
  authorUserId: string | null;
  createdAt: string;
  /** 1, then one more each time the same title and kind is published again. */
  version: number;
  /** The version this one replaced. */
  supersedesId: string | null;
  /** The message whose thread discusses it — shared by its versions — once started. */
  reviewRootId: string | null;
  /** Verdicts on this version, newest first. */
  reviews: WorkReview[];
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
  /** A recording made in the composer, or an ordinary file. */
  kind: 'file' | 'voice';
  durationMs: number | null;
  /** 64-100 peaks, 0-255, so the bars draw without fetching the audio. */
  waveform: number[] | null;
  /** Where the transcript stands. The transcript itself is the message body. */
  transcriptStatus: 'none' | 'pending' | 'done' | 'failed';
  /** Which engine wrote it — `groq:whisper-large-v3-turbo`, `local:small`. */
  transcriptProvider: string | null;
}

/** A posted file as the Files tab lists it. */
export interface FileEntry extends Attachment {
  channelId: string;
  messageId: string;
  createdAt: string;
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
  /** Blob's own copy of the page's picture, never the page's address for it (M3 · B3). */
  imageUrl: string | null;
  /** The picture's size, so the row is the right height before its bytes arrive. */
  imageWidth?: number | null;
  imageHeight?: number | null;
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
  /** The standing decision this message is the source of (M2 · A8), or null. */
  decisionId?: string | null;
  pinnedAt: string | null;
  createdAt: string;
  reactions: Reaction[];
  attachments: Attachment[];
  /** Structured content beside `body`, which stays the plain-text fallback. */
  blocks?: MessageBlock[] | null;
  /** Which app posted this, when one did. */
  pluginId?: string | null;
  linkPreview: LinkPreview | null;
  /** Files the workspace's retention took from this message, which kept its words
   * (ADR 0039) — so a reader sees that something was there. */
  filesRemoved?: number;
  /** The poll this message asks, when it is one (ADR 0041): the body is the question. */
  poll?: Poll | null;
}

/** One answer a poll offers, and how many chose it. */
export interface PollOption {
  id: string;
  text: string;
  count: number;
  /** Who chose it, oldest first — null for an anonymous poll, which never says. */
  voterIds: string[] | null;
}

/** A poll beside its message (ADR 0041), the same for every reader: an anonymous poll's
 * own choice is asked for apart (`GET /api/messages/{id}/poll`). */
export interface Poll {
  options: PollOption[];
  /** Whether several options may be chosen. */
  multiple: boolean;
  anonymous: boolean;
  /** How many people have chosen anything. */
  voters: number;
  closedAt: string | null;
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

export interface ThreadSummaryOpenQuestion {
  text: string;
  /** The message that asked it, when the summary could tell; null on older rows. */
  messageId: string | null;
  askedByUserId: string | null;
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
  openQuestions: ThreadSummaryOpenQuestion[];
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
  /** The message that handed this task to its agent — a hand-off from the person who
   * assigned it, which the agent's run answers under. Null for a person's task. */
  dispatchMessageId: string | null;
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
  /** Whether the server has a translation provider. Without one the client draws no
   * Translate action and no translation preference. */
  translationEnabled: boolean;
  /** Who may use @channel, @here and @everyone here (M3 · B3). */
  everyoneMentions?: 'everyone' | 'admins';
  /** Whether the server has a speech service for voice messages (M3 · B2). */
  transcriptionEnabled?: boolean;
  /**
   * Whom you tagged most recently, newest first, each once and never yourself — read off
   * your own last messages. The `@` picker ranks a tie on how well a name matches by
   * these, so the person you were just talking to is the row Enter takes.
   */
  recentMentionUserIds: string[];
  recentMentionGroupIds: string[];
  /** How long this workspace keeps messages and files, and whether you are on legal hold
   * (ADR 0039). Null when it keeps everything and you are not. */
  retention?: RetentionNotice | null;
}

/** The workspace's retention as it reaches you (ADR 0039). */
export interface RetentionNotice {
  /** Days a message, and a file, is kept; null keeps it. */
  messageDays: number | null;
  fileDays: number | null;
  /** You are on legal hold. Yours to know: nobody else is told who is held. */
  held: boolean;
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
  | 'expired'
  /**
   * Asked another agent something with `ask_agent` and is waiting for its answer, holding
   * nothing (M2 · A2); that agent's finish carries it on as a run of its own.
   */
  | 'waiting';

/** The live view of what an agent is doing, folded server-side from AG-UI events. */
export interface AgentRunCard {
  steps: Array<{ name: string; status: 'running' | 'done' }>;
  tools: Array<{
    name: string;
    status: 'running' | 'done';
    args: string;
    result: string | null;
    /**
     * The MCP server a tool belongs to, by name, when it is one an admin connected rather
     * than Blob's or the agent's own (ADR 0027). Absent for every other tool.
     */
    via?: string;
  }>;
  activity: string | null;
  /**
   * Delegated work, drawn like steps (AG-UI 1.0's subagent events). Absent on a card
   * stored before 1.0 support, so read it as optional.
   */
  subagents?: Array<{ name: string; status: 'running' | 'done' | 'failed' }>;
  reasoning: string | null;
  textChars: number;
  /**
   * The tail of the answer being written — at most 2,000 characters — while the run goes.
   * A draft, not the answer: the message is still posted once, when it is finished, and
   * this is gone from the card when it is. Absent on a card stored before it existed.
   */
  textTail?: string | null;
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
  /**
   * The person the run is on behalf of: whoever rooted its chain. The one person who may
   * answer a decision it stops to ask, so "needs you" is a comparison with this.
   */
  initiatedByUserId: string | null;
  /**
   * The agent this run asked with `ask_agent` and waited on, by name (M2 · A2) — while it
   * waits, and after it heard back.
   */
  askedAgent?: string | null;
  /**
   * When the run said it would come back to this conversation (ADR 0040), and what for —
   * while it waits, and after it has. Optional on the wire, like `askedAgent`.
   */
  comesBackAt?: string | null;
  comesBackFor?: string | null;
  /**
   * Tokens the agent reported for the run, all providers together; null when it reported
   * none. Optional on the wire, because a view written before 1.0 support has no field.
   */
  tokens?: number | null;
  /** Set once the decision an interrupted run was waiting on has been made. */
  answeredAt: string | null;
  /** When a waiting decision stops waiting. */
  expiresAt: string | null;
  /**
   * What the run was shown, once it has ended. Absent on a view from before it was kept,
   * and null for a run Blob could not finish recording.
   */
  seen?: AgentRunSeen | null;
  /**
   * The question a waiting run is asking, while nobody has answered it: what the card
   * offers its asker. Null otherwise; absent on a view from before it was sent.
   */
  decision?: AgentRunDecision | null;
}

/** What an agent was shown for one run — counts and names, never content. */
export interface AgentRunSeen {
  /** Messages of the conversation it was handed. */
  messages: number;
  /** Where they came from: the thread it was asked in, or the channel. */
  window: 'thread' | 'channel';
  /** Files handed over with them (agents that speak AG-UI 1.0 only). */
  files: number;
  /** Whether the workspace's instructions went with the run. */
  instructions: boolean;
  /** Whether it started from what it remembered here. */
  memory: boolean;
  /** Whether it was handed a task (ADR 0023). */
  task: boolean;
  /** Blob's tools it was offered (ADR 0022), by name. */
  tools: string[];
  /** MCP servers whose tools it was offered (ADR 0027), by name. Absent when none were. */
  servers?: string[];
  /** The AG-UI it was spoken to in, when it declared one. */
  protocol: string | null;
}

/** A waiting run's question, as the card offers it. */
export interface AgentRunDecision {
  prompt: string;
  /** The choices the agent declared, by label — answered by their place in this list. */
  choices: Array<{ label: string }>;
  /** True when the question takes words rather than a choice. */
  freeText: boolean;
}

export type LaterState = 'in_progress' | 'archived' | 'done';

export interface LaterItem {
  message: Message;
  state: LaterState;
  remindAt: string | null;
  remindedAt: string | null;
  note: string | null;
}

/** A huddle or a meetup: a LiveKit room that belongs to one conversation. */
export type CallKind = 'huddle' | 'meetup';

export interface Call {
  id: string;
  channelId: string;
  kind: CallKind;
  createdBy: string;
  status: 'active' | 'ended';
  createdAt: string;
  endedAt: string | null;
  /** Who is connected right now, in the order they arrived. */
  participantIds: string[];
}

export interface CallToken {
  token: string;
  url: string;
}

export interface HuddleSettings {
  enabled: boolean;
  cameras: boolean;
  screenShare: boolean;
  maxParticipants: number;
}

export interface MeetupSettings {
  enabled: boolean;
  camerasOnJoin: boolean;
  maxParticipants: number;
}

export interface CallSettings {
  huddles: HuddleSettings;
  meetups: MeetupSettings;
}

export interface CallsState {
  /** Whether this server has a media server at all. */
  available: boolean;
  settings: CallSettings;
  calls: Call[];
}

export interface MediaServerStatus {
  configured: boolean;
  url: string | null;
  reachable: boolean | null;
  latencyMs: number | null;
  error: string | null;
  openRooms: number | null;
  lastEventAt: string | null;
  webhookUrl: string;
}

/**
 * Something a conversation settled, from the decision log (M2 · A8). Rests on the message
 * it was settled in, and is read under that message's channel.
 */
export interface Decision {
  id: string;
  channelId: string;
  channelName: string | null;
  channelKind: string;
  /** The message it was settled in, when it rests on one. */
  messageId: string | null;
  threadRootId: string | null;
  /** What was decided, in one line. */
  title: string;
  /** Why, if anybody said; empty otherwise. */
  rationale: string;
  /** Who recorded it — the person who approved it, when an agent proposed it. */
  decidedBy: string | null;
  /** The agent that proposed it, if one did. */
  proposedBy: string | null;
  proposedByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Set when it no longer stands. Kept, never deleted. */
  revokedAt: string | null;
  revokedBy: string | null;
}
