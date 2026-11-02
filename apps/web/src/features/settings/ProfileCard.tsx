/** Your profile: the parts of you other people see.
 *
 * The first card on the You page. Preferences below it is how the app behaves for you;
 * this is what the workspace sees — the name on your messages, what you do, and where
 * you are. It was its own route at /profile until the three pages became one.
 */

import { useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import {
  CLEAR_AFTER_OPTIONS,
  optionForExpiry,
  presetsFor,
} from "./statusClearAfter.ts";
import { Avatar } from "../../components/Avatar.tsx";
import { Alert, AlertDescription } from "../../components/ui/alert.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../../components/ui/field.tsx";
import { Input } from "../../components/ui/input.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../../components/ui/item.tsx";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { uploadFile } from "../../lib/attachments.ts";
import { showError } from "../../lib/toasts.ts";
import { Card } from "../console/Card.tsx";

export function ProfileCard() {
  const currentUser = useStore((s) => s.currentUser);
  const applyEvent = useStore((s) => s.applyEvent);

  const [displayName, setDisplayName] = useState(
    currentUser?.displayName ?? "",
  );
  const [fullName, setFullName] = useState(currentUser?.fullName ?? "");
  const [title, setTitle] = useState(currentUser?.title ?? "");
  const [statusEmoji, setStatusEmoji] = useState(
    currentUser?.statusEmoji ?? "",
  );
  const [statusText, setStatusText] = useState(currentUser?.statusText ?? "");
  const [clearAfter, setClearAfter] = useState(() =>
    optionForExpiry(currentUser?.statusExpiresAt ?? null, new Date()),
  );
  const [busy, setBusy] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!currentUser) return null;

  const dirty =
    displayName !== (currentUser.displayName ?? "") ||
    fullName !== (currentUser.fullName ?? "") ||
    title !== (currentUser.title ?? "") ||
    statusEmoji !== (currentUser.statusEmoji ?? "") ||
    statusText !== (currentUser.statusText ?? "") ||
    clearAfter !==
      optionForExpiry(currentUser.statusExpiresAt ?? null, new Date());

  async function save() {
    if (!displayName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Empty means "clear it", and the server distinguishes absent from null — so the
      // optional fields go as null rather than as an empty string.
      const { user } = await api.me.update({
        displayName: displayName.trim(),
        fullName: fullName.trim() || null,
        title: title.trim() || null,
        statusEmoji: statusEmoji.trim() || null,
        statusText: statusText.trim() || null,
        // Computed at the moment of saving, not when the option was picked: the form
        // can sit open for an hour, and "30 minutes" has to mean thirty minutes from
        // pressing Save. Null clears any expiry the status had.
        statusExpiresAt:
          CLEAR_AFTER_OPTIONS.find((o) => o.id === clearAfter)
            ?.at(new Date())
            ?.toISOString() ?? null,
      });
      applyEvent({ t: "user.updated", user });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Profile"
      description="What other people see on your messages."
      footer={
        <>
          {/* There before anything is said in it, so the words are announced when they come. */}
          <span role="status" className="text-sm text-muted-foreground">
            {saved ? "Saved." : ""}
          </span>
          <Button
            onClick={() => void save()}
            disabled={!dirty || !displayName.trim() || busy}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Item variant="muted">
        <ItemMedia>
          <Avatar user={currentUser} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{displayName || currentUser.displayName}</ItemTitle>
          <ItemDescription>
            {[statusEmoji, statusText].filter(Boolean).join(" ") ||
              title ||
              "No status set"}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="flex-wrap">
          <input
            ref={avatarInputRef}
            type="file"
            name="avatar"
            aria-label="Choose a profile photo"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setUploadingAvatar(true);
              try {
                const attachmentId = await uploadFile(
                  file,
                  file.type || "image/png",
                );
                const { user } = await api.me.update({
                  avatarAttachmentId: attachmentId,
                });
                applyEvent({ t: "user.updated", user });
              } catch (err) {
                showError(err);
              } finally {
                setUploadingAvatar(false);
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={uploadingAvatar}
            onClick={() => avatarInputRef.current?.click()}
          >
            {uploadingAvatar
              ? "Uploading…"
              : currentUser.avatarUrl
                ? "Change photo"
                : "Add a photo"}
          </Button>
          {currentUser.avatarUrl && (
            <Button
              type="button"
              variant="ghost"
              disabled={uploadingAvatar}
              onClick={async () => {
                try {
                  const { user } = await api.me.update({
                    avatarAttachmentId: null,
                  });
                  applyEvent({ t: "user.updated", user });
                } catch (err) {
                  showError(err);
                }
              }}
            >
              Remove
            </Button>
          )}
        </ItemActions>
      </Item>

      {/* Two across where the card has room: name beside full name, what you do beside your
          status. */}
      <FieldGroup className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] items-start gap-x-6 gap-y-4">
        <Field>
          <FieldLabel htmlFor="profile-display-name">Display name</FieldLabel>
          <Input
            id="profile-display-name"
            value={displayName}
            maxLength={40}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <FieldDescription>
            This is the name on your messages and mentions.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="profile-full-name">Full name</FieldLabel>
          <Input
            id="profile-full-name"
            value={fullName}
            maxLength={80}
            placeholder="Optional"
            onChange={(event) => setFullName(event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="profile-title">What you do</FieldLabel>
          <Input
            id="profile-title"
            value={title}
            maxLength={80}
            placeholder="Optional"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        <FieldSet className="gap-2">
          <FieldLegend variant="label" className="mb-0">
            Status
          </FieldLegend>
          <div className="flex gap-2">
            <Input
              className="w-16 shrink-0 text-center"
              value={statusEmoji}
              maxLength={8}
              placeholder="🎧"
              aria-label="Status emoji"
              onChange={(event) => setStatusEmoji(event.target.value)}
            />
            <Input
              className="flex-1"
              value={statusText}
              maxLength={100}
              placeholder="Heads down until 3"
              aria-label="Status text"
              onChange={(event) => setStatusText(event.target.value)}
            />
          </div>
          {/* Offered only once there is a status, because "clear after" with nothing
            to clear is a control that cannot do anything. */}
          {(statusEmoji.trim() || statusText.trim()) && (
            <Field className="pt-2 sm:max-w-xs">
              <FieldLabel htmlFor="profile-clear-after">Clear after</FieldLabel>
              <NativeSelect
                id="profile-clear-after"
                className="w-full"
                value={clearAfter}
                onChange={(event) => setClearAfter(event.target.value)}
              >
                {presetsFor(new Date()).map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
        </FieldSet>
      </FieldGroup>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </Card>
  );
}
