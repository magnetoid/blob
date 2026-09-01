/** How this workspace behaves. */

import { useCallback, useState } from "react";
import { api } from "../../../lib/api.ts";
import { useStore } from "../../../lib/store.ts";
import { useAdminAction, useAdminData } from "../hooks.ts";

export function SettingsSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const settings = await api.admin.settings();
    setName(settings.name);
    return settings;
  }, []);

  const { reload } = useAdminData(
    load,
    [],
    onError,
    "Could not load settings.",
  );
  const act = useAdminAction(onError, reload);

  return (
    <section>
      <form
        style={{ display: "flex", gap: 8, alignItems: "flex-end" }}
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            const updated = await api.admin.updateSettings({
              name: name.trim(),
            });
            useStore.setState({ workspaceName: updated.name });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          });
        }}
      >
        <label className="field" style={{ maxWidth: 280, flex: 1 }}>
          <span className="field-label">Workspace name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" type="submit">
          {saved ? "Saved" : "Save"}
        </button>
      </form>
    </section>
  );
}
