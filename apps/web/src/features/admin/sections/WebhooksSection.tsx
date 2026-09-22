/** Incoming URLs that let another system post into a channel. */

import { useCallback, useState, type FormEvent } from "react";
import { api, type AdminWebhook } from "../../../lib/api.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";
import { useStore } from "../../../lib/store.ts";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { Card, CardNotice } from "../../console/Card.tsx";
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
    <div className="console-stack">
      <Card
        title="New webhook"
        description="Post into a channel from CI or a cron job. The URL is shown once — store it somewhere safe."
      >
        <form className="console-inline-form" onSubmit={submit}>
          <label className="field">
            <span className="field-label">Channel</span>
            <select className="input" name="channel" defaultValue="">
              <option value="" disabled>
                Pick one
              </option>
              {Object.values(channels)
                .filter((c) => c.name && !c.archivedAt)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Name</span>
            <input className="input" name="label" placeholder="CI" />
          </label>
          <button className="btn" type="submit">
            Create
          </button>
        </form>

        {created && (
          <div className="draft-chip console-copy">
            <span className="grow ellipsis">{created}</span>
            <button
              className="btn btn-ghost"
              onClick={() => void navigator.clipboard.writeText(created)}
            >
              Copy
            </button>
            <button className="btn btn-ghost" onClick={() => setCreated(null)}>
              Done
            </button>
          </div>
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
            <div className="console-list">
              {webhooks.map((hook) => (
                <div className="admin-row" key={hook.id}>
                  <div className="grow min-0">
                    <div className="admin-row-title">{hook.name}</div>
                    <div className="admin-row-meta">
                      {hook.lastUsedAt
                        ? `Last used ${formatRelative(hook.lastUsedAt)}`
                        : "Never used"}
                    </div>
                  </div>
                  <button
                    className="btn"
                    aria-label={`Revoke ${hook.name}`}
                    onClick={() => setRevoking(hook)}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
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
