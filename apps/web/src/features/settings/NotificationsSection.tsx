/** When Blob is allowed to interrupt you.
 *
 * Split out of the old `/settings` page rather than left with the appearance controls:
 * "how it looks" and "when it pings me" are two different questions, and the second is
 * the one people go looking for after being woken up.
 *
 * Yours, so every member sees it. Nothing here is a workspace-wide setting.
 */

import { useState } from "react";
import { useEffect } from "react";
import { api } from "../../lib/api.ts";
import {
  currentPushState,
  disablePush,
  enablePush,
  needsIosInstall,
  type PushState,
} from "../../lib/push.ts";
import { useStore } from "../../lib/store.ts";
import { showError } from "../../lib/toasts.ts";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Snooze presets, in minutes. Slack's set, because those are the ones in people's fingers. */
const SNOOZE_PRESETS: Array<{ label: string; minutes: number }> = [
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "Until tomorrow", minutes: 16 * 60 },
];

function hourOptions(): number[] {
  return Array.from({ length: 24 }, (_, hour) => hour);
}

export function NotificationsSection() {
  const currentUser = useStore((s) => s.currentUser);
  const setPrefs = useStore((s) => s.setPrefs);
  const groups = useStore((s) => s.groups);
  const myGroupIds = useStore((s) => s.myGroupIds);
  const mutedGroupIds = useStore((s) => s.mutedGroupIds);
  const [keywordDraft, setKeywordDraft] = useState("");

  const myGroups = Object.values(groups).filter((g) => myGroupIds.has(g.id));

  async function toggleGroupMute(groupId: string) {
    const muted = !mutedGroupIds.has(groupId);
    // Optimistic: the switch answers immediately, and the store is the render source.
    useStore.setState((s) => {
      const next = new Set(s.mutedGroupIds);
      if (muted) next.add(groupId);
      else next.delete(groupId);
      return { mutedGroupIds: next };
    });
    try {
      await api.groups.setMuted(groupId, muted);
    } catch (err) {
      useStore.setState((s) => {
        const next = new Set(s.mutedGroupIds);
        if (muted) next.delete(groupId);
        else next.add(groupId);
        return { mutedGroupIds: next };
      });
      showError(err);
    }
  }

  const prefs = currentUser?.prefs;
  if (!prefs) return null;

  const dnd = prefs.dnd ?? {
    enabled: false,
    startHour: 9,
    endHour: 18,
    days: [1, 2, 3, 4, 5],
  };
  const snoozedUntil =
    prefs.snoozeUntil && new Date(prefs.snoozeUntil) > new Date()
      ? new Date(prefs.snoozeUntil)
      : null;

  return (
    <section style={{ maxWidth: 620 }}>
      <PushPanel />

      <div className="pref-row">
        <div style={{ flex: 1 }}>
          <div className="pref-label">Pause notifications</div>
          <div className="pref-hint">
            {snoozedUntil
              ? `Paused until ${snoozedUntil.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
              : "Stop everything for a while, whatever the hour."}
          </div>
        </div>
        {snoozedUntil ? (
          <button
            className="btn"
            onClick={() => void setPrefs({ snoozeUntil: null })}
          >
            Resume
          </button>
        ) : (
          <div className="chip-row">
            {SNOOZE_PRESETS.map((preset) => (
              <button
                key={preset.minutes}
                className="chip"
                onClick={() =>
                  void setPrefs({
                    snoozeUntil: new Date(
                      Date.now() + preset.minutes * 60_000,
                    ).toISOString(),
                  })
                }
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pref-row">
        <div style={{ flex: 1 }}>
          <div className="pref-label">Quiet hours</div>
          <div className="pref-hint">
            Only the hours you choose will notify you. Unread counts still
            update.
          </div>
        </div>
        <button
          className="toggle"
          aria-pressed={dnd.enabled}
          aria-label="Quiet hours"
          onClick={() =>
            void setPrefs({ dnd: { ...dnd, enabled: !dnd.enabled } })
          }
        >
          <span />
        </button>
      </div>

      {dnd.enabled && (
        <div className="pref-block">
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <label className="pref-hint" htmlFor="dnd-start">
              Notify me from
            </label>
            <select
              id="dnd-start"
              className="input"
              style={{ width: 90 }}
              value={dnd.startHour}
              onChange={(e) =>
                void setPrefs({
                  dnd: { ...dnd, startHour: Number(e.target.value) },
                })
              }
            >
              {hourOptions().map((hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, "0")}:00
                </option>
              ))}
            </select>
            <label className="pref-hint" htmlFor="dnd-end">
              until
            </label>
            <select
              id="dnd-end"
              className="input"
              style={{ width: 90 }}
              value={dnd.endHour}
              onChange={(e) =>
                void setPrefs({
                  dnd: { ...dnd, endHour: Number(e.target.value) },
                })
              }
            >
              {hourOptions().map((hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </div>
          <div className="chip-row" style={{ marginTop: 10 }}>
            {DAY_LABELS.map((label, day) => {
              const active = dnd.days.includes(day);
              return (
                <button
                  key={label}
                  className="chip"
                  aria-pressed={active}
                  onClick={() =>
                    void setPrefs({
                      dnd: {
                        ...dnd,
                        days: active
                          ? dnd.days.filter((d) => d !== day)
                          : [...dnd.days, day].sort((a, b) => a - b),
                      },
                    })
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="pref-block">
        <div className="pref-label">Keyword alerts</div>
        <div className="pref-hint">
          Notify me whenever one of these words appears anywhere I can see.
        </div>
        <div className="chip-row" style={{ marginTop: 10 }}>
          {prefs.keywords.map((keyword) => (
            <button
              key={keyword}
              className="chip"
              aria-pressed
              title="Remove"
              onClick={() =>
                void setPrefs({
                  keywords: prefs.keywords.filter((k) => k !== keyword),
                })
              }
            >
              {keyword}{" "}
              {/* The glyph is decoration: without this the button is named "deploy ✕"
                  and a reader says the multiplication sign out loud. `title` stays as
                  the description, so the announcement is the word and then what
                  clicking does. */}
              <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
        <form
          style={{ display: "flex", gap: 8, marginTop: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            const word = keywordDraft.trim();
            if (!word || prefs.keywords.includes(word)) return;
            void setPrefs({ keywords: [...prefs.keywords, word] });
            setKeywordDraft("");
          }}
        >
          <input
            className="input"
            value={keywordDraft}
            onChange={(e) => setKeywordDraft(e.target.value)}
            // A placeholder is a hint, not a name: it is not reliably announced and it
            // disappears the moment there is a value, so the one control on this screen
            // with nothing else to identify it was the one with no name at all.
            aria-label="Add a keyword to be alerted on"
            placeholder="Add a word"
            style={{ maxWidth: 240 }}
          />
          <button className="btn" type="submit">
            Add
          </button>
        </form>
      </div>

      {myGroups.length > 0 && (
        <div className="pref-block">
          <div className="pref-label">Group mentions</div>
          <div className="pref-hint">
            Silence a group you are in: @-mentions of it stop counting as
            mentions of you. Muting is yours alone — nobody is told.
          </div>
          {myGroups.map((group) => (
            <div
              key={group.id}
              className="pref-row"
              style={{ padding: "8px 0" }}
            >
              <div style={{ flex: 1 }}>
                <code>@{group.handle}</code>
                <span className="pref-hint" style={{ marginLeft: 8 }}>
                  {group.name}
                </span>
              </div>
              <button
                className="toggle"
                aria-pressed={!mutedGroupIds.has(group.id)}
                aria-label={`Notifications for @${group.handle}`}
                onClick={() => void toggleGroupMute(group.id)}
              >
                <span />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Device notifications: the browser-push switch, and the one honest sentence each
 * platform needs. The server half has been able to send these since the port; this
 * switch is what finally subscribes a browser to receive them.
 */
function PushPanel() {
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void currentPushState().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      setState(state === "on" ? await disablePush() : await enablePush());
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  const explanation =
    state === "unsupported"
      ? "This browser cannot receive push notifications."
      : state === "no-server-key"
        ? "The server has no push keys configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)."
        : state === "denied"
          ? "Notifications are blocked for this site — allow them in the browser’s site settings to turn this on."
          : "Get notified on this device even when the tab is closed.";

  return (
    <>
      <div className="pref-row">
        <div style={{ flex: 1 }}>
          <div className="pref-label">Notify this device</div>
          <div className="pref-hint">
            {state === "loading" ? "Checking…" : explanation}
          </div>
        </div>
        {(state === "on" || state === "off") && (
          <button
            className="toggle"
            aria-pressed={state === "on"}
            aria-label="Push notifications on this device"
            disabled={busy}
            onClick={() => void toggle()}
          >
            <span />
          </button>
        )}
        {state === "on" && (
          <button
            className="btn btn-ghost"
            disabled={busy || tested}
            onClick={async () => {
              try {
                await api.me.pushTest();
                setTested(true);
                setTimeout(() => setTested(false), 4000);
              } catch (err) {
                showError(err);
              }
            }}
          >
            {tested ? "Sent — check the device" : "Send a test"}
          </button>
        )}
      </div>
      {needsIosInstall() && state !== "unsupported" && (
        <div className="pref-row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div className="pref-label">On iPhone and iPad</div>
            <div className="pref-hint">
              iOS only delivers push to installed web apps, and never says so:
              tap the Share button in Safari, then “Add to Home Screen”, open
              Blob from that icon, and this switch will work.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
