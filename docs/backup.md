# Backup and restore

Postgres is the source of truth. Redis is presence, rate limits, the job queue and the
log buffer — losing it is an inconvenience, not data loss. Object storage holds
uploads; losing the bucket loses attachments even if the database still names them.

## What Blob does on its own

Every night the worker runs `pg_dump --format=custom` and streams the dump straight into
object storage — no temporary file, nothing held in memory — as
`backups/blob-YYYYMMDDTHHMMSSZ.dump`, then deletes the ones older than `BACKUP_KEEP_DAYS`
(never the newest). The image carries `pg_dump` 17, which dumps Postgres 16 and 17.

| Variable | Default | |
|---|---|---|
| `BACKUP_ENABLED` | `true` | Off means nothing backs up the database; the Health page says so in red. |
| `BACKUP_S3_BUCKET` | the uploads' bucket | **Set this.** One bucket lost should not take the uploads and the means of restoring the database together. Same credentials and endpoint as `S3_*`. |
| `BACKUP_PREFIX` | `backups/` | |
| `BACKUP_KEEP_DAYS` | `14` | |
| `BACKUP_HOUR_UTC` | `3` | The dump starts at :30 past this hour. |

Set them on **the app and the worker both**: the worker takes the backup, the app reports
it.

A workspace with a retention window (Admin → Retention, ADR 0039) has its sweep run an hour
after the backup begins, at :40 past `BACKUP_HOUR_UTC + 1`, so each night's dump holds what
that night's sweep is about to remove. Backups keep it for `BACKUP_KEEP_DAYS` more — the
window in which a retention mistake can still be undone by a restore, and the reason a
workspace that must forget quickly should keep that number short. **Admin → Health → Backups** shows the last one — its size and age, or why it failed —
and turns red when a night is missed. The server's administrators also get **Back up now**
there, for the moment before an upgrade.

## Restore

From inside the app container, fetch the newest dump:

```bash
python -m blob_api.backups list
python -m blob_api.backups latest --out blob.dump
```

Prove it restores before you need it — quarterly, and on any new server — with the drill.
It restores into a scratch database, checks that it holds a workspace, prints the
schema head and the counts, times it, and drops the scratch copy whatever happened:

```bash
PGHOST=… PGUSER=… PGPASSWORD=… scripts/restore-drill.sh blob.dump
```

It needs a role that may `CREATE DATABASE` and a `pg_restore` of the dump's version or
newer. On the development server, a 1-workspace, 39-message dump restored in a second;
time yours and write the number down.

To restore for real, stop the app and the worker first — open transactions fight a
`--clean` — then:

```bash
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" blob.dump
pnpm migrate   # in case the dump is from an older schema
```

and start both again so they reconnect to the new catalog.

## How much you can lose, and for how long

- **RPO — at most a day.** The dump is nightly; whatever was written since the last one is
  what a restore cannot bring back. Take one with **Back up now** before anything risky.
- **RTO — the drill's time, plus fetching the dump.** Measure it with the drill on your
  own data rather than trusting anybody's estimate, this one included.

## What this does not cover

- **Uploads.** The dump holds the database, not the files it names. Version the uploads
  bucket, or `mc mirror` it somewhere else on a schedule.
- **`.env`.** Theme files and the built bundle come from the image; the environment does
  not. Keep `.env` where the people who hold the dumps can reach it — VAPID keys in
  particular: a restore onto a new machine with new keys silently stops web push.
- **Redis.** Not worth backing up; `plugin_deliveries` is in Postgres.
