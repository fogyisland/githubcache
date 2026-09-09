#!/usr/bin/env bash
# dev-fresh — kill stale dev server, wipe .next, restart.
#
# Use when `npm run dev` is wedged: cache pollution, port-in-use,
# webpack cache throwing MODULE_NOT_FOUND on vendor-chunks/lib/worker.js.
#
#   ./scripts/dev-fresh.sh           # macOS / Linux
#   pwsh scripts/dev-fresh.ps1       # Windows
#
# After this, `npm run dev` boots clean in ~3s.

set -e

# 1. Find and kill anything on port 5002.
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti:5002 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "→ killing PIDs on :5002: $PIDS"
    kill -9 $PIDS 2>/dev/null || true
  fi
else
  # fallback: fuser or pgrep
  PIDS=$(fuser 5002/tcp 2>/dev/null | tr -d ' ' || true)
  if [ -n "$PIDS" ]; then
    echo "→ killing PIDs on :5002: $PIDS"
    kill -9 $PIDS 2>/dev/null || true
  fi
fi

# 2. Wipe .next cache.
if [ -d .next ]; then
  echo "→ removing .next/"
  rm -rf .next
fi

# 3. Restart.
echo "→ starting npm run dev"
exec npm run dev
