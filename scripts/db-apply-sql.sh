#!/usr/bin/env bash
#
# Apply a SQL file to the Supabase project via the Management API.
# Durable, low-friction migration path — no CLI/psql needed, and (unlike
# `supabase db push`) it runs exactly the SQL you point at, so it can't replay
# historical migrations on a manually-built database.
#
# One-time setup: create a Supabase Personal Access Token
#   Supabase Dashboard → Account → Access Tokens → Generate new token
# then add it to coach-lab/.env.local (gitignored — never committed):
#   SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx
#
# Usage:
#   scripts/db-apply-sql.sh supabase/migrations/20260709120000_subscription_tier.sql
#
set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env.local (SUPABASE_ACCESS_TOKEN, optional SUPABASE_PROJECT_REF).
if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN in .env.local (a Supabase Personal Access Token, sbp_...)}"

# Derive project ref from the Supabase URL if not set explicitly.
if [ -z "${SUPABASE_PROJECT_REF:-}" ] && [ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
  SUPABASE_PROJECT_REF="$(printf '%s' "$NEXT_PUBLIC_SUPABASE_URL" | sed -E 's#https?://([^.]+)\..*#\1#')"
fi
: "${SUPABASE_PROJECT_REF:?Could not determine project ref; set SUPABASE_PROJECT_REF in .env.local}"

FILE="${1:?Usage: scripts/db-apply-sql.sh <path-to-.sql>}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }

export SUPABASE_PROJECT_REF SUPABASE_ACCESS_TOKEN FILE
echo "Applying $FILE to project $SUPABASE_PROJECT_REF …"
python3 - <<'PY'
import os, json, urllib.request, urllib.error
ref = os.environ["SUPABASE_PROJECT_REF"]
tok = os.environ["SUPABASE_ACCESS_TOKEN"]
sql = open(os.environ["FILE"]).read()
req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{ref}/database/query",
    data=json.dumps({"query": sql}).encode(),
    headers={
        "Authorization": f"Bearer {tok}",
        "Content-Type": "application/json",
        # A real User-Agent is required — the API sits behind Cloudflare, which
        # blocks the default "Python-urllib/*" signature with a 403 (code 1010).
        "User-Agent": "coach-lab-migrator/1.0",
    },
    method="POST",
)
try:
    r = urllib.request.urlopen(req)
    print("OK", r.status)
    body = r.read().decode()
    if body.strip():
        print(body[:2000])
except urllib.error.HTTPError as e:
    print("ERROR", e.code)
    print(e.read().decode()[:2000])
    raise SystemExit(1)
PY
echo "Done."
