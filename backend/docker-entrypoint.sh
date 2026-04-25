#!/bin/sh
# Backend container entrypoint.
#
# Behavior:
#   1. If SEED_ON_EMPTY != "0", check whether the seeded user
#      (alice@example.com) exists in the SQLite DB referenced by
#      SEED_CHECK_DB (default: ./scheduler.db, which under the compose bind
#      mount is backend/scheduler.db on the host).
#   2. If the check fails (DB missing, table missing, or no seeded user),
#      run the existing seed script — which is NOT modified by this feature
#      (FR-003). The seed script runs Base.metadata.create_all itself.
#   3. exec uvicorn so it becomes PID 1 and handles SIGTERM cleanly.

set -e

SEED_ON_EMPTY="${SEED_ON_EMPTY:-1}"
SEED_CHECK_DB="${SEED_CHECK_DB:-./scheduler.db}"
# Reload flag is on by default (dev compose expects it) but can be turned
# off for the production / Helm image by setting UVICORN_RELOAD=0.
UVICORN_RELOAD="${UVICORN_RELOAD:-1}"

if [ "$SEED_ON_EMPTY" = "1" ]; then
  if ! python - <<PY
import os, sqlite3, sys

db_path = os.environ.get("SEED_CHECK_DB", "./scheduler.db")
if not os.path.exists(db_path):
    sys.exit(1)

conn = sqlite3.connect(db_path)
try:
    row = conn.execute(
        "SELECT 1 FROM users WHERE email = 'alice@example.com' LIMIT 1"
    ).fetchone()
    sys.exit(0 if row else 1)
except sqlite3.OperationalError:
    # Table 'users' does not exist yet — treat as empty.
    sys.exit(1)
finally:
    conn.close()
PY
  then
    echo "[entrypoint] seeded user not found at ${SEED_CHECK_DB} — running seed_data.py"
    python scripts/seed_data.py
  else
    echo "[entrypoint] seeded user already present at ${SEED_CHECK_DB} — skipping seed"
  fi
else
  echo "[entrypoint] SEED_ON_EMPTY=0 — skipping seed check"
fi

if [ "$UVICORN_RELOAD" = "1" ]; then
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
else
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000
fi
