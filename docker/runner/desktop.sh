#!/usr/bin/env bash
set -euo pipefail
pids=()
cleanup() { trap - EXIT TERM INT; kill "${pids[@]}" 2>/dev/null || true; wait || true; }
trap cleanup EXIT
trap 'exit 0' TERM INT
# Docker keeps /tmp when restarting a container. A forced stop can leave Xvfb's
# lock pointing at a PID reused on the next start, so Xvfb cannot recover itself.
[[ "$DISPLAY" =~ ^:([0-9]+)(\.[0-9]+)?$ ]] || { echo "Invalid runner DISPLAY: $DISPLAY" >&2; exit 1; }
display_number=${BASH_REMATCH[1]}
if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    echo "Runner display $DISPLAY is already in use." >&2
    exit 1
fi
rm -f "/tmp/.X${display_number}-lock" "/tmp/.X11-unix/X${display_number}"
# Readiness probes disconnect before Openbox starts. Keep their last-client exit
# from resetting the server while the next desktop client connects.
Xvfb "$DISPLAY" -screen 0 1600x1000x24 -nolisten tcp -noreset &
pids+=("$!")
for attempt in {1..50}; do
    xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
    sleep 0.1
done
xdpyinfo -display "$DISPLAY" >/dev/null
openbox --sm-disable >/tmp/magelens-openbox.log 2>&1 &
pids+=("$!")
xsetroot -solid '#202832'
xmessage -center -buttons '' 'MageLens test runner

Waiting for a test run.
Start tests from your terminal with ./bin/run-coverage' &
pids+=("$!")
# LibVNCServer scans the file limit on connect; some Docker hosts set it to billions.
# Bound only this process so the browser retains the container's normal limits.
(ulimit -n 1024; exec x11vnc -display "$DISPLAY" -localhost -rfbport 5900 -forever -shared -nopw -viewonly -noxdamage -quiet) &
pids+=("$!")
websockify --web=/usr/share/novnc 6080 localhost:5900 &
pids+=("$!")
status=0
wait -n -p exited "${pids[@]}" || status=$?
echo "Runner desktop process ${exited:-unknown} exited (status $status)." >&2
[[ ! -f /tmp/magelens-openbox.log ]] || cat /tmp/magelens-openbox.log >&2
exit 1
