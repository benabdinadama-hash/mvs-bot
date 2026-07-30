/**
 * check-telegram.js — shows the same info /status and /positions would
 * show in Telegram, but read straight from the local files GitHub Actions
 * already writes (state.json, open-positions.json) — no Telegram API call,
 * no need to open the Telegram app.
 *
 * Usage: node execution/check-telegram.js
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const REPO_ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(REPO_ROOT, 'state.json');
const OPEN_POSITIONS_FILE = path.join(REPO_ROOT, 'open-positions.json');

const loadJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
};

const line = () => console.log('─'.repeat(50));

const state = loadJSON(STATE_FILE, null);
const openPositions = loadJSON(OPEN_POSITIONS_FILE, {});

console.log('--- MVS Telegram-equivalent status (read locally) ---\n');

if (!state) {
  console.log('⚠️  No saved state.json found — run `git pull` first, or wait for the next scan.');
  process.exit(0);
}

console.log(`📊 Last scan: ${state._lastRunAt || 'unknown'}`);
line();

for (const sym of config.SYMBOLS) {
  const s = state[sym];
  const open = openPositions[sym];
  console.log(`${sym}`);
  if (open) {
    console.log(`   🟢 OPEN — ${open.direction} @ $${Number(open.entryPrice).toFixed(4)} (since ${new Date(open.entryTime * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC)`);
  } else if (s && s.signal && s.signal.startsWith('CLOSED_')) {
    const rrStr = s.rr !== undefined ? `${s.rr > 0 ? '+' : ''}${s.rr}R` : '';
    console.log(`   ⚪ Last closed: ${s.signal} ${rrStr}`);
  } else if (s) {
    console.log(`   Signal: ${s.signal || 'unknown'}${s.direction ? ' (' + s.direction + ')' : ''} — price $${Number(s.price).toFixed(4)}`);
  } else {
    console.log(`   no data yet`);
  }
}
line();
console.log('Reminder: this shows the SIGNAL side (Telegram alerts / simulated tracking).');
console.log('For your REAL Bybit balance/positions, use: node execution/check-status.js');
