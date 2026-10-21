#!/usr/bin/env bash
# Restore a Blob backup into a scratch database, check it, time it, drop it (M3 · B4).
#
# A backup nobody has restored is a hope. Run this quarterly, and before trusting a new
# server with anything: it is the measured half of docs/backup.md's RPO and RTO.
#
#   python -m blob_api.backups latest --out blob.dump   # inside the app container
#   PGHOST=… PGUSER=… PGPASSWORD=… scripts/restore-drill.sh blob.dump
#
# Needs pg_restore and psql of the dump's major version or newer, and a role that may
# CREATE DATABASE. It never touches the live database: the scratch one is named
# blob_drill_<time> and is dropped on the way out, whatever happened.
set -euo pipefail

dump="${1:?usage: restore-drill.sh <file.dump>}"
[ -r "$dump" ] || { echo "cannot read $dump" >&2; exit 2; }

scratch="blob_drill_$(date -u +%Y%m%d%H%M%S)"
cleanup() { dropdb --if-exists "$scratch" >/dev/null 2>&1 || true; }
trap cleanup EXIT

started=$(date +%s)
createdb "$scratch"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$scratch" "$dump"
restored=$(date +%s)

count() { psql --dbname="$scratch" --no-psqlrc --tuples-only --no-align --command "$1"; }
head=$(count "SELECT version_num FROM alembic_version")
workspaces=$(count "SELECT count(*) FROM workspaces")
people=$(count "SELECT count(*) FROM users WHERE bot_plugin_id IS NULL")
messages=$(count "SELECT count(*) FROM messages")
newest=$(count "SELECT coalesce(max(created_at)::text, 'none') FROM messages")

echo "restored $dump into $scratch in $((restored - started))s"
echo "  schema at ${head}: ${workspaces} workspace(s), ${people} people, ${messages} messages"
echo "  newest message: ${newest}"

# A dump that restores to nothing is not a backup of anything.
[ "${workspaces}" -gt 0 ] || { echo "FAILED: no workspaces in the restored copy" >&2; exit 1; }
echo "OK"
