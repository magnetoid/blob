/** The guide, as data.
 *
 * A help page is the one screen in an app that can be wrong without anything failing.
 * Nothing crashes when it describes a button that was renamed a year ago; it simply
 * teaches people something untrue and keeps doing it. So two thirds of this page is not
 * written here at all — the keyboard section renders from `lib/shortcuts.ts` and the
 * command section from what the server said on bootstrap, exactly as `ShortcutHelp`
 * does, and a topic that wants to mention a shortcut or a command refers to it by id
 * rather than quoting it. `test_help_parity.py` then holds the ids to the server's
 * registry across the language boundary, the way `test_protocol_parity.py` holds the
 * socket vocabulary.
 *
 * What is left here is prose about behaviour, which no registry can generate: what a
 * thread is for, what happens when the connection drops, why a private channel answers
 * as though it does not exist.
 */

/** Who a topic is about. Everything not marked is for everybody. */
export type Audience = 'admins' | 'owner';

export interface Topic {
  /** The anchor. `/help#threads` has to keep working once somebody has sent it. */
  id: string;
  title: string;
  /** The one-sentence answer, for somebody who will read nothing else. */
  blurb: string;
  /** Paragraphs. Plain text — this is prose, not markup. */
  body?: string[];
  /** A numbered how-to, when the answer is a sequence rather than an explanation. */
  steps?: string[];
  /** Ids from `SHORTCUTS`. Rendered as keys, so they cannot drift from the bindings. */
  shortcuts?: string[];
  /** Command names, without the slash. Rendered from the server's own list. */
  commands?: string[];
  /** Where in the app this lives, as a path. Linked only if the reader may open it. */
  path?: string;
  audience?: Audience;
  /** Words somebody might search for that the prose does not happen to contain. */
  keywords?: string[];
}

export interface Section {
  id: string;
  title: string;
  /** One line under the section heading. */
  intro: string;
  topics: Topic[];
  /**
   * A section whose contents are generated rather than written.
   *
   * `shortcuts` renders every binding there is; `commands` renders every command this
   * server answers, including the ones apps installed here have added.
   */
  generated?: 'shortcuts' | 'commands';
  audience?: Audience;
}

export const SECTIONS: Section[] = [
  {
    id: 'start',
    title: 'Start here',
    intro: 'What is on the screen, and the four gestures that get you anywhere.',
    topics: [
      {
        id: 'the-shape',
        title: 'How the screen is laid out',
        blurb:
          'A bar across the top, a list of conversations down the left, the conversation in the middle, and a panel on the right when a thread is open.',
        body: [
          'The top bar holds the workspace name, the buttons that switch between Messages, Search and Preferences, a Feedback button, and your avatar at the far right. The avatar is the account menu — this page, your profile, preferences and what has shipped recently all hang off it.',
          'The left column lists the channels you are in, starred ones first and the rest alphabetically, then your direct messages. Anything with unread messages is bold; a number beside it counts mentions rather than messages, so a busy channel does not shout at you for conversation you were not part of.',
          'On a narrow screen the left column becomes a drawer behind the ☰ button, and the thread panel takes the whole width instead of splitting it.',
        ],
        keywords: ['layout', 'sidebar', 'top bar', 'navigation', 'where'],
      },
      {
        id: 'first-day',
        title: 'Your first ten minutes',
        blurb: 'Say who you are, join what you care about, and learn one shortcut.',
        steps: [
          'Open the account menu at the top right and pick User profile. A display name and a picture are what everyone else sees beside your messages.',
          'Open Browse channels and join anything relevant. Channels are open by default — joining one needs nobody’s permission.',
          'Post in one. A first message is worth more than a perfect profile.',
          'Learn the jump shortcut. It is the one that replaces hunting through the sidebar, and it reaches people as well as channels.',
        ],
        shortcuts: ['palette'],
        path: '/channels',
        keywords: ['new', 'onboarding', 'getting started', 'first'],
      },
      {
        id: 'getting-around',
        title: 'Getting around without the mouse',
        blurb:
          'Jump to any conversation by name, walk the sidebar with the arrows, and step through only the ones with something new.',
        body: [
          'The jump box matches channels, people and a few actions at once, so you can type part of a name and press Enter. It matches names, never the words inside messages — searching what people said is the other screen.',
          'The arrow shortcuts walk the sidebar in the order it is drawn, wrapping at both ends. The unread ones skip everything you have already read, and pressing again moves to the next one rather than back to the first.',
        ],
        shortcuts: ['palette', 'dms', 'next-conversation', 'next-unread'],
        keywords: ['keyboard', 'switch', 'jump', 'quick switcher'],
      },
      {
        id: 'signing-in',
        title: 'Signing in',
        blurb: 'An email address and a password of at least ten characters.',
        body: [
          'Once a workspace exists you cannot sign yourself up: joining needs an invitation link. Email and password is the only way in — there is no single sign-on and no second factor.',
          'Forgot your password sends a link by email. It works once and expires in an hour, which is short on purpose — a password reset link sitting in an inbox for a week is a spare key under the mat. It is also the only way to change your password: there is no field for it while you are signed in, and no way to change your email address from the app.',
          'Being signed in is per browser. Preferences lists every session your account holds, so a machine you no longer have can be signed out from one you do.',
        ],
        path: '/workspace/preferences',
        keywords: ['sign in', 'login', 'password', 'forgot', 'reset', 'account'],
      },
      {
        id: 'invitations',
        title: 'Getting someone else in',
        blurb:
          'An admin makes an invitation — to one email address, or a link anybody can use — from Invitations.',
        body: [
          'An invitation chooses the role the person arrives with. A link with nobody’s email on it is shareable, which is convenient and worth being deliberate about; either kind can be revoked before it is used.',
        ],
        audience: 'admins',
        path: '/workspace/invitations',
        keywords: ['invite', 'invitation', 'join', 'new member', 'link'],
      },
      {
        id: 'this-build',
        title: 'This guide describes the build you are running',
        blurb:
          'It ships inside the app rather than living on a website, so it cannot describe a version you do not have.',
        body: [
          'Blob deploys straight from its main branch, so features arrive continuously rather than in numbered releases. What’s new lists everything that has shipped, and names the exact commit this build was made from.',
          'If something here does not match what you see, the app is right and this page is wrong. Feedback in the account menu is the fastest way to get it fixed.',
        ],
        path: '/whats-new',
        keywords: ['version', 'release', 'changelog', 'update'],
      },
    ],
  },

  {
    id: 'messages',
    title: 'Messages',
    intro: 'Writing them, formatting them, and everything you can do to one afterwards.',
    topics: [
      {
        id: 'sending',
        title: 'Sending a message',
        blurb: 'Type in the box at the bottom and press Enter.',
        body: [
          'Shift+Enter starts a new line. If you would rather Enter always made a new line and sending were deliberate, turn off “Enter sends a message” under Language and input in Preferences — the send button beside the box does not change either way.',
          'A message runs to 12,000 characters and there is no counter, so the only way to meet the limit is to exceed it — the message comes back needing attention rather than being trimmed. Sending is capped at thirty messages a minute.',
          'A message you send while your connection is down is queued rather than lost. A banner at the top of the conversation says how many are waiting — “Offline — 2 messages are queued to send when you reconnect” — and they go out when the connection returns. A send that was interrupted after the server had already accepted it cannot arrive twice: every message carries an id your browser made, and the second attempt resolves to the first message rather than to a copy of it.',
        ],
        path: '/workspace/preferences',
        keywords: ['send', 'enter', 'newline', 'compose', 'post', 'limit', 'length'],
      },
      {
        id: 'formatting',
        title: 'Formatting',
        blurb:
          'A small Markdown subset: bold, italics, strikethrough, inline code, code blocks, quotes, lists and links.',
        body: [
          'Write **bold**, *italics* or _italics_, ~~strikethrough~~ and `code` inline. Start a line with > for a quote, with - or 1. for a list, and fence a block of code with three backticks. [Text](https://example.com) makes a link, and a bare URL becomes one on its own.',
          'The buttons under the composer do the same thing to whatever you have selected, and so do the keyboard chords. Nothing you write ever becomes raw HTML, so a message cannot inject markup into anyone else’s screen no matter what it contains.',
        ],
        shortcuts: ['format-bold', 'format-italic', 'format-code', 'format-strike'],
        keywords: ['markdown', 'bold', 'italic', 'code', 'quote', 'list', 'link'],
      },
      {
        id: 'mentions',
        title: 'Mentioning people',
        blurb: 'Type @ and part of a name; @channel, @everyone and @here reach the whole channel.',
        body: [
          '@channel and @everyone notify everybody in the channel. @here is the quieter one: it reaches only the people who are at their desk, and passes over anyone away or offline. Being passed over is not being silenced — a keyword still fires, and a channel set to Every message still delivers.',
          'A mention is counted separately from ordinary messages, which is why the number beside a channel in the sidebar is a count of mentions rather than of messages.',
          'A group your workspace has defined can be mentioned the same way, and mentioning it counts as mentioning you if you are in it. A mention inside a code block or inline code notifies nobody — pasting a shell snippet with @channel in it is safe.',
        ],
        keywords: ['@', 'mention', 'ping', 'notify', 'here', 'channel', 'group'],
      },
      {
        id: 'emoji-and-reactions',
        title: 'Emoji and reactions',
        blurb: 'Hover a message and press the smiley, or write :name: in the message itself.',
        body: [
          'Reacting is the cheapest reply there is: it acknowledges without adding a message to everyone’s unread. Clicking a reaction someone else added joins it; clicking your own removes it.',
          'Your workspace can add its own emoji, and those work in a message and as a reaction exactly like the built-in ones.',
        ],
        keywords: ['emoji', 'reaction', 'react', 'custom emoji', ':'],
      },
      {
        id: 'files',
        title: 'Files and images',
        blurb: 'Attach up to ten files to a message, each under 100 MB.',
        body: [
          'The paperclip beside the composer attaches a file, and so does dropping one on the conversation. Both limits are enforced on the server as well as in the browser, so a file refused here would have been refused there too.',
          'Anything executable is refused by extension — .exe, .msi, .bat, .cmd, .com, .scr, .ps1, .sh, .app and .jar — and so are .svg and .html, which are executable in a browser even though they do not look it.',
          'An image is shown in the conversation at full size: nothing makes thumbnails, so a 100 MB photo is a 100 MB download for everyone who scrolls past it. Clicking any attachment opens it in a new tab rather than in a viewer here.',
        ],
        keywords: ['upload', 'attach', 'image', 'photo', 'document', 'size'],
      },
      {
        id: 'editing',
        title: 'Editing and deleting',
        blurb: 'Your own messages only, from the ⋯ menu on the message.',
        body: [
          'An edited message is marked as edited — the change is visible rather than silent. A deleted message leaves a tombstone in place rather than closing the gap, so a conversation that refers to it still makes sense.',
          'The up arrow in an empty composer opens your last message for editing without reaching for the menu.',
        ],
        shortcuts: ['edit-last'],
        keywords: ['edit', 'delete', 'remove', 'change', 'typo'],
      },
      {
        id: 'message-menu',
        title: 'What the ⋯ menu on a message does',
        blurb:
          'Copy link, Forward, Mark unread, Save for later, Remind me, Pin to channel, and — on your own messages — Edit and Delete.',
        body: [
          '“Copy link” gives a permalink anyone in the channel can open; it resolves to the message in place rather than to a page of its own.',
          '“Forward…” sends the message to another conversation with your own note attached. “Mark unread” puts the blue line back above it, which is the honest way to say “I will deal with this later” — it appears only in the channel, because the read marker is a channel’s and a thread reply is not one of its rows.',
          '“Save for later” puts it on your Later list, which is yours alone and tells nobody. “Pin to channel” is the opposite: it is the channel’s, everybody sees it, and it shows in the bar at the top of the conversation. Anyone who can post can pin or unpin anything.',
          'Two edges worth knowing. Forwarding carries the text and not the files or the reactions, to one conversation at a time. And copying a link needs a secure page: on a workspace reached over plain http on a local network the clipboard is unavailable, so the app shows the link for you to copy by hand instead of failing silently.',
        ],
        path: '/later',
        keywords: ['menu', 'copy link', 'permalink', 'forward', 'pin', 'save', 'unread'],
      },
      {
        id: 'later',
        title: 'Later',
        blurb: 'Your own shortlist: messages you saved and reminders that have come back, at Later in the sidebar.',
        body: [
          'It is private and it is yours — the author is not told that you kept their message, and nobody sees the list. Removing something is the same menu item that put it there.',
          'Saving works in a channel that has been archived, which reacting and pinning do not: those need a channel you can still post in.',
        ],
        path: '/later',
        keywords: ['later', 'saved', 'bookmark', 'shortlist', 'keep'],
      },
      {
        id: 'pinned',
        title: 'Pinned messages',
        blurb:
          'The channel’s own shortlist: a bar at the top of the conversation, and a Pinned button that opens the list.',
        body: [
          'Pinning is public and permanent until somebody unpins it — the opposite of saving for later. It is for the link everyone keeps asking for, not for your own reading list.',
        ],
        keywords: ['pin', 'pinned', 'bookmark', 'important'],
      },
      {
        id: 'drafts',
        title: 'Unsent drafts',
        blurb:
          'Half a sentence survives switching channels: the sidebar marks the conversation with an unsent draft.',
        body: [
          'A draft lives in the browser you typed it in rather than on the server, and a thread keeps its own draft separately from the channel it is in. Signing out clears them.',
        ],
        keywords: ['draft', 'unsent', 'saved text', 'lost'],
      },
      {
        id: 'unread-line',
        title: 'The line where you left off',
        blurb: 'A “New messages” divider marks where your reading stopped when you open a conversation.',
        body: [
          'The marker only ever moves forward, so a slow update from another tab or another device cannot drag your position backwards. Moving it back is a deliberate act: Mark unread on a message puts the line above it again.',
        ],
        keywords: ['unread', 'new messages', 'divider', 'where I left off', 'position'],
      },
      {
        id: 'remind-me',
        title: 'Being reminded about a message',
        blurb:
          '“Remind me…” on the message menu, with a choice of in 20 minutes, in 1 hour, in 3 hours, tomorrow at 9:00, or next week.',
        body: [
          'A reminder saves the message to your Later list and brings it back at the time you picked. Nobody else is told, and the message itself is untouched. “Next week” means seven days from now at 9:00.',
          'Those five are the only choices here — there is no custom time on a message. Each reminder fires once; picking a new time re-arms it. For a note that is not about a message, and for a time in your own words, /remind is the way.',
        ],
        commands: ['remind'],
        path: '/later',
        keywords: ['remind', 'later', 'snooze', 'follow up'],
      },
      {
        id: 'translation',
        title: 'Reading a message in another language',
        blurb: 'A Translate action on the message, once you have told Blob which language you read.',
        body: [
          'Two things have to be true before the buttons appear at all. You need a preferred language set under Language and input — without one there is nothing to translate *into*, and the server says so. And whoever runs this server has to have configured a translation service; where nobody has, the click answers “Translation is not configured for this workspace yet”.',
          'With both in place: Translate adds the translation under the message rather than replacing it, Hide puts it away again, and Refresh asks a second time if the first answer was poor. The original is never taken off the screen. Turning on “Auto-translate incoming messages” does it as messages land.',
        ],
        path: '/workspace/preferences',
        keywords: ['translate', 'language', 'auto-translate'],
      },
    ],
  },
  {
    id: 'threads',
    title: 'Threads',
    intro: 'A conversation about one message, kept out of the channel’s main flow.',
    topics: [
      {
        id: 'starting-a-thread',
        title: 'Starting and reading one',
        blurb: 'Hover a message and press “Reply in thread”. The thread opens in a panel on the right.',
        body: [
          'A thread keeps a tangent out of everyone else’s way: the channel shows that replies exist and how many, and only the people who open it read them. Tick “Also send to #channel” above the reply box and that one reply goes to both places — the tick clears itself afterwards, so it is a decision per message rather than a mode.',
          'Threads is a view of its own in the sidebar, listing the ones you have replied in, so a conversation you are part of does not disappear because the channel moved on. It shows the thirty most recent and does not refresh while you sit on it.',
          'Slash commands do not work in a thread. A leading slash there is ordinary text, which is also the only way to send a message that starts with one.',
        ],
        shortcuts: ['threads', 'close'],
        path: '/threads',
        keywords: ['thread', 'reply', 'conversation', 'panel'],
      },
      {
        id: 'thread-following',
        title: 'Who hears about a reply',
        blurb: 'Replying subscribes you to the thread. Writing the message it grew under does not.',
        body: [
          'That is the part worth knowing, because it is not what Slack does: if you post something and three people reply underneath it, you are not notified and the thread does not join your Threads view until you reply yourself. A mention still reaches you, and so does a channel set to Every message.',
          'There is no Follow or Unfollow. Once you have replied you are subscribed, and the only way out is to mute the whole channel — muting silences thread replies along with everything else.',
          'A thread notification is deliberately quiet: it can raise a notification on your device, but it never adds to the mention count beside the channel.',
        ],
        keywords: ['follow', 'unfollow', 'subscribe', 'notified', 'thread'],
      },
      {
        id: 'thread-unread',
        title: 'Threads and unread',
        blurb: 'The blue line and the unread count are the channel’s, and a thread reply is not one of the channel’s rows.',
        body: [
          'That is why “Mark unread” is on messages in the channel and not on replies inside a thread: marking a reply unread would move a marker that points at something the sidebar never shows.',
        ],
        keywords: ['unread', 'thread', 'mark'],
      },
      {
        id: 'thread-summary',
        title: 'Summarising a thread',
        blurb:
          'The thread panel pulls out the decisions, the open questions and the action items. Press Generate, or Refresh once the thread has moved on.',
        body: [
          'It is labelled AI Summary and it is worth knowing what it actually is: keyword matching over the sentences in the thread, not a language model. Decisions are sentences that say decided, agreed, approved or we will; action items say todo, please, need to or next step; open questions are the sentences ending in a question mark. It reads the thread you are looking at and nothing else.',
          'So it is a good index of a long thread and a bad substitute for reading one. What it finds it finds exactly; what nobody phrased that way it misses entirely.',
          'Action items can be turned into tasks and assigned. A member can assign a person; handing work to an agent is an admin’s to do.',
        ],
        path: '/tasks',
        keywords: ['summary', 'summarise', 'ai', 'action items', 'decisions', 'tasks'],
      },
    ],
  },

  {
    id: 'channels',
    title: 'Channels',
    intro: 'Where the work happens: open by default, private when they need to be.',
    topics: [
      {
        id: 'creating',
        title: 'Making a channel',
        blurb: '“New channel” at the top of the sidebar. A name, an optional topic, and whether it is private.',
        body: [
          'Public is the default and usually the right answer: anybody in the workspace can find it, read it and join it without asking. A private channel is the exception, not the safe default — it is invisible to everyone who is not in it.',
        ],
        keywords: ['create', 'new channel', 'private', 'public', 'make'],
      },
      {
        id: 'joining',
        title: 'Finding and joining one',
        blurb: 'Browse channels lists every open channel with its topic and how many people are in it. Join is in place, in the list.',
        body: [
          'Archived channels are behind the “Include archived” toggle; joining one is refused, because it is read-only.',
          'You can open a public channel you have not joined and read it. The message box is still drawn, but sending fails until you join — so join first, then write.',
          'New members land in #general and #random automatically, and in nothing else. Private channels you are not in are never listed, because listing them would tell you they exist.',
        ],
        commands: ['join', 'leave'],
        path: '/channels',
        keywords: ['browse', 'join', 'directory', 'find channel', 'leave'],
      },
      {
        id: 'channel-menu',
        title: 'The menu on the channel name',
        blurb: 'Click the name at the top of a conversation for details, notifications, starring, leaving and archiving.',
        body: [
          '“Channel details” is where the topic and the member list live — add someone by typing their name.',
          'Starring pins a channel to the top of your sidebar. It is yours: nobody else’s list changes.',
          'Two things have no button anywhere and are only reachable as commands: renaming a channel is /rename, and taking somebody out of one is /remove. Channel details can add people and not remove them.',
          'Leaving a private channel removes it from your app completely — you cannot find your way back without somebody adding you again. A public one stays in the directory to rejoin.',
        ],
        commands: ['topic', 'rename', 'who', 'invite', 'remove'],
        keywords: ['menu', 'details', 'star', 'members', 'topic', 'leave', 'archive', 'rename'],
      },
      {
        id: 'channel-notifications',
        title: 'How much a channel notifies you',
        blurb:
          'Every message, Mentions, or Nothing — under Notifications in the channel menu.',
        body: [
          '“Nothing” is a mute: the channel still gathers unread messages and still shows them, it just never notifies you. Muting is not leaving, and it is invisible to everyone else.',
        ],
        commands: ['mute'],
        keywords: ['notify', 'mute', 'notifications', 'quiet', 'all', 'mentions'],
      },
    ],
  },

  {
    id: 'dms',
    title: 'Direct messages',
    intro: 'One person, a few people, or yourself.',
    topics: [
      {
        id: 'starting-a-dm',
        title: 'Messaging someone',
        blurb: 'The people-only jump box, a name in the sidebar, or /dm @name.',
        body: [
          'Adding more names makes it a group message, up to eight people. A group message is not a channel: it has no topic, nobody can join it later, and it cannot be archived.',
          'Clicking somebody’s name or avatar on a message opens a small card with a Message button, which is the fourth way and usually the nearest one.',
          'A group message can only be started by naming everybody at once — /dm @ana @bob — and once it exists nobody can be added, removed or given it a name.',
          'A direct message cannot be left, closed or hidden; its menu offers only starring, so /mute is the only way to quieten one.',
        ],
        commands: ['dm', 'mute'],
        shortcuts: ['dms'],
        keywords: ['dm', 'direct message', 'private message', 'group', 'mute'],
      },
      {
        id: 'group-dm',
        title: 'Starting a group message',
        blurb: 'The + beside Direct messages opens a recipient field; add up to seven other people.',
        body: [
          'It is a conversation, not a channel: no topic, nobody can be added afterwards, and it cannot be named or archived. If you find yourself wanting any of that, a channel is the thing you actually want.',
        ],
        commands: ['dm'],
        keywords: ['group', 'new message', 'compose', 'several people'],
      },
      {
        id: 'self-dm',
        title: 'Messaging yourself',
        blurb: 'A conversation with just you, listed as “You” — the place for a note you want on the record.',
        body: [
          'It behaves like any other conversation: searchable, formatted, and able to hold files. Reminders you write with /remind arrive here.',
        ],
        commands: ['remind'],
        keywords: ['self', 'notes', 'me', 'you', 'draft'],
      },
    ],
  },

  {
    id: 'search',
    title: 'Search',
    intro: 'One box, with Slack’s modifiers, over every message you can see.',
    topics: [
      {
        id: 'searching',
        title: 'Finding a message',
        blurb: 'Type what you remember. Results are ranked by relevance, newest first among equals.',
        body: [
          'Search covers the conversations you are in and nothing else — channels you have joined, and your direct messages. An open channel you have not joined is not searched, so if a search comes back empty, joining the channel and searching again is worth trying.',
          'Archived channels are still searched. Their history does not go anywhere when they close.',
        ],
        shortcuts: ['search'],
        path: '/search',
        keywords: ['search', 'find', 'lookup'],
      },
      {
        id: 'search-modifiers',
        title: 'Narrowing a search',
        blurb:
          'from:@name, in:#channel, has:link, has:file, before:2026-01-31 and after:2026-01-01 — the rest of what you type is the text to match.',
        body: [
          'Modifiers combine: “from:@ana in:#eng has:link deploy” finds Ana’s links in #eng about a deploy. Anything that is not one of these is treated as words to search for, so a colon in the middle of a sentence is harmless.',
          'after: excludes the day you name and before: excludes it too, which is Slack’s behaviour — “after:2026-01-01” means from the 2nd onward.',
          'A modifier that is wrong is refused rather than ignored: has:files and before:yesterday both answer with what to write instead. A search that silently dropped half of what you asked for would look like it had filtered when it had not.',
          'Those five are the whole vocabulary — there is no is:saved, no has:image, no to: and no way to scope to a direct message. And modifiers alone find nothing: “in:#eng has:file” with no words after it returns an empty list, because search matches text and there is none to match.',
        ],
        keywords: ['modifier', 'from', 'in', 'has', 'before', 'after', 'filter', 'operator'],
      },
    ],
  },

  {
    id: 'commands',
    title: 'Slash commands',
    intro:
      'Typed into the message box, starting with a slash. This list is the one your server answered with, including anything the apps installed here have added.',
    generated: 'commands',
    topics: [
      {
        id: 'commands-how',
        title: 'How commands work',
        blurb:
          'Type / in the message box and a list appears; keep typing to narrow it, and press Tab or Enter to pick one.',
        body: [
          'Most commands answer only you — a note that appears in the conversation, that nobody else sees and that is gone on reload. A few of them post a real message instead, and those say so in their description.',
          'Most of them need membership of the channel you are in, and a channel that is not archived. /archive needs more than that: it is an admin’s, the same as the menu row, because archiving cannot be undone.',
        ],
        commands: ['help', 'shrug', 'me'],
        keywords: ['slash', 'command', '/'],
      },
      {
        id: 'commands-people',
        title: 'Commands that name people',
        blurb: '/invite, /remove and /dm read the @names at the start of what you typed.',
        body: [
          'Only the leading run of names counts as a list of people. “/dm @Ana what did @Bob mean?” opens a message with Ana and sends the rest as text — Bob is talked about, not messaged. Everything after the first word that is not a name is the message.',
          'A group DM holds up to eight people. /remove takes somebody out of the channel you are in, which is not the same as them leaving: they can rejoin an open channel themselves.',
        ],
        commands: ['invite', 'remove', 'dm'],
        keywords: ['invite', 'remove', 'dm', 'group'],
      },
      {
        id: 'commands-channel',
        title: 'Commands that change the channel',
        blurb: '/topic, /rename, /archive, /join, /leave, /who and /mute.',
        body: [
          'Archiving is the one to be careful with. An archived channel becomes read-only for everybody, it leaves the sidebar, and anything scheduled into it stops going out and says why. Its history stays searchable and readable — archiving is not deleting.',
          'There is no undo. Nothing in the app brings an archived channel back, so treat it as a decision rather than as tidying up. Direct messages cannot be archived at all.',
          '/mute toggles this channel between notifying you about everything and notifying you only about mentions.',
        ],
        commands: ['topic', 'rename', 'archive', 'join', 'leave', 'who', 'mute'],
        keywords: ['topic', 'rename', 'archive', 'join', 'leave', 'who', 'mute'],
      },
      {
        id: 'commands-you',
        title: 'Commands about you',
        blurb: '/status sets what people see beside your name, /away toggles it, /remind writes yourself a note.',
        body: [
          '“/status :coffee: back in ten” sets both the emoji and the text; /status on its own clears them. A status set from the profile page can also be given a time to clear itself.',
        ],
        commands: ['status', 'away', 'remind'],
        keywords: ['status', 'away', 'remind', 'presence'],
      },
    ],
  },

  {
    id: 'scheduling',
    title: 'Sending later, and repeating',
    intro: 'A message written now and delivered when it should be.',
    topics: [
      {
        id: 'schedule-a-message',
        title: 'Scheduling a message',
        blurb:
          'The clock beside the message box — “Send later” — offers In an hour, This evening, Tomorrow at 9:00, Monday at 9:00, or a time you pick.',
        body: [
          'Writing at midnight and arriving at nine is politeness, not deceit — the message says when it was sent, and everybody can see it was scheduled. Scheduled ones wait on your Scheduled list, where you can change your mind before they go.',
          'A channel that is archived before the message goes out will not take it: the send stops, and the reason appears on the Scheduled list rather than the message quietly never arriving.',
          'A message with a file attached cannot be scheduled — the clock is disabled and says so. An attachment can be deleted between now and then, which would leave a message scheduled around a file that no longer exists.',
          'The only edit is cancelling. You cannot change the time, change the words, or send it now: take it back and schedule it again. The furthest ahead is a year, and the nearest is about a minute.',
        ],
        path: '/scheduled',
        keywords: ['schedule', 'later', 'send later', 'timing', 'delay'],
      },
      {
        id: 'repeating',
        title: 'Repeating it',
        blurb: 'Every day, Every weekday or Every week, chosen in the same menu.',
        body: [
          'A repeat is rebuilt from the wall clock in your time zone each time it goes, so a standup at 9:00 stays at 9:00 across daylight saving rather than drifting to 8:00 for half the year.',
          'A worker that was down does not wake up owing you a week of standups: missed occurrences are skipped and the next one is the next real slot ahead. Cancelling on the Scheduled list stops the whole series.',
          'Those three rules are the whole list — there is no monthly, no every-other-week, no “Monday and Thursday”, and no end date. The clock a repeat keeps is your account’s, set under Time zone in Preferences.',
        ],
        path: '/scheduled',
        keywords: ['repeat', 'recurring', 'daily', 'weekly', 'standup', 'every'],
      },
      {
        id: 'reminders',
        title: 'Reminding yourself',
        blurb: '/remind me to water the plants tomorrow at 9 — a note that arrives in your own messages.',
        body: [
          'It reads durations (“in 20 minutes”, “in 2 hours”), clock times (“at 5pm”, “18:30”), days (“tomorrow”, “Monday”) and repeats (“every weekday at 9am”). A time it cannot read is answered with the shapes it does understand rather than with a guess. It has to be typed in a channel: the thread reply box does not read commands at all, and a slash there is just a slash.',
          'Reminders are ordinary scheduled messages to yourself, which is why they show on the Scheduled list with the same Cancel button as everything else — and it is also why they arrive quietly. Blob never notifies you about your own message, so the note appears in your own conversation without a ping. When you want to be interrupted, “Remind me…” on a message is the one that comes back at you.',
          'Times are read in your account’s time zone, which is under Time zone in Preferences — it shows the clock in whatever zone is set, so a wrong one is visible at a glance. Set it before you trust “tomorrow at 9”.',
        ],
        commands: ['remind'],
        path: '/scheduled',
        keywords: ['remind', 'reminder', 'note', 'later', 'todo'],
      },
    ],
  },

  {
    id: 'notifications',
    title: 'Notifications and unread',
    intro: 'What reaches you, when, and how to get through what you missed.',
    topics: [
      {
        id: 'what-notifies',
        title: 'What notifies you',
        blurb:
          'Direct messages and mentions by default, plus anything in a channel you have set to Every message.',
        body: [
          'In order: a direct message always notifies. Then being mentioned by name, then being named through a group you are in, then @here and @channel, then one of your keywords, then a reply in a thread you are in, and last anything at all in a channel set to Every message.',
          'Muting is absolute. A channel set to Nothing does not notify you even when somebody says your name in it — that is what makes it a mute rather than a preference. It still collects unread messages and still shows them in the sidebar, so nothing is hidden; it just never interrupts.',
          'The number beside a conversation counts mentions, not messages, so a busy channel does not look urgent for being busy.',
          'Everything happens in the app or through a device notification. Blob never emails you about a message or a mention — the only mail it ever sends is an invitation or a password reset — and it plays no sounds.',
        ],
        path: '/workspace/notifications',
        keywords: ['notify', 'notification', 'unread', 'badge', 'mention', 'count'],
      },
      {
        id: 'push',
        title: 'Notifications on this device',
        blurb: 'Turn on “Push notifications on this device” to be told when the tab is closed.',
        body: [
          'Permission is per browser and per device, so each one you use has to be turned on separately.',
          'On an iPhone or iPad the browser only allows this once the app has been added to the Home Screen — the Notifications page says so where it matters.',
          'It also needs the person running this server to have set push keys up. Where nobody has, there is no switch to turn on and the page says why instead of failing quietly.',
        ],
        path: '/workspace/notifications',
        keywords: ['push', 'desktop', 'mobile', 'iphone', 'ios', 'device', 'alert'],
      },
      {
        id: 'keywords-and-groups',
        title: 'Keywords and group mentions',
        blurb:
          'Be notified when a word you care about is written, and silence a group you are in.',
        body: [
          'Keyword alerts notify you when a message contains a word you have listed, in any channel you are in — the way people watch for a product name or their own surname. Up to thirty words, matched whole (so “ops” does not fire on “developops”) and never inside code.',
          'Silencing a group means @-mentions of it stop counting as mentions of you. It is yours alone; nobody is told, and the group is unchanged for everyone else.',
        ],
        path: '/workspace/notifications',
        keywords: ['keyword', 'alert', 'group', 'mute group', 'highlight'],
      },
      {
        id: 'quiet-hours',
        title: 'Quiet hours and pausing',
        blurb: 'Choose the hours that may notify you, or pause everything for 30 minutes to a day.',
        body: [
          'Quiet hours stop the interruption, not the message: a conversation still goes bold, so nothing is hidden from you. The numbered mention badge is the exception — a mention that arrives while you are paused or outside your hours is not counted into it, so the badge tells you about the mentions you were available for.',
          'Pause is the short version: 30 minutes, 1 hour, 2 hours, or until tomorrow (a flat sixteen hours), with Resume to end it early. A reminder due while you are paused is held rather than lost.',
          'The hours are read in your account’s time zone, which is set under Time zone in Preferences. Check it first: an account that has never been told keeps UTC, and “22:00 to 07:00” would then mean UTC.',
        ],
        path: '/workspace/notifications',
        keywords: ['quiet', 'do not disturb', 'dnd', 'pause', 'snooze', 'hours'],
      },
      {
        id: 'catching-up',
        title: 'Catching up',
        blurb:
          '“Catch me up” reads what you have not read and summarises it, per channel or across everything.',
        body: [
          'It is in the jump box and at the top of a conversation. Each summary has “Mark as read” beside it, so catching up and clearing up are one gesture rather than two. This one is a real model, and it needs the server to have one configured — where none is, the panel says so rather than inventing a summary.',
          'Marking everything read is a single keystroke when you are past caring about the backlog.',
        ],
        shortcuts: ['read-all', 'palette'],
        keywords: ['catch up', 'summary', 'unread', 'backlog', 'mark read'],
      },
    ],
  },

  {
    id: 'you',
    title: 'Your account',
    intro: 'Who you are here, how the app looks, and where you are signed in.',
    topics: [
      {
        id: 'profile',
        title: 'Your profile',
        blurb: 'A photo, a display name, and a title — what everyone else sees beside your messages.',
        body: [
          'The display name is the one thing worth setting on the first day: it is what appears on every message you write and what people type when they mention you.',
        ],
        path: '/profile',
        keywords: ['name', 'avatar', 'photo', 'picture', 'title', 'job'],
      },
      {
        id: 'status',
        title: 'Your status',
        blurb: 'An emoji and a line of text, optionally clearing itself after a while.',
        body: [
          'Set it on your profile page or with /status. The clear-after choices are Don’t clear, 30 minutes, 1 hour, 4 hours, Today and This week — which is how “in a meeting” stops being a lie by the afternoon.',
          'The status emoji box has no picker — type or paste the character itself. A :shortcode: is stored and shown as you typed it there, even though the same code becomes a picture in a message.',
          '/away is separate and simpler: it toggles whether you show as away, without touching what your status says.',
        ],
        commands: ['status', 'away'],
        path: '/profile',
        keywords: ['status', 'emoji', 'away', 'busy', 'vacation'],
      },
      {
        id: 'appearance',
        title: 'Theme and density',
        blurb: 'System, Light or Dark, a palette for each, and three text densities.',
        body: [
          'System follows whatever your computer is set to, including switching at sunset if that is what it does.',
          'Under it are two galleries — one for light, one for dark — with a dozen palettes between them: Paper, Linen, Harbour, Sage, Blossom, High contrast; Midnight, Slate, Plum, Forest, Carbon, Ember. Each tile is drawn in its own colours, so you are choosing a look rather than a name. Both are yours: picking one changes nothing on anyone else’s screen, and an admin can add more.',
          'Animation follows your operating system’s “reduce motion” setting and has no switch of its own here. Text size has no setting either — browser zoom is the lever.',
        ],
        path: '/workspace/preferences',
        keywords: ['theme', 'dark mode', 'light', 'density', 'compact', 'appearance', 'palette'],
      },
      {
        id: 'language',
        title: 'Language and input',
        blurb:
          'A preferred language, automatic translation of what arrives, and whether Enter sends.',
        path: '/workspace/preferences',
        keywords: ['language', 'translate', 'enter', 'input'],
      },
      {
        id: 'sessions',
        title: 'Where you’re signed in',
        blurb: 'Every browser holding a session for this account, with the device and the last time it was used.',
        body: [
          'Sign one out from here if you do not recognise it, or if you left yourself signed in somewhere you no longer have. Sign out under Account ends the one you are using now.',
        ],
        path: '/workspace/preferences',
        keywords: ['sessions', 'devices', 'sign out', 'logout', 'security'],
      },
    ],
  },

  {
    id: 'agents',
    title: 'Agents and apps',
    intro:
      'An agent joins this workspace as a member with a name, a permission set and messages of its own — not as a panel bolted on beside the conversation.',
    topics: [
      {
        id: 'talking-to-an-agent',
        title: 'Asking an agent for something',
        blurb: 'Mention it in a channel, or open a direct message with it, exactly as you would with a person.',
        body: [
          'An agent is a real member here: it has an avatar, it can be mentioned, it can be in a channel, and its replies are ordinary messages that thread, search and get reacted to like anyone else’s.',
          'What it may see is what its channels contain. Adding an agent to a channel is the same decision as adding a person to one.',
        ],
        keywords: ['agent', 'bot', 'ai', 'mention', 'ask'],
      },
      {
        id: 'watching-a-run',
        title: 'Watching it work',
        blurb:
          'A card under your message shows the plan, the step it is on and what it is doing, with a Stop button while it runs.',
        body: [
          'The alternative — a spinner and two minutes of silence — is why the card exists. If a run is going somewhere you did not intend, Stop ends it.',
        ],
        keywords: ['run', 'progress', 'stop', 'plan', 'steps', 'working'],
      },
      {
        id: 'tasks',
        title: 'Tasks',
        blurb: 'What agents and teammates have queued up, filtered to Mine or All.',
        body: [
          'Action items pulled out of a thread land here, and so does anything an agent has been asked to do. Each one can be assigned to a person or to an agent.',
        ],
        path: '/tasks',
        keywords: ['task', 'todo', 'assign', 'queue', 'action item'],
      },
      {
        id: 'agent-terminal',
        title: 'A terminal in an agent',
        blurb: '/cli in a direct message with an agent opens a terminal panel beside the conversation.',
        body: [
          'Admins only, and only in a conversation with an agent — typed anywhere else the command is not even offered, because a command that autocompletes and then refuses teaches people the feature is broken rather than that it is not for here.',
        ],
        audience: 'admins',
        commands: ['cli'],
        keywords: ['terminal', 'cli', 'shell', 'console', 'debug'],
      },
      {
        id: 'apps',
        title: 'What an app can do here',
        blurb:
          'Post messages, add slash commands, put buttons on a message, and receive what happens in the channels it is in.',
        body: [
          'An app is never told who is present or who is typing. That is a deliberate limit rather than an omission: an integration does not need to watch the room to do its job.',
          'A command an app adds appears in the same list as the built-in ones, and disappears the moment the app is switched off.',
        ],
        keywords: ['app', 'integration', 'plugin', 'webhook', 'buttons', 'blocks'],
      },
    ],
  },

  {
    id: 'keyboard',
    title: 'Keyboard shortcuts',
    intro:
      'Every binding the app has, taken from the app itself. The same list opens in a dialog over whatever you are doing.',
    generated: 'shortcuts',
    topics: [
      {
        id: 'shortcuts-note',
        title: 'Where they work',
        blurb:
          'Anything with a modifier works while you are typing; the bare keys wait until the message box does not have focus.',
        body: [
          'That distinction is deliberate: a bare letter that stole a keystroke mid-sentence would be a bug rather than a shortcut. The up arrow is the one exception, and only from an empty message box, where there is nothing to move the cursor through.',
          'Escape closes whatever is on top — a menu, a dialog, the thread panel — one layer at a time, rather than everything at once.',
        ],
        shortcuts: ['help', 'close', 'read-all'],
        keywords: ['keyboard', 'shortcut', 'keys', 'hotkey'],
      },
    ],
  },

  {
    id: 'workspace-admin',
    title: 'Running the workspace',
    intro: 'What this workspace is like, who is in it and what is installed — one page, at /workspace.',
    audience: 'admins',
    topics: [
      {
        id: 'admin-general',
        title: 'Name, appearance and emoji',
        blurb: 'What the workspace is called, the colours everyone here sees, and its own emoji.',
        body: [
          'A workspace theme is a palette everybody gets; each person still chooses light, dark or system, and which palette each mode uses.',
        ],
        audience: 'admins',
        path: '/workspace/general',
        keywords: ['workspace', 'name', 'theme', 'palette', 'emoji', 'branding'],
      },
      {
        id: 'admin-people',
        title: 'Members, groups and invitations',
        blurb:
          'Everyone here and what they can do; teams that can be mentioned as one name; who has been invited and not yet arrived.',
        body: [
          'A user group is mentionable — @platform-team reaches everyone in it, and anybody in it can silence that for themselves without changing it for the rest.',
        ],
        audience: 'admins',
        path: '/workspace/members',
        keywords: ['members', 'people', 'roles', 'groups', 'invite', 'invitation'],
      },
      {
        id: 'admin-channels',
        title: 'Channels and apps',
        blurb:
          'Every channel here — including the private ones you are not in — plus the apps and agents installed, and incoming webhooks.',
        body: [
          'Seeing that a private channel exists is part of running a workspace; reading it is not, and this page does not offer that.',
        ],
        audience: 'admins',
        path: '/workspace/channels',
        keywords: ['channels', 'apps', 'agents', 'webhooks', 'install'],
      },
    ],
  },

  {
    id: 'server-admin',
    title: 'Running the server',
    intro:
      'One level up from a workspace: every account, every workspace, and whether the machine is healthy. At /admin.',
    audience: 'owner',
    topics: [
      {
        id: 'server-accounts',
        title: 'Accounts, workspaces and app policy',
        blurb:
          'Every account on this server and where it belongs, every workspace, and what each workspace may do to this machine.',
        audience: 'owner',
        path: '/admin/users',
        keywords: ['accounts', 'users', 'workspaces', 'policy', 'limits', 'instance'],
      },
      {
        id: 'server-health',
        title: 'Health, audit and logs',
        blurb:
          'Whether the parts the server runs on are answering, who did what and from where, and what has gone wrong recently.',
        body: [
          'Feedback filed from inside the app arrives here too, with the console output and the page state that was captured when it was written.',
        ],
        audience: 'owner',
        path: '/admin/health',
        keywords: ['health', 'audit', 'logs', 'errors', 'monitoring', 'feedback'],
      },
    ],
  },

  {
    id: 'privacy',
    title: 'Privacy and what happens when things break',
    intro: 'What Blob does not record, and how it behaves when part of it is unavailable.',
    topics: [
      {
        id: 'not-collected',
        title: 'What nobody can see',
        blurb: 'There are no read receipts, and apps are never told who is present or typing.',
        body: [
          'Nothing tells anyone whether you have read a message. Saving a message for later, marking one unread and setting a reminder are all yours alone — none of them is visible to the author or to anybody else.',
          'A private channel you are not in does not appear anywhere, and asking for it directly is answered as though it does not exist rather than as though you are not allowed. That the channel exists is itself the private part.',
        ],
        keywords: ['privacy', 'read receipt', 'seen', 'typing', 'presence', 'private'],
      },
      {
        id: 'offline',
        title: 'When your connection drops',
        blurb: 'You keep writing; the messages queue and go out when it comes back.',
        body: [
          'A banner at the top of the conversation says what is happening and how many messages are waiting. On reconnecting, the app asks the server what it missed rather than assuming the gap was empty, so nothing arrives out of order and nothing is skipped.',
          'The live connection only delivers. Every message you send is an ordinary request, so losing the connection costs you live updates and never data.',
          'Plain messages are the part that queues. A reaction, an edit, a deletion, a file upload or a slash command attempted while you are offline fails and has to be repeated — they are not held for later.',
        ],
        keywords: ['offline', 'reconnect', 'connection', 'queue', 'outbox', 'sync'],
      },
      {
        id: 'degrading',
        title: 'When one part is down',
        blurb: 'A broken piece breaks that piece only.',
        body: [
          'A mail server that is not answering, an app that has stopped responding, a link that will not preview — each of those degrades exactly one thing. None of them stops the workspace, and none of them stops a message being sent.',
        ],
        keywords: ['outage', 'down', 'broken', 'error', 'degraded'],
      },
    ],
  },

  {
    id: 'trouble',
    title: 'When something looks wrong',
    intro: 'How to tell somebody, and what to check first.',
    topics: [
      {
        id: 'feedback',
        title: 'Reporting a bug',
        blurb:
          'The Feedback button in the top bar captures the page as it stands, the browser console, the URL and the window size along with what you write.',
        body: [
          'That is why it is a button in the bar rather than a row buried in a menu: a report is worth most at the moment the thing goes wrong, and by the time you have found a menu the moment has passed.',
        ],
        keywords: ['bug', 'feedback', 'report', 'problem', 'broken'],
      },
      {
        id: 'not-yet',
        title: 'What isn’t here yet',
        blurb:
          'A few things a Slack habit reaches for are not built, and they say so rather than pretending.',
        body: [
          'The Huddle button at the top of a channel is there and disabled: huddles arrive in a later release. Canvases and workflows do not exist at all.',
          'There is no Activity inbox collecting your mentions in one place, and no Unreads screen — stepping through unread conversations with the keyboard is what Blob has instead. Nothing emails you about a message.',
          'In the consoles, the rows marked “Soon” are honest: Moderation, Deliveries, Approvals, Storage and Import / export are named because they are coming, and they do nothing today.',
        ],
        keywords: ['huddle', 'canvas', 'workflow', 'missing', 'coming', 'soon', 'roadmap', 'activity'],
      },
      {
        id: 'stale',
        title: 'The app looks out of date',
        blurb: 'Reload the page — the app is served fresh, and What’s new says which build you have.',
        body: [
          'What’s new names the exact commit this build came from and lists what went into it, which is the honest answer to “is my fix in yet”.',
        ],
        path: '/whats-new',
        keywords: ['reload', 'refresh', 'version', 'old', 'update', 'cache'],
      },
    ],
  },

];

/** Every topic, flattened — for the filter and for the parity test. */
export function allTopics(): Topic[] {
  return SECTIONS.flatMap((section) => section.topics);
}

/** Whether a topic matches what somebody typed into the filter. */
export function topicMatches(topic: Topic, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    topic.title,
    topic.blurb,
    ...(topic.body ?? []),
    ...(topic.steps ?? []),
    ...(topic.keywords ?? []),
    ...(topic.commands ?? []).map((name) => `/${name}`),
  ]
    .join(' ')
    .toLowerCase();
  // Every word, in any order: "mark unread" should find a topic that says "marking a
  // conversation unread" without demanding the phrase back verbatim.
  return q.split(/\s+/).every((word) => haystack.includes(word));
}
