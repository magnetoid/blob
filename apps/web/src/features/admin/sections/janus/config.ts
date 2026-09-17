/** Janus's `GET /v1/config` body, as this page reads it.
 *
 * `config.data` is `unknown` all the way from Janus's own route through
 * `services/janus_console.py` and `JanusPartOut`, and deliberately so: Janus's config
 * grows fields with every release, and a Blob-side mirror of its shape would be a second
 * thing to keep in step. That leaves the page as the place where the shape is finally
 * asserted — so it is asserted *defensively*, field by field, rather than by a cast. A
 * cast would turn a Janus that renamed one key into a blank screen or a crash; this turns
 * it into one control that says it does not know, beside the seven that do.
 *
 * The names are Janus's own, snake_case and untranslated. Nothing between here and Janus
 * renames them, and inventing a camelCase twin would be a second vocabulary for one set of
 * fields — the mistake `_janus_body` exists to avoid on the way out.
 *
 * One field is *about* a secret and is narrowed hardest: `providers[].key` becomes
 * `{set, tail?}` and nothing else. Blob's service already narrows it on the way out; doing
 * it again here is what makes "no key value can reach the screen" true of this file on its
 * own, without depending on the process upstream.
 */

/** One of Janus's complaints about a config: `{severity, message, hint}`. */
export interface JanusIssue {
  severity: string;
  message: string;
  hint: string;
}

/** Whether a provider's key is present — never the key. `tail` is absent for a short one. */
export interface KeyState {
  set: boolean;
  tail?: string;
}

export interface JanusProvider {
  id: string;
  name: string;
  /** The environment variable Janus reads this provider's key from — and the name a save sends. */
  env: string;
  key: KeyState;
}

export interface JanusConfig {
  version: string;
  /** What Janus answers as. `default` is the model id; Janus's word, not ours. */
  model: { default: string; provider: string; base_url: string };
  agent: {
    max_turns: number | null;
    reasoning_effort: string;
    gateway_timeout: number | null;
    personality: string;
  };
  personalities: string[];
  toolsets: { available: string[]; enabled: string[]; error: string | null };
  providers: JanusProvider[];
  /** The provider's own catalogue, or the one-line reason there isn't one. */
  models: { ids: string[] | null; reason: string | null };
  /** `config.yaml` verbatim, with every inline key already replaced by `«redacted»`. */
  raw: string;
  restart_pending: boolean;
}

/** What the page draws when Janus did not answer: every control empty and dead. */
export const UNKNOWN: JanusConfig = {
  version: "",
  model: { default: "", provider: "", base_url: "" },
  agent: {
    max_turns: null,
    reasoning_effort: "",
    gateway_timeout: null,
    personality: "",
  },
  personalities: [],
  toolsets: { available: [], enabled: [], error: null },
  providers: [],
  models: { ids: null, reason: null },
  raw: "",
  restart_pending: false,
};

function obj(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A number, or null for "Janus did not say" — which is not the same as zero. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** `{set, tail?}` and nothing else — the one narrowing this file exists for. */
function keyState(value: unknown): KeyState {
  const raw = obj(value);
  const tail = str(raw.tail);
  return { set: raw.set === true, ...(tail ? { tail } : {}) };
}

function provider(value: unknown): JanusProvider {
  const raw = obj(value);
  const id = str(raw.id);
  return {
    id,
    // Janus has sent a `name` since 0.17.0; an older one that sends only the id should
    // read as the id rather than as a provider with no name at all.
    name: str(raw.name) || id,
    env: str(raw.env),
    key: keyState(raw.key),
  };
}

/** `{severity, message, hint}`, from a refusal's `issues` or a success's `warnings`. */
export function issues(value: unknown): JanusIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const raw = obj(entry);
      return {
        severity: str(raw.severity) || "error",
        message: str(raw.message),
        hint: str(raw.hint),
      };
    })
    .filter((issue) => issue.message !== "");
}

/**
 * Janus's config body, read field by field.
 *
 * `null` when there is no body to read — Janus did not answer `/v1/config`, or answered
 * with something that is not an object. The caller draws `UNKNOWN` in its place and
 * disables everything, which is a different screen from a config that is merely empty.
 */
export function readConfig(data: unknown): JanusConfig | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as Record<string, unknown>;
  const model = obj(raw.model);
  const agent = obj(raw.agent);
  const toolsets = obj(raw.toolsets);
  const models = obj(raw.models);
  const ids = models.ids;

  return {
    version: str(raw.version),
    model: {
      default: str(model.default),
      provider: str(model.provider),
      base_url: str(model.base_url),
    },
    agent: {
      max_turns: num(agent.max_turns),
      reasoning_effort: str(agent.reasoning_effort),
      gateway_timeout: num(agent.gateway_timeout),
      personality: str(agent.personality),
    },
    personalities: strings(raw.personalities),
    toolsets: {
      available: strings(toolsets.available),
      enabled: strings(toolsets.enabled),
      error: str(toolsets.error) || null,
    },
    providers: Array.isArray(raw.providers) ? raw.providers.map(provider) : [],
    // `null` is "the provider would not list them" and an empty array is "it listed
    // none" — the first gets a text field, the second an empty select, so they must not
    // collapse into each other.
    models: { ids: Array.isArray(ids) ? strings(ids) : null, reason: str(models.reason) || null },
    raw: str(raw.raw),
    restart_pending: raw.restart_pending === true,
  };
}

/** The skills Janus has, from `/v1/skills`. Read-only everywhere on this page. */
export interface JanusSkill {
  name: string;
  description: string;
  category: string;
}

export function readSkills(data: unknown): JanusSkill[] {
  const list = obj(data).data;
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => {
      const raw = obj(entry);
      return {
        name: str(raw.name),
        description: str(raw.description),
        category: str(raw.category),
      };
    })
    .filter((skill) => skill.name !== "");
}

/**
 * A select's options, with whatever is configured now always among them.
 *
 * A value Janus is running on that this page's list does not contain would otherwise be
 * unselectable — the select would show its first option instead, and the *next* Save
 * would change a setting nobody touched. That is not hypothetical for any of the four
 * selects on this page: `_providers_view()` lists API-key providers only, so a Janus on
 * an OAuth or local provider matches none of them; `models.ids` is the provider's live
 * catalogue, which can retire the name in use; `personalities` is Janus's list at this
 * release; and the reasoning-effort scale is the one list here that is not Janus's own.
 *
 * The empty string is a value like any other and gets an option too — that is what stops
 * "Janus did not say" from rendering as a blank select. Callers label it `—` and mark it
 * `disabled`, because there is no way to send *unset*: the option exists to be read, not
 * picked.
 */
export function withCurrent(options: string[], current: string): string[] {
  return options.includes(current) ? options : [current, ...options];
}
