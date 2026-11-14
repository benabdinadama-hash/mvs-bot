#!/data/data/com.termux/files/usr/bin/bash
# Starts the read-only MVS skipped-signals journal in the background (separate from the watcher).
cd "$(dirname "$0")/../.." || exit 1
mkdir -p "$HOME/mvs-skips"
if pgrep -f "mvs-skips.js" >/dev/null; then echo "mvs-skips already running."; exit 0; fi
nohup node execution/shadow/mvs-skips.js >> "$HOME/mvs-skips/out.log" 2>&1 &
echo "mvs-skips started (pid $!). Log: ~/mvs-skips/out.log"
