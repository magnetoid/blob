/** What has shipped, in the words of somebody using it.
 *
 * Shipped *with the build* rather than stored in a table, and that is the whole design
 * decision. Blob deploys continuously from main, so the bundle a person is running is
 * the release — notes compiled into it can never describe a version they are not looking
 * at. A `releases` table would drift the moment somebody wrote an entry before the deploy
 * finished, or after a rollback, and it would drift silently.
 *
 * Identified by date, not by a version number. Every package here still says 0.1.0 and
 * there has never been a tagged release, so numbering these 0.2 through 0.5 after the
 * fact would be inventing a history that did not happen. A date is true and is also what
 * somebody actually wants to know: is this newer than the last time I looked.
 *
 * To add one: put a new object at the top of `RELEASES` with today's date. The date is
 * the identity, so it has to be unique and it has to sort — both hold for ISO dates.
 * Entries are user-facing. "Fixed the N+1 in the unread query" belongs in a commit
 * message; "channels stop flickering when you switch quickly" belongs here.
 */

export type EntryKind = 'added' | 'fixed' | 'changed';

export interface ChangelogEntry {
  kind: EntryKind;
  text: string;
}

export interface Release {
  /** ISO date. The identity, and what "newer than what I have seen" compares. */
  date: string;
  /** One line naming the theme, so the list can be skimmed. */
  title: string;
  entries: ChangelogEntry[];
}

export const RELEASES: readonly Release[] = [
  {
    date: '2026-09-05',
    title: 'Agents that work together',
    entries: [
      {
        kind: 'added',
        text: 'Agents can talk to each other. Ask one for something and it may bring in another by mentioning it, the way you would; the card under the reply says who asked. Until now only a person\'s message could start an agent, which stopped runaway conversations by stopping every conversation. A request can now travel a few hops, each agent is brought in only a few times, the whole thing has a quarter of an hour, and every hop runs on the authority of the person who started it — an agent nobody could ask on your behalf still cannot be asked on your behalf.',
      },
      {
        kind: 'added',
        text: 'An agent that needs a decision can now get one. The question arrives with buttons when the agent offered choices, or a box to type in, and only the person who started the request can answer. The answer is posted as their own message so the channel sees what was decided, and the agent carries on from where it stopped with everything it knew. A question nobody answers within a day expires and says so.',
      },
      {
        kind: 'added',
        text: 'Connect your own agent. Under Manage workspace → My agents, name it and Blob gives you a token and the command to run beside it on your laptop — no public address needed. It is yours from the first mention: it answers you and whoever you lend it to with /allow, nobody else, and it can only be added to channels you are in. Until now a personal agent was something an admin installed and handed over.',
      },
      {
        kind: 'added',
        text: 'Agents remember. What an agent knew at the end of a run — a plan, the open items, what it had already checked — is handed back to it the next time it is mentioned in the same channel or thread, instead of every run starting cold. Only for agents that share their state over AG-UI, and only from runs that finished or stopped to ask.',
      },
      {
        kind: 'changed',
        text: 'Scheduling a message that mentions an agent now reads as what it is: a way to have the agent do something every morning. Nothing changed underneath — it always ran when the message sent — but the guide now says so, and the agent runs on your authority like any other mention.',
      },
      {
        kind: 'fixed',
        text: 'Every page and every API answer now carries a Content-Security-Policy and the usual hardening headers (no framing, no MIME sniffing, a strict referrer policy, HSTS over https). Scripts run only from the workspace itself; images and uploads still reach the file storage and link previews still show their pictures. Until now only the feedback snapshot had a policy at all. This is also the groundwork for showing an agent’s HTML preview safely.',
      },
      {
        kind: 'changed',
        text: 'Stop stops the whole thing. Stopping an agent that had brought in others stops them too, rather than leaving the agent you stopped talking on through another one.',
      },
      {
        kind: 'added',
        text: 'Server administrators set how far agents may hand a request between themselves, per workspace, under App policy — “Agent-to-agent hops”. Zero is the old behaviour, and AGENT_CHAIN_MAX_DEPTH=0 turns it off for the whole server.',
      },
    ],
  },
  {
    date: '2026-09-04',
    title: 'Whose agent it is',
    entries: [
      {
        kind: 'added',
        text: 'An agent can belong to somebody. Until now every installed agent was everybody\'s — any member could mention any of them and it answered, which is right for the assistant the workspace shares and wrong for a personal one. An agent with an owner now answers its owner and nobody else, and the refusal is silence rather than an announcement, because saying "that is not your agent" would tell the room whose it is.',
      },
      {
        kind: 'added',
        text: '`/allow @agent @name` lends your agent to somebody in this channel, and `/disallow` takes it back. The grant is per channel, so an agent lent for one project is not lent everywhere; `/allow @agent` on its own lists who can command it here.',
      },
      {
        kind: 'added',
        text: 'Manage workspace → Apps & agents now says who owns each agent, and an admin sets it there. Leaving it as the workspace is what the shared assistant wants — everybody can reach it, which is the whole point of the one everybody works with.',
      },
    ],
  },
  {
    date: '2026-09-03',
    title: 'Six things that said one thing and did another',
    entries: [
      {
        kind: 'added',
        text: 'Follow and unfollow a thread. Replying used to subscribe you for good — the column that would have switched it off had been on the table since the first migration with nothing to write it — so the only escape from a thread you answered once was muting the whole channel. Following one you have never replied in works too, and starts you at the end rather than handing you everything already said.',
      },
      {
        kind: 'added',
        text: 'Threads with replies you have not seen are marked New, and opening one clears it. The read position was recorded every time you replied and read by nothing, so a thread you had read to the end looked exactly like one with ten new replies in it.',
      },
      {
        kind: 'fixed',
        text: 'An archived channel can be reopened, from Manage workspace → Channels. Nothing in the product set that back before — no button, no command, no route — so a channel closed by mistake stayed closed and its history stayed readable and unwritable for ever. Archiving is also an admin\'s now on every path into it; the REST route had been accepting it from any member.',
      },
      {
        kind: 'added',
        text: 'Twelve colour themes, six light and six dark — Paper, Linen, Harbour, Sage, Blossom, High contrast, Midnight, Slate, Plum, Forest, Carbon and Ember. Preferences shows them as a gallery where each tile is drawn in its own colours, so you pick a look rather than a name. Yours alone: choosing one changes nothing on anybody else\'s screen.',
      },
      {
        kind: 'added',
        text: 'A time zone, at last, under Preferences — with the current time in it beside the picker, because that is the fastest way to see a wrong one. Quiet hours and every /remind phrase are read in it, and until now every account quietly kept UTC, so "remind me tomorrow at 9" meant 09:00 UTC and the confirmation printed 09:00 back at you either way.',
      },
      {
        kind: 'added',
        text: 'A New message button beside Direct messages, and with it the first way to start a group conversation without typing a slash command. Click somebody\'s name on a message and a card opens with a Message button — the gesture every chat app trains you to make, which until now did nothing at all.',
      },
      {
        kind: 'fixed',
        text: '"Also send to #channel" now sends to the channel. The tick above the thread composer had been stored and read by nobody: the reply went to the thread and stopped there, for everyone including whoever ticked it.',
      },
      {
        kind: 'fixed',
        text: '@here no longer wakes the whole channel. It had been parsed and then treated exactly like @channel; it now reaches the people who are actually around, and anyone it passes over is still reachable by a keyword or a channel set to Every message.',
      },
      {
        kind: 'fixed',
        text: 'Archiving a channel is an admin\'s again. The menu row had always been admin-only, but /archive was accepted from any member — and archiving cannot be undone.',
      },
      {
        kind: 'fixed',
        text: 'The app\'s own icons ship. The favicon and the Home Screen icon had never been committed, and a missing file was answered with the app\'s HTML and a 200, so nothing ever looked broken. A request for a file that is not there is now a 404, which is how the four missing PNGs were found.',
      },
      {
        kind: 'added',
        text: 'A link to Blob pasted elsewhere now unfurls with a card and an image rather than a bare URL. It describes the product and never the conversation: a permalink needs a session to open, and a preview must not leak what is behind one.',
      },
    ],
  },
  {
    date: '2026-09-02',
    title: 'Commands you already know, and messages that come back',
    entries: [
      {
        kind: 'added',
        text: 'Help is now a page rather than a shrug: everything the app does, in one place, under Help in the account menu. Sixteen sections and a search box, with the keyboard shortcuts and the slash commands read straight out of the running app — so the list is your server\'s list, including whatever the apps installed here have added, and the page cannot describe a key nobody bound. ⌘/ links to it.',
      },
      {
        kind: 'added',
        text: 'Nine slash commands, spelled the way Slack spells them: /invite and /remove for people, /join and /rename and /archive and /mute for channels, /who for who is here, /dm to start a conversation (and say the thing in the same breath), and /status to tell everyone where you are. Type / in the composer to see the whole list.',
      },
      {
        kind: 'added',
        text: '`/remind me to water the plants tomorrow at 9`. It understands "in 20 minutes", "at 5pm", "tomorrow", a weekday by name, and "every weekday at 9am" for the ones that come back. The note arrives in the conversation you have with yourself, and it is an ordinary scheduled message — so it is in the Scheduled list with a Cancel button beside it. If it cannot read the time it says so rather than guessing at one.',
      },
      {
        kind: 'added',
        text: 'A scheduled message can repeat — every day, every weekday, or every week. The standup reminder, without anybody remembering to write it. It keeps the time you picked on your own clock, so it does not drift by an hour when the clocks change, and a worker that was down over a weekend does not wake up owing you three days of reminders at once.',
      },
      {
        kind: 'added',
        text: 'This page now tells you which build you are running, when it went out, and lists the commits behind it — each one linking to the change itself.',
      },
      {
        kind: 'added',
        text: '⌥↑ and ⌥↓ walk the sidebar, and ⌥⇧↑ and ⌥⇧↓ jump to the next conversation with something unread. ⌘⇧K opens the same picker ⌘K does with only people in it. ⌘/ lists all of them.',
      },
      {
        kind: 'fixed',
        text: 'Escape now closes the channel details and new channel dialogs. It used to fall through to the conversation behind them and mark it read, quietly undoing a message you had just marked unread.',
      },
      {
        kind: 'fixed',
        text: 'A file left in the composer no longer follows you to the next channel — and so can no longer be posted to the wrong one.',
      },
      {
        kind: 'fixed',
        text: 'Search no longer paints the results of a search you have moved on from. Typing quickly used to leave you looking at answers for something you had already finished typing.',
      },
      {
        kind: 'fixed',
        text: '/away lasts until you say otherwise. It used to switch itself back on within half a minute.',
      },
      {
        kind: 'fixed',
        text: 'Signing out everywhere else now disconnects those tabs, rather than only stopping their next request. So does changing your password.',
      },
      {
        kind: 'fixed',
        text: 'A revoked invitation stops working. It used to keep creating accounts for as long as the link had left to live.',
      },
      {
        kind: 'fixed',
        text: 'Uninstalling an app and installing it again works. And a mention is no longer suppressed for a channel you are not actually looking at, so a minimised tab gets its notifications.',
      },
    ],
  },
  {
    date: '2026-08-26',
    title: 'Blob has an agent now',
    entries: [
      {
        kind: 'added',
        text: 'Blob comes with its own assistant. It is already in your public channels — mention @Blob anywhere and it answers in the conversation, not in a panel beside it. Your admin turns it on by setting a model provider; until then nothing changes.',
      },
      {
        kind: 'added',
        text: 'Message Blob directly for a private conversation of your own. In its DM you do not need to mention it — every message is addressed to it, the way a DM already works with anyone else. It can see only that conversation for now, and it will say so rather than guessing.',
      },
      {
        kind: 'added',
        text: 'Blob shows as typing while it is thinking, so a slow answer looks like a slow answer rather than nothing happening.',
      },
      {
        kind: 'added',
        text: 'Admins can see what an agent actually did: every run it made, who asked, how long it took, how many replies it wrote, and what went wrong when something did. Under Apps in the console.',
      },
    ],
  },
  {
    date: '2026-08-25',
    title: 'Finding your way back to things',
    entries: [
      {
        kind: 'fixed',
        text: 'Forgotten passwords can be reset. Blob was sending the email all along — the link in it opened the app and did nothing, so there was no way back into an account.',
      },
      {
        kind: 'added',
        text: 'Every message has a link. Copy link from the ••• menu, and following one opens the message in place, in its thread if it is in one — even if it is months old.',
      },
      {
        kind: 'added',
        text: 'Later: put a message aside for yourself from the ••• menu. Pinning tells the whole channel; this tells nobody, and only you can see the list.',
      },
      {
        kind: 'added',
        text: 'Threads, in the sidebar and on ⌘⇧T — every conversation you started or replied to, newest reply first.',
      },
      {
        kind: 'added',
        text: 'The channel name opens a menu: mute it, star it, edit the topic, see who is in it, add someone, leave, archive. Starred channels have always sorted to the top of the sidebar; now something can star one.',
      },
      {
        kind: 'added',
        text: 'A Pinned button in the channel header. Pinning worked; there was no way to see what had been pinned.',
      },
      { kind: 'added', text: 'Admins can upload the workspace’s own emoji.' },
      {
        kind: 'changed',
        text: 'Reporting a bug is a button in the top-right corner rather than the last row of the account menu. The console log and a picture of the page are captured the moment it opens, which is worth most at the instant something goes wrong.',
      },
      {
        kind: 'added',
        text: 'This page. Every update, with what it added, changed and fixed — in the account menu, where a row promising it had sat greyed out since the menu was built.',
      },
      {
        kind: 'added',
        text: 'Errors and logs in the server console: recent warnings and failures from every process, with the traceback and the endpoint that broke. Until now the only account of a problem was the container’s output, which needs shell access to the host and is gone after a restart.',
      },
      {
        kind: 'added',
        text: 'Whoever runs the server can now limit what each workspace may do to it — host agents, reach private addresses, hold an agent socket.',
      },
      {
        kind: 'fixed',
        text: 'Jumping to a pinned message older than what was on screen used to close the panel and do nothing.',
      },
      {
        kind: 'fixed',
        text: 'Clicking a channel or a search result while on another screen loaded it invisibly behind that screen.',
      },
    ],
  },
  {
    date: '2026-08-24',
    title: 'Agents that dial in, and a keyboard',
    entries: [
      {
        kind: 'added',
        text: 'An agent with no public address — on a laptop, behind NAT — can connect to Blob and hold the connection open. It joins as a real member and answers when mentioned.',
      },
      {
        kind: 'added',
        text: 'What you typed and did not send is kept per channel and per thread, and channels you have a draft in are marked in the sidebar.',
      },
      { kind: 'added', text: 'Keyboard shortcuts, with ⌘/ to see all of them.' },
      {
        kind: 'changed',
        text: 'Your preferences are a section of the workspace page instead of a separate screen that looked different.',
      },
      {
        kind: 'fixed',
        text: 'Deploys failed on any host that did not already have the agents network. It is created now instead of demanded.',
      },
    ],
  },
  {
    date: '2026-08-24',
    title: 'Emoji, slash commands, and more than one workspace',
    entries: [
      {
        kind: 'added',
        text: 'An emoji picker for the composer and for reactions, and :shortcodes: in message bodies. Reactions used to be three fixed characters.',
      },
      {
        kind: 'added',
        text: 'Slash commands — /help, /shrug, /me, /topic, /leave, /away — and apps can add their own.',
      },
      {
        kind: 'added',
        text: 'One server can hold several workspaces, with a switcher behind the workspace name. One address is one password across all of them.',
      },
      {
        kind: 'fixed',
        text: 'A serious one, found by enabling multiple workspaces: any account could read another workspace’s public channels if it knew the channel id.',
      },
      {
        kind: 'fixed',
        text: 'Signing up from an invitation put you in the oldest workspace on the server rather than the one you were invited to.',
      },
    ],
  },
  {
    date: '2026-08-22',
    title: 'Two consoles, split by whose job it is',
    entries: [
      {
        kind: 'changed',
        text: 'Running a workspace and running the server are separate pages now. Inviting a colleague used to start in a console named after the machine. Every old link still works.',
      },
      {
        kind: 'added',
        text: 'Apps that speak AG-UI can be installed from the console rather than only through the API.',
      },
      { kind: 'added', text: 'An admin can add an app to a channel.' },
    ],
  },
];

/** The newest release. Named rather than indexed, since `RELEASES[0]` says nothing. */
export const LATEST_RELEASE = RELEASES[0] as Release;

const SEEN_KEY = 'blob.changelog.seen';

/**
 * localStorage rather than the server, because "have I read the release notes" is a
 * fact about this browser and not about the account. Wrapped because Safari's private
 * mode throws on access rather than returning null, and a changelog must never be the
 * reason the app fails to start.
 */
function readSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/** Is there something published since this browser last opened the page? */
export function hasUnseenRelease(): boolean {
  const seen = readSeen();
  // Never looked: true, so somebody arriving for the first time is told there are notes
  // rather than having to discover the page to find out it exists.
  if (seen === null) return true;
  return LATEST_RELEASE.date > seen;
}

export function markReleasesSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, LATEST_RELEASE.date);
  } catch {
    // A browser that will not store this shows the dot every time. Mildly annoying and
    // strictly better than not opening.
  }
}

const KIND_LABELS: Record<EntryKind, string> = {
  added: 'New',
  changed: 'Changed',
  fixed: 'Fixed',
};

export function labelFor(kind: EntryKind): string {
  return KIND_LABELS[kind];
}

/** "25 August 2026" — the long form, since this is read rarely and scanned by date. */
export function formatReleaseDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
