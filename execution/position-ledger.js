/**
 * position-ledger.js — the account already has 2 positions the user opened
 * manually elsewhere. This bot must NEVER count those toward its own
 * max-concurrent-trades limit, modify them, or treat them as its own.
 *
 * Approach: we keep our OWN local record (our-positions.json) of every
 * order this bot places (symbol, side, Bybit orderId, timestamps). Any
 * time we need to know "how many trades do WE currently have open," we
 * check this local ledger — never a raw "all open positions" call to
 * Bybit, which would include the user's manual ones.
 */

const fs = require('fs');
const path = require('path');

const LEDGER_FILE = path.join(__dirname, 'our-positions.json');

const load = () => {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
  } catch {
    return []; // no file yet, or unreadable — start fresh, never crash on this
  }
};

const save = (entries) => {
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(entries, null, 2));
};

const recordOpened = ({ symbol, side, orderId, entryTime, margin, leverage }) => {
  const entries = load();
  entries.push({ symbol, side, orderId, entryTime, margin, leverage, status: 'open' });
  save(entries);
};

const recordClosed = (orderId, { realizedPnl, closeReason } = {}) => {
  const entries = load();
  const updated = entries.map(e => e.orderId === orderId
    ? { ...e, status: 'closed', closedAt: Date.now(), realizedPnl: realizedPnl ?? null, closeReason: closeReason ?? 'unknown' }
    : e);
  save(updated);
};

const countOpen = () => load().filter(e => e.status === 'open').length;

const getOpen = () => load().filter(e => e.status === 'open');

// Most recent N CLOSED trades, newest first — used by protect.js to
// check consecutive-loss / drawdown rules. Never includes open trades.
const getRecentClosed = (n = 10) => load()
  .filter(e => e.status === 'closed')
  .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
  .slice(0, n);

module.exports = { recordOpened, recordClosed, countOpen, getOpen, getRecentClosed, LEDGER_FILE };
