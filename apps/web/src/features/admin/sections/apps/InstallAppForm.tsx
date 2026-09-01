/** Register an external app by hand: endpoints, event subscriptions, scopes. */

import { useState } from "react";
import { api, ApiError, type AdminPluginCatalog } from "../../../../lib/api.ts";

export function InstallAppForm({
  catalog,
  onError,
  onInstalled,
}: {
  catalog: AdminPluginCatalog | null;
  onError: (message: string | null) => void;
  onInstalled: (notice: {
    pluginName: string;
    signingSecret?: string;
    botToken?: string;
  }) => void;
}) {
  const [form, setForm] = useState({
    slug: "",
    name: "",
    description: "",
    version: "1.0.0",
    requestUrl: "",
    aguiUrl: "",
    events: [] as string[],
    scopes: [] as string[],
  });

  return (
    <form
      className="admin-app-form"
      onSubmit={(event) => {
        event.preventDefault();
        onError(null);
        void api.admin
          .installPlugin({
            slug: form.slug.trim(),
            name: form.name.trim(),
            description: form.description.trim() || null,
            runtime: "external",
            version: form.version.trim() || "1.0.0",
            requestUrl: form.requestUrl.trim() || null,
            aguiUrl: form.aguiUrl.trim() || null,
            events: form.events,
            scopes: form.scopes,
          })
          .then((installed) => {
            onInstalled({
              pluginName: installed.plugin.name,
              signingSecret: installed.signingSecret,
              botToken: installed.botToken,
            });
            setForm({
              slug: "",
              name: "",
              description: "",
              version: "1.0.0",
              requestUrl: "",
              aguiUrl: "",
              events: [],
              scopes: [],
            });
          })
          .catch((err) => {
            onError(
              err instanceof ApiError
                ? err.message
                : "Could not install the app.",
            );
          });
      }}
    >
      <label className="field">
        <span className="field-label">Slug</span>
        <input
          className="input"
          value={form.slug}
          onChange={(e) =>
            setForm((current) => ({ ...current, slug: e.target.value }))
          }
          placeholder="standup-bot"
          required
        />
      </label>
      <label className="field">
        <span className="field-label">Name</span>
        <input
          className="input"
          value={form.name}
          onChange={(e) =>
            setForm((current) => ({ ...current, name: e.target.value }))
          }
          placeholder="Standup Bot"
          required
        />
      </label>
      <label className="field admin-app-form-wide">
        <span className="field-label">Description</span>
        <input
          className="input"
          value={form.description}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              description: e.target.value,
            }))
          }
          placeholder="Collects standup notes every morning"
        />
      </label>
      <label className="field">
        <span className="field-label">Version</span>
        <input
          className="input"
          value={form.version}
          onChange={(e) =>
            setForm((current) => ({ ...current, version: e.target.value }))
          }
          placeholder="1.0.0"
          required
        />
      </label>
      <label className="field admin-app-form-wide">
        <span className="field-label">Request URL</span>
        <input
          className="input"
          type="url"
          value={form.requestUrl}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              requestUrl: e.target.value,
            }))
          }
          placeholder="https://apps.example.com/blob/events"
        />
        <span className="pref-hint">
          Where Blob POSTs the events this app subscribed to.
        </span>
      </label>
      <label className="field admin-app-form-wide">
        <span className="field-label">AG-UI URL</span>
        <input
          className="input"
          type="url"
          value={form.aguiUrl}
          onChange={(e) =>
            setForm((current) => ({ ...current, aguiUrl: e.target.value }))
          }
          placeholder="https://agent.example.com/agui"
        />
        <span className="pref-hint">
          For an agent that speaks AG-UI. Blob calls it when someone mentions the
          app, and posts what it streams back — no webhook handler needed. Give one
          of these two URLs, or both.
        </span>
      </label>

      <div className="admin-app-permissions">
        <div>
          <div className="section-label">
            Event subscriptions
          </div>
          <div className="admin-check-grid">
            {catalog &&
              Object.entries(catalog.events).map(
                ([eventKey, description]) => (
                  <label className="admin-check-card" key={eventKey}>
                    <input
                      type="checkbox"
                      aria-label={eventKey}
                      checked={form.events.includes(eventKey)}
                      onChange={() =>
                        setForm((current) => ({
                          ...current,
                          events: toggleChoice(current.events, eventKey),
                        }))
                      }
                    />
                    <span>
                      <strong>{eventKey}</strong>
                      <small>{description}</small>
                    </span>
                  </label>
                ),
              )}
          </div>
        </div>
        <div>
          <div className="section-label">
            Granted scopes
          </div>
          <div className="admin-check-grid">
            {catalog &&
              Object.entries(catalog.scopes).map(
                ([scopeKey, description]) => (
                  <label className="admin-check-card" key={scopeKey}>
                    <input
                      type="checkbox"
                      aria-label={scopeKey}
                      checked={form.scopes.includes(scopeKey)}
                      onChange={() =>
                        setForm((current) => ({
                          ...current,
                          scopes: toggleChoice(current.scopes, scopeKey),
                        }))
                      }
                    />
                    <span>
                      <strong>{scopeKey}</strong>
                      <small>{description}</small>
                    </span>
                  </label>
                ),
              )}
          </div>
        </div>
      </div>

      <div className="admin-app-form-actions">
        <div className="pref-hint">
          Blob only installs external apps here. Local plugins remain
          deploy-time code.
        </div>
        <button className="btn btn-primary" type="submit">
          Install app
        </button>
      </div>
    </form>
  );
}

function toggleChoice(items: string[], value: string): string[] {
  return items.includes(value)
    ? items.filter((item) => item !== value)
    : [...items, value];
}
