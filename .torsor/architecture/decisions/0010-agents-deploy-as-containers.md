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

## Amendment: an operator may open a shell in their own agent

The original decision left an operator able to deploy an agent, redeploy it and read its
logs — and unable to do anything else to it. That turned out to be too little. Not every
part of setting an agent up is declarative: a device-code login prints a URL and waits for
an approval that completes on another machine, a broken install needs looking at, a prompt
file needs editing. On a laptop that work is a shell, and requiring one here was not a
preference but the shape of the problem.

So the console gained a terminal. **Blob still does not hold the Docker socket**, and the
"no" in the decision above stands unchanged — what is added is narrower than the thing it
refused.

Blob holds an SSH key whose power is decided at the far end by a forced command in
`authorized_keys`. sshd runs that wrapper whatever the client asks for, so Blob does not
send a *command*; it sends an *argument*, and the only argument the wrapper accepts is a
deployment id. The wrapper refuses anything that is not one, refuses Blob's own
deployment, refuses a stack with more than one container rather than guessing, and execs a
shell in that container and nothing else. The blast radius of the credential is one
`docker exec` into one agent.

That distinction is the whole amendment. The socket would have granted "do anything to
anything on this host, forever". This grants "open a shell in a container that passes
these checks", and the checks run on the host — so the confinement does not depend on this
application being correct, which was the property the original decision was protecting.

The host key is required and there is no way to skip verifying it. Without one this is an
authenticated root shell handed to whoever answers on that address, and a flag labelled
"skip host key checking" is the flag that ends up switched on in production. A server
missing any of the settings simply has the feature off.

Every session is audited on the way in as well as the way out, because the sessions worth
having a record of are the ones that did not end tidily — and an open with no close says
that on its own. Idle and absolute timeouts both apply: one catches an operator who walked
away, the other a tab kept alive by something that is not a person.

See [docs/agent-terminal.md](../../../docs/agent-terminal.md) for the wrapper, the key and
the settings.
