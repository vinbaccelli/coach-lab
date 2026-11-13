#!/usr/bin/env bash
# Local Supabase stand-in for browser / API / RLS tests. DEV ONLY.
#   scripts/local-stack/start.sh --reset   # fresh database: bootstrap + every migration + seed
# Needs PostgreSQL 16 binaries (initdb, pg_ctl, psql). Postgres refuses to run as root, so when
# run as root it uses (and creates) a "pgtest" user.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="${LOCAL_STACK_DIR:-/tmp/coachlab-local-stack}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT=54322
mkdir -p "$DIR"
run_pg() { if [ "$(id -u)" = 0 ]; then su pgtest -c "$*"; else bash -c "$*"; fi; }
if [ "$(id -u)" = 0 ]; then id pgtest >/dev/null 2>&1 || useradd -m pgtest; chown pgtest "$DIR"; chmod 755 "$DIR"; fi
if [ ! -f "$DIR/data/PG_VERSION" ]; then run_pg "$PGBIN/initdb -D $DIR/data -U postgres --auth=trust >/dev/null"; fi
if ! "$PGBIN/pg_isready" -h 127.0.0.1 -p $PORT >/dev/null 2>&1; then
  run_pg "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c listen_addresses=127.0.0.1' -l $DIR/pg.log start" >/dev/null
  sleep 2
fi
PSQL="psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1"
if [ "${1:-}" = "--reset" ] || ! $PSQL -d coachlab -c 'select 1' >/dev/null 2>&1; then
  $PSQL -d postgres -c "drop database if exists coachlab" -c "create database coachlab"
  $PSQL -d coachlab -f "$ROOT/scripts/local-stack/bootstrap.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do $PSQL -d coachlab -f "$f" >/dev/null; done
  node "$ROOT/scripts/local-stack/seed.mjs" > "$DIR/seed.json"
  echo "database ready ($(ls "$ROOT"/supabase/migrations/*.sql | wc -l) migrations)"
fi
pkill -f "scripts/local-stack/server.mjs" 2>/dev/null || true
LOCAL_STORAGE_DIR="$DIR/storage" nohup node "$ROOT/scripts/local-stack/server.mjs" > "$DIR/server.log" 2>&1 &
sleep 1
echo "REST/auth stand-in on http://localhost:54321 (log: $DIR/server.log)"
