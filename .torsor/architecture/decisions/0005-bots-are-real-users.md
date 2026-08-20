---
type: decision
status: accepted
tags: [adr, plugins]
links: []
rules:
  - kind: forbid_layer_import
    target: "blob_api\\.routers(\\.|$)"
    scope: "apps/api/src/blob_api/plugins/*.py"
    message: "plugins/ must not import routers/ — routers depend on the plugin layer, not the reverse. ADR 0005."
    severity: error
---

# ADR 0005: A plugin's bot is a real user row

## Context
An app that posts messages needs an identity. The tempting shortcut is a parallel concept
— a `bot_id` beside `author_id`, nullable, with the client taught to render both.

## Decision
Each plugin gets a `users` row with `kind='bot'` and no password hash.

## Consequences
`messages.author_id` stays a valid foreign key, and avatars, mentions, member lists, DMs
and search all work on a bot with **zero frontend changes**. Verified in a browser: a
bot's message is indistinguishable from a person's.

Authorization needs no second implementation. A bot goes through the same
`assert_channel_access` a person does, against its own row — so private channels are
already correct, and answer 404 rather than 403 for the same reason they do for people.

`messages.kind='bot'` drives exactly one addition, an "APP" chip, and that is the whole
client-side cost.

Uninstalling **deactivates** the bot rather than deleting it. Deleting would null
`author_id` across every message the app ever posted and turn a year of CI notifications
into messages from nobody.

A bot needs an email because `users.email` is NOT NULL and unique per workspace;
`{slug}@bots.invalid` is used, because `.invalid` is reserved by RFC 2606 and can never
resolve, so a stray send fails rather than reaching a stranger.
