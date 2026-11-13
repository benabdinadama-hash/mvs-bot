#!/data/data/com.termux/files/usr/bin/bash
# Starts the GWP shadow logger in the background. Separate from the MVS watcher.
# Stop it with:  bash execution/shadow/stop-gwp-shadow.sh
cd "$(dirname "$0")/../.." || exit 1
mkdir -p "$HOME/gwp-shadow"
if pgrep -f "gwp-shadow.js" >/dev/null; then echo "gwp-shadow already running."; exit 0; fi
nohup node execution/shadow/gwp-shadow.js >> "$HOME/gwp-shadow/shadow.out" 2>&1 &
echo "gwp-shadow started (pid $!). Log: ~/gwp-shadow/shadow.out"
