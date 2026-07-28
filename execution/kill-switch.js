/**
 * kill-switch.js — a single JSON flag checked before every real order.
 * Toggled via Telegram command (/pause, /resume — see commands.js), so it
 * works instantly from your phone with no code deploy needed.
 */

const fs = require('fs');
const path = require('path');

const SWITCH_FILE = path.join(__dirname, 'kill-switch.json');

const isPaused = () => {
  try {
    return JSON.parse(fs.readFileSync(SWITCH_FILE, 'utf8')).paused === true;
  } catch {
    return false; // no file yet = not paused, default to active
  }
};

const setPaused = (paused) => {
  fs.writeFileSync(SWITCH_FILE, JSON.stringify({ paused, updatedAt: Date.now() }, null, 2));
};

module.exports = { isPaused, setPaused, SWITCH_FILE };
