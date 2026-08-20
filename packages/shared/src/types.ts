/** Domain types shared by the server and every client. */

export type UserRole = 'member' | 'admin' | 'owner';
export type ChannelKind = 'public' | 'private' | 'dm' | 'group_dm';
export type NotifyLevel = 'all' | 'mentions' | 'none';
export type MessageKind = 'user' | 'system' | 'bot';
export type PresenceState = 'active' | 'away' | 'offline';

/** Public shape of a user. Never includes password_hash or email of other users. */
export interface User {
  id: string;
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

export interface Bootstrap {
  workspace: Workspace;
  user: CurrentUser;
  users: User[];
  channels: ChannelWithState[];
  customEmoji: { name: string; url: string }[];
  themes: Theme[];
}
