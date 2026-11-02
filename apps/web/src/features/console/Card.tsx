/** The unit a console page is read in: one group of settings, one list, one table.
 *
 * A page used to be one long run of rows under uppercase overlines, with an inline
 * margin deciding where one group ended. A card makes the group the thing on screen —
 * the title says what it holds, the rows inside are ruled from each other, and a Save
 * sits in the card it saves.
 *
 * shadcn's Card, in its parts: a header holding the title, the line under it and any
 * card-wide controls; the content; a footer strip. The card is not a landmark on
 * purpose: a named section is one, and a settings page of eight landmarks is a list
 * nobody can use. The title is a heading, which is how a screen reader already moves
 * through a page.
 *
 * What a card holds is stacked with the card's own gap, not with margins. A list or a
 * table that runs to the card's edges takes `-mx-(--card-spacing)`, the padding it is
 * cancelling; a lone control in the stack takes `self-start`, or it is as wide as the card.
 */

import { Children, createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';
import {
  Card as CardRoot,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.tsx';

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
} & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  return (
    // `overflow-clip` in place of the generated `overflow-hidden`: both keep a flush list's
    // hover inside the rounded corners, but `hidden` makes the card a scroll container,
    // which focusing a control near its edge can scroll sideways.
    <CardRoot className={className ? `overflow-clip ${className}` : 'overflow-clip'} {...rest}>
      {(title !== undefined || description !== undefined || actions !== undefined) && (
        <CardHeader>
          {title !== undefined && (
            // The title is the heading's content; `render` only names the element. A title
            // may be data — `@some-long-handle` — so one unbroken word wraps (`min-w-0`,
            // `wrap-anywhere`) rather than widening the header's column past the card.
            // eslint-disable-next-line jsx-a11y/heading-has-content
            <CardTitle render={<h2 />} className="flex min-w-0 flex-wrap items-center gap-2 wrap-anywhere">
              {title}
            </CardTitle>
          )}
          {description !== undefined && (
            <CardDescription
              id={descriptionId}
              className="max-w-[68ch] min-w-0 text-pretty wrap-break-word"
            >
              {description}
            </CardDescription>
          )}
          {/* Beside the title while both fit; under it in a narrow card, where a row of
              buttons squeezed into the title's column would leave the words a word wide. */}
          {actions !== undefined && (
            <CardAction className="flex flex-wrap items-center gap-2 @max-sm/card-header:col-start-1 @max-sm/card-header:row-span-1 @max-sm/card-header:row-start-auto @max-sm/card-header:mt-2 @max-sm/card-header:justify-self-start">
              {actions}
            </CardAction>
          )}
        </CardHeader>
      )}
      {/* Only when there is something to hold: an empty part would still take the card's
          gap, and a card that is only its title would end in a blank strip. */}
      {Children.toArray(children).length > 0 && (
        <CardContent className="flex flex-col gap-4">
          <InTitledCard.Provider value={title !== undefined}>{children}</InTitledCard.Provider>
        </CardContent>
      )}
      {/* A strip of its own, so the action is found in the same place on every card; a note
          in it reads first and pushes the actions to the end. */}
      {footer !== undefined && (
        <CardFooter className="flex-wrap justify-end gap-x-3 gap-y-2 [&>:is(p,span):first-child]:mr-auto">
          {footer}
        </CardFooter>
      )}
    </CardRoot>
  );
}

/**
 * A heading for a part of a card — "New group", "Recent runs". It sits a level under the
 * card's title, or, in a card with none, a level under the page's own. A part can be
 * drawn in either: Groups is a titled card on the People page and an untitled one at its
 * old URL, and a fixed h3 made that page go from its h1 straight to an h3.
 *
 * A caller's `className` replaces the heading's own type rather than adding to it.
 */
export function CardHeading({
  className = 'font-heading text-sm font-semibold',
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
  return <p className="px-4 py-6 text-center text-sm text-pretty text-muted-foreground">{children}</p>;
}
