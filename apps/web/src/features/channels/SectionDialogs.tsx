/** Moving a conversation into a section of your own, and naming one (M3 · B3). */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SidebarSection } from '@blob/shared';
import { Dialog } from '../../components/Dialog.tsx';
import { useStore } from '../../lib/store.ts';
import {
  addSection,
  MAX_SECTION_NAME,
  MAX_SECTIONS,
  placeIn,
  renameSection,
  sectionOf,
} from '../../lib/sidebarSections.ts';

const EMPTY: SidebarSection[] = [];
const NONE = '';
const NEW = '+new';

export function MoveToSectionDialog({
  conversationId,
  name,
  onClose,
}: {
  conversationId: string;
  /** How the conversation is named in the title: "#design", "Ana Petrov". */
  name: string;
  onClose: () => void;
}) {
  const sections = useStore((s) => s.currentUser?.prefs?.sidebarSections ?? EMPTY);
  const setSidebarSections = useStore((s) => s.setSidebarSections);
  const [choice, setChoice] = useState(sectionOf(sections, conversationId)?.id ?? NONE);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const newNameRef = useRef<HTMLInputElement>(null);
  const full = sections.length >= MAX_SECTIONS;

  useEffect(() => {
    if (choice === NEW) newNameRef.current?.focus();
  }, [choice]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (choice === NEW) {
      if (!newName.trim()) {
        setError('Give the section a name.');
        return;
      }
      void setSidebarSections(addSection(sections, newName, conversationId).sections);
    } else {
      void setSidebarSections(placeIn(sections, conversationId, choice || null));
    }
    onClose();
  }

  return (
    <Dialog label={`Move ${name} to a section`} onClose={onClose}>
      <form className="dialog" onSubmit={submit}>
        <h2 className="dialog-title">Move {name} to a section</h2>
        <p className="muted m-0">Sections are yours: nobody else’s list changes.</p>
        <fieldset className="section-choices">
          <legend className="sr-only">Section</legend>
          <label className="section-choice">
            <input
              type="radio"
              name="section"
              checked={choice === NONE}
              onChange={() => setChoice(NONE)}
            />
            <span>No section</span>
          </label>
          {sections.map((section) => (
            <label key={section.id} className="section-choice">
              <input
                type="radio"
                name="section"
                checked={choice === section.id}
                onChange={() => setChoice(section.id)}
              />
              <span>{section.name}</span>
            </label>
          ))}
          {!full && (
            <label className="section-choice">
              <input
                type="radio"
                name="section"
                checked={choice === NEW}
                onChange={() => setChoice(NEW)}
              />
              <span>New section</span>
            </label>
          )}
          {choice === NEW && (
            <input
              ref={newNameRef}
              className="input"
              aria-label="Name of the new section"
              value={newName}
              maxLength={MAX_SECTION_NAME}
              placeholder="Clients"
              onChange={(event) => setNewName(event.target.value)}
            />
          )}
        </fieldset>
        {error && (
          <p className="error-text" data-refused="true">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit">
            Move
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function RenameSectionDialog({
  section,
  onClose,
}: {
  section: SidebarSection;
  onClose: () => void;
}) {
  const sections = useStore((s) => s.currentUser?.prefs?.sidebarSections ?? EMPTY);
  const setSidebarSections = useStore((s) => s.setSidebarSections);
  const [name, setName] = useState(section.name);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.select();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) void setSidebarSections(renameSection(sections, section.id, name));
    onClose();
  }

  return (
    <Dialog label="Rename section" onClose={onClose}>
      <form className="dialog" onSubmit={submit}>
        <h2 className="dialog-title">Rename section</h2>
        <label className="field">
          <span className="field-label">Name</span>
          <input
            ref={ref}
            className="input"
            value={name}
            maxLength={MAX_SECTION_NAME}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
