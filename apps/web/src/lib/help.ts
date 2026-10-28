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
type Audience = 'admins' | 'owner';

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
          'The top bar holds the workspace’s mark and name, the Messages, Activity, Files and Channels tabs, the search box, and your avatar at the far right. The avatar is the account menu — this page, your profile, preferences, the server’s settings for admins, and what has shipped recently all hang off it.',
          'The left column lists the channels you are in, starred ones first and the rest alphabetically, then your direct messages. Anything with unread messages is bold; a number beside it counts mentions rather than messages, so a busy channel does not shout at you for conversation you were not part of.',
          'Click the workspace’s mark — the coloured square with its initial, at the far left of the top bar — to fold the left column down to a rail of icons, and again to open it back up. On a narrow screen the same mark opens the column as a drawer, and the thread panel takes the whole width instead of splitting it.',
        ],
        keywords: ['layout', 'sidebar', 'top bar', 'navigation', 'where'],
      },
      {
        id: 'home',
        title: 'Home',
        blurb: 'Where you stand, what needs you, and what the agents are doing — and the place to deal with most of it.',
        body: [
          'Home opens with a sentence saying what is waiting for you, and each part of it takes you to what it counts. Below it you can ask the workspace’s agent anything, and each of the four numbers leads to the things it counts.',
          'A question an agent stopped to ask you is shown in full under Needs a decision, with its choices as buttons, or a line to type in when it wants words. Answering there is the same as answering under the message: your answer is posted in the conversation as your own, and the agent carries on.',
          'Tick a task off under Your tasks and it is marked done. Mark all read clears everything unread at once.',
        ],
        path: '/',
        keywords: ['home', 'dashboard', 'overview', 'decision', 'answer', 'tasks', 'done', 'mark all read'],
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
          'Once a workspace exists you cannot sign yourself up: joining needs an invitation link — or, where the server has single sign-on, your organisation’s account. One address has one password in every workspace it belongs to on this server, and can have passkeys too.',
          'Forgot your password sends a link by email. It works once and expires in an hour, which is short on purpose — a password reset link sitting in an inbox for a week is a spare key under the mat. While you are signed in you can change it under Sign-in & security, which signs out every other device. There is no way to change your email address from the app.',
          'A few things ask you to confirm it’s you first, once your sign-in is more than fifteen minutes old: making a token for an assistant, letting one connect, attaching an agent of your own, changing someone’s role, making them a reset link, and installing an app. Enter your password and it goes ahead; you are not asked again for fifteen minutes.',
          'Being signed in is per browser. Sign-in & security lists every session you hold, so a machine you no longer have can be signed out from one you do.',
        ],
        path: '/settings/security',
        keywords: ['sign in', 'login', 'password', 'forgot', 'reset', 'account', 'change password', 'confirm'],
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
        path: '/admin/invitations',
        keywords: ['invite', 'invitation', 'join', 'new member', 'link'],
      },
      {
        id: 'guests',
        title: 'Guests',
        blurb: 'Somebody from outside — a client, a contractor — in the channels you choose and nowhere else.',
        body: [
          'Invite a guest from Invitations: choose guest, their address, and the channels they may see. They see those channels and the people in them — no other channel, public ones included, and no directory of everyone else.',
          'A guest cannot start channels, add people, browse the channel list, use agents or connect an assistant. They can write to the people they share a channel with, and anyone here can write to them.',
          'The owner can turn a member into a guest from People, or a guest into a member. A member made a guest keeps the channels they were already in, and loses every assistant they had connected.',
        ],
        audience: 'admins',
        path: '/admin/invitations',
        keywords: ['guest', 'guests', 'external', 'client', 'contractor', 'single-channel', 'limited access'],
      },
      {
        id: 'exporting',
        title: 'Taking your data with you',
        blurb: 'Export everything you are in — or, as an admin, the workspace’s public channels.',
        body: [
          'Export your data, under Profile & preferences, makes a zip of every conversation you are in — channels public and private, direct messages and group messages — with their messages, reactions and the list of their files. It is yours alone; nobody else can download it.',
          'An admin’s Export page makes the workspace’s: every public channel, archived ones too, and the people in the workspace with their email addresses. Private channels and direct messages are never in it — each person exports their own.',
          'Both ask you to confirm it is you if your sign-in is more than fifteen minutes old, take a minute or two to build, and are kept for a week. Inside, each .jsonl file holds one JSON object per line, which jq and any script can read; the files themselves are listed, not packed in.',
        ],
        path: '/settings/preferences',
        keywords: ['export', 'download', 'data', 'backup', 'portability', 'leave', 'gdpr', 'archive', 'jsonl'],
      },
      {
        id: 'importing',
        title: 'Bringing your history from Slack',
        blurb: 'An admin imports a Slack workspace’s export: its channels, threads, reactions and files.',
        body: [
          'In Slack, a workspace’s owner or admin exports its data from Workspace settings → Import/Export Data, and downloads the zip Slack emails. In Blob, an admin chooses that zip on the Import page. Nothing is written until they have seen what it holds: how many channels and conversations, who is already here, which channels merge into ones with the same name.',
          'Public channels always come. Private channels and direct messages come only if the admin ticks the box, and only the people who were in each one see it — the admin who imports them is not added. Messages keep their time and their writer, threads their replies, and reactions, pins and files come too; a file that is not copied leaves a line in its message saying why. Nothing in the history notifies anybody, and it counts as read.',
          'People who had a Slack account but none here arrive as names on their messages. An invitation to the address Slack had hands that person their account, with their messages, channels and conversations; nothing else does. The Import page invites them in one go once the history is in.',
        ],
        path: '/admin/import',
        audience: 'admins',
        keywords: ['import', 'slack', 'migrate', 'move', 'history', 'switch', 'zip'],
      },
      {
        id: 'retention',
        title: 'How long messages and files are kept',
        blurb: 'An admin can have old messages and files removed — and put a legal hold on what must stay.',
        body: [
          'Blob keeps everything unless an admin sets a window on the Retention page: messages, files, or both. Every night, an hour after the backup, a sweep removes what is past it. A message goes the way a delete does — its words, reactions, files and preview — and a thread keeps its shape: a first message whose replies are still inside the window stays as “This message was deleted”.',
          'A file window shorter than the message window removes files sooner and keeps the words; the message then says how many files were removed. Tasks and decisions are never removed: a thread that reached a decision leaves the decision behind.',
          'A change waits a day before it counts, so a wrong choice can be put back, and the page says about how much the first sweep would remove before you save. A conversation’s details say how long it keeps things.',
          'A legal hold keeps a conversation, or everything a person wrote and every conversation they are in, past the windows. The people in a held conversation see the hold in its details; a person on hold is told in their settings. A hold does not stop anybody deleting their own messages; it keeps what they deleted.',
          'While a conversation, or the person who wrote a message, is on hold, an edit keeps the words it replaces and a delete keeps the words it takes, and the person editing or deleting is told so. An admin who can read the conversation opens them from the message’s menu, under Earlier versions, and the workspace export carries them. Releasing the hold removes what it kept.',
        ],
        path: '/admin/retention',
        keywords: ['retention', 'delete', 'history', 'legal hold', 'gdpr', 'compliance', 'files', 'old messages', 'purge', 'edit history', 'versions', 'edited'],
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
        path: '/settings/preferences',
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
          'A code block shows the language it was fenced with — ```sql gives it a “sql” label — and a Copy button at its foot takes the whole block, indentation and all. The button shows when you point at the block, and is always there on a touch screen.',
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
          'An admin can keep @channel, @here and @everyone for admins alone, under General in the admin console. Then they are not offered to anybody else, and a message using one says who may.',
        ],
        keywords: ['@', 'mention', 'ping', 'notify', 'here', 'channel', 'group', 'broadcast'],
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
        id: 'polls',
        title: 'Polls',
        blurb: 'Ask the room to choose: press the poll button under the message box, write the question and two to ten answers.',
        body: [
          'A poll is a message: its question is what everyone reads, finds in search and gets notified about, and the answers sit under it. Press an answer to choose it, press it again to take your choice back, or press another to change it. When the poll allows several answers, each press adds or removes one.',
          'Who chose what is shown the way reactions are — hover an answer to see the names. An anonymous poll shows only the counts, to everyone including whoever asked it, and that cannot be changed once it is sent. Whoever asked a poll, or an admin, can close it; a closed poll keeps its result and takes no more answers. A poll’s question can’t be edited once it is asked.',
        ],
        keywords: ['poll', 'vote', 'survey', 'choose', 'question', 'anonymous', 'multiple choice'],
      },
      {
        id: 'files',
        title: 'Files and images',
        blurb: 'Attach up to ten files to a message, each under 100 MB.',
        body: [
          'The paperclip beside the composer attaches a file, and so does dropping one anywhere on the conversation — the messages, not only the box you type in. Dropped on an open thread, it goes into your reply instead. Nothing is sent until you send it. Both limits are enforced on the server as well as in the browser, so a file refused here would have been refused there too.',
          'Anything executable is refused by extension — .exe, .msi, .bat, .cmd, .com, .scr, .ps1, .sh, .app and .jar — and so are .svg and .html, which are executable in a browser even though they do not look it.',
          'Several pictures sent together sit as tiles of one size; click any of them to see it whole. A link gets a preview with the site’s name and picture — a copy Blob made when the message was sent, so the conversation never asks that site for anything, and it never learns who read it.',
          'An image is shown in the conversation as a small copy made when you upload it, so a large photo is not a large download for everyone who scrolls past. Clicking it opens the original full size in place — Escape closes it, and Download keeps it. A photo taken sideways is turned upright, and the copy the channel sees carries none of the camera data. The original keeps its camera data with one exception: where it was taken. A phone writes its position into every photo, and Download hands the original to everyone in the room, so that position is removed from a JPEG when you upload it — nothing else about the file changes, not one pixel. Anything that is not an image opens in a new tab as before.',
        ],
        keywords: ['upload', 'attach', 'image', 'photo', 'document', 'size'],
      },
      {
        id: 'voice-messages',
        title: 'Voice messages',
        blurb: 'Record up to five minutes from the composer, and send it like a file.',
        body: [
          'The microphone beside the paperclip starts recording. While it records, the composer shows how long you have been talking and how loud; the tick keeps the recording and the cross throws it away. A kept recording waits above the message field like an attached file, and nothing is sent until you send it. At five minutes recording stops on its own and keeps what you said.',
          'A voice message plays where it was sent. Its bars are the shape of the recording, so you can see where the talking is before you press play: click anywhere on them to jump there, or use the arrow keys to move five seconds at a time.',
          'Where this server has a speech service, the words are written out as the message’s text a moment after it arrives — so search finds them, a notification says them, and an agent you sent it to reads them, answering once they are there. Only a recording sent on its own is written out; send words of your own with it and those are the text. Without a speech service a recording stays a recording, and an agent in your DM is told one came that it could not read.',
          'The first time, your browser asks whether Blob may use the microphone. If you said no, allow it in the browser’s settings for this site and press the microphone again.',
        ],
        keywords: [
          'voice',
          'audio',
          'record',
          'recording',
          'microphone',
          'voice note',
          'transcript',
          'transcription',
          'speech',
        ],
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
          'A reminder here that you did not set is a nudge: in a channel with “Nudge unanswered questions” switched on, a question of yours that went a day without an answer comes back to you this way. The note says so. Nobody else is told.',
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
          'Half a sentence survives switching channels — and devices: start it on your phone, finish it on your laptop.',
        body: [
          'What you type and do not send is kept as a draft, and the sidebar marks the conversation that has one. A thread keeps its own draft apart from the channel it is in.',
          'Drafts follow you: they are saved to the server a moment after you stop typing, so the next device you open has them, and Drafts in the sidebar lists every one. Nobody else can see them. Sending the message — from any device — clears its draft everywhere, and a draft nobody touches for thirty days is forgotten.',
          'What you are typing right now is never replaced by a copy from another device. Signing out clears the drafts kept in that browser.',
        ],
        path: '/drafts',
        keywords: ['draft', 'drafts', 'unsent', 'saved text', 'lost', 'sync', 'other device', 'phone'],
      },
      {
        id: 'unread-line',
        title: 'The line where you left off',
        blurb: 'A “New messages” divider marks where your reading stopped when you open a conversation.',
        body: [
          'The marker only ever moves forward, so a slow update from another tab or another device cannot drag your position backwards. Moving it back is a deliberate act: Mark unread on a message puts the line above it again.',
          'Read a screen or more back from the newest message and a Jump to latest button appears at the foot of the conversation. If people kept talking while you read, it says how many new messages are waiting instead; your own do not count.',
        ],
        keywords: ['unread', 'new messages', 'divider', 'where I left off', 'position', 'jump to latest', 'newest'],
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
        path: '/settings/preferences',
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
          'Follow at the top of the thread panel is the control for both halves: it takes you off a thread you answered once and no longer care about, and it puts you on one you have not replied in at all. Following from scratch starts you at the end — you asked to hear what happens next, not to be handed everything already said.',
          'Threads with replies you have not seen are marked New in the Threads view, and opening one clears the mark. Looking at a thread does not subscribe you to it.',
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
          'It says which of two things wrote it. With a model configured on the server it is an AI summary: the model reads the thread with every message numbered and every speaker named, and each decision, action item and open question it lists points at the message it came from — the arrow beside a line jumps there. When the model cites its sources, a line it could not source is dropped rather than shown; a model that cites nothing keeps its lines, with no arrow beside them. Without a model it is a keyword scan: decisions are sentences that say decided, agreed, approved or we will; action items say todo, please, need to or next step; open questions are the sentences ending in a question mark.',
          'Either way it reads the thread you are looking at and nothing else, and it is an index of a long thread rather than a substitute for reading one. Check the sources before acting on an AI summary; a model is sometimes confidently wrong, and the arrow is there so you do not have to take its word.',
          'Action items can be turned into tasks and assigned. A member can assign a person; handing work to an agent is an admin’s to do.',
        ],
        path: '/tasks',
        keywords: ['summary', 'summarise', 'ai', 'ai summary', 'model', 'sources', 'action items', 'decisions', 'tasks'],
      },
      {
        id: 'decisions',
        title: 'Decisions',
        blurb: 'Record what a conversation settled, and find it again on the Decisions page.',
        body: [
          'When a conversation settles something, record it: choose Record as a decision from a message’s menu, press Record beside a decision in a thread’s summary, or type /decision and what was decided. The message it rests on is marked Decision, and the decision is kept on the Decisions page with where it was made, who decided, and why.',
          'An agent can propose a decision, but only a person makes it one: you are asked first, and it is recorded in your name. A decision that no longer stands can be revoked by whoever recorded it or an admin — it stays on the page, struck through. Decisions in a private channel are seen only by its members.',
        ],
        path: '/decisions',
        commands: ['decision'],
        keywords: ['decision', 'decisions', 'decided', 'log', 'record', 'settled', 'agreed', 'adr'],
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
          '“Channel details” is where the topic, the description and the member list live — add someone by typing their name. Files, beside Pinned at the top of a conversation, shows every picture and file posted there.',
          'Starring pins a channel to the top of your sidebar. It is yours: nobody else’s list changes.',
          'Two things have no button anywhere and are only reachable as commands: renaming a channel is /rename, and taking somebody out of one is /remove. Channel details can add people and not remove them.',
          'Leaving a private channel removes it from your app completely — you cannot find your way back without somebody adding you again. A public one stays in the directory to rejoin.',
        ],
        commands: ['topic', 'rename', 'who', 'invite', 'remove'],
        keywords: ['menu', 'details', 'star', 'members', 'topic', 'leave', 'archive', 'rename'],
      },
      {
        id: 'announcement-channels',
        title: 'Announcement channels',
        blurb: 'A channel where admins post and everybody else replies in threads.',
        body: [
          'An admin sets “Who can post” to Admins only in Channel details. From then on only the workspace’s admins post at the top level; everybody else sees a note at the top of the channel instead of a message box, and replies in a message’s thread — so the channel stays a clean list of announcements with the conversation tucked under each one.',
          'It holds for messages scheduled earlier too: a scheduled message that can no longer be posted says so under Scheduled instead of going out. Agents and apps an admin installed are not held to it.',
        ],
        keywords: ['announcement', 'announcements', 'read-only', 'admins only', 'posting', 'who can post'],
      },
      {
        id: 'sidebar-sections',
        title: 'Sections in your sidebar',
        blurb: 'Group channels and direct messages under names of your own, like “Clients”.',
        body: [
          'Open the ··· menu on any channel or direct message and choose “Move to a section…”. Pick a section you already have, or make a new one by naming it. Your sections sit above Channels, and whatever is in one leaves the list it came from.',
          'Click a section’s name to fold it; folded, it still shows anything unread and the conversation you are in. Its own ··· menu renames or deletes it — deleting puts its conversations back where they were.',
          'Sections are yours, and follow you to every device you sign in on. Nobody else’s sidebar changes.',
        ],
        keywords: ['section', 'sections', 'group', 'folder', 'organise', 'organize', 'sidebar', 'collapse'],
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
      {
        id: 'huddles',
        title: 'Huddles',
        blurb:
          'The Huddle button in a channel or DM header starts a quick call — microphones on, no full screen — that anyone there can join.',
        body: [
          'A huddle lives in the bar at the foot of the channel list, so you can keep reading and writing while you talk. Turn a camera on or share a screen if your admins allow it, and open it full screen when there is something to see.',
          'Leaving takes only you out; the huddle ends itself once everyone has left it. An admin decides on the Calls page whether huddles are allowed here, whether cameras and screens are, and how many people fit in one.',
        ],
        keywords: ['huddle', 'audio', 'voice', 'call', 'talk', 'microphone', 'screen share'],
      },
      {
        id: 'meetups',
        title: 'Video meetups',
        blurb:
          'The Meetup button in the channel header starts a call, full screen, that anyone there can join. For something lighter, start a huddle beside it.',
        body: [
          'Going back to the conversation does not hang up: it puts you back in the channel with a bar at the foot of the channel list, showing who is in the call and letting you return to it full screen or leave.',
          'Leaving takes only you out — the call carries on for whoever is left, and it ends itself once everyone has left it.',
        ],
        keywords: ['meetup', 'video', 'call', 'camera', 'screen', 'join'],
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
        blurb: 'Type what you remember, and choose whether the best match or the latest one comes first.',
        body: [
          'Search covers the conversations you are in and nothing else — channels you have joined, and your direct messages. An open channel you have not joined is not searched, so if a search comes back empty, joining the channel and searching again is worth trying.',
          'Most relevant is the default and ranks by how well a message matches. Most recent ignores that and answers in time order, which is the one you want for “what was said about this lately”. Both page the same way, and the button that loads more keeps the order you chose.',
          'Accents are ignored on both sides, so sta finds šta and šta finds sta — useful when half the team types diacritics and half does not. Word endings are matched the English way: deploys finds deployed.',
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
          'Those five are the whole vocabulary — there is no is:saved, no has:image, no to: and no way to scope to a direct message. Modifiers alone are enough: “from:@ana” lists Ana’s messages, “in:#eng has:file” lists files in #eng. Words after them, if any, are extra narrowing, not a requirement.',
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
          'An admin can reopen one from Manage workspace → Channels, so it is a decision rather than a demolition — but everyone loses the channel from their sidebar in the meantime. Direct messages cannot be archived at all.',
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
        title: 'Reminders',
        blurb: '/remind me to water the plants tomorrow at 9 — or @Ana, or #design — a note that arrives later.',
        body: [
          'It reads durations (“in 20 minutes”, “in 2 hours”), clock times (“at 5pm”, “18:30”), days (“tomorrow”, “Monday”) and repeats (“every weekday at 9am”). A time it cannot read is answered with the shapes it does understand rather than with a guess. It has to be typed in a channel: the thread reply box does not read commands at all, and a slash there is just a slash.',
          'Reminders are ordinary scheduled messages to yourself, which is why they show on the Scheduled list with the same Cancel button as everything else — and it is also why they arrive quietly. Blob never notifies you about your own message, so the note appears in your own conversation without a ping. When you want to be interrupted, “Remind me…” on a message is the one that comes back at you.',
          'Times are read in your account’s time zone, which is under Time zone in Preferences — it shows the clock in whatever zone is set, so a wrong one is visible at a glance. Set it before you trust “tomorrow at 9”.',
          '/remind @Ana to send the deck tomorrow at 9 reminds somebody else: at that time, a message from you arrives in the conversation the two of you have. /remind #design to post the notes every Friday at 4pm posts it in a channel, as you — only one you could post in now. Both are on your Scheduled list, where you can cancel them.',
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
        id: 'activity',
        title: 'Mentions and reactions',
        blurb:
          'Activity, at the top of the sidebar: everybody who named you and everybody who reacted to something you wrote, newest first, with every reaction to one message on one row.',
        body: [
          'A mention used to leave a number beside a channel and nothing you could open; a reaction to your message left nothing at all. Both are here now, with who did it and where, and clicking one takes you to the message.',
          'Only what you can still read: a channel you have left takes its mentions with it, and a deleted message takes its own. Muting a channel keeps somebody naming you directly and drops the @channel ones, which is what muting is for.',
          'Anything that arrived since your last visit is marked New. That mark is remembered in this browser alone — nobody is told when you look.',
        ],
        shortcuts: ['activity'],
        path: '/activity',
        keywords: ['activity', 'mentions', 'reactions', 'notifications', 'unread', 'at me'],
      },
      {
        id: 'unanswered-questions',
        title: 'Questions nobody answered',
        blurb:
          'In a channel that has it switched on, a question of yours that goes a day without an answer comes back to you as a reminder in Later — to you alone.',
        body: [
          'Switch it on per channel, in the channel’s details: “Nudge unanswered questions”. Off by default, because it acts on the room’s conversation and the room decides. Any member who can write there can flip it.',
          'A day after you ask, if nobody has replied in the thread, nobody else has reacted, nobody else has said anything in the channel since and nobody has mentioned you, the question lands in your Later as a reminder — inside your quiet hours it waits for the morning. It happens once per question.',
          'Only you are told. Nothing about who saw the question is ever looked at; Blob has no read receipts to look at. Turn it off for yourself here under Notifications, or mute the channel, which counts as turning it off.',
        ],
        path: '/settings/preferences',
        keywords: ['nudge', 'unanswered', 'question', 'no answer', 'reminder', 'later', 'follow up'],
      },
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
        path: '/settings/preferences',
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
        path: '/settings/preferences',
        keywords: ['push', 'desktop', 'mobile', 'iphone', 'ios', 'device', 'alert'],
      },
      {
        id: 'email-when-away',
        title: 'Email when you’re away',
        blurb: 'What waited for you unread, in one email, when you have no Blob open.',
        body: [
          'When a direct message, a mention of you or of a group you are in, or a reply in a thread you follow arrives while you have no Blob open anywhere, Blob holds on to it. If it is still unread fifteen minutes later — or an hour, if you choose — one email lists everything that waited, each with a link straight to it.',
          'Nothing is emailed that you have already read, that arrived while you had Blob open, or that came from a room you have since left. @channel and keywords are never emailed: they notify you in the app, not in your inbox. Quiet hours and Pause notifications hold emails too, and the email goes when they end if anything is still unread.',
          'Choose every 15 minutes, once an hour or never under Notifications in your settings. Every email also ends with a link that stops them without signing in.',
        ],
        path: '/settings/preferences',
        keywords: ['email', 'mail', 'inbox', 'away', 'offline', 'unsubscribe', 'digest'],
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
        path: '/settings/preferences',
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
        path: '/settings/preferences',
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
        path: '/settings/preferences',
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
        path: '/settings/preferences',
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
        path: '/settings/preferences',
        keywords: ['theme', 'dark mode', 'light', 'density', 'compact', 'appearance', 'palette'],
      },
      {
        id: 'language',
        title: 'Language and input',
        blurb:
          'A preferred language, automatic translation of what arrives, and whether Enter sends.',
        path: '/settings/preferences',
        keywords: ['language', 'translate', 'enter', 'input'],
      },
      {
        id: 'sessions',
        title: 'Where you’re signed in',
        blurb: 'Every browser holding a session for you, in every workspace, with how it signed in and when it was last used.',
        body: [
          'Sign one out from Sign-in & security if you do not recognise it, or if you left yourself signed in somewhere you no longer have. Sign out under Account ends the one you are using now.',
          'Sign out everywhere else ends all of them but this one — in every workspace, because a session in one can switch into the others — and disconnects every assistant you have let in.',
          'Recent activity, on the same page, lists your sign-ins, wrong passwords and password changes from the last 90 days, with the device and address each came from.',
        ],
        path: '/settings/security',
        keywords: ['sessions', 'devices', 'sign out', 'logout', 'security', 'activity', 'history'],
      },
      {
        id: 'passkeys',
        title: 'Passkeys',
        blurb: 'Sign in with your fingerprint, face or device PIN instead of a password.',
        body: [
          'A passkey lives on your phone, your laptop or in your password manager. Only its public half is kept here, so nothing on this server could sign in as you. Add one under Sign-in & security; it works in every workspace you are in on this server.',
          'To sign in with it, pick it from the email field’s suggestions or press Sign in with a passkey — no address or password to type. It also answers Confirm it’s you.',
          'Ask for a passkey after my password makes a password alone not enough to sign in as you. If you lose every device your passkeys were on, an admin can turn that off for you from People; a password reset link does not.',
        ],
        path: '/settings/security',
        keywords: ['passkey', 'passkeys', 'webauthn', 'face id', 'touch id', 'fingerprint', 'security key', 'two-step', '2fa', 'two factor', 'mfa'],
      },
      {
        id: 'single-sign-on',
        title: 'Single sign-on',
        blurb: 'Sign in with the account your organisation gives you — Google, Microsoft, Okta and the like.',
        body: [
          'Where the server’s administrator has connected one, the sign-in page has a Continue with button for it. The first time, it is linked to your account here when the provider has verified your address; if it says it cannot be, sign in another way and link it under Sign-in & security.',
          'A provider can also let new people from your organisation in without an invitation, into a workspace the administrator chose. Signing in this way follows your organisation’s own rules — its two-step sign-in included — rather than this server’s second step.',
          'It also answers Confirm it’s you, in a small window of its own. Unlinking it is refused while it is the only way you have in: set a password or add a passkey first.',
        ],
        path: '/settings/security',
        keywords: ['sso', 'single sign-on', 'oidc', 'openid', 'google', 'microsoft', 'okta', 'entra', 'keycloak', 'organisation', 'company account'],
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
        id: 'whose-agent',
        title: 'Whose agent is it',
        blurb:
          'An agent with no owner is the workspace’s and answers anyone. An agent with an owner answers that person, and whoever they have lent it to.',
        body: [
          'The shared assistant everybody works with is unowned — that is what makes it shared. A personal agent belongs to one member: mentioning it does nothing for anybody else, and the refusal is silent, because saying “that is not your agent” out loud would tell the room whose it is. Its slash commands go the same way — they do not appear in anybody else’s composer, and typing one answers as though the name were free.',
          'Lending it is one command in the channel where you want it to answer: /allow @agent @name, and /disallow to take it back. The grant is per channel, so an agent lent for one project is not lent everywhere. /allow with just the agent lists who can currently command it here.',
          'An admin decides who owns an agent, from Manage workspace → Apps & agents. Handing it back makes it the workspace’s again.',
        ],
        commands: ['allow', 'disallow'],
        keywords: ['owner', 'personal agent', 'my agent', 'allow', 'lend', 'delegate'],
      },
      {
        id: 'my-agent',
        title: 'Connecting your own agent',
        blurb:
          'An agent on your laptop can join the workspace as yours: it dials Blob, answers only you, and goes where you put it.',
        body: [
          'Under Manage workspace → My agents, give it a name and Blob hands you a token and a short command to run next to the agent. It needs no public address — it connects out to Blob and holds the connection, and it shows as connected the moment it does.',
          'It is yours from the start. Mentioning it does nothing for anybody else until you lend it to them with /allow in a channel, and it can only be added to channels you are in. An admin can still see it, budget it or remove it, the same as any app.',
          'Any agent that speaks AG-UI works — the bridge just forwards runs to it. Janus does; so do agents built on LangGraph, Pydantic AI, the Claude Agent SDK and most others.',
        ],
        path: '/settings/my-agents',
        commands: ['allow'],
        keywords: ['my agent', 'personal agent', 'connect', 'laptop', 'desktop', 'bridge', 'token'],
      },
      {
        id: 'work-channels',
        title: 'Starting work from a message',
        blurb:
          'Turn a conversation into a place to build something: a private channel for one job, with the agents you name, and tabs for what they make.',
        body: [
          'From any message’s ••• menu, choose Start work from here. Give the job a title, tick the agents to bring, and Blob spins a private channel that quotes the message and links back to it from its thread. The agents start at once, on your say‑so, exactly as if you had mentioned them.',
          'Beside the conversation the channel has three tabs. Plan shows what the agents are doing right now and what they did. Changes lists every diff an agent (or a person) has published, with a viewer. Preview lists pages and documents — a page runs only when you click Run preview, in a sandbox with no network and no access to the workspace. Publish puts one in by hand.',
          'Published again under the same title, an artifact gets its next version — v2, v3 — and you can step back through them. Under each version, Approve it or Request changes with a note: the note goes into the artifact’s thread and mentions whoever made it, so an agent sets to work on the next version straight away. Discuss opens that thread beside the work.',
          'You can bring the workspace’s agents and your own. Somebody else’s personal agent is not on offer. When the job is finished, Mark done on the Plan tab says what was made and what was approved — in the channel and back where the work started — and archives the channel; its history stays searchable.',
        ],
        keywords: ['work', 'work channel', 'assignment', 'code', 'diff', 'preview', 'artifacts', 'build', 'project', 'review', 'approve', 'version', 'request changes', 'publish'],
      },
      {
        id: 'agents-together',
        title: 'Agents talking to each other',
        blurb:
          'An agent can hand part of a job to another agent by mentioning it, the way you would. It happens inside the request you started, on your authority, and it stops on its own.',
        body: [
          'Ask an agent for something and it may bring in another — “@Planner, can you outline this?” — and that agent answers in the same channel. The card under its reply says who asked it (“asked by Janus”), so a conversation between agents reads as one, not as agents talking to themselves.',
          'Every hop runs on the authority of the person who started it. If you could not have asked an agent yourself — because it is somebody else’s and they have not lent it to you — no agent can ask it on your behalf either. That is what keeps a personal agent personal even when the workspace agent is in the room.',
          'It cannot run away. A request can travel a few hops (four, unless a server administrator sets otherwise), the same agent can be brought in only a few times per request, and the whole exchange has a quarter of an hour. Stop on any card stops everything it started.',
        ],
        keywords: ['agents', 'chain', 'hop', 'delegate', 'hand off', 'together', 'multi-agent'],
      },
      {
        id: 'agent-decisions',
        title: 'When an agent asks you something',
        blurb:
          'An agent that needs a decision posts the question with buttons, or a box to type in. Answer it and the agent carries on from where it stopped.',
        body: [
          'Only the person who started the request can answer — the question is visible to the channel, but the decision is yours. Your answer is posted as your own message, so everybody sees what was decided, and the agent picks up with everything it knew when it stopped.',
          'A question nobody answers within a day expires: the buttons go, the card says so, and the agent does not carry on. Mention it again if you still want the work done.',
          'Admins see every question waiting on somebody, and every agent that said it would come back, under Approvals in the admin console — with what it asks only where they can read the conversation.',
          'A post an agent wants to make is a question of this kind: “Helper wants to post in #general”, with Approve and Deny. That is the default for every agent. An admin can let one post without asking in its own DM with you — where nobody else’s words reach it — or anywhere, from the agent’s page in Agents & apps. Either way it can only post where you and it both can, and from a channel only to that channel or a public one.',
        ],
        keywords: ['decision', 'question', 'approve', 'confirm', 'interrupt', 'resume', 'buttons', 'post'],
      },
      {
        id: 'agent-memory',
        title: 'What an agent remembers',
        blurb:
          'An agent that keeps a plan or a list of open items picks it up again the next time it is mentioned in the same conversation.',
        body: [
          'Agents that speak AG-UI can share their working state with Blob. What an agent knew at the end of a run is handed back to it at the start of its next run in the same channel — or the same thread, which counts as its own conversation. Each agent remembers separately, so two agents in one channel keep their own.',
          'A run that failed or was stopped changes nothing; only a run that finished, or stopped to ask you something, is remembered. Removing an agent forgets everything it remembered.',
        ],
        keywords: ['memory', 'remember', 'state', 'context', 'continue', 'pick up'],
      },
      {
        id: 'agent-on-a-schedule',
        title: 'Asking an agent on a schedule',
        blurb:
          'Schedule a message that mentions an agent and it runs when the message sends — every weekday at 9:00 if you like.',
        body: [
          'Write “@Janus post what changed in #ops yesterday”, choose Schedule instead of Send, and pick a time and a repeat. When the message goes out the agent answers as if you had just typed it, on your authority, in that channel. Cancel the schedule under Scheduled to stop it.',
          'The same limits apply as to any mention: the agent has to be in the channel, and if it is somebody else’s they have to have lent it to you.',
        ],
        path: '/scheduled',
        keywords: ['schedule', 'recurring', 'daily', 'standup', 'digest', 'cron', 'every morning', 'proactive'],
      },
      {
        id: 'agent-comes-back',
        title: 'When an agent says it will come back',
        blurb:
          'An agent waiting on something it cannot know yet — a deploy, an answer due tomorrow — can come back to the conversation by itself, at a time it sets.',
        body: [
          'Ask “tell me when the deploy is out” and an agent with Blob’s tools may answer that it will look again at four. Its card then says “coming back” with the time and what for, and at that time it carries on in the same place, on your behalf, with everything said since in front of it.',
          'It is your request still, so the same rules hold when it comes back: if you have left the conversation, no longer have that agent, or agents have been turned off, it does not come back, and its card says why. Stop on the card calls it off. An agent can set a time up to two weeks ahead, and one conversation comes back at most five times.',
        ],
        keywords: ['follow up', 'come back', 'later', 'check back', 'remind', 'wait', 'proactive', 'deploy'],
      },
      {
        id: 'connect-your-assistant',
        title: 'Reading Blob from your own assistant',
        blurb:
          'Add Blob to Claude, ChatGPT or Claude Code as a connector, and it can read the channels you can read — and post as you if you let it.',
        body: [
          'This is the other direction from an agent in a channel. Here the assistant stays where it is and reaches into Blob: ask it “what did I miss in #ops?” or “find the thread about the deploy” and it looks for itself, in the app you were already in.',
          'Settings → Assistants shows the connector address. Give it to Claude or ChatGPT as a custom connector, or to Claude Code with the line shown there: the assistant sends you to Blob, Blob asks whether to connect it, and once you say yes it appears under Connected apps. The page tells you which website confirms the app is what it says, and where your answer goes — check both before you say yes.',
          'It connects as you, not as a bot with its own membership. Whatever you can see it can see, a private channel you are not in stays invisible to it, and the moment you leave a channel it loses that channel too. Posting is a separate tick, off unless you turn it on — a message it sends looks exactly like one you typed, because as far as everybody else is concerned, it is.',
          'A tool that cannot sign in — an editor, a script — takes a token instead, made on the same page and shown once. Disconnect an app or revoke a token there whenever you like, and it stops at once.',
        ],
        path: '/settings/assistants',
        keywords: ['mcp', 'claude', 'claude code', 'assistant', 'model context protocol', 'token', 'connect', 'connector', 'oauth', 'sign in', 'editor', 'cursor', 'chatgpt'],
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
        id: 'agents-page',
        title: 'Agents',
        blurb: 'Every agent you can ask, what each one does, and what it is doing right now.',
        body: [
          'Open it from the button beside the Agents heading in the sidebar, or from ⌘K. Each row is one agent you can set going: the workspace’s, your own, or one somebody lent you. Somebody else’s own agent is not listed, because it would not answer you.',
          'Under each name is what the agent says it does, and where it stands: working in a channel, waiting for your answer to a question it asked, or when it last ran. That line is read from its runs, which is why it is honest — Blob shows no presence for apps, so an agent is never “online” here, only busy or not.',
          'Message opens your direct message with it. Runs shows what it has done that you can see. Settings appears for your own agents, and for an admin on the workspace’s.',
        ],
        path: '/agents',
        keywords: ['agents', 'agent', 'bots', 'directory', 'who can i ask', 'status', 'working', 'ai'],
      },
      {
        id: 'agent-follows',
        title: 'An agent that follows a channel',
        blurb: 'An agent an admin set following a channel hears what people post there, not only what mentions it — every message, only files, or only the questions nobody answered.',
        body: [
          'Normally an agent answers only when it is mentioned, in its DM, or handed a task. An admin can let one follow a channel it is in, from its page in Agents & apps. It then hears what people post there, told it was not mentioned, and speaks up only when it has something to add — the rest of the time it says nothing at all.',
          'The admin also chooses what it hears: every message, only messages with files, or only questions nobody has answered for half an hour, an hour, four hours or a day. A question like that reaches it a few minutes after its time is up, and its answer goes in the question’s thread. A question somebody answered first is left alone.',
          'It works for the person whose message it heard, and sees no further than you could in that channel. It can look things up, but it cannot post anywhere else or ask another agent. While it thinks, the channel sees nothing — no card, no typing — and it hears at most one message every couple of minutes. A message that mentions it still gets an ordinary answer.',
        ],
        audience: 'admins',
        keywords: ['follow', 'follows', 'ambient', 'listen', 'unprompted', 'without mention', 'watch channel', 'unanswered', 'questions', 'files'],
      },
      {
        id: 'mcp-servers',
        title: 'Tools from outside Blob',
        blurb:
          'An admin can connect an MCP server — GitHub, a docs search, a company’s own — and let chosen agents use its tools.',
        body: [
          'An admin connects the server on the MCP servers page and switches it on for the agents that should have it. Its tools then join the agent’s own: anyone who can ask that agent can have it look something up there, or open an issue, with the credential the admin gave Blob rather than their own.',
          'Each tool runs at once or waits for you, as the admin chose. When one waits, you see the tool, the server and exactly what the agent would send, with Approve and Deny, under your message and on Home. Nothing leaves Blob until you approve it, and the card under your message names the server each call went to.',
        ],
        keywords: ['mcp', 'tools', 'connectors', 'integrations', 'github', 'outside', 'approve', 'server'],
      },
      {
        id: 'usage',
        title: 'What agents cost',
        blurb:
          'The Usage page shows each agent’s runs and tokens, whose requests they answered, and what Blob’s own summaries used — priced, if you set prices.',
        body: [
          'Tokens are what each agent reports at the end of a run, and what the model provider reports for Blob’s own catch-ups and summaries. An agent that reports nothing counts nothing — that is a fact about its report, not its cost.',
          'Blob ships no prices, because providers change them and a contract is not the list price. Enter a currency and what each model costs per million input and output tokens, and every row gains a cost; a row with a model you have not priced says so instead of reading as cheaper than it was.',
          'An agent’s budget, on its page in Agents & apps, can cap the tokens it reports in a day as well as its runs and minutes. The run that crosses the cap finishes; the next mention is refused in the channel, where it happened. Owners see what their own agents spent in Settings → My agents.',
        ],
        path: '/admin/usage',
        audience: 'admins',
        keywords: ['usage', 'cost', 'tokens', 'spend', 'budget', 'billing', 'price', 'money', 'cap'],
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
    title: 'Running this server',
    intro: 'What this server is like, who is in it and what is installed — one page, at /admin.',
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
        path: '/admin/general',
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
        path: '/admin/members',
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
        path: '/admin/channels',
        keywords: ['channels', 'apps', 'agents', 'webhooks', 'install'],
      },
    ],
  },

  {
    id: 'server-admin',
    title: 'Running the server',
    intro:
      'One level up from a workspace: every account, how people sign in, what may be installed, and whether the machine is healthy. At /server, for whoever administers it.',
    audience: 'owner',
    topics: [
      {
        id: 'server-accounts',
        title: 'Accounts, workspaces and app policy',
        blurb:
          'Every account on this server and where it belongs, every workspace, and what each workspace may do to this machine.',
        audience: 'owner',
        path: '/server/users',
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
        path: '/server/health',
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
          'Canvases and workflows do not exist at all.',
          'There is no Unreads screen — stepping through unread conversations with the keyboard is what Blob has instead. Blob emails you what waited for you while you were away, and sends no daily summary.',
          'The server console lists only pages that exist. Moderation and Storage are not built, and have no row there until they are.',
        ],
        keywords: ['canvas', 'workflow', 'missing', 'coming', 'soon', 'roadmap'],
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
