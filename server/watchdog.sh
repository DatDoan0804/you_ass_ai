#!/bin/bash
# ==============================================================================
# Subtitle Server Watchdog & Auto-Restart Daemon (`server/watchdog.sh`)
#
# Checks health of local subtitle server on http://127.0.0.1:8765/health.
# If dead, crashed, or unresponsive, automatically restarts it and logs.
#
# Can be run:
# - Manually: ./server/watchdog.sh
# - From cron: * * * * * /bin/bash /home/bo/Downloads/ass_you/server/watchdog.sh
# ==============================================================================

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_SCRIPT="$DIR/server/subtitle-server.js"
LOG_FILE="$DIR/server/server.log"
PID_FILE="$DIR/server/server.pid"
PORT="${PORT:-8765}"
HEALTH_URL="http://127.0.0.1:$PORT/health"

# 1. Quick health check using curl (2s timeout)
if curl -s -m 2 "$HEALTH_URL" | grep -q '"status":"running"'; then
  # Server is healthy
  exit 0
fi

# 2. Server is not responding. Check for frozen/zombie process
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Watchdog] Process $OLD_PID unresponsive. Terminating." >> "$LOG_FILE"
    kill -TERM "$OLD_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# Also check for any orphaned process bound to port
ORPHAN_PID="$(lsof -ti :"$PORT" 2>/dev/null || true)"
if [ -n "$ORPHAN_PID" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Watchdog] Killing orphaned process $ORPHAN_PID on port $PORT" >> "$LOG_FILE"
  kill -9 "$ORPHAN_PID" 2>/dev/null || true
fi

# 3. Start server in background
NODE_BIN="$(which node 2>/dev/null || echo "/usr/bin/node")"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Watchdog] Subtitle server down. Starting with $NODE_BIN..." >> "$LOG_FILE"
nohup "$NODE_BIN" "$SERVER_SCRIPT" >> "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"

# Wait briefly and verify startup
sleep 1
if curl -s -m 2 "$HEALTH_URL" | grep -q '"status":"running"'; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Watchdog] Subtitle server successfully started (PID: $NEW_PID)." >> "$LOG_FILE"
  exit 0
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Watchdog] Warning: Subtitle server started (PID: $NEW_PID) but health check pending." >> "$LOG_FILE"
  exit 0
fi
