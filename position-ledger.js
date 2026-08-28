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

// v10.26: accepts any extra fields the caller wants stored (e.g. the
// split/qty1/tp1OrderId/qty2/tp2OrderId from a genuine partial-exit
// entry) without needing this function's signature to know about each
// one — spreads whatever it's given straight through. Fully backward
// compatible: the old { symbol, side, orderId, entryTime, margin,
// leverage } shape still works exactly as before.
const recordOpened = (details) => {
  const entries = load();
  entries.push({ ...details, status: 'open' });
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

// v10.19.1 FIX — a position that had ONE transient "not open" cycle
// (a brief Bybit API blip, or a rapid close-then-reopen) would get
// pendingCloseSince set, then if it went back to genuinely open for
// the next 10+ cycles, forceCloseStalePending() would still force-close
// it 5 minutes after that single old blip — wrongly, since it's been
// fine the whole time since. Called whenever protect.js confirms a
// position IS still open, to clear any stale pending-close mark from
// an earlier transient blip so only a SUSTAINED absence can ever
// trigger the stale fallback.
const clearPendingClose = (orderId) => {
  const entries = load();
  const updated = entries.map(e =>
    (e.orderId === orderId && e.pendingCloseSince)
      ? { ...e, pendingCloseSince: null }
      : e
  );
  save(updated);
};

const countOpen = () => load().filter(e => e.status === 'open').length;

const getOpen = () => load().filter(e => e.status === 'open');

// v10.25: symbol-specific check, used by execute-signal.js as a backstop
// against double-execution — independent of WHY two execution attempts
// might happen for the same signal (GitHub Actions + watcher.js racing,
// a manual `node strategy.js` run on Termux overlapping with watcher.js,
// or any future scenario not anticipated here). countOpen()/MAX_CONCURRENT_TRADES
// only ever checked a TOTAL count, never "is this exact symbol already
// open" — so two attempts for the same signal could both pass that
// check and both place a real order. This closes that gap directly.
const isSymbolOpen = (bybitSymbol) => load().some(e => e.status === 'open' && e.symbol === bybitSymbol);

// Most recent N CLOSED trades, newest first — used by protect.js to
// check consecutive-loss / drawdown rules. Never includes open trades.
const getRecentClosed = (n = 10) => load()
  .filter(e => e.status === 'closed')
  .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
  .slice(0, n);

module.exports = { recordOpened, recordClosed, markPendingClose, clearPendingClose, forceCloseStalePending, countOpen, getOpen, isSymbolOpen, getRecentClosed, LEDGER_FILE };
