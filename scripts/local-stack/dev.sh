#!/usr/bin/env bash
# Run `next dev` against the local stack (start it first with scripts/local-stack/start.sh).
set -euo pipefail
DIR="${LOCAL_STACK_DIR:-/tmp/coachlab-local-stack}"
SEED="$DIR/seed.json"
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(node -e "console.log(require('$SEED').anonKey)")"
export SUPABASE_SERVICE_ROLE_KEY="$(node -e "console.log(require('$SEED').serviceKey)")"
export YOUTUBE_TOKEN_ENC_KEY="${YOUTUBE_TOKEN_ENC_KEY:-MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=}"
export NEXT_TELEMETRY_DISABLED=1
exec npx next dev -p "${PORT:-3000}"
