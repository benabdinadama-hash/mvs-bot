#!/data/data/com.termux/files/usr/bin/bash
#
# watchdog.sh — v10.24 addition. Belt-and-suspenders on top of the
# watcher.js fixes (axios timeout, git exec timeouts, re-entrancy
# guard): even with those in place, runs forever unattended on a phone
# should have an external check, not just internal self-discipline.
#
# Loops forever: every 3 minutes, checks execution/heartbeat.json.
#   - Missing entirely, or older than 5 minutes -> watcher is either
#     not running or wedged. pkill it (if present) and restart via
#     start-watcher.sh.
#   - Fresh -> do nothing, watcher is cycling normally.
#
# This is the actual answer to "stay active as long as connected to
# the internet": it does not require you to notice and manually
# pkill/restart — it does that itself, automatically, indefinitely.
#
# Started automatically by start-watcher.sh — you do not need to run
# this file directly under normal use.

cd "$(dirname "$0")/.." || exit 1

STALE_SECONDS=300   # 5 min = ~5 missed 60s cycles, well past normal jitter
CHECK_INTERVAL=180  # 3 min between checks — frequent enough to catch a
                     # wedge quickly, infrequent enough not to churn battery

while true; do
  sleep "$CHECK_INTERVAL"

  HB_FILE="execution/heartbeat.json"
  RESTART_NEEDED=0
  REASON=""

  if ! pgrep -f "node execution/watcher.js" > /dev/null; then
    RESTART_NEEDED=1
    REASON="watcher process not found"
  elif [ ! -f "$HB_FILE" ]; then
    RESTART_NEEDED=1
    REASON="no heartbeat file yet"
  else
    HB_EPOCH=$(date -d "$(node -e "console.log(JSON.parse(require('fs').readFileSync('$HB_FILE','utf8')).at)" 2>/dev/null)" +%s 2>/dev/null)
    NOW_EPOCH=$(date +%s)
    if [ -z "$HB_EPOCH" ]; then
      RESTART_NEEDED=1
      REASON="heartbeat file unreadable/corrupt"
    else
      AGE=$((NOW_EPOCH - HB_EPOCH))
      if [ "$AGE" -gt "$STALE_SECONDS" ]; then
        RESTART_NEEDED=1
        REASON="heartbeat is ${AGE}s old (stale beyond ${STALE_SECONDS}s)"
      fi
    fi
  fi

  if [ "$RESTART_NEEDED" -eq 1 ]; then
    TS=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[watchdog] $TS — restarting watcher: $REASON"
    pkill -f "node execution/watcher.js" 2>/dev/null
    sleep 2
    pkill -9 -f "node execution/watcher.js" 2>/dev/null  # force, in case it was truly wedged and ignored SIGTERM
    sleep 1
    bash execution/start-watcher.sh --from-watchdog
  fi
done
