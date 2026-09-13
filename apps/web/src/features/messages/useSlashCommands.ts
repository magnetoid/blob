/** Commands to offer while the name is half-typed, and who this conversation is with.
 *
 * Only in the channel composer: a command acts on the channel, so running one from a
 * thread would put its answer somewhere the person could not see it. In a thread a
 * leading slash is ordinary text, which is also the only way to send one as text.
 */

import { useMemo, type KeyboardEvent, type RefObject } from "react";
import { useStore } from "../../lib/store.ts";
import {
  commandQuery,
  matchAllCommands,
  type LocalCommandContext,
} from "../../lib/commands.ts";
import { useAutocomplete } from "./useAutocomplete.ts";

export function useSlashCommands(
  channelId: string,
  threadRootId: string | null,
  draft: string,
  setDraft: (value: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): {
  matches: ReturnType<typeof matchAllCommands>;
  index: number;
  localContext: LocalCommandContext;
  reset: () => void;
  apply: (name: string) => void;
  handleKey: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
} {
  const users = useStore((s) => s.users);
  const channels = useStore((s) => s.channels);
  const currentUser = useStore((s) => s.currentUser);
  const commands = useStore((s) => s.commands);

  /**
   * Who this conversation is with, for the commands the client answers itself.
   *
   * Only a one-to-one DM: a group DM has no single agent to open a terminal in, and a
   * channel an agent is a member of is not a conversation *with* it.
   */
  const localContext = useMemo<LocalCommandContext>(() => {
    const channel = channels[channelId];
    const otherId =
      channel?.kind === "dm"
        ? (channel.memberIds ?? []).find((id) => id !== currentUser?.id)
        : undefined;
    const other = otherId ? users[otherId] : undefined;
    return {
      botUserId: other?.kind === "bot" ? other.id : null,
      isAdmin: currentUser?.role === "admin" || currentUser?.role === "owner",
    };
  }, [channels, channelId, users, currentUser]);

  const matches = useMemo(() => {
    if (threadRootId) return [];
    const query = commandQuery(draft);
    return query === null
      ? []
      : matchAllCommands(query, commands, localContext);
  }, [draft, commands, threadRootId, localContext]);

  function apply(name: string) {
    // A trailing space, so the next keystroke is the argument rather than more name.
    const next = `/${name} `;
    setDraft(next);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.length, next.length);
    });
  }

  const list = useAutocomplete(matches, (chosen) => apply(chosen.name));
  return {
    matches,
    index: list.index,
    localContext,
    reset: list.reset,
    apply,
    handleKey: list.handleKey,
  };
}
