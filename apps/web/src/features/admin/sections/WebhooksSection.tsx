/** Incoming URLs that let another system post into a channel. */

import { useCallback, useId, useState, type FormEvent } from "react";
import { api, type AdminWebhook } from "../../../lib/api.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";
import { useStore } from "../../../lib/store.ts";
import { Button } from "../../../components/ui/button.tsx";
import { Field, FieldLabel } from "../../../components/ui/field.tsx";
import { Input } from "../../../components/ui/input.tsx";
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "../../../components/ui/item.tsx";
import { NativeSelect, NativeSelectOption } from "../../../components/ui/native-select.tsx";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { Card, CardNotice, CardRow, CardRows } from "../../console/Card.tsx";
import { CopyField } from "../../console/CopyField.tsx";
import { useAdminAction, useAdminData } from '../../console/hooks.ts';

export function WebhooksSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const channels = useStore((s) => s.channels);
  // Shown once and then never again, so it lives beside the form rather than in an
  // alert() the browser can swallow — and can be copied rather than retyped.
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<AdminWebhook | null>(null);
  const fields = useId();

  const load = useCallback(() => api.admin.webhooks(), []);
  const { data, loading, reload } = useAdminData(
    load,
    [],
    onError,
    "Could not load webhooks.",
  );
  const act = useAdminAction(onError, reload);
  const webhooks = data?.webhooks ?? [];

  function submit(event: FormEvent) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const channelId = (form.elements.namedItem("channel") as HTMLSelectElement)
      .value;
    const label = (
      form.elements.namedItem("label") as HTMLInputElement
    ).value.trim();
    if (!channelId || !label) return;
    void act(async () => {
      const hook = await api.admin.createWebhook(channelId, label);
      if (hook.url) setCreated(hook.url);
      form.reset();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="New webhook"
        description="Post into a channel from CI or a cron job. The URL is shown once — store it somewhere safe."
      >
        {/* The fields and the button on one line while they fit, and the button on the
            fields' bottom edge. */}
        <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
          <Field className="w-auto max-w-xs min-w-48 flex-1 basis-48">
            <FieldLabel htmlFor={`${fields}-channel`}>Channel</FieldLabel>
            <NativeSelect
              id={`${fields}-channel`}
              className="w-full"
              name="channel"
              defaultValue=""
            >
              <NativeSelectOption value="" disabled>
                Pick one
              </NativeSelectOption>
              {Object.values(channels)
                .filter((c) => c.name && !c.archivedAt)
                .map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    #{c.name}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </Field>
          <Field className="w-auto max-w-xs min-w-48 flex-1 basis-48">
            <FieldLabel htmlFor={`${fields}-name`}>Name</FieldLabel>
            <Input id={`${fields}-name`} name="label" placeholder="CI" />
          </Field>
          <Button variant="outline" type="submit">
            Create
          </Button>
        </form>

        {created && (
          <>
            <CopyField label="Webhook URL" value={created} />
            <Button variant="ghost" className="self-start" onClick={() => setCreated(null)}>
              Done
            </Button>
          </>
        )}
      </Card>

      {/* No data and no request in flight means the load failed: the error above says so,
          and "No webhooks yet" would be a claim about webhooks it never read. */}
      {(data !== null || loading) && (
        <Card>
          {data === null ? (
            <CardNotice>Loading…</CardNotice>
          ) : webhooks.length === 0 ? (
            <CardNotice>No webhooks yet.</CardNotice>
          ) : (
            <CardRows aria-label="Webhooks">
              {webhooks.map((hook) => (
                <CardRow key={hook.id}>
                  <ItemContent>
                    <ItemTitle>{hook.name}</ItemTitle>
                    <ItemDescription>
                      {hook.lastUsedAt
                        ? `Last used ${formatRelative(hook.lastUsedAt)}`
                        : "Never used"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="ghost"
                      aria-label={`Revoke ${hook.name}`}
                      onClick={() => setRevoking(hook)}
                    >
                      Revoke
                    </Button>
                  </ItemActions>
                </CardRow>
              ))}
            </CardRows>
          )}
        </Card>
      )}

      <DialogPresence when={revoking}>
        {(revoking) => (
          <ConfirmDialog
            title={`Revoke “${revoking.name}”?`}
            body="Anything posting through it stops working immediately."
            confirmLabel="Revoke"
            danger
            onClose={() => setRevoking(null)}
            onConfirm={() => {
              const hook = revoking;
              setRevoking(null);
              void act(() => api.admin.revokeWebhook(hook.id));
            }}
          />
        )}
      </DialogPresence>
    </div>
  );
}
