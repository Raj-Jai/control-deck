#!/bin/bash
# toggle-broadcast.sh — Toggle laptop mute + streaming to all connected devices
# without opening the dashboard UI. Bound to a global hotkey (default: Ctrl+Alt+B).
# Usage: ./scripts/toggle-broadcast.sh
#        curl toggle directly: curl -s -X POST http://localhost:8080/api/stream/broadcast -d '{"action":"toggle"}'

set -e

# Find config.json (prefer CONFIG_PATH if set, else ./config.json)
CONFIG=""
if [ -n "$CONFIG_PATH" ] && [ -f "$CONFIG_PATH" ]; then
  CONFIG="$CONFIG_PATH"
elif [ -f "$(dirname "$0")/../config.json" ]; then
  CONFIG="$(dirname "$0")/../config.json"
elif [ -f "./config.json" ]; then
  CONFIG="./config.json"
fi

PORT=8080
if [ -n "$CONFIG" ] && [ -f "$CONFIG" ]; then
  # Try jq, then python3, then grep fallback
  if command -v jq >/dev/null 2>&1; then
    P=$(jq -r '.http_port // 8080' "$CONFIG" 2>/dev/null || echo 8080)
    if [ "$P" != "null" ] && [ -n "$P" ]; then PORT="$P"; fi
  elif command -v python3 >/dev/null 2>&1; then
    P=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('http_port',8080))" 2>/dev/null || echo 8080)
    if [ -n "$P" ]; then PORT="$P"; fi
  else
    P=$(grep -o '"http_port"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG" | grep -o '[0-9]*' | head -1)
    if [ -n "$P" ]; then PORT="$P"; fi
  fi
fi

# Also allow overriding via first arg or env
if [ -n "$1" ]; then PORT="$1"; fi
if [ -n "$TAB_DASHBOARD_PORT" ]; then PORT="$TAB_DASHBOARD_PORT"; fi

URL="http://localhost:${PORT}/api/stream/broadcast"
echo "Toggling broadcast via $URL ..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "$URL" -H "Content-Type: application/json" -d '{"action":"toggle"}' 2>&1)
BODY=$(echo "$RESP" | sed '$d')
CODE=$(echo "$RESP" | tail -1)

if [ "$CODE" = "200" ]; then
  ACTION=$(echo "$BODY" | grep -o '"action"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
  if [ -n "$ACTION" ]; then
    echo "OK: broadcast $ACTION"
    # Notify via desktop notification if available
    if command -v notify-send >/dev/null 2>&1; then
      if [ "$ACTION" = "start" ]; then
        notify-send "Tab Dashboard" "Broadcast started — laptop muted, streaming to all devices"
      else
        notify-send "Tab Dashboard" "Broadcast stopped — laptop unmuted"
      fi
    fi
  else
    echo "OK: $BODY"
  fi
  exit 0
else
  echo "Failed (HTTP $CODE): $BODY" >&2
  echo "Is tab-dashboard running on port $PORT?" >&2
  exit 1
fi
