/** The frame every dashboard panel sits in, and the controls on its corner.
 *
 * One frame rather than five, because the hide/resize/reorder controls have to behave
 * identically on each panel or the grid stops feeling like one thing. The frame is the
 * console's card; the grid it is laid in is the section's, and asks the page's own column
 * how wide it is, not the window, since the nav takes 240px of the window at one width and
 * none of it at the next.
 */

import { Button } from "../../../../components/ui/button.tsx";
import { Card } from "../../../console/Card.tsx";
import { type WidgetId, type WidgetSize } from "./model.ts";

export function DashboardWidget({
  title,
  description,
  size,
  controls,
  children,
}: {
  title: string;
  description: string;
  size: WidgetSize;
  /** Absent unless the person is arranging the page. */
  controls: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card
      title={title}
      description={description}
      actions={controls || undefined}
      // Three across where the column has room for them, a wide one taking two of the three;
      // one under the other where it has not. Not `aria-busy`: a refresh is a request every
      // second or two, and the socket asks for another on most events, so the widgets would
      // be announced as busy for as long as the page was open. Busy is the first load's —
      // the skeleton in HealthSection — and a refresh is said in the toolbar's words.
      data-widget-size={size}
      className={
        size === "wide"
          ? "@min-[961px]/console-page:col-span-8"
          : "@min-[961px]/console-page:col-span-4"
      }
    >
      {children}
    </Card>
  );
}

export function WidgetControls({
  widget,
  size,
  canMoveLeft,
  canMoveRight,
  onMove,
  onResize,
  onHide,
}: {
  widget: WidgetId;
  size: WidgetSize;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (direction: -1 | 1) => void;
  onResize: () => void;
  onHide: () => void;
}) {
  // Every panel has the same four, so each is named by the panel it acts on — after its
  // visible words, which stay the start of the name.
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {/* Inert at either end, not disabled: moving a widget to the end is what makes its
          button inert, and a browser drops focus from a button that becomes disabled. */}
      <Button
        variant="outline"
        size="sm"
        aria-label={`Move earlier, ${widget} widget`}
        onClick={() => onMove(-1)}
        disabled={!canMoveLeft}
        focusableWhenDisabled
      >
        Move earlier
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Move later, ${widget} widget`}
        onClick={() => onMove(1)}
        disabled={!canMoveRight}
        focusableWhenDisabled
      >
        Move later
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label={`${size === "wide" ? "Standard width" : "Wide"}, ${widget} widget`}
        onClick={onResize}
      >
        {size === "wide" ? "Standard width" : "Wide"}
      </Button>
      <Button variant="outline" size="sm" aria-label={`Hide ${widget} widget`} onClick={onHide}>
        Hide
      </Button>
    </div>
  );
}
