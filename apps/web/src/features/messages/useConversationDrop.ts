/**
 * Files dropped anywhere on a conversation, not only on its composer.
 *
 * The composer used to be the drop target, a box at the foot of the pane — so a file
 * dragged onto the messages, which is where a hand carrying one goes, was dropped on
 * nothing and the browser opened it in place of the app. Discord takes a drop anywhere
 * on its window; Teams shows "Drop your files here" across the conversation. This listens
 * on the composer's own conversation — the card a channel's composer sits in, or the
 * thread panel a reply's does — so each composer takes what is dropped on its side, and
 * reports the area while files are over it, for the overlay that says what will happen.
 *
 * A depth count rather than `relatedTarget` to tell the drag has left: every child the
 * pointer crosses fires its own enter and leave, and Safari gives a drag's leave no
 * `relatedTarget` at all.
 */

import { useEffect, useRef, useState, type RefObject } from "react";

export interface DropArea {
  top: number;
  left: number;
  width: number;
  height: number;
  /** The conversation's own corners — a thread panel's are square where it joins the
   *  conversation, and a phone's are square all round — so the overlay sits in it. */
  radius: string;
}

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

export function useConversationDrop(
  anchor: RefObject<HTMLElement | null>,
  onFiles: (files: File[]) => void,
): DropArea | null {
  const [area, setArea] = useState<DropArea | null>(null);
  // The latest `onFiles`: the tray's `attach` is a fresh function every render, and the
  // listeners below are installed once.
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  });

  useEffect(() => {
    const host = anchor.current?.closest<HTMLElement>(".pane, .panel");
    if (!host) return undefined;
    let depth = 0;
    const reset = () => {
      depth = 0;
      setArea(null);
    };

    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth += 1;
      if (depth === 1) {
        const rect = host.getBoundingClientRect();
        setArea({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          radius: getComputedStyle(host).borderRadius,
        });
      }
    };
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // What makes this a place a file may be dropped at all.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setArea(null);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      reset();
      onFilesRef.current(Array.from(event.dataTransfer?.files ?? []));
    };

    host.addEventListener("dragenter", enter);
    host.addEventListener("dragover", over);
    host.addEventListener("dragleave", leave);
    host.addEventListener("drop", drop);
    // A drag abandoned with Escape, or let go outside the window, can end with no leave
    // on this host; the end of any drag puts the overlay away.
    window.addEventListener("dragend", reset);
    return () => {
      host.removeEventListener("dragenter", enter);
      host.removeEventListener("dragover", over);
      host.removeEventListener("dragleave", leave);
      host.removeEventListener("drop", drop);
      window.removeEventListener("dragend", reset);
    };
  }, [anchor]);

  return area;
}
