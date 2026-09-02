/**
 * Translation for one message: the fetch, the module-level cache, the
 * Translate/Hide/Refresh actions and the translated card. Renders nothing until the
 * viewer has a preferred language.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Message,
  MessageTranslation as MessageTranslationData,
} from "@blob/shared";
import { ApiError, api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";

const translationCache = new Map<string, MessageTranslationData>();

// Bounded: a tab can stay open for days and every translated message is an entry.
// At the cap the oldest insertion is evicted — plain insertion order, which Map
// already keeps, rather than an LRU that would need touch-on-read bookkeeping.
const TRANSLATION_CACHE_LIMIT = 500;

// Keyed on the edit revision, so an edited message translates again instead of
// showing the previous body's translation.
function translationCacheKey(message: Message, targetLanguage: string): string {
  return `${message.id}:${message.editedAt ?? message.createdAt}:${targetLanguage}`;
}

function cacheTranslation(
  key: string,
  translation: MessageTranslationData,
): void {
  if (
    !translationCache.has(key) &&
    translationCache.size >= TRANSLATION_CACHE_LIMIT
  ) {
    const oldest = translationCache.keys().next().value;
    if (oldest !== undefined) translationCache.delete(oldest);
  }
  translationCache.set(key, translation);
}

interface Props {
  message: Message;
  /** Queued or still sending — there is nothing on the server to translate yet. */
  pending: boolean;
  /** The inline editor is open; the translate actions would fight the form. */
  editing: boolean;
}

export function MessageTranslation({ message, pending, editing }: Props) {
  const currentUser = useStore((s) => s.currentUser);
  const preferredLanguage = currentUser?.prefs.language ?? null;
  const autoTranslate = Boolean(
    currentUser?.prefs.autoTranslate && preferredLanguage,
  );
  const mine = message.authorId === currentUser?.id;
  const canTranslate =
    !pending &&
    !editing &&
    !message.deletedAt &&
    !!message.body.trim() &&
    !!preferredLanguage;

  const [translation, setTranslation] = useState<MessageTranslationData | null>(
    null,
  );
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationVisible, setTranslationVisible] = useState(false);

  useEffect(() => {
    if (!preferredLanguage) {
      setTranslation(null);
      setTranslationVisible(false);
      setTranslationError(null);
      return;
    }
    const cached =
      translationCache.get(translationCacheKey(message, preferredLanguage)) ??
      null;
    setTranslation(cached);
    setTranslationVisible((current) =>
      cached !== null ? autoTranslate || current : false,
    );
    setTranslationError(null);
  }, [autoTranslate, message, preferredLanguage]);

  const requestTranslation = useCallback(
    async (forceRefresh = false) => {
      if (!preferredLanguage || !canTranslate) return;
      setTranslationBusy(true);
      setTranslationError(null);
      try {
        const { translation: next } = await api.messages.translate(message.id, {
          targetLanguage: preferredLanguage,
          forceRefresh,
        });
        cacheTranslation(translationCacheKey(message, preferredLanguage), next);
        setTranslation(next);
        setTranslationVisible(true);
      } catch (error) {
        const nextError =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "That translation couldn't be loaded.";
        setTranslationError(nextError);
      } finally {
        setTranslationBusy(false);
      }
    },
    [canTranslate, message, preferredLanguage],
  );

  // What stops the retry loop. `translationBusy` is a dependency of the effect below
  // and its `finally` sets it back to false, so a failed request re-ran the effect,
  // which saw no translation and fired the same failing request again — every visible
  // row spinning its own POST for as long as it stayed on screen, which is what kept
  // the route's rate limit tripped in the first place. Adding `translationError` to the
  // guard is not enough: the reset effect above clears it whenever the `message` prop
  // identity changes, and a store update re-creates that object.
  //
  // The key is the message revision and the target language, so an edit or a change of
  // language does attempt again — and the manual Translate button never consults it.
  const autoAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !autoTranslate ||
      !canTranslate ||
      mine ||
      translation ||
      translationBusy ||
      !preferredLanguage
    )
      return;
    const key = translationCacheKey(message, preferredLanguage);
    if (autoAttemptedRef.current === key) return;
    autoAttemptedRef.current = key;
    void requestTranslation();
  }, [
    autoTranslate,
    canTranslate,
    mine,
    requestTranslation,
    translation,
    translationBusy,
    message,
    preferredLanguage,
  ]);

  return (
    <>
      {canTranslate && (
        <div className="message-translation-actions">
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              if (translation) {
                setTranslationVisible((visible) => !visible);
                return;
              }
              void requestTranslation();
            }}
            disabled={translationBusy}
          >
            {translationBusy
              ? "Translating…"
              : translationVisible
                ? "Hide translation"
                : translation
                  ? "Show translation"
                  : "Translate"}
          </button>
          {translation && (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => void requestTranslation(true)}
              disabled={translationBusy}
            >
              Refresh
            </button>
          )}
          {translationError && (
            <span className="message-translation-error">
              {translationError}
            </span>
          )}
        </div>
      )}

      {translationVisible && translation && (
        <div className="message-translation-card">
          <div className="message-translation-meta">
            {translation.sourceLanguage
              ? `Translated from ${displayLanguage(translation.sourceLanguage)} to ${displayLanguage(translation.targetLanguage)}`
              : `Translated to ${displayLanguage(translation.targetLanguage)}`}
            {" · "}
            {translation.provider}
          </div>
          <div className="message-translation-text">
            {translation.translatedText}
          </div>
        </div>
      )}
    </>
  );
}

function displayLanguage(code: string): string {
  try {
    const display = new Intl.DisplayNames(undefined, { type: "language" }).of(
      code,
    );
    return display ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}
