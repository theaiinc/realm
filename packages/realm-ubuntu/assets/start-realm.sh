#!/bin/bash
# start-realm.sh — Entrypoint for Ubuntu Desktop realm containers.
#
# 1. Starts Xvfb virtual display
# 2. Creates .Xauthority for Xlib-based tools (pyautogui, etc.)
# 3. Launches XFCE4 desktop session
# 4. Starts x11vnc for remote access
# 5. Launches Yggdrasil Ratatoskr daemon (if YGGDRASIL_URL is set)
# 6. Keeps container alive

set -e

RESOLUTION="${1:-1920x1080}"
VNC_PORT="${VNC_PORT:-5901}"
DISPLAY="${DISPLAY:-:99}"

echo "[realm-ubuntu] Starting Ubuntu Desktop realm..."
echo "  Resolution: $RESOLUTION"
echo "  Display:    $DISPLAY"
echo "  VNC port:   $VNC_PORT"

# ------------------------------------------------------------------
# dbus
# ------------------------------------------------------------------
mkdir -p /run/dbus
dbus-daemon --system --fork 2>/dev/null || true

# ------------------------------------------------------------------
# Xvfb virtual display
# ------------------------------------------------------------------
Xvfb "$DISPLAY" -screen 0 "${RESOLUTION}x24" -ac \
    -nolisten tcp \
    -dpi 96 \
    2>/dev/null &
XVFB_PID=$!
echo "[realm-ubuntu] Xvfb started (PID: $XVFB_PID)"

for i in $(seq 1 10); do
    if DISPLAY="$DISPLAY" xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
        echo "[realm-ubuntu] Xvfb ready after ${i}s"
        break
    fi
    sleep 1
done

# Create .Xauthority so Xlib-based tools (pyautogui, etc.) work
touch ~/.Xauthority
xauth generate "$DISPLAY" . trusted 2>/dev/null || true

xsetroot -solid "#2c3e50" -display "$DISPLAY" 2>/dev/null || true
xset -display "$DISPLAY" -dpms 2>/dev/null || true
xset -display "$DISPLAY" s off 2>/dev/null || true

# ------------------------------------------------------------------
# XFCE4 desktop
# ------------------------------------------------------------------
startxfce4 --display="$DISPLAY" &
XFCE_PID=$!
echo "[realm-ubuntu] XFCE4 started (PID: $XFCE_PID)"
sleep 3

# ------------------------------------------------------------------
# x11vnc
# ------------------------------------------------------------------
x11vnc -display "$DISPLAY" \
    -forever -shared -nopw -quiet \
    -rfbport "$VNC_PORT" \
    -bg \
    2>/dev/null || true
echo "[realm-ubuntu] x11vnc started on port $VNC_PORT"

# ------------------------------------------------------------------
# Desktop terminal (backgrounded — can block as CMD)
# ------------------------------------------------------------------
nohup xfce4-terminal --display="$DISPLAY" --geometry=120x32 \
    --title="Realm Ubuntu" \
    --hide-menubar \
    > /dev/null 2>&1 &
sleep 1

# ------------------------------------------------------------------
# Yggdrasil Ratatoskr daemon
# Starts only if YGGDRASIL_URL is provided.
# ------------------------------------------------------------------
if [ -n "${YGGDRASIL_URL:-}" ]; then
    echo "[realm-ubuntu] YGGDRASIL_URL set — starting Ratatoskr..."

    CAPABILITIES="${CAPABILITIES:-agent,code}"

    export YGGDRASIL_URL
    export API_KEY="${API_KEY:-}"
    export RUNNER_NAME="${RUNNER_NAME:-realm-ubuntu}"
    export CAPABILITIES
    export LLM_MODEL="${LLM_MODEL:-google/gemma-4-26b-a4b-qat}"
    export LLM_BASE_URL="${LLM_BASE_URL:-http://host.docker.internal:1234/v1}"
    export LLM_API_KEY="${LLM_API_KEY:-}"
    export AGENT_MAX_TOOL_ITERATIONS="${AGENT_MAX_TOOL_ITERATIONS:-25}"
    export TASK_POLL_INTERVAL="${TASK_POLL_INTERVAL:-10}"

    echo "[realm-ubuntu] Ratatoskr capabilities: $CAPABILITIES"
    echo "[realm-ubuntu] Ratatoskr Yggdrasil URL: $YGGDRASIL_URL"

    nohup node /usr/lib/node_modules/@theaiinc/yggdrasil-ratatoskr/dist/src/runner.js \
        > /tmp/ratatoskr.log 2>&1 &
    RATATOSKR_PID=$!
    echo "[realm-ubuntu] Ratatoskr started (PID: $RATATOSKR_PID)"
    echo "[realm-ubuntu] Ratatoskr logs: /tmp/ratatoskr.log"
else
    echo "[realm-ubuntu] YGGDRASIL_URL not set — Ratatoskr not started"
fi

# ------------------------------------------------------------------
# Oasis Chrome Bridge extension
# Patches the WebSocket URL at runtime so it connects to the host's
# dev-agent (via host.docker.internal) instead of container localhost.
# ------------------------------------------------------------------
EXTENSION_DIR="/opt/extensions/oasis-chrome-bridge"
DEV_AGENT_WS_HOST="${DEV_AGENT_WS_HOST:-host.docker.internal}"
DEV_AGENT_WS_PORT="${DEV_AGENT_WS_PORT:-8008}"

if [ -d "$EXTENSION_DIR" ]; then
    echo "[realm-ubuntu] Patching Oasis Chrome Bridge WS URL → ws://${DEV_AGENT_WS_HOST}:${DEV_AGENT_WS_PORT}/ws/chrome-bridge"
    sed -i "s|ws://localhost:8008/ws/chrome-bridge|ws://${DEV_AGENT_WS_HOST}:${DEV_AGENT_WS_PORT}/ws/chrome-bridge|g" \
        "$EXTENSION_DIR/background.js"

    echo "[realm-ubuntu] Launching Chromium with Oasis Chrome Bridge extension..."
    nohup chromium-browser \
        --no-sandbox \
        --no-first-run \
        --disable-extensions-except="$EXTENSION_DIR" \
        --load-extension="$EXTENSION_DIR" \
        --disable-default-apps \
        --disable-sync \
        --window-size=1920,1080 \
        --start-maximized \
        --user-data-dir=/tmp/chrome-profile \
        "https://www.google.com" \
        > /tmp/chromium.log 2>&1 &
    CHROME_PID=$!
    echo "[realm-ubuntu] Chromium started (PID: $CHROME_PID)"
else
    echo "[realm-ubuntu] WARNING: Oasis Chrome Bridge extension not found at $EXTENSION_DIR"
fi

echo "[realm-ubuntu] Ready. PID=$$"

# Keep container alive
tail -f /dev/null
