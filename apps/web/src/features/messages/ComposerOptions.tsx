/** The three lists that open under the message field: `@` people, `:` emoji, `/` commands.
 *
 * The listbox had buttons for children once, which is a listbox with no options in it —
 * worse than no role at all, because it announced an empty list rather than nothing. The
 * active row was `data-active` and CSS only, so arrowing through names was silent;
 * `aria-activedescendant` on the textarea is what makes it audible while focus stays in
 * the message field.
 */

import type { ResolvedEmoji } from "../../lib/emoji.ts";
import type { CommandSpec } from "@blob/shared";
import { Avatar } from "../../components/Avatar.tsx";
import { MentionIcon } from "../../components/Icon.tsx";
import type { MentionCandidate } from "./useMentionAutocomplete.ts";

export function MentionOptions({
  candidates,
  index,
  onPick,
}: {
  candidates: MentionCandidate[];
  index: number;
  onPick: (name: string) => void;
}) {
  return (
    <div className="autocomplete" role="listbox" id="mention-options">
      {candidates.map((candidate, i) => (
        <button
          key={candidate.key}
          id={`mention-option-${i}`}
          role="option"
          aria-selected={i === index}
          className="autocomplete-item"
          data-active={i === index}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(candidate.label);
          }}
        >
          {candidate.kind === "user" ? (
            <Avatar user={candidate.user} size="sm" />
          ) : (
            <MentionIcon size="md" />
          )}
          {candidate.label}
          {candidate.hint && (
            <span className="muted autocomplete-hint">{candidate.hint}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function EmojiOptions({
  candidates,
  index,
  onPick,
}: {
  candidates: ResolvedEmoji[];
  index: number;
  onPick: (emoji: ResolvedEmoji) => void;
}) {
  return (
    <div className="autocomplete" role="listbox" id="emoji-options">
      {candidates.map((emoji, i) => (
        <button
          key={`${emoji.kind}-${emoji.name}`}
          id={`emoji-option-${i}`}
          role="option"
          aria-selected={i === index}
          aria-label={`:${emoji.name}:`}
          className="autocomplete-item"
          data-active={i === index}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(emoji);
          }}
        >
          {emoji.kind === "custom" ? (
            <img className="custom-emoji" src={emoji.url} alt="" />
          ) : (
            <span aria-hidden="true">{emoji.char}</span>
          )}
          :{emoji.name}:
        </button>
      ))}
    </div>
  );
}

export function CommandOptions({
  matches,
  index,
  onPick,
}: {
  matches: Array<Pick<CommandSpec, "name" | "usage" | "summary">>;
  index: number;
  onPick: (name: string) => void;
}) {
  return (
    <div className="autocomplete" role="listbox">
      {matches.map((command, i) => (
        <button
          key={command.name}
          className="autocomplete-item"
          data-active={i === index}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(command.name);
          }}
        >
          <span className="command-name">
            /{command.name}
            {command.usage ? ` ${command.usage}` : ""}
          </span>
          <span className="command-summary">{command.summary}</span>
        </button>
      ))}
    </div>
  );
}
