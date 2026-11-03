/** Errors the client threw in people's browsers here (ADR 0025's addendum): once per fault,
 *  newest seen first, with how often, where and in what. The server cut each report down
 *  before keeping it, so there is no address, id or query string here to read. */

import { useId, useRef, useState } from 'react';
import { api } from '../../../../lib/api.ts';
import { showError } from '../../../../lib/toasts.ts';
import { useFetch } from '../../../../lib/useFetch.ts';
import { Button } from '../../../../components/ui/button.tsx';
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '../../../../components/ui/item.tsx';
import { formatRelative } from '../../../messages/messageFormatting.ts';
import { Card, CardNotice, CardRow, CardRows } from '../../../console/Card.tsx';
import { useDisclosure } from '../apps/useDisclosure.ts';
import type { ClientErrorEntry } from '../../../../lib/api.ts';

export function BrowserErrors() {
  const { data, reload } = useFetch(() => api.admin.clientErrors(), [], { onError: showError });
  const [clearing, setClearing] = useState(false);
  // One request per press: state is not read until the next render.
  const inFlight = useRef(false);
  const errors = data?.errors ?? [];

  async function clear() {
    if (inFlight.current) return;
    inFlight.current = true;
    setClearing(true);
    try {
      await api.admin.clearClientErrors();
      reload();
    } catch (err) {
      showError(err);
    } finally {
      inFlight.current = false;
      setClearing(false);
    }
  }

  return (
    <Card
      title="Errors in browsers"
      description="What the client threw in people’s browsers here, once per fault. Addresses, ids and query strings are taken out before anything is kept, and a fault is forgotten thirty days after it was last seen."
      actions={
        errors.length > 0 ? (
          // Busy, not gone: a button disabled under the pointer would drop focus to the page.
          <Button variant="outline" disabled={clearing} focusableWhenDisabled onClick={() => void clear()}>
            Clear
          </Button>
        ) : undefined
      }
    >
      {data === null ? (
        <CardNotice>Loading…</CardNotice>
      ) : errors.length === 0 ? (
        <CardNotice>No browser has reported an error.</CardNotice>
      ) : (
        <CardRows aria-label="Errors in browsers">
          {errors.map((fault) => (
            <FaultRow key={fault.fingerprint} fault={fault} />
          ))}
        </CardRows>
      )}
    </Card>
  );
}

function FaultRow({ fault }: { fault: ClientErrorEntry }) {
  const messageId = useId();
  const stack = useDisclosure(messageId);
  return (
    <CardRow>
      <ItemContent>
        {/* A message is data, and may be one unbroken token. */}
        <ItemTitle id={messageId} className="wrap-anywhere">
          {fault.message}
        </ItemTitle>
        <ItemDescription className="wrap-anywhere">
          {fault.count === 1 ? 'Once' : `${fault.count} times`}, last {formatRelative(fault.lastAt)} ·{' '}
          {fault.browser} · {fault.path || '/'}
          {fault.release ? ` · build ${fault.release}` : ''}
        </ItemDescription>
      </ItemContent>
      {fault.stack && (
        <ItemActions>
          <Button variant="ghost" {...stack.buttonProps}>
            Stack
          </Button>
        </ItemActions>
      )}
      {fault.stack && stack.open && (
        // Monospace, and bounded: a long stack scrolls inside its own box rather than
        // stretching the page.
        <pre
          id={stack.panelId}
          className="m-0 max-h-56 basis-full overflow-auto rounded-md bg-muted p-2.5 font-mono text-xs leading-normal whitespace-pre text-muted-foreground"
        >
          {fault.stack}
        </pre>
      )}
    </CardRow>
  );
}
