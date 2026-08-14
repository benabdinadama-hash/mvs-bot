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

// v10.19 FIX — reconcileLedger() in protect.js was calling recordClosed()
// ONLY when it found a matching closed-PnL record on Bybit. If that
// match never comes (confirmed live: AVAXUSDT sat in "no longer open,
// but no closed-PnL match yet" every single cycle for over 12 hours,
// across multiple watcher restarts, never once resolving) the entry
// stays 'open' FOREVER — countOpen() overcounts forever, and
// MAX_CONCURRENT_TRADES can silently block real future signals
// indefinitely. Root cause of the closed-PnL match failure itself
// wasn't confirmable without live Bybit API access to test against
// (a timestamp-window or pagination edge case in
// /v5/position/closed-pnl is the leading suspect) — rather than guess
// at that blindly, this adds a bounded, self-healing fallback so the
// ledger can never get stuck again regardless of the exact cause:
//
// markPendingClose(): called the FIRST time an entry is seen as
// "not open on Bybit, but no closed-PnL match yet." Records WHEN that
// was first noticed (only once — subsequent calls are no-ops so the
// clock doesn't keep resetting).
const markPendingClose = (orderId) => {
  const entries = load();
  const updated = entries.map(e =>
    (e.orderId === orderId && e.status === 'open' && !e.pendingCloseSince)
      ? { ...e, pendingCloseSince: Date.now() }
      : e
  );
  save(updated);
};

// forceCloseStalePending(): entries that have been stuck in
// "pending close" for longer than maxPendingMs get force-marked closed
// with realizedPnl left null (genuinely unknown — check Bybit's trade
// history directly for the exact figure) rather than staying open
// forever. Returns the list of entries it force-closed, so callers can
// log/alert on it.
const forceCloseStalePending = (maxPendingMs = 5 * 60 * 1000) => {
  const entries = load();
  const now = Date.now();
  const forced = [];
  const updated = entries.map(e => {
    if (e.status === 'open' && e.pendingCloseSince && (now - e.pendingCloseSince) > maxPendingMs) {
      forced.push(e);
      return { ...e, status: 'closed', closedAt: now, realizedPnl: null, closeReason: 'stale_unmatched_fallback' };
    }
    return e;
  });
  if (forced.length) save(updated);
  return forced;
};

const countOpen = () => load().filter(e => e.status === 'open').length;

const getOpen = () => load().filter(e => e.status === 'open');

// Most recent N CLOSED trades, newest first — used by protect.js to
// check consecutive-loss / drawdown rules. Never includes open trades.
const getRecentClosed = (n = 10) => load()
  .filter(e => e.status === 'closed')
  .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
  .slice(0, n);

module.exports = { recordOpened, recordClosed, markPendingClose, forceCloseStalePending, countOpen, getOpen, getRecentClosed, LEDGER_FILE };
