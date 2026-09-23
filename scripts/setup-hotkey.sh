#!/bin/bash
# setup-hotkey.sh — Register GNOME global shortcut for broadcast toggle.
# Idempotent: safe to run multiple times. Creates/updates a custom keybinding.
# Default binding: <Control><Alt>b (toggle mute + stream to all devices)
# Usage:
#   ./scripts/setup-hotkey.sh                          # use default <Control><Alt>b
#   ./scripts/setup-hotkey.sh "<Super><Alt>b"          # custom combo
#   ./scripts/setup-hotkey.sh "<Control><Alt>b" 8080   # custom port
#   BROADCAST_HOTKEY="<Super>F8" ./scripts/setup-hotkey.sh
#
# To remove: gsettings reset ... or edit via Settings > Keyboard > View and Customize Shortcuts > Custom Shortcuts

set -e

HOTKEY="${1:-${BROADCAST_HOTKEY:-<Control><Alt>b}}"
PORT="${2:-}"
NAME="Toggle Tab-Dashboard Broadcast"

# Detect port from config if not supplied
if [ -z "$PORT" ]; then
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
    if command -v jq >/dev/null 2>&1; then
      P=$(jq -r '.http_port // 8080' "$CONFIG" 2>/dev/null || echo 8080)
      [ "$P" != "null" ] && [ -n "$P" ] && PORT="$P"
    elif command -v python3 >/dev/null 2>&1; then
      P=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('http_port',8080))" 2>/dev/null || echo 8080)
      [ -n "$P" ] && PORT="$P"
    fi
  fi
fi

COMMAND="sh -c 'curl -s -X POST http://localhost:${PORT}/api/stream/broadcast -H \"Content-Type: application/json\" -d \"{\\\"action\\\":\\\"toggle\\\"}\" > /dev/null'"

if ! command -v gsettings >/dev/null 2>&1; then
  echo "Error: gsettings not found. Are you on GNOME?" >&2
  exit 1
fi

# Also try the helper binary if available (more robust than curl)
# Prefer curl command for simplicity; binary is fallback for non-standard setups.

echo "Setting up hotkey: $HOTKEY -> $COMMAND"

# Get current custom-keybindings
CURRENT=$(gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings 2>&1 || echo "[]")
echo "Current bindings: $CURRENT"

# Check if our name already exists
EXISTING_PATH=""
if echo "$CURRENT" | grep -q "custom"; then
  # List paths
  PATHS=$(echo "$CURRENT" | grep -o "'[^']*'" | tr -d "'" || true)
  for P in $PATHS; do
    N=$(gsettings get "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${P}" name 2>/dev/null || echo "")
    # Trim quotes
    N_TRIM=$(echo "$N" | sed "s/^'//;s/'$//")
    if [ "$N_TRIM" = "$NAME" ]; then
      EXISTING_PATH="$P"
      echo "Found existing entry at $P"
      break
    fi
  done
fi

if [ -n "$EXISTING_PATH" ]; then
  echo "Updating existing entry $EXISTING_PATH"
  gsettings set "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${EXISTING_PATH}" name "$NAME"
  gsettings set "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${EXISTING_PATH}" command "$COMMAND"
  gsettings set "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${EXISTING_PATH}" binding "$HOTKEY"
  echo "Updated. Press $HOTKEY to toggle broadcast (no dashboard needed)."
  exit 0
fi

# Find next free index
IDX=0
while true; do
  CANDIDATE="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom${IDX}/"
  if ! echo "$CURRENT" | grep -q "$CANDIDATE"; then
    break
  fi
  IDX=$((IDX+1))
  if [ $IDX -gt 50 ]; then echo "Too many custom bindings" >&2; exit 1; fi
done
NEW_PATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom${IDX}/"
echo "Creating new entry at $NEW_PATH (index $IDX)"

# Append to list
if [ "$CURRENT" = "@as []" ] || [ "$CURRENT" = "[]" ]; then
  NEW_LIST="['$NEW_PATH']"
else
  # Remove trailing ] and append
  TRIMMED=$(echo "$CURRENT" | sed 's/]$//')
  if echo "$TRIMMED" | grep -q "'"; then
    NEW_LIST="${TRIMMED}, '$NEW_PATH']"
  else
    NEW_LIST="['$NEW_PATH']"
  fi
fi

echo "New list: $NEW_LIST"
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "$NEW_LIST"

gsettings set "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${NEW_PATH}" name "$NAME"
gsettings set "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${NEW_PATH}" command "$COMMAND"
gsettings set "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${NEW_PATH}" binding "$HOTKEY"

echo "Done. Press $HOTKEY to toggle broadcast (mute laptop + stream to all devices)."
echo "Verify: gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings"
echo "        gsettings get \"org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${NEW_PATH}\" binding"
