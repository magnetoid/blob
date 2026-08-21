---
type: decision
status: accepted
tags: [adr, plugins, agents, security, deployment]
links: [0005-bots-are-real-users, 0009-local-plugins-are-a-deploy]
rules: []
---

# ADR 0010: An agent installed from a repository runs as a container, never in-process

## Context
The workspace should be able to take an agent from a Git repository and run it, without
that becoming the thing [[0009-local-plugins-are-a-deploy]] refuses. That ADR is about
where code runs, not where it came from: a local plugin is dangerous because it shares
the FastAPI process, and no amount of provenance changes that.

## Decision
An agent installed from a repository is an **external app whose hosting Blob arranged**.
It gets `runtime: "container"`, which is a deployment detail on top of the external
contract — its own process, its own container, talking to Blob over `/api/v1/` with a
scoped bot token, receiving HMAC-signed deliveries. Nothing about the trust model moves.

Blob does not hold the Docker socket. Deployment goes through a runner adapter, and the
first one drives Coolify's API, because a host running Coolify already has something
whose job is to own that socket. `AGENT_RUNNER` selects it; unset means the feature is
off and agents are registered but not hosted.

## Consequences
The security boundary is the same one external apps already have, which is the point: a
container-hosted agent can do exactly what its granted scopes allow and nothing else,
and `assert_channel_access` against its bot user keeps private channels private with no
new code.

Handing the socket to Blob would have been simpler and is refused. On a host running
other people's sites, a compromise of the chat app must not become a compromise of the
box; the runner keeps that privilege in the component that already had it.

What this does add is a supply-chain question that registering a URL did not have: the
repository's code now runs on the operator's hardware. The manifest is fetched over the
same SSRF-guarded path as registration, the scopes still need admin approval, and the
console shows the repository and commit — but an admin deploying an agent is trusting
that repository the way they trust any container they run. The docs say so.

The sentence the docs use: *"Deploying an agent runs someone else's code on your server,
in its own container with only the scopes you granted. It cannot reach the workspace
except through the API every app uses."*
