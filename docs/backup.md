# Backup and restore

Postgres is the source of truth. Redis is presence, rate limits, the job queue and the
log buffer — losing it is an inconvenience, not data loss. Object storage holds
uploads; losing the bucket loses attachments even if the database still names them.

## Backup

From the host that can reach Postgres (the compose network, or `localhost` in
development):

```bash
pg_dump --format=custom --file=blob-$(date -u +%Y%m%d).dump "$DATABASE_URL"
```

Coolify: use the postgres service backup if you enabled it, and keep a copy off the
server. The dump is the restore; a volume snapshot of the container is not a substitute.

Object storage: version the bucket, or `mc mirror` it somewhere else on a schedule.
Redis: do not bother unless you are draining a long plugin-outbox; `plugin_deliveries`
is in Postgres.

## Restore

```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" blob-YYYYMMDD.dump
```

Then run migrations in case the dump is from an older schema:

```bash
pnpm migrate
```

Do not restore over a live workspace without stopping the API and worker first — open
transactions will fight the `--clean`. After restore, restart both so they reopen
connections against the new catalog.

## What this does not cover

Theme files, the built web bundle, and `.env` are not in the database. Keep `.env`
somewhere the same people who hold the dump can reach. VAPID keys in particular: a
restore onto a new machine with new keys silently stops web push.
