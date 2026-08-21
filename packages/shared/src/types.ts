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
}

/** A channel as it appears in the sidebar, with this user's own state folded in. */
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

export interface Bootstrap {
  workspace: Workspace;
  user: CurrentUser;
  users: User[];
  channels: ChannelWithState[];
  customEmoji: { name: string; url: string }[];
  themes: Theme[];
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
