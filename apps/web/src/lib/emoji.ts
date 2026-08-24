/**
 * Emoji: the shortcode vocabulary, and the lookup both the picker and the renderer use.
 *
 * The set is curated and lives here rather than coming from a package. A full Unicode
 * table is megabytes for a feature whose long tail nobody reaches, and this app keeps its
 * runtime dependencies countable on one hand — see the note in lib/router.ts. What is
 * here is the vocabulary a work chat actually reaches for.
 *
 * Two kinds of emoji share one namespace, which is what makes `:shipit:` feel the same as
 * `:tada:` to the person typing it:
 *
 * * **Unicode** reactions are stored as the character itself (`👍`), so every reaction
 *   written before this module existed keeps rendering.
 * * **Custom** reactions are stored as `:name:`, which fits because the server takes any
 *   string up to 64 characters for a reaction and validates nothing about its shape.
 *
 * A custom emoji wins a name collision with a Unicode one. A workspace that uploads its
 * own `:tada:` means it.
 */

import type { CustomEmoji } from '@blob/shared';

export interface EmojiEntry {
  /** Shortcode without the colons. */
  name: string;
  char: string;
  /** Extra search terms; the name is always searched and is never repeated here. */
  keywords: string[];
}

export interface EmojiCategory {
  id: string;
  label: string;
  entries: EmojiEntry[];
}

/** What the picker hands back, and what a reaction pill renders. */
export type ResolvedEmoji =
  | { kind: 'unicode'; name: string; char: string }
  | { kind: 'custom'; name: string; url: string };

const e = (name: string, char: string, ...keywords: string[]): EmojiEntry => ({
  name,
  char,
  keywords,
});

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'people',
    label: 'Smileys & people',
    entries: [
      e('grinning', '😀', 'smile', 'happy'),
      e('smiley', '😃', 'happy', 'joy'),
      e('smile', '😄', 'happy', 'joy', 'laugh'),
      e('grin', '😁', 'happy'),
      e('laughing', '😆', 'lol', 'haha'),
      e('sweat_smile', '😅', 'hot', 'relief'),
      e('joy', '😂', 'lol', 'crying', 'laugh'),
      e('rofl', '🤣', 'lol', 'rolling', 'laugh'),
      e('slightly_smiling_face', '🙂', 'smile'),
      e('upside_down_face', '🙃', 'sarcasm', 'irony'),
      e('wink', '😉', 'flirt'),
      e('blush', '😊', 'shy', 'happy'),
      e('innocent', '😇', 'halo', 'angel'),
      e('heart_eyes', '😍', 'love', 'crush'),
      e('kissing_heart', '😘', 'kiss', 'love'),
      e('yum', '😋', 'tongue', 'delicious'),
      e('stuck_out_tongue', '😛', 'tongue'),
      e('stuck_out_tongue_winking_eye', '😜', 'tongue', 'cheeky'),
      e('zany_face', '🤪', 'goofy', 'wild'),
      e('sunglasses', '😎', 'cool', 'shades'),
      e('nerd_face', '🤓', 'geek', 'glasses'),
      e('star_struck', '🤩', 'amazed', 'wow'),
      e('partying_face', '🥳', 'celebrate', 'party'),
      e('thinking_face', '🤔', 'hmm', 'consider'),
      e('face_with_raised_eyebrow', '🤨', 'skeptical', 'suspicious'),
      e('neutral_face', '😐', 'meh'),
      e('expressionless', '😑', 'blank'),
      e('no_mouth', '😶', 'silence', 'quiet'),
      e('smirk', '😏', 'smug'),
      e('unamused', '😒', 'meh', 'annoyed'),
      e('roll_eyes', '🙄', 'eyeroll', 'whatever'),
      e('grimacing', '😬', 'awkward', 'yikes'),
      e('lying_face', '🤥', 'pinocchio'),
      e('relieved', '😌', 'phew'),
      e('pensive', '😔', 'sad'),
      e('sleepy', '😪', 'tired'),
      e('sleeping', '😴', 'zzz', 'tired'),
      e('mask', '😷', 'sick', 'ill'),
      e('face_with_thermometer', '🤒', 'sick', 'fever'),
      e('exploding_head', '🤯', 'mindblown', 'shocked'),
      e('cowboy_hat_face', '🤠', 'yeehaw'),
      e('woozy_face', '🥴', 'drunk', 'dizzy'),
      e('confused', '😕', 'unsure'),
      e('worried', '😟', 'concerned'),
      e('slightly_frowning_face', '🙁', 'sad'),
      e('cry', '😢', 'sad', 'tear'),
      e('sob', '😭', 'crying', 'sad'),
      e('scream', '😱', 'shocked', 'fear'),
      e('confounded', '😖', 'frustrated'),
      e('persevere', '😣', 'struggle'),
      e('disappointed', '😞', 'sad'),
      e('sweat', '😓', 'nervous'),
      e('weary', '😩', 'tired', 'exhausted'),
      e('tired_face', '😫', 'exhausted'),
      e('triumph', '😤', 'huff', 'determined'),
      e('rage', '😡', 'angry', 'mad'),
      e('angry', '😠', 'mad'),
      e('face_with_symbols_on_mouth', '🤬', 'swearing', 'cursing'),
      e('hot_face', '🥵', 'heat', 'overheating'),
      e('cold_face', '🥶', 'freezing'),
      e('shushing_face', '🤫', 'quiet', 'secret'),
      e('hugging_face', '🤗', 'hug'),
      e('face_holding_back_tears', '🥹', 'touched', 'emotional'),
      e('saluting_face', '🫡', 'salute', 'yes', 'ack'),
      e('melting_face', '🫠', 'melting', 'overwhelmed'),
      e('skull', '💀', 'dead', 'dying'),
      e('ghost', '👻', 'boo', 'spooky'),
      e('alien', '👽', 'ufo'),
      e('robot', '🤖', 'bot', 'agent', 'ai'),
      e('poop', '💩', 'crap'),
      e('clown_face', '🤡', 'clown'),
    ],
  },
  {
    id: 'gestures',
    label: 'Gestures & body',
    entries: [
      e('thumbsup', '👍', '+1', 'yes', 'approve', 'lgtm'),
      e('thumbsdown', '👎', '-1', 'no', 'disapprove'),
      e('ok_hand', '👌', 'perfect'),
      e('pinching_hand', '🤏', 'small', 'tiny'),
      e('v', '✌️', 'peace', 'victory'),
      e('crossed_fingers', '🤞', 'luck', 'hopeful'),
      e('love_you_gesture', '🤟', 'ily'),
      e('call_me_hand', '🤙', 'shaka'),
      e('point_up', '☝️', 'this', 'attention'),
      e('point_right', '👉', 'this'),
      e('point_left', '👈', 'this'),
      e('point_down', '👇', 'below'),
      e('raised_hand', '✋', 'stop', 'halt'),
      e('wave', '👋', 'hello', 'hi', 'bye'),
      e('raised_hands', '🙌', 'praise', 'celebrate', 'hooray'),
      e('clap', '👏', 'applause', 'bravo'),
      e('handshake', '🤝', 'deal', 'agreement'),
      e('pray', '🙏', 'please', 'thanks', 'thankyou'),
      e('muscle', '💪', 'strong', 'flex'),
      e('writing_hand', '✍️', 'write', 'note'),
      e('nail_care', '💅', 'nails', 'sassy'),
      e('facepalm', '🤦', 'facepalm', 'ugh'),
      e('shrug', '🤷', 'dunno', 'idk'),
      e('tada', '🎉', 'party', 'celebrate', 'congrats', 'ship'),
      e('eyes', '👀', 'look', 'watching', 'seen'),
      e('brain', '🧠', 'smart', 'think'),
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts & symbols',
    entries: [
      e('heart', '❤️', 'love'),
      e('orange_heart', '🧡', 'love'),
      e('yellow_heart', '💛', 'love'),
      e('green_heart', '💚', 'love'),
      e('blue_heart', '💙', 'love'),
      e('purple_heart', '💜', 'love'),
      e('black_heart', '🖤', 'love'),
      e('white_heart', '🤍', 'love'),
      e('broken_heart', '💔', 'sad', 'breakup'),
      e('sparkling_heart', '💖', 'love'),
      e('heartpulse', '💗', 'love'),
      e('sparkles', '✨', 'shiny', 'magic', 'new'),
      e('star', '⭐', 'favourite', 'favorite'),
      e('star2', '🌟', 'glowing'),
      e('boom', '💥', 'explosion', 'collision'),
      e('fire', '🔥', 'lit', 'hot', 'burn'),
      e('zap', '⚡', 'lightning', 'fast'),
      e('bulb', '💡', 'idea', 'insight'),
      e('rainbow', '🌈', 'pride', 'colour'),
      e('100', '💯', 'hundred', 'perfect', 'agree'),
      e('white_check_mark', '✅', 'done', 'yes', 'check', 'complete'),
      e('heavy_check_mark', '✔️', 'done', 'check'),
      e('x', '❌', 'no', 'cancel', 'fail'),
      e('warning', '⚠️', 'caution', 'careful'),
      e('question', '❓', 'ask', 'unsure'),
      e('exclamation', '❗', 'important'),
      e('no_entry', '⛔', 'stop', 'blocked'),
      e('recycle', '♻️', 'reuse', 'refactor'),
      e('lock', '🔒', 'secure', 'private'),
      e('unlock', '🔓', 'open', 'public'),
      e('key', '🔑', 'password', 'access'),
      e('bell', '🔔', 'notify', 'alert'),
      e('no_bell', '🔕', 'mute', 'quiet'),
    ],
  },
  {
    id: 'work',
    label: 'Work & objects',
    entries: [
      e('rocket', '🚀', 'ship', 'launch', 'deploy', 'fast'),
      e('computer', '💻', 'laptop', 'code'),
      e('desktop_computer', '🖥️', 'monitor'),
      e('keyboard', '⌨️', 'typing'),
      e('iphone', '📱', 'mobile', 'phone'),
      e('floppy_disk', '💾', 'save', 'disk'),
      e('package', '📦', 'release', 'box', 'shipping'),
      e('wrench', '🔧', 'fix', 'tool'),
      e('hammer', '🔨', 'build', 'tool'),
      e('hammer_and_wrench', '🛠️', 'tools', 'maintenance'),
      e('gear', '⚙️', 'settings', 'config'),
      e('nut_and_bolt', '🔩', 'hardware'),
      e('mag', '🔍', 'search', 'find', 'investigate'),
      e('bug', '🐛', 'defect', 'issue'),
      e('lady_beetle', '🐞', 'bug', 'defect'),
      e('chart_with_upwards_trend', '📈', 'growth', 'metrics', 'up'),
      e('chart_with_downwards_trend', '📉', 'decline', 'metrics', 'down'),
      e('bar_chart', '📊', 'metrics', 'analytics'),
      e('clipboard', '📋', 'notes', 'tasks'),
      e('memo', '📝', 'note', 'write', 'docs'),
      e('books', '📚', 'docs', 'reading'),
      e('bookmark', '🔖', 'save', 'later'),
      e('paperclip', '📎', 'attach', 'file'),
      e('link', '🔗', 'url', 'chain'),
      e('calendar', '📅', 'date', 'schedule'),
      e('alarm_clock', '⏰', 'reminder', 'time'),
      e('hourglass', '⌛', 'waiting', 'time'),
      e('email', '📧', 'mail', 'message'),
      e('inbox_tray', '📥', 'receive', 'incoming'),
      e('outbox_tray', '📤', 'send', 'outgoing'),
      e('speech_balloon', '💬', 'comment', 'chat'),
      e('mega', '📣', 'announce', 'shout'),
      e('trophy', '🏆', 'win', 'award'),
      e('dart', '🎯', 'target', 'goal', 'bullseye'),
      e('construction', '🚧', 'wip', 'building'),
      e('coffee', '☕', 'break', 'caffeine'),
      e('beer', '🍺', 'drink', 'cheers'),
      e('pizza', '🍕', 'food', 'lunch'),
      e('cake', '🍰', 'birthday', 'dessert'),
      e('popcorn', '🍿', 'watching', 'drama'),
      e('moneybag', '💰', 'money', 'cost', 'budget'),
      e('gem', '💎', 'valuable', 'diamond'),
      e('crystal_ball', '🔮', 'predict', 'future'),
      e('magnet', '🧲', 'attract'),
      e('test_tube', '🧪', 'experiment', 'testing'),
      e('microscope', '🔬', 'research', 'inspect'),
      e('satellite', '🛰️', 'network', 'signal'),
      e('battery', '🔋', 'power', 'energy'),
      e('electric_plug', '🔌', 'power', 'connect'),
      e('shield', '🛡️', 'security', 'protect'),
      e('scroll', '📜', 'docs', 'log'),
      e('page_facing_up', '📄', 'document', 'file'),
      e('card_index_dividers', '🗂️', 'organise', 'files'),
      e('wastebasket', '🗑️', 'delete', 'trash', 'remove'),
    ],
  },
  {
    id: 'nature',
    label: 'Animals & nature',
    entries: [
      e('dog', '🐶', 'puppy', 'pet'),
      e('cat', '🐱', 'kitten', 'pet'),
      e('fox_face', '🦊', 'fox'),
      e('bear', '🐻', 'bear'),
      e('panda_face', '🐼', 'panda'),
      e('koala', '🐨', 'koala'),
      e('tiger', '🐯', 'tiger'),
      e('lion', '🦁', 'lion'),
      e('cow', '🐮', 'cow'),
      e('pig', '🐷', 'pig'),
      e('frog', '🐸', 'frog'),
      e('monkey_face', '🐵', 'monkey'),
      e('see_no_evil', '🙈', 'monkey', 'hide', 'oops'),
      e('hear_no_evil', '🙉', 'monkey'),
      e('speak_no_evil', '🙊', 'monkey', 'quiet'),
      e('penguin', '🐧', 'linux'),
      e('bird', '🐦', 'tweet'),
      e('duck', '🦆', 'duck', 'rubber'),
      e('eagle', '🦅', 'eagle'),
      e('owl', '🦉', 'wise', 'night'),
      e('bee', '🐝', 'busy', 'buzz'),
      e('butterfly', '🦋', 'transform'),
      e('snail', '🐌', 'slow'),
      e('turtle', '🐢', 'slow', 'steady'),
      e('snake', '🐍', 'python'),
      e('dragon', '🐉', 'dragon'),
      e('whale', '🐳', 'docker', 'ocean'),
      e('dolphin', '🐬', 'ocean'),
      e('fish', '🐟', 'ocean'),
      e('octopus', '🐙', 'git', 'ocean'),
      e('unicorn', '🦄', 'rare', 'magic'),
      e('sloth', '🦥', 'slow', 'lazy'),
      e('hedgehog', '🦔', 'spiky'),
      e('seedling', '🌱', 'growth', 'new', 'start'),
      e('herb', '🌿', 'plant', 'green'),
      e('four_leaf_clover', '🍀', 'luck'),
      e('maple_leaf', '🍁', 'autumn', 'fall'),
      e('sunflower', '🌻', 'flower'),
      e('rose', '🌹', 'flower'),
      e('cactus', '🌵', 'desert', 'plant'),
      e('evergreen_tree', '🌲', 'tree', 'forest'),
      e('sun_with_face', '🌞', 'sunny', 'day'),
      e('crescent_moon', '🌙', 'night', 'sleep'),
      e('cloud', '☁️', 'weather', 'cloudy'),
      e('snowflake', '❄️', 'cold', 'winter', 'freeze'),
      e('ocean', '🌊', 'wave', 'water'),
      e('volcano', '🌋', 'eruption'),
      e('earth_americas', '🌎', 'world', 'global', 'planet'),
    ],
  },
  {
    id: 'travel',
    label: 'Travel & places',
    entries: [
      e('car', '🚗', 'drive'),
      e('bus', '🚌', 'transport'),
      e('train', '🚆', 'rail'),
      e('airplane', '✈️', 'flight', 'travel'),
      e('ship', '🚢', 'boat', 'shipping'),
      e('sailboat', '⛵', 'boat', 'sailing'),
      e('bike', '🚲', 'cycling'),
      e('helicopter', '🚁', 'flight'),
      e('house', '🏠', 'home'),
      e('office', '🏢', 'work', 'building'),
      e('factory', '🏭', 'industry'),
      e('hospital', '🏥', 'medical'),
      e('bank', '🏦', 'money'),
      e('school', '🏫', 'education'),
      e('stadium', '🏟️', 'sports'),
      e('tent', '⛺', 'camping'),
      e('desert_island', '🏝️', 'holiday', 'vacation'),
      e('mountain', '⛰️', 'hiking'),
      e('world_map', '🗺️', 'map', 'plan'),
      e('compass', '🧭', 'direction', 'navigate'),
      e('traffic_light', '🚦', 'stop', 'go', 'status'),
      e('rotating_light', '🚨', 'alert', 'urgent', 'incident', 'siren'),
    ],
  },
  {
    id: 'activity',
    label: 'Activity',
    entries: [
      e('soccer', '⚽', 'football', 'sport'),
      e('basketball', '🏀', 'sport'),
      e('football', '🏈', 'sport'),
      e('tennis', '🎾', 'sport'),
      e('8ball', '🎱', 'pool', 'billiards'),
      e('bowling', '🎳', 'sport'),
      e('dart_board', '🎯', 'aim', 'target'),
      e('video_game', '🎮', 'gaming', 'controller'),
      e('game_die', '🎲', 'random', 'chance'),
      e('jigsaw', '🧩', 'puzzle', 'piece'),
      e('art', '🎨', 'design', 'paint'),
      e('musical_note', '🎵', 'music', 'song'),
      e('headphones', '🎧', 'music', 'listening'),
      e('microphone', '🎤', 'sing', 'speak'),
      e('clapper', '🎬', 'film', 'action'),
      e('camera', '📷', 'photo', 'picture'),
      e('movie_camera', '🎥', 'video', 'film'),
      e('circus_tent', '🎪', 'circus', 'chaos'),
      e('balloon', '🎈', 'party', 'celebrate'),
      e('gift', '🎁', 'present', 'surprise'),
      e('confetti_ball', '🎊', 'celebrate', 'party'),
      e('medal', '🏅', 'award', 'win'),
      e('checkered_flag', '🏁', 'finish', 'done', 'race'),
    ],
  },
];

/** Every Unicode entry, flattened, in category order. */
export const ALL_EMOJI: EmojiEntry[] = EMOJI_CATEGORIES.flatMap((c) => c.entries);

const BY_NAME = new Map(ALL_EMOJI.map((entry) => [entry.name, entry]));

/** What the composer's picker offers first, and the row of one-click reactions. */
export const QUICK_REACTIONS = ['👍', '🎉', '👀', '✅', '❤️', '😄'];

/** `:name:` — the shape a shortcode takes in a message body or a reaction value. */
export const SHORTCODE_RE = /^:([a-z0-9_+-]+):$/;

/** True when a stored reaction value is a custom-emoji shortcode rather than a character. */
export function isShortcode(value: string): boolean {
  return SHORTCODE_RE.test(value);
}

/** The name inside `:name:`, or null when this is not a shortcode. */
export function shortcodeName(value: string): string | null {
  return SHORTCODE_RE.exec(value)?.[1] ?? null;
}

/**
 * Resolve one shortcode name against the workspace's custom emoji, then the built-in set.
 *
 * Custom wins: a workspace that uploads its own `:tada:` has said what it wants `:tada:`
 * to mean, and silently preferring ours would make its own upload unreachable.
 */
export function resolveName(
  name: string,
  custom: readonly CustomEmoji[],
): ResolvedEmoji | null {
  const own = custom.find((c) => c.name === name);
  if (own) return { kind: 'custom', name: own.name, url: own.url };

  const builtin = BY_NAME.get(name);
  if (builtin) return { kind: 'unicode', name: builtin.name, char: builtin.char };

  return null;
}

/**
 * Resolve a *stored reaction value* — a raw character for Unicode, `:name:` for custom.
 *
 * Returns null for a shortcode whose custom emoji has since been deleted, so the caller
 * can fall back to showing the raw text rather than a broken image.
 */
export function resolveReaction(
  value: string,
  custom: readonly CustomEmoji[],
): ResolvedEmoji | null {
  const name = shortcodeName(value);
  if (name === null) return { kind: 'unicode', name: value, char: value };

  const own = custom.find((c) => c.name === name);
  return own ? { kind: 'custom', name: own.name, url: own.url } : null;
}

/** The value to store for a reaction, and to insert into a message body. */
export function reactionValue(emoji: ResolvedEmoji): string {
  return emoji.kind === 'custom' ? `:${emoji.name}:` : emoji.char;
}

/**
 * Search both sets by name and keyword.
 *
 * Ranked so that an exact name comes first and a prefix beats a mid-word hit — typing
 * "check" should offer `:white_check_mark:` before `:heavy_check_mark:` only because of
 * where the match lands, never because of dataset order. Custom emoji are ranked with a
 * small bonus: a workspace's own vocabulary is what its people are reaching for.
 */
export function searchEmoji(
  query: string,
  custom: readonly CustomEmoji[],
  limit = 60,
): ResolvedEmoji[] {
  const q = query.trim().toLowerCase().replace(/^:+|:+$/g, '');

  if (!q) {
    return [
      ...custom.map((c) => ({ kind: 'custom' as const, name: c.name, url: c.url })),
      ...ALL_EMOJI.map((x) => ({ kind: 'unicode' as const, name: x.name, char: x.char })),
    ].slice(0, limit);
  }

  const scored: { score: number; emoji: ResolvedEmoji }[] = [];

  const score = (name: string, keywords: readonly string[]): number => {
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (keywords.some((k) => k === q)) return 2;
    if (name.includes(q)) return 3;
    if (keywords.some((k) => k.startsWith(q))) return 4;
    return -1;
  };

  for (const c of custom) {
    const s = score(c.name, []);
    // Half a step ahead of the Unicode entry that scored the same way.
    if (s >= 0) scored.push({ score: s - 0.5, emoji: { kind: 'custom', name: c.name, url: c.url } });
  }

  for (const entry of ALL_EMOJI) {
    const s = score(entry.name, entry.keywords);
    if (s >= 0) {
      scored.push({ score: s, emoji: { kind: 'unicode', name: entry.name, char: entry.char } });
    }
  }

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.emoji);
}
