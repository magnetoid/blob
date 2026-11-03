/** Line icons: Lucide's glyphs, at Blob's sizes and weights.
 *
 * The names are the app's and the drawing is Lucide's — the set shadcn ships with, so an
 * icon in a shadcn component and one in a legacy row are the same family. Each export is
 * a thin wrapper that a caller uses exactly as before; only the paths changed hands. Named
 * imports, so the build keeps the thirty-nine glyphs used here and none of Lucide's others.
 *
 * Four sizes, named by role rather than by number. There were seven — 13, 14, 15, 16,
 * 17, 18 and 19 — and five stroke weights between 1.7 and 2.2, chosen a call site at a
 * time, so the same job came out a different weight depending on which screen it was on.
 * A caller now says how prominent an icon is and the scale decides the rest.
 *
 * Stroke goes with size on purpose: a 1.7 hairline that reads correctly at 20px goes
 * thin and grey at 14, so the small end carries a touch more weight to hold the same
 * apparent colour. That is one decision here rather than a guess at each call site.
 * Lucide draws at 2 in its 24-box; these are in the same units, so a little lighter than
 * Lucide's default, which is the weight the app was designed at.
 *
 * Where Lucide's nearest glyph is a different picture of the same thing, the meaning won:
 * a huddle is headphones, as Slack draws it, where a speaker was traced; Send is a paper
 * plane, not a bare arrow; a poll is a bar chart with one answer ahead; leaving a call is
 * the handset struck through.
 */

import type { SVGProps } from 'react';
import {
  LucideArrowDown,
  LucideAtSign,
  LucideChartBar,
  LucideCheck,
  LucideChevronDown,
  LucideChevronLeft,
  LucideClock,
  LucideCopy,
  LucideDownload,
  LucideEllipsis,
  LucideFile,
  LucideFlag,
  LucideHeadphones,
  LucideHouse,
  LucideLifeBuoy,
  LucideLock,
  LucideMaximize2,
  LucideMessageCircle,
  LucideMic,
  LucideMicOff,
  LucideMinimize2,
  LucidePaperclip,
  LucidePause,
  LucidePencilLine,
  LucidePhoneOff,
  LucidePin,
  LucidePlay,
  LucidePlus,
  LucideReply,
  LucideScreenShare,
  LucideSearch,
  LucideSendHorizontal,
  LucideSettings,
  LucideSmile,
  LucideSparkle,
  LucideUsers,
  LucideVideo,
  LucideVideoOff,
  LucideX,
  type LucideIcon,
} from 'lucide-react';

type IconSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<IconSize, { px: number; stroke: number }> = {
  sm: { px: 14, stroke: 1.9 }, // inside a row: sidebar, menus, message meta
  md: { px: 16, stroke: 1.8 }, // the default: buttons and toolbars
  lg: { px: 18, stroke: 1.7 }, // the top bar, and anything leading a header
  xl: { px: 20, stroke: 1.7 }, // empty states, where the icon is the illustration
};

type IconProps = Omit<SVGProps<SVGSVGElement>, 'size'> & { size?: IconSize };

/** Per-glyph optical correction, added to whatever the size scale asks for.
 *
 * A bare `+` or `×` is two strokes and a lot of empty box; a detailed glyph at the same
 * nominal weight reads darker. These few carry a little extra so the set looks evenly
 * weighted. An offset rather than an absolute, so a corrected icon still gets lighter as
 * it gets larger instead of staying stuck at one weight across the whole scale — which
 * is what four hard-coded strokeWidths were doing. */
type Corrected = IconProps & { glyph: LucideIcon; boost?: number };

/** Decoration by default, as every icon here always was: `aria-hidden` comes first and
 *  whatever the caller passes — a label, `aria-hidden={false}`, a class — lands after it. */
function Glyph({ glyph: Lucide, size = 'md', boost = 0, ...rest }: Corrected) {
  const { px, stroke } = SIZES[size];
  // Rounded because 1.8 + 0.1 is 1.9000000000000001 in binary, and that lands in the
  // DOM verbatim.
  const width = Number((stroke + boost).toFixed(2));
  return <Lucide size={px} strokeWidth={width} aria-hidden="true" {...rest} />;
}

export const HomeIcon = (p: IconProps) => <Glyph glyph={LucideHouse} {...p} />;

export const MessagesIcon = (p: IconProps) => <Glyph glyph={LucideMessageCircle} {...p} />;

export const ChevronDownIcon = (p: IconProps) => <Glyph glyph={LucideChevronDown} {...p} />;

export const SearchIcon = (p: IconProps) => <Glyph glyph={LucideSearch} {...p} />;

/** Headphones, the mark Slack gives a huddle. */
export const HuddleIcon = (p: IconProps) => <Glyph glyph={LucideHeadphones} {...p} />;

export const SettingsIcon = (p: IconProps) => <Glyph glyph={LucideSettings} {...p} />;

export const PlusIcon = (p: IconProps) => <Glyph glyph={LucidePlus} boost={0.2} {...p} />;

export const MembersIcon = (p: IconProps) => <Glyph glyph={LucideUsers} {...p} />;

export const ReplyIcon = (p: IconProps) => <Glyph glyph={LucideReply} {...p} />;

/** Three dots, as Lucide draws them: r 1, which the stroke alone closes into a solid dot.
 *  A fill on top added nothing to their size. */
export const MoreIcon = (p: IconProps) => <Glyph glyph={LucideEllipsis} {...p} />;

export const SendIcon = (p: IconProps) => (
  <Glyph glyph={LucideSendHorizontal} boost={0.1} {...p} />
);

export const AttachIcon = (p: IconProps) => <Glyph glyph={LucidePaperclip} {...p} />;

export const EmojiIcon = (p: IconProps) => <Glyph glyph={LucideSmile} {...p} />;

/** A poll (ADR 0041): answers as bars, one of them ahead. */
export const PollIcon = (p: IconProps) => <Glyph glyph={LucideChartBar} {...p} />;

export const MentionIcon = (p: IconProps) => <Glyph glyph={LucideAtSign} {...p} />;

export const FileIcon = (p: IconProps) => <Glyph glyph={LucideFile} {...p} />;

export const DownloadIcon = (p: IconProps) => <Glyph glyph={LucideDownload} {...p} />;

/** A pencil on a line: something written and not yet sent (Drafts). */
export const DraftIcon = (p: IconProps) => <Glyph glyph={LucidePencilLine} {...p} />;

export const ClockIcon = (p: IconProps) => <Glyph glyph={LucideClock} {...p} />;

export const PinIcon = (p: IconProps) => <Glyph glyph={LucidePin} {...p} />;

/** A planted flag: something the conversation settled (the decision log). */
export const DecisionIcon = (p: IconProps) => <Glyph glyph={LucideFlag} {...p} />;

export const CloseIcon = (p: IconProps) => <Glyph glyph={LucideX} boost={0.4} {...p} />;

export const ChevronLeftIcon = (p: IconProps) => <Glyph glyph={LucideChevronLeft} {...p} />;

/** A four-pointed spark: the mark on everything the workspace summarised for you.
 *
 * A glyph rather than the "✦" character, because that one's weight and baseline differ
 * across platforms and it is set here inside a 22px tile where either shows. Not an
 * agent mark — this is the *workspace* offering a recap, so it wears the accent, and
 * anything an agent itself produced wears iris instead.
 */
export const SparkIcon = (p: IconProps) => <Glyph glyph={LucideSparkle} {...p} />;

/** A lifebuoy: report a problem, ask for something. Not a "?" — that reads as
 *  documentation, and this opens a form somebody on the other end answers. */
export const FeedbackIcon = (p: IconProps) => <Glyph glyph={LucideLifeBuoy} {...p} />;

export const VideoIcon = (p: IconProps) => <Glyph glyph={LucideVideo} {...p} />;

export const VideoOffIcon = (p: IconProps) => <Glyph glyph={LucideVideoOff} {...p} />;

export const MicIcon = (p: IconProps) => <Glyph glyph={LucideMic} {...p} />;

/** Play and pause: filled, because a voice message's control is a solid shape in every
 *  player people already know. The stroke stays, so the corners stay round. */
export const PlayIcon = (p: IconProps) => <Glyph glyph={LucidePlay} fill="currentColor" {...p} />;

export const PauseIcon = (p: IconProps) => (
  <Glyph glyph={LucidePause} fill="currentColor" {...p} />
);

export const MicOffIcon = (p: IconProps) => <Glyph glyph={LucideMicOff} {...p} />;

export const ScreenShareIcon = (p: IconProps) => <Glyph glyph={LucideScreenShare} {...p} />;

/** Hanging up: the handset, struck through. */
export const LeaveCallIcon = (p: IconProps) => <Glyph glyph={LucidePhoneOff} {...p} />;

export const ExpandIcon = (p: IconProps) => <Glyph glyph={LucideMaximize2} {...p} />;

export const CollapseIcon = (p: IconProps) => <Glyph glyph={LucideMinimize2} {...p} />;

/** Two sheets, the front one whole: "take a copy". */
export const CopyIcon = (p: IconProps) => <Glyph glyph={LucideCopy} {...p} />;

/** Done. A bare stroke reads light beside detailed glyphs, so it carries a touch more. */
export const CheckIcon = (p: IconProps) => <Glyph glyph={LucideCheck} boost={0.2} {...p} />;

/** Down to the end of something: the newest message. */
export const ArrowDownIcon = (p: IconProps) => <Glyph glyph={LucideArrowDown} {...p} />;

/** A private channel: a shackle over a body. */
export const LockIcon = (p: IconProps) => <Glyph glyph={LucideLock} {...p} />;
