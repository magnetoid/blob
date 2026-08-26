# A terminal in a hosted agent

For the part of setting an agent up that is not a form.

A device-code login prints a URL and waits for an approval that happens on another
machine. A broken virtualenv needs looking at. A prompt file needs editing. On a laptop
all of that is a shell — and an agent Blob deployed had no equivalent, so the console
could redeploy it and read its logs and nothing in between. That is the difference between
an operator who can fix a thing and one who can only turn it off and on again.

- Endpoint: `wss://<your-blob>/ws/admin/agents/{pluginId}/shell`
- Handler: [routers/agent_shell.py](../apps/api/src/blob_api/routers/agent_shell.py)
- Who may open one: [services/agent_shell.py](../apps/api/src/blob_api/services/agent_shell.py)
- The PTY itself: [plugins/shell.py](../apps/api/src/blob_api/plugins/shell.py)

## Blob does not hold the Docker socket

[ADR 0010](../.torsor/architecture/decisions/0010-blob-does-not-hold-the-docker-socket.md)
said it never should, on the grounds that a compromise of the chat app must not become a
compromise of the box. That decision was **overruled deliberately** — an operator needs a
shell in their own agent — and the reasoning is honoured rather than discarded.

Blob gets an SSH key. The far end decides what that key can do, using a forced command:

```
command="/usr/local/bin/blob-agent-exec",no-port-forwarding,no-agent-forwarding,
no-X11-forwarding,no-user-rc ssh-ed25519 AAAA…
```

sshd runs that wrapper **whatever the client asks for**. So what Blob sends is not a
command, it is an *argument*, and the only argument the wrapper accepts is a deployment
id. The blast radius of this credential is one `docker exec` into one container that
passes the checks, and nothing else.

### The wrapper

Install as `/usr/local/bin/blob-agent-exec`, mode `0755`:

```sh
#!/bin/sh
set -eu
CMD=${SSH_ORIGINAL_COMMAND:-}

# Blob's own stack. Refused outright, so this key can never open a shell in the database
# that holds every message in the workspace.
BLOB_APP_UUID='replace-with-your-blob-deployment-uuid'

log() { logger -t blob-agent-exec "$*" 2>/dev/null || true; }
deny() { log "DENY $1 target=${2:-}"; echo "blob-agent-exec: $1" >&2; exit 1; }

[ -n "$CMD" ] || deny 'no agent named'

# One token, nothing else. Anything that is not a bare identifier is refused rather than
# sanitised — no pipes, no semicolons, no substitution.
case "$CMD" in
  *[!a-zA-Z0-9_.-]*) deny 'that is not an agent id' "$CMD" ;;
esac
echo "$CMD" | grep -Eq '^[a-z0-9]{24}$' || deny 'that is not a deployment id' "$CMD"
case "$CMD" in "$BLOB_APP_UUID") deny 'that deployment is Blob itself' "$CMD" ;; esac

# Blob knows the deployment's uuid, not the container name — the platform appends a
# timestamp at deploy time, so the name changes on every redeploy and an agent that had
# to be re-pointed after each one would not stay pointed.
MATCHES=$(docker ps --filter "name=-$CMD-" --format '{{.Names}}' 2>/dev/null || true)
COUNT=$(printf '%s\n' "$MATCHES" | grep -c . || true)
[ "$COUNT" -ge 1 ] || deny 'that agent has no running container' "$CMD"
[ "$COUNT" -eq 1 ] || deny "that deployment has $COUNT containers; name one" "$CMD"

TARGET=$MATCHES
log "EXEC target=$TARGET from=${SSH_CLIENT%% *}"

# A PTY only when the client asked for one. Not cosmetic: the flows this exists for are
# interactive, and without a terminal those programs either refuse to prompt or buffer
# their output until they exit, which looks like the shell having hung.
TTY_FLAG=''
[ -n "${SSH_TTY:-}" ] && TTY_FLAG='-t'

# shellcheck disable=SC2086 — TTY_FLAG is one word or empty, deliberately unquoted.
exec docker exec -i $TTY_FLAG "$TARGET" sh -c 'exec ${SHELL:-/bin/sh} -l 2>/dev/null || exec /bin/sh'
```

Verify the confinement before trusting it. All four must refuse:

```bash
ssh -i key user@host 'whoami'                  # → no agent named / that is not a deployment id
ssh -i key user@host 'cat /etc/shadow'         # → that is not an agent id
ssh -i key user@host "$BLOB_APP_UUID"          # → that deployment is Blob itself
ssh -i key user@host 'abc; rm -rf /'           # → that is not an agent id
```

## Settings

```bash
AGENT_SHELL=ssh
AGENT_SHELL_HOST=host.example.com
AGENT_SHELL_PORT=22
AGENT_SHELL_USER=root                  # whichever account holds the forced command
AGENT_SHELL_KEY="-----BEGIN OPENSSH PRIVATE KEY-----\n…"
AGENT_SHELL_HOST_KEY="ssh-ed25519 AAAA…"
```

All four are required, and with any of them missing the feature is simply off — which the
console says, rather than offering a button that fails.

`AGENT_SHELL_KEY` is read inline because that is how a container is configured. Escaped
newlines (`\n`) are accepted as well as real ones, because a key pasted into a dashboard
field arrives that way about half the time.

**`AGENT_SHELL_HOST_KEY` is not optional and there is no way to skip verification.**
Without it this is an authenticated root shell handed to whoever answers on that address,
and a flag labelled "skip host key checking" is the flag that ends up switched on in
production. Get the value with:

```bash
ssh-keyscan -t ed25519 host.example.com
```

Either the whole `known_hosts` line or just the `type key` half of it will do.

## Generating the key

```bash
ssh-keygen -t ed25519 -N '' -f blob_agent_shell -C 'blob agent terminal'
# then, on the host, in the chosen account's ~/.ssh/authorized_keys:
#   command="/usr/local/bin/blob-agent-exec",no-port-forwarding,no-agent-forwarding,\
#   no-X11-forwarding,no-user-rc ssh-ed25519 AAAA…
```

## What the socket carries

JSON frames with a `t` discriminator, like Blob's other socket protocols. Authentication
is the ordinary **session cookie** — a terminal is a first-party console feature, and
giving it a credential of its own would mean a long-lived secret that opens a root shell.

| Browser → Blob | Blob → browser |
|---|---|
| `{"t":"in","data":"ls\r"}` | `{"t":"ready","agent":"Janus"}` |
| `{"t":"resize","cols":120,"rows":30}` | `{"t":"out","data":"…"}` |
| `{"t":"ping"}` | `{"t":"exit","code":0}` / `{"t":"error","message":"…"}` / `{"t":"pong"}` |

Output is text, not base64: the stream is almost entirely printable characters and
encoding it would waste a third of the bandwidth. It is decoded **incrementally**, because
a PTY splits wherever the read boundary falls and a multi-byte character routinely arrives
in two pieces.

Unknown frames are ignored rather than fatal, on both sides.

## Bounds

| | |
|---|---|
| Idle timeout | `AGENT_SHELL_IDLE_SEC`, 15 minutes |
| Absolute timeout | `AGENT_SHELL_MAX_SEC`, 4 hours |
| Concurrent terminals per process | `AGENT_SHELL_MAX_SESSIONS`, 8 |
| Connect timeout | `AGENT_SHELL_CONNECT_TIMEOUT_SEC`, 15s |

Both timeouts exist because they catch different things: the idle one catches somebody who
walked away, the absolute one catches a tab kept alive by something that is not a person.

## Who may open one

Three checks, all made when the terminal is opened rather than when the console was
loaded — a console tab sits open for a day, and a revoked admin should not still have a
shell behind it.

1. An admin or owner of the workspace.
2. The plugin is one **this workspace** owns and one Blob actually hosts.
3. The workspace's `may_host_agents` policy is on. Choosing what code runs in a container
   and getting inside it are the same privilege; a workspace denied the first should not
   be handed the second.

Every session is audited as `plugin.shell_opened` and `plugin.shell_closed`, with the
duration. The open is written **before** the session starts, not after it ends: a shell
that hangs, a killed process or a container that dies mid-session all end without an
"after", and those are exactly the sessions a log is for.

## What it is not

Not a shell on the host. Not a shell in Blob's own containers. Not a way to reach the
database. The wrapper refuses all three, and it refuses them on the host rather than in
Blob — which is the point: the confinement does not depend on this application being
correct.
