/**
 * check-remote-heartbeat.js — v10.30 addition. Run by mvs-scan.yml
 * (GitHub Actions) after every scan, right before the "Commit and push
 * state files" step.
 *
 * Confirmed real gap this closes: on 2026-09-10 the Termux watcher
 * wasn't running AT ALL for the day. GitHub Actions kept scanning,
 * firing signals, and sending Telegram alerts exactly as designed — but
 * nothing anywhere noticed that Bybit execution had silently stopped,
 * because the only heartbeat that existed (execution/heartbeat.json) is
 * gitignored and lives ONLY on the phone. The user found out by manually
 * running check-status.js on Termux and then having to place the trade
 * by hand.
 *
 * Fix: watcher.js now also pushes a small, git-tracked heartbeat
 * (execution/remote-heartbeat.json) periodically — see
 * heartbeat-config.js for the interval. This script runs on GitHub's
 * infrastructure (up regardless of the phone's state), reads that file
 * (already on disk after this job's checkout step, since it was
 * committed by the phone), and sends a Telegram alert if it's gone
 * stale — i.e. the phone hasn't proven it's alive in a while.
 *
 * Alerts exactly once on the ok→stale transition, and once on the
 * stale→ok (recovery) transition — never every 15-minute scan for the
 * same ongoing outage. State tracked in
 * execution/remote-heartbeat-alert-state.json, which the SAME workflow
 * step that commits state.json/signals.log.json etc. also commits (see
 * mvs-scan.yml) — this script only ever writes it locally.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { REMOTE_HEARTBEAT_STALE_MS } = require('./heartbeat-config');

const HB_FILE = path.join(__dirname, 'remote-heartbeat.json');
const ALERT_STATE_FILE = path.join(__dirname, 'remote-heartbeat-alert-state.json');

const loadJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

// Standalone alert, same pattern as protect.js's sendAlert — deliberately
// not shared code, so this has no dependency on the signal-generation
// pipeline and can't be broken by changes made there.
const sendAlert = async (text) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error('[check-remote-heartbeat] No Telegram credentials set — cannot send alert. Logging only:', text);
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId, text, parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error('[check-remote-heartbeat] Failed to send Telegram alert:', err.message);
  }
};

(async () => {
  const hb = loadJSON(HB_FILE, null);
  const alertState = loadJSON(ALERT_STATE_FILE, { lastState: 'never_seen' });

  let currentState;
  let ageMin = null;
  if (!hb || !hb.at) {
    // No heartbeat committed yet at all — either brand new setup (watcher
    // never started once on Termux yet) or this file predates v10.30.
    // Deliberately NOT alerted on its own: alerting here would fire on
    // every scan for anyone who hasn't set up the phone side yet, which
    // is noise, not signal. It only starts mattering once a heartbeat
    // has been seen at least once (see 'stale' branch below).
    currentState = 'never_seen';
  } else {
    const ageMs = Date.now() - new Date(hb.at).getTime();
    ageMin = Math.round(ageMs / 60000);
    currentState = ageMs > REMOTE_HEARTBEAT_STALE_MS ? 'stale' : 'ok';
  }

  console.log(
    `[check-remote-heartbeat] state=${currentState}` +
    `${ageMin != null ? ` (last heartbeat ~${ageMin}min ago)` : ' (no heartbeat committed yet)'}` +
    `, previous=${alertState.lastState}`
  );

  if (currentState === 'stale' && alertState.lastState !== 'stale') {
    await sendAlert(
      `⚠️ *Phone watcher looks down*\n\n` +
      `No remote heartbeat from the Termux watcher in ~${ageMin} min ` +
      `(threshold ${Math.round(REMOTE_HEARTBEAT_STALE_MS / 60000)} min).\n\n` +
      `Signals are still firing normally from here (GitHub Actions), but ` +
      `nothing is executing them on Bybit until the watcher is back up. ` +
      `Check Termux — likely needs:\n\`bash execution/start-watcher.sh\``
    );
  } else if (currentState === 'ok' && alertState.lastState === 'stale') {
    await sendAlert(
      `✅ *Phone watcher back up* — remote heartbeat is fresh again (~${ageMin} min old).`
    );
  }
  // 'never_seen' or a no-change transition: nothing to alert, just
  // persist the state below if it changed.

  if (alertState.lastState !== currentState) {
    fs.writeFileSync(ALERT_STATE_FILE, JSON.stringify({
      lastState: currentState, updatedAt: new Date().toISOString(),
    }, null, 2));
  }
})();
