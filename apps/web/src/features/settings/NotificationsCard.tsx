/** When Blob is allowed to interrupt you.
 *
 * Split out of the old `/settings` page rather than left with the appearance controls:
 * "how it looks" and "when it pings me" are two different questions, and the second is
 * the one people go looking for after being woken up.
 *
 * Yours, so every member sees it. Nothing here is a workspace-wide setting.
 */

import { useId, useState } from "react";
import type { UserPrefs } from "@blob/shared";
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
import { useFetch } from "../../lib/useFetch.ts";
import { Button } from "../../components/ui/button.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "../../components/ui/field.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import { Card, CardFields } from "../console/Card.tsx";

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

export function NotificationsCard() {
  const currentUser = useStore((s) => s.currentUser);
  const setPrefs = useStore((s) => s.setPrefs);
  const groups = useStore((s) => s.groups);
  const myGroupIds = useStore((s) => s.myGroupIds);
  const mutedGroupIds = useStore((s) => s.mutedGroupIds);
  const [keywordDraft, setKeywordDraft] = useState("");
  const hint = useId();

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
    <Card
      title="Notifications"
      description="When Blob is allowed to interrupt you, and what counts as urgent."
    >
      <CardFields>
        <PushPanel />

        <Field orientation="responsive">
          <FieldContent>
            <FieldLabel htmlFor="email-when-away">Email me when I'm away</FieldLabel>
            <FieldDescription id={`${hint}-email`}>
              Direct messages, mentions and replies in threads you follow that
              are still unread while you have no Blob open, all in one email.
            </FieldDescription>
          </FieldContent>
          <NativeSelect
            id="email-when-away"
            aria-describedby={`${hint}-email`}
            value={prefs.emailWhenAway ?? "quarter_hour"}
            onChange={(e) =>
              void setPrefs({
                emailWhenAway: e.target.value as UserPrefs["emailWhenAway"],
              })
            }
          >
            <NativeSelectOption value="quarter_hour">Once every 15 minutes</NativeSelectOption>
            <NativeSelectOption value="hourly">Once an hour</NativeSelectOption>
            <NativeSelectOption value="off">Never</NativeSelectOption>
          </NativeSelect>
        </Field>

        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>Pause notifications</FieldTitle>
            <FieldDescription>
              {snoozedUntil
                ? `Paused until ${snoozedUntil.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
                : "Stop everything for a while, whatever the hour."}
            </FieldDescription>
          </FieldContent>
          {snoozedUntil ? (
            <Button
              variant="outline"
              onClick={() => void setPrefs({ snoozeUntil: null })}
            >
              Resume
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              {SNOOZE_PRESETS.map((preset) => (
                <Button
                  key={preset.minutes}
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void setPrefs({
                      snoozeUntil: new Date(
                        Date.now() + preset.minutes * 60_000,
                      ).toISOString(),
                    })
                  }
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          )}
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="nudges">Nudge me about unanswered questions</FieldLabel>
            <FieldDescription id={`${hint}-nudges`}>
              In channels that have it switched on, a question of yours that goes
              a day without a reply comes back to you in Later. Nobody else is
              told.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="nudges"
            aria-describedby={`${hint}-nudges`}
            checked={prefs.nudges}
            onCheckedChange={(on) => void setPrefs({ nudges: on })}
          />
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="quiet-hours">Quiet hours</FieldLabel>
            <FieldDescription id={`${hint}-quiet`}>
              Only the hours you choose will notify you. Unread counts still
              update.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="quiet-hours"
            aria-describedby={`${hint}-quiet`}
            checked={dnd.enabled}
            onCheckedChange={(on) => void setPrefs({ dnd: { ...dnd, enabled: on } })}
          />
        </Field>

        {dnd.enabled && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="dnd-start" className="font-normal text-muted-foreground">
                Notify me from
              </Label>
              <NativeSelect
                id="dnd-start"
                value={dnd.startHour}
                onChange={(e) =>
                  void setPrefs({
                    dnd: { ...dnd, startHour: Number(e.target.value) },
                  })
                }
              >
                {hourOptions().map((hour) => (
                  <NativeSelectOption key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Label htmlFor="dnd-end" className="font-normal text-muted-foreground">
                until
              </Label>
              <NativeSelect
                id="dnd-end"
                value={dnd.endHour}
                onChange={(e) =>
                  void setPrefs({
                    dnd: { ...dnd, endHour: Number(e.target.value) },
                  })
                }
              >
                {hourOptions().map((hour) => (
                  <NativeSelectOption key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, day) => {
                const active = dnd.days.includes(day);
                return (
                  <Button
                    key={label}
                    variant="outline"
                    size="sm"
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
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        <Field>
          <FieldContent>
            <FieldTitle>Keyword alerts</FieldTitle>
            <FieldDescription id={`${hint}-keywords`}>
              Notify me whenever one of these words appears anywhere I can see.
            </FieldDescription>
          </FieldContent>
          {prefs.keywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {prefs.keywords.map((keyword) => (
                <Button
                  key={keyword}
                  variant="outline"
                  size="sm"
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
                </Button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const word = keywordDraft.trim();
              if (!word || prefs.keywords.includes(word)) return;
              void setPrefs({ keywords: [...prefs.keywords, word] });
              setKeywordDraft("");
            }}
          >
            <Input
              className="max-w-xs"
              value={keywordDraft}
              onChange={(e) => setKeywordDraft(e.target.value)}
              // A placeholder is a hint, not a name: it is not reliably announced and it
              // disappears the moment there is a value, so the one control on this screen
              // with nothing else to identify it was the one with no name at all.
              aria-label="Add a keyword to be alerted on"
              aria-describedby={`${hint}-keywords`}
              placeholder="Add a word"
            />
            <Button variant="outline" type="submit">
              Add
            </Button>
          </form>
        </Field>

        {myGroups.length > 0 && (
          <Field>
            <FieldContent>
              <FieldTitle>Group mentions</FieldTitle>
              <FieldDescription id={`${hint}-groups`}>
                Silence a group you are in: @-mentions of it stop counting as
                mentions of you. Muting is yours alone — nobody is told.
              </FieldDescription>
            </FieldContent>
            {myGroups.map((group) => (
              <div key={group.id} className="flex items-center gap-3">
                <Label htmlFor={`mute-${group.id}`} className="flex-1 font-normal">
                  {/* Said before the handle to a screen reader, so "on" reads as notifications
                      on rather than as the group silenced; the name still holds what is shown. */}
                  <span className="sr-only">Notifications for </span>
                  <code className="font-mono text-xs">@{group.handle}</code>{" "}
                  <span className="text-muted-foreground">{group.name}</span>
                </Label>
                <Switch
                  id={`mute-${group.id}`}
                  aria-describedby={`${hint}-groups`}
                  checked={!mutedGroupIds.has(group.id)}
                  onCheckedChange={() => void toggleGroupMute(group.id)}
                />
              </div>
            ))}
          </Field>
        )}
      </CardFields>
    </Card>
  );
}

/**
 * Device notifications: the browser-push switch, and the one honest sentence each
 * platform needs. The server half has been able to send these since the port; this
 * switch is what finally subscribes a browser to receive them.
 */
function PushPanel() {
  const hint = useId();
  const { data: detected } = useFetch(currentPushState, []);
  /** Where the switch was last put, which outranks what was detected on arrival. */
  const [changed, setChanged] = useState<PushState | null>(null);
  const state: PushState | "loading" = changed ?? detected ?? "loading";
  const [busy, setBusy] = useState(false);
  /** What the last test actually did, in the words the person needs. */
  const [tested, setTested] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    try {
      setChanged(state === "on" ? await disablePush() : await enablePush());
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  const hasSwitch = state === "on" || state === "off";
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
      <Field orientation="horizontal">
        <FieldContent>
          {/* A label only while there is a switch for it to point at. */}
          {hasSwitch ? (
            <FieldLabel htmlFor="push-device">Notify this device</FieldLabel>
          ) : (
            <FieldTitle>Notify this device</FieldTitle>
          )}
          <FieldDescription id={hint}>
            {state === "loading" ? "Checking…" : (tested ?? explanation)}
          </FieldDescription>
        </FieldContent>
        <div className="flex shrink-0 items-center gap-3">
          {state === "on" && (
            <Button
              variant="ghost"
              disabled={busy || tested !== null}
              onClick={async () => {
                try {
                  // What came back, not what was hoped for: this switch reads "on" from
                  // the browser's own subscription, which can outlive the server's record
                  // of it — and a push that failed for a bad server key used to be
                  // counted as sent.
                  const result = await api.me.pushTest();
                  setTested(
                    result.sent > 0
                      ? `Sent to ${result.sent} ${result.sent === 1 ? "device" : "devices"} — check it`
                      : result.failed > 0
                        ? "The server could not send it. An admin can check the push keys."
                        : "This browser is subscribed but the server has no record of it. Turn the switch off and on again.",
                  );
                  setTimeout(() => setTested(null), 6000);
                } catch (err) {
                  showError(err);
                }
              }}
            >
              Send a test
            </Button>
          )}
          {hasSwitch && (
            <Switch
              id="push-device"
              aria-describedby={hint}
              checked={state === "on"}
              disabled={busy}
              onCheckedChange={() => void toggle()}
            />
          )}
        </div>
      </Field>
      {needsIosInstall() && state !== "unsupported" && (
        <Field>
          <FieldContent>
            <FieldTitle>On iPhone and iPad</FieldTitle>
            <FieldDescription>
              iOS only delivers push to installed web apps, and never says so:
              tap the Share button in Safari, then “Add to Home Screen”, open
              Blob from that icon, and this switch will work.
            </FieldDescription>
          </FieldContent>
        </Field>
      )}
    </>
  );
}
