/**
 * kill-switch.js — a single JSON flag checked before every real order.
 * Toggled via Telegram command (/pause, /resume — see commands.js), so it
 * works instantly from your phone with no code deploy needed.
 */

const fs = require('fs');
const path = require('path');

const SWITCH_FILE = path.join(__dirname, 'kill-switch.json');

const isPaused = () => {
  let raw;
  try {
    raw = fs.readFileSync(SWITCH_FILE, 'utf8');
  } catch {
    return false; // no file yet = not paused, default to active
  }
  try {
    return JSON.parse(raw).paused === true;
  } catch {
    // v10.43: file EXISTS but is unreadable (e.g. git merge-conflict
    // markers from two hosts writing it, or a truncated write). This used
    // to return false (= trading allowed) — failing OPEN on a real-money
    // safety flag. Fail CLOSED instead: an unreadable kill switch is
    // treated as paused until someone sends /resume (which rewrites it).
    console.error('[kill-switch] kill-switch.json exists but is unreadable — treating as PAUSED (fail-safe). Send /resume to reset it.');
    return true;
  }
};

// v10.43: atomic write (temp + rename) so a concurrent reader can never
// catch a half-written file and hit the fail-closed branch above.
const setPaused = (paused) => {
  const tmp = `${SWITCH_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ paused, updatedAt: Date.now() }, null, 2));
  fs.renameSync(tmp, SWITCH_FILE);
};

module.exports = { isPaused, setPaused, SWITCH_FILE };
