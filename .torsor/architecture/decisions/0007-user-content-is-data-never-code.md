---
type: decision
status: accepted
tags: [adr, security]
links: []
rules: []
---

# ADR 0007: Anything a user supplies is data, never code

## Context
Two features invite the same mistake in different clothes. A theme editor wants to let an
admin change colours — the easy version stores a CSS string. An app wants to send rich
messages — the easy version stores HTML.

## Decision
Neither is ever stored or rendered as source text.

- **Themes** are `{token: value}` maps. Token names come from a 41-entry allowlist and
  values must match a colour grammar, so `--bg: #fff; position: fixed` is refused at save
  time. Applied with `root.style.setProperty`, never by injecting a stylesheet.
- **Blocks** are a discriminated union of seven types, rendered by a `switch` producing
  React elements and reusing `renderInline()` for text — the XSS surface is the one
  message bodies already have.
- **Interactions** are checked against the *stored* blocks: the server verifies the
  `actionId` exists in the message it claims to come from, so a client cannot forge one.

## Consequences
A hostile admin cannot smuggle a declaration into every page through a theme, and a
hostile app cannot smuggle markup into a channel. The validation lives at the write
boundary, so the render path has nothing to sanitise.
