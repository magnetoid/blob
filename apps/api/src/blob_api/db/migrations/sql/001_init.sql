-- Initial schema. See TEAM-CHAT-BUILD-PLAN.md §5.3 for the reasoning behind
-- each denormalization and index.

CREATE EXTENSION IF NOT EXISTS citext;

-- ─── identity ────────────────────────────────────────────────────────────────
CREATE TABLE workspaces (
  id         uuid PRIMARY KEY,
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                uuid PRIMARY KEY,
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email             citext NOT NULL,
  password_hash     text,
  display_name      text NOT NULL,
  full_name         text,
  title             text,
  avatar_key        text,
  timezone          text NOT NULL DEFAULT 'UTC',
  role              text NOT NULL DEFAULT 'member'
                    CHECK (role IN ('member', 'admin', 'owner')),
  status_emoji      text,
  status_text       text,
  status_expires_at timestamptz,
  prefs             jsonb NOT NULL DEFAULT '{}'::jsonb,
  deactivated_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);
-- Mention resolution looks users up by lowercased display name.
CREATE UNIQUE INDEX users_display_name_uniq
  ON users (workspace_id, lower(display_name)) WHERE deactivated_at IS NULL;

CREATE TABLE sessions (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  user_agent   text,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE invites (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        citext,
  token_hash   text NOT NULL UNIQUE,
  created_by   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_resets (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── channels ────────────────────────────────────────────────────────────────
CREATE TABLE channels (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('public', 'private', 'dm', 'group_dm')),
  name            text,
  topic           text,
  description     text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  archived_at     timestamptz,
  -- Denormalized so "has unread?" is one UUIDv7 comparison, never a COUNT.
  last_message_id uuid,
  -- Sorted member-id digest; makes DM creation idempotent.
  dm_key          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX channels_name_uniq ON channels (workspace_id, lower(name))
  WHERE kind IN ('public', 'private');
CREATE UNIQUE INDEX channels_dm_uniq ON channels (workspace_id, dm_key)
  WHERE dm_key IS NOT NULL;
CREATE INDEX channels_workspace ON channels (workspace_id);

CREATE TABLE channel_members (
  channel_id   uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  notify_level text NOT NULL DEFAULT 'mentions'
               CHECK (notify_level IN ('all', 'mentions', 'none')),
  is_starred   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX channel_members_user ON channel_members (user_id);

-- ─── messages ────────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id                uuid PRIMARY KEY,              -- UUIDv7: sorts chronologically
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id        uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  kind              text NOT NULL DEFAULT 'user'
                    CHECK (kind IN ('user', 'system', 'bot')),
  body              text NOT NULL DEFAULT '',
  thread_root_id    uuid REFERENCES messages(id) ON DELETE CASCADE,
  also_in_channel   boolean NOT NULL DEFAULT false,
  reply_count       integer NOT NULL DEFAULT 0,
  reply_user_ids    uuid[] NOT NULL DEFAULT '{}',
  last_reply_at     timestamptz,
  mention_user_ids  uuid[] NOT NULL DEFAULT '{}',
  mentions_everyone boolean NOT NULL DEFAULT false,
  client_msg_id     text NOT NULL,
  edited_at         timestamptz,
  deleted_at        timestamptz,
  pinned_at         timestamptz,
  pinned_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  search_tsv        tsvector GENERATED ALWAYS AS (to_tsvector('english', body)) STORED
);
-- The workhorse: a channel's timeline, newest first.
CREATE INDEX messages_channel_id_desc ON messages (channel_id, id DESC);
CREATE INDEX messages_thread ON messages (thread_root_id, id)
  WHERE thread_root_id IS NOT NULL;
-- Idempotent sends: retrying the same client_msg_id is a no-op.
CREATE UNIQUE INDEX messages_client_idem ON messages (channel_id, author_id, client_msg_id);
CREATE INDEX messages_search ON messages USING GIN (search_tsv);
CREATE INDEX messages_mentions ON messages USING GIN (mention_user_ids);
CREATE INDEX messages_pinned ON messages (channel_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;
CREATE INDEX messages_author ON messages (author_id, id DESC);

CREATE TABLE reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, emoji, user_id)
);
CREATE INDEX reactions_message ON reactions (message_id);

CREATE TABLE attachments (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id   uuid REFERENCES messages(id) ON DELETE CASCADE,
  uploader_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key   text NOT NULL,
  thumb_key    text,
  filename     text NOT NULL,
  mime         text NOT NULL,
  size_bytes   bigint NOT NULL,
  width        integer,
  height       integer,
  uploaded_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_message ON attachments (message_id);
-- Sweeper target: uploads never bound to a message.
CREATE INDEX attachments_orphans ON attachments (created_at) WHERE message_id IS NULL;

CREATE TABLE custom_emoji (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  object_key   text NOT NULL,
  created_by   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, name)
);

-- ─── attention state ─────────────────────────────────────────────────────────
CREATE TABLE read_states (
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id           uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read_message_id uuid,
  mention_count        integer NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE thread_subscriptions (
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_root_id     uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  last_read_reply_id uuid,
  muted              boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_root_id)
);
CREATE INDEX thread_subs_root ON thread_subscriptions (thread_root_id);

CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subs_user ON push_subscriptions (user_id);

CREATE TABLE webhooks (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id   uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  created_by   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
