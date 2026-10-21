/** Your own sections in the channel list (M3 · B3), as pure functions over the list.
 *
 * Kept with your preferences, so they follow you to every device; every change here
 * returns a new list for `setSidebarSections` to save. A conversation sits in at most one
 * section — the server keeps a conversation's first place if two tabs disagree.
 */

import type { SidebarSection } from '@blob/shared';

/** The server's ceiling (`UpdatePrefsInput.sidebar_sections`). */
export const MAX_SECTIONS = 20;
export const MAX_SECTION_NAME = 40;

export function newSectionId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export function sectionOf(
  sections: readonly SidebarSection[],
  conversationId: string,
): SidebarSection | undefined {
  return sections.find((section) => section.channelIds.includes(conversationId));
}

/** Every conversation that has a section, so the default lists can leave them out. */
export function sectioned(sections: readonly SidebarSection[]): Set<string> {
  return new Set(sections.flatMap((section) => section.channelIds));
}

/** Move a conversation into a section, or back out of every one with `null`. */
export function placeIn(
  sections: readonly SidebarSection[],
  conversationId: string,
  sectionId: string | null,
): SidebarSection[] {
  return sections.map((section) => {
    const without = section.channelIds.filter((id) => id !== conversationId);
    return section.id === sectionId
      ? { ...section, channelIds: [...without, conversationId] }
      : without.length === section.channelIds.length
        ? section
        : { ...section, channelIds: without };
  });
}

/** A new section, last in the list, holding `conversationId` if one is given. */
export function addSection(
  sections: readonly SidebarSection[],
  name: string,
  conversationId?: string,
): { sections: SidebarSection[]; id: string } {
  const id = newSectionId();
  const fresh: SidebarSection = {
    id,
    name: name.trim().slice(0, MAX_SECTION_NAME),
    channelIds: [],
    collapsed: false,
  };
  const added = [...sections, fresh];
  return { id, sections: conversationId ? placeIn(added, conversationId, id) : added };
}

export function renameSection(
  sections: readonly SidebarSection[],
  sectionId: string,
  name: string,
): SidebarSection[] {
  const trimmed = name.trim().slice(0, MAX_SECTION_NAME);
  return sections.map((section) =>
    section.id === sectionId && trimmed ? { ...section, name: trimmed } : section,
  );
}

/** Its conversations go back to where they were before it: the default lists. */
export function removeSection(
  sections: readonly SidebarSection[],
  sectionId: string,
): SidebarSection[] {
  return sections.filter((section) => section.id !== sectionId);
}

export function toggleCollapsed(
  sections: readonly SidebarSection[],
  sectionId: string,
): SidebarSection[] {
  return sections.map((section) =>
    section.id === sectionId ? { ...section, collapsed: !section.collapsed } : section,
  );
}
