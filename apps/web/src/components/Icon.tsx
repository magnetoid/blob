/** Line icons, traced from the design artifact. Stroke-based, 24-box.
 *
 * Four sizes, named by role rather than by number. There were seven — 13, 14, 15, 16,
 * 17, 18 and 19 — and five stroke weights between 1.7 and 2.2, chosen a call site at a
 * time, so the same job came out a different weight depending on which screen it was on.
 * A caller now says how prominent an icon is and the scale decides the rest.
 *
 * Stroke goes with size on purpose: a 1.7 hairline that reads correctly at 20px goes
 * thin and grey at 14, so the small end carries a touch more weight to hold the same
 * apparent colour. That is one decision here rather than a guess at each call site.
 */

import type { SVGProps } from 'react';

export type IconSize = 'sm' | 'md' | 'lg' | 'xl';

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
type Corrected = IconProps & { boost?: number };

function Svg({ size = 'md', boost = 0, children, ...rest }: Corrected) {
  const { px, stroke } = SIZES[size];
  // Rounded because 1.8 + 0.1 is 1.9000000000000001 in binary, and that lands in the
  // DOM verbatim.
  const width = Number((stroke + boost).toFixed(2));
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const MessagesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 8.7 3.9 8.38 8.38 0 0 1 12.5 3h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9.5l6 6 6-6" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Svg>
);

export const HuddleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 6.5a4.5 4.5 0 0 1 0 11" />
    <path d="M4 9.5h3l4.5-3.5v12L7 14.5H4z" />
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.11A1.7 1.7 0 0 0 7 19.3l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4h.11A1.7 1.7 0 0 0 4.7 7L4.64 7a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 10 4.6V4a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 17 5.7l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 11H21a2 2 0 1 1 0 4h-.11z" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg boost={0.2} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const MembersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
    <circle cx="10" cy="8" r="3.2" />
    <path d="M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4" />
    <path d="M15.4 5.2a3.2 3.2 0 0 1 0 5.6" />
  </Svg>
);

export const ReplyIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14l-4-4 4-4" />
    <path d="M5 10h9a5 5 0 0 1 5 5v3" />
  </Svg>
);

export const MoreIcon = (p: IconProps) => (
  <Svg fill="currentColor" stroke="none" {...p}>
    <circle cx="6" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="18" cy="12" r="1.5" />
  </Svg>
);

export const SendIcon = (p: IconProps) => (
  <Svg boost={0.1} {...p}>
    <path d="M4 12h15" />
    <path d="M13 6l6 6-6 6" />
  </Svg>
);

export const AttachIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21.4 11.05l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />
  </Svg>
);

export const EmojiIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
    <circle cx="9" cy="9.5" r="0.6" fill="currentColor" />
    <circle cx="15" cy="9.5" r="0.6" fill="currentColor" />
  </Svg>
);

export const MentionIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M16 8v5a3 3 0 0 0 5 2 9 9 0 1 0-3.2 5.3" />
  </Svg>
);

export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3v5h5" />
    <path d="M19 21H5V3h9l5 5v13z" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 17v5" />
    <path d="M9 2h6l-1 8 3 3v2H7v-2l3-3-1-8z" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg boost={0.4} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 6l-6 6 6 6" />
  </Svg>
);

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

/** A lifebuoy: report a problem, ask for something. Not a "?" — that reads as
 *  documentation, and this opens a form somebody on the other end answers. */
export const FeedbackIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.6" />
    <path d="M5.7 5.7l3.8 3.8M14.5 14.5l3.8 3.8M18.3 5.7l-3.8 3.8M9.5 14.5l-3.8 3.8" />
  </Svg>
);
