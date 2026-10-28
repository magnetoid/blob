/**
 * Typed HTTP client. Every call goes through here so error shapes stay consistent.
 *
 * The groups live in `lib/api/<group>.ts`; this file assembles them into `api` and
 * re-exports every type, so a consumer imports from here and nothing else.
 */

import type { Call, CallKind, CallSettings, CallsState, CallToken, MediaServerStatus } from "@blob/shared";
import { clientErrors } from "./api/clientErrors.ts";
import { auth } from "./api/auth.ts";
import { passkeys } from "./api/passkeys.ts";
import { sso } from "./api/sso.ts";
import { me } from "./api/me.ts";
import { users } from "./api/users.ts";
import { files } from "./api/files.ts";
import { later } from "./api/later.ts";
import { work } from "./api/work.ts";
import { agentRuns } from "./api/agentRuns.ts";
import { groups } from "./api/groups.ts";
import { workspaces } from "./api/workspaces.ts";
import { channels } from "./api/channels.ts";
import { dms } from "./api/dms.ts";
import { calls } from "./api/calls.ts";
import { messages } from "./api/messages.ts";
import { scheduled } from "./api/scheduled.ts";
import { agents } from "./api/agents.ts";
import { assistants } from "./api/assistants.ts";
import { drafts } from "./api/drafts.ts";
import { mail } from "./api/mail.ts";
import { oauth } from "./api/oauth.ts";
import { agentic } from "./api/agentic.ts";
import { themes } from "./api/themes.ts";
import { decisions } from "./api/decisions.ts";
import { admin } from "./api/admin.ts";
import { activity } from "./api/activity.ts";
import { feedback } from "./api/feedback.ts";
import { uploads } from "./api/uploads.ts";
import { bootstrap, interact, search, sync } from "./api/core.ts";

export type { Call, CallKind, CallSettings, CallsState, CallToken, MediaServerStatus };
export { ApiError } from "./api/client.ts";
export type {
  AuthSession,
  AccountEvent,
  PasskeyChallenge,
  SsoChoice,
  ReauthState,
} from "./api/auth.ts";
export type {
  PasskeyRow,
} from "./api/passkeys.ts";
export type {
  SsoIdentity,
} from "./api/sso.ts";
export type {
  ExportEntry,
} from "./api/me.ts";
export type {
  WorkspaceMembership,
} from "./api/workspaces.ts";
export type {
  UsageLine,
  UsageModel,
  UsageReport,
  AgentNote,
  AgentMemory,
  AgentLoan,
  MyAgent,
  WorkspaceAgent,
  AppChannel,
} from "./api/agents.ts";
export type {
  AssistantToken,
} from "./api/assistants.ts";
export type {
  DraftSave,
} from "./api/drafts.ts";
export type {
  UnsubscribeInfo,
} from "./api/mail.ts";
export type {
  OAuthConsentRequest,
  OAuthGrant,
} from "./api/oauth.ts";
export type {
  InstanceUser,
  WorkspaceEmoji,
  WorkspacePolicy,
  WorkspaceAssistantToken,
  ModelPrice,
  UsagePrices,
  WorkspaceOAuthGrant,
  InstanceWorkspace,
  AdminUser,
  AdminInvite,
  AdminChannel,
  AuditEvent,
  AdminWebhook,
  AdminHealth,
  AdminStorage,
  ServerLogEntry,
  AdminPlugin,
  JanusPart,
  JanusInstall,
  JanusOverview,
  JanusConfigChange,
  JanusApplied,
  AgentRepoPreview,
  AgentDeployment,
  AgentEnvVar,
  FollowedChannel,
  FollowHears,
  McpToolPolicy,
  McpTool,
  McpServer,
  McpServerAuthInput,
  AdminPluginCatalog,
  AdminAgentRun,
  AppRecentError,
  AdminRunEvent,
  AdminRunEvents,
  AdminPluginDelivery,
  AdminPluginDeliveryDetail,
  AdminWorkspaceDelivery,
  SsoProvider,
  SsoProviderInput,
  KeptVersions,
  ImportPreview,
  ImportProgress,
  ImportRecord,
  ImportState,
  ImportedPerson,
  RetentionView,
  SecurityCheck,
  PendingApproval,
  ClientErrorEntry,
  RetentionPreview,
} from "./api/admin.ts";
export type {
  ActivityKind,
  ActivityItem,
} from "./api/activity.ts";
export type {
  SearchSort,
  ParsedSearchQuery,
} from "./api/core.ts";

export const api = {
  clientErrors,
  auth,
  passkeys,
  sso,
  bootstrap,
  me,
  users,
  files,
  later,
  work,
  agentRuns,
  groups,
  workspaces,
  channels,
  dms,
  calls,
  messages,
  scheduled,
  agents,
  assistants,
  drafts,
  mail,
  oauth,
  agentic,
  themes,
  decisions,
  admin,
  interact,
  activity,
  search,
  sync,
  feedback,
  uploads,
};
