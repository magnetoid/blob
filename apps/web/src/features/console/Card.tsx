/** The unit a console page is read in: one group of settings, one list, one table.
 *
 * A page used to be one long run of rows under uppercase overlines, with an inline
 * margin deciding where one group ended. A card makes the group the thing on screen —
 * the title says what it holds, the rows inside are ruled from each other, and a Save
 * sits in the card it saves.
 *
 * The layout lives in app.css under `.console-card`; this is only the markup that has to
 * agree with it. Cards are sections with no accessible name on purpose: a named section
 * is a landmark, and a settings page of eight landmarks is a list nobody can use. The
 * title is a heading, which is how a screen reader already moves through a page.
 */

import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';

/** Whether the card something is drawn in has a title — see `CardHeading`. */
const InTitledCard = createContext(false);

export function Card({
  title,
  description,
  actions,
  footer,
  descriptionId,
  className,
  children,
  ...rest
}: {
  /** A heading. For a card that is one field, it can be that field's `<label>`. */
  title?: ReactNode;
  /** One line under the title, saying what the card is for. */
  description?: ReactNode;
  /** Controls that act on the whole card, drawn at the end of its header. */
  actions?: ReactNode;
  /** What closes the card: a Save, a "Load older", a note that belongs after the rows. */
  footer?: ReactNode;
  /** For a control that the description describes. */
  descriptionId?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  const heading = title !== undefined || description !== undefined;
  return (
    <section className={className ? `console-card ${className}` : 'console-card'} {...rest}>
      {(heading || actions !== undefined) && (
        <header className="console-card-header">
          {heading && (
            <div className="console-card-heading">
              {title !== undefined && <h2 className="console-card-title">{title}</h2>}
              {description !== undefined && (
                <p id={descriptionId} className="console-card-desc">
                  {description}
                </p>
              )}
            </div>
          )}
          {actions !== undefined && <div className="console-card-actions">{actions}</div>}
        </header>
      )}
      <InTitledCard.Provider value={title !== undefined}>{children}</InTitledCard.Provider>
      {footer !== undefined && <footer className="console-card-footer">{footer}</footer>}
    </section>
  );
}

/**
 * A heading for a part of a card — "New group", "Recent runs". It sits a level under the
 * card's title, or, in a card with none, a level under the page's own. A part can be
 * drawn in either: Groups is a titled card on the People page and an untitled one at its
 * old URL, and a fixed h3 made that page go from its h1 straight to an h3.
 */
export function CardHeading({
  className = 'section-label',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const Heading = useContext(InTitledCard) ? 'h3' : 'h2';
  return <Heading className={className}>{children}</Heading>;
}

/**
 * The line a card shows where its rows would be: nothing yet, nothing matched, or still
 * loading. One element for all three, so every page says it in the same place and type.
 */
export function CardNotice({ children }: { children: ReactNode }) {
  return <p className="console-notice">{children}</p>;
}
