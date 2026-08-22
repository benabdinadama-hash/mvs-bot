#!/data/data/com.termux/files/usr/bin/bash
#
# start-watcher.sh — starts the MVS execution watcher in the background,
# holds a wake lock so Android doesn't kill it, and survives you closing
# the Termux app window (though NOT force-stopping the Termux app itself,
# or rebooting the phone — see termux-boot-start.sh for the reboot case).
#
# Run this ONCE after each phone reboot (or let termux-boot-start.sh do
# it automatically — see below). Safe to run again if unsure whether it's
# already running; it won't create a second instance if one is already up.

cd "$(dirname "$0")/.." || exit 1  # repo root, assuming this script lives in execution/

# Load credentials from a local, gitignored env file (never committed).
# Create this file once — see execution/.env.example for the format, but
# note: THIS script needs shell "export KEY=value" syntax specifically,
# not the plain KEY=value dotenv format.
if [ -f "execution/keys.sh" ]; then
  source execution/keys.sh
else
  echo "❌ execution/keys.sh not found. Create it first — see instructions."
  exit 1
fi

# Avoid starting a second instance.
if pgrep -f "node execution/watcher.js" > /dev/null; then
  echo "✅ Watcher already running. Nothing to do."
  exit 0
fi

# Hold a wake lock for the whole session (prevents Android's Doze mode
# from suspending this process while the screen is off).
termux-wake-lock

mkdir -p execution/logs
LOG_FILE="execution/logs/watcher-$(date +%Y%m%d).log"

nohup node execution/watcher.js >> "$LOG_FILE" 2>&1 &
disown

echo "✅ Watcher started in background. Logging to $LOG_FILE"
echo "Check it's alive anytime with: pgrep -f 'node execution/watcher.js'"

# v10.24 addition — also (re)start the watchdog, unless THIS start was
# itself called BY the watchdog (the --from-watchdog flag prevents it
# spawning a second copy of itself on every restart it performs).
if [ "$1" != "--from-watchdog" ]; then
  if pgrep -f "execution/watchdog.sh" > /dev/null; then
    echo "✅ Watchdog already running. Nothing to do."
  else
    WATCHDOG_LOG="execution/logs/watchdog-$(date +%Y%m%d).log"
    nohup bash execution/watchdog.sh >> "$WATCHDOG_LOG" 2>&1 &
    disown
    echo "✅ Watchdog started in background. Logging to $WATCHDOG_LOG"
    echo "It checks execution/heartbeat.json every 3 min and auto-restarts the watcher if it ever goes stale/wedged again."
  fi
fi
