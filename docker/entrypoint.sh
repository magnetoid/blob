#!/bin/sh
# Migrate, then become the server. A deploy never serves against a schema it does not
# have, and a failed migration stops the container rather than starting a broken one.
#
# The worker runs the same image with RUN_MIGRATIONS=false: it waits on the app's health
# check, so by the time it boots the schema is already current.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  python -m blob_api.db.migrate
fi

exec "$@"
