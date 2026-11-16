#!/bin/sh
# Container start-up: bring the database schema up to date, optionally seed
# it, then hand over to the API.
set -e

# Applies only migrations that have not run yet. Prisma takes a database
# lock, so several instances starting together cannot migrate twice.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying database migrations"
  npx prisma migrate deploy
fi

# Idempotent: creates the admin/demo accounts and sample rooms if missing.
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] seeding database"
  node dist/database/seed.js
fi

# exec: node replaces this shell, so it receives SIGTERM and shuts down cleanly.
exec node dist/main.js
