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
 *
 * v10.29 FIX — confirmed real, twice: a genuinely open, healthy TRXUSDT
 * position vanished from our-positions.json entirely (empty array),
 * with no 'closed' record left behind — while the real Bybit position
 * stayed open the whole time. Root cause, found precisely: load()
 * treated ANY read/parse failure the same as "no file yet, start
 * fresh" and silently returned []. clearPendingClose() — called on
 * EVERY reconciliation cycle for EVERY genuinely-still-open position,
 * which is the normal case, most cycles, for a healthy trade — then
 * called save() UNCONDITIONALLY, even when there was nothing to
 * actually clear. Put together: any cycle where the file happened to
 * be transiently unreadable (exactly what an interrupted git pull —
 * confirmed happening repeatedly in the watcher log both times this
 * occurred — would cause mid-write) silently fabricated an empty
 * ledger and immediately wrote it back, permanently erasing the real
 * one. Two changes close this: (1) load() now only treats a genuinely
 * MISSING file as "start fresh" — an existing-but-unreadable file
 * throws instead, forcing every caller to explicitly decide how to
 * fail safe rather than silently trusting a lie; (2) every write
 * function skips the write entirely when nothing would actually
 * change, and every function (read or write) now has an explicit,
 * logged, safety-first fallback if load() throws — never a silent
 * empty-array substitution feeding into a save().
 */

const fs = require('fs');
const path = require('path');

const LEDGER_FILE = path.join(__dirname, 'our-positions.json');

const load = () => {
  if (!fs.existsSync(LEDGER_FILE)) return []; // genuinely no file yet — legitimate fresh start (e.g. first-ever run)
  try {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
  } catch (err) {
    // The file EXISTS but couldn't be read or parsed right now — this is
    // NOT "start fresh." Silently returning [] here is exactly what
    // caused real data loss (see header). Throw instead; every caller
    // below explicitly decides what "I can't currently verify the real
    // ledger" should mean for it, and none of them let that turn into
    // an accidental overwrite.
    throw new Error(`our-positions.json exists but could not be read/parsed (${err.message})`);
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
//
// v10.29: if the ledger can't currently be read, this does NOT invent
// an empty base and append to it — that would risk silently discarding
// whatever was really there the moment the read next succeeds and
// something else writes on top. It logs loudly and refuses to record,
// leaving the caller's real, already-placed exchange order untouched
// but genuinely unrecorded locally — rare, and far safer than the
// alternative. v10.28's exchange-level cross-check in execute-signal.js
// is the backstop for exactly this gap: it verifies against Bybit
// directly rather than trusting this file alone.
const recordOpened = (details) => {
  let entries;
  try {
    entries = load();
  } catch (err) {
    console.error(`[position-ledger] recordOpened(${details?.symbol}) could not read the ledger — NOT writing, to avoid discarding real data: ${err.message}. ` +
      `The exchange order this refers to was still placed for real — this local record is what's missing, not the position itself.`);
    return;
  }
  entries.push({ ...details, status: 'open' });
  save(entries);
};

const recordClosed = (orderId, { realizedPnl, closeReason } = {}) => {
  let entries;
  try {
    entries = load();
  } catch (err) {
    console.error(`[position-ledger] recordClosed(${orderId}) could not read the ledger — NOT writing, to avoid discarding real data: ${err.message}. Will retry next cycle.`);
    return;
  }
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
  let entries;
  try {
    entries = load();
  } catch (err) {
    console.error(`[position-ledger] markPendingClose(${orderId}) could not read the ledger — skipping this cycle: ${err.message}. Will retry next cycle; not dangerous to skip once.`);
    return;
  }
  const target = entries.find(e => e.orderId === orderId && e.status === 'open' && !e.pendingCloseSince);
  if (!target) return; // v10.29: nothing would actually change — skip the write
  const updated = entries.map(e => e === target ? { ...e, pendingCloseSince: Date.now() } : e);
  save(updated);
};

// forceCloseStalePending(): entries that have been stuck in
// "pending close" for longer than maxPendingMs get force-marked closed
// with realizedPnl left null (genuinely unknown — check Bybit's trade
// history directly for the exact figure) rather than staying open
// forever. Returns the list of entries it force-closed, so callers can
// log/alert on it.
const forceCloseStalePending = (maxPendingMs = 5 * 60 * 1000) => {
  let entries;
  try {
    entries = load();
  } catch (err) {
    console.error(`[position-ledger] forceCloseStalePending could not read the ledger — skipping this cycle: ${err.message}. Will retry next cycle.`);
    return [];
  }
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
//
// v10.29 FIX — this is THE call site that caused real, confirmed data
// loss (see file header): it used to run unconditionally on every
// single reconciliation cycle for every genuinely-open position (the
// normal, most-common case) and called save() every time regardless of
// whether there was ever anything to clear. Combined with load()'s old
// silent []-on-failure, one unlucky read during a connectivity blip
// was enough to wipe a real, healthy position from tracking forever.
// Now: skips the write entirely unless there's an actual pending-close
// mark to clear, and refuses to write at all if the ledger can't
// currently be read (rather than fabricating an empty one).
const clearPendingClose = (orderId) => {
  let entries;
  try {
    entries = load();
  } catch (err) {
    console.error(`[position-ledger] clearPendingClose(${orderId}) could not read the ledger — skipping this cycle: ${err.message}. ` +
      `Not dangerous to skip: any real pending-close mark just stays a little longer, and forceCloseStalePending()'s bounded timeout already handles that safely.`);
    return;
  }
  const target = entries.find(e => e.orderId === orderId && e.pendingCloseSince);
  if (!target) return; // v10.29: nothing to actually clear — skip the write (this was the main amplifier of the bug: writing on literally every healthy cycle for no reason)
  const updated = entries.map(e => e === target ? { ...e, pendingCloseSince: null } : e);
  save(updated);
};

// v10.29: countOpen() feeds MAX_CONCURRENT_TRADES directly — if the
// ledger can't be read right now, the safe direction is to OVER-count
// (block new trades) rather than under-count (which could let more
// trades through than intended). Infinity guarantees the
// openCount >= MAX_CONCURRENT_TRADES check in execute-signal.js always
// blocks when we genuinely can't verify the real count.
const countOpen = () => {
  try {
    return load().filter(e => e.status === 'open').length;
  } catch (err) {
    console.error(`[position-ledger] countOpen could not read the ledger — reporting Infinity as a safety fallback (blocks new trades until the ledger is readable again): ${err.message}`);
    return Infinity;
  }
};

// v10.29: read-only, used by protect.js's reconciliation loop. If the
// ledger can't be read, returning [] just means this cycle reconciles
// nothing — safe, since no write happens for entries protect.js
// doesn't know about, and the next successful read catches up normally.
const getOpen = () => {
  try {
    return load().filter(e => e.status === 'open');
  } catch (err) {
    console.error(`[position-ledger] getOpen could not read the ledger — returning empty for this cycle only: ${err.message}`);
    return [];
  }
};

// v10.25: symbol-specific check, used by execute-signal.js as a backstop
// against double-execution — independent of WHY two execution attempts
// might happen for the same signal (GitHub Actions + watcher.js racing,
// a manual `node strategy.js` run on Termux overlapping with watcher.js,
// or any future scenario not anticipated here). countOpen()/MAX_CONCURRENT_TRADES
// only ever checked a TOTAL count, never "is this exact symbol already
// open" — so two attempts for the same signal could both pass that
// check and both place a real order. This closes that gap directly.
//
// v10.29: if the ledger can't be read, returns true (assume it MIGHT
// already be open) rather than false — fail toward blocking a new
// trade, never toward risking a duplicate. execute-signal.js's v10.28
// exchange-level check runs right after this regardless, as a second,
// independent layer.
const isSymbolOpen = (bybitSymbol) => {
  try {
    return load().some(e => e.status === 'open' && e.symbol === bybitSymbol);
  } catch (err) {
    console.error(`[position-ledger] isSymbolOpen(${bybitSymbol}) could not read the ledger — assuming TRUE as a safety fallback (blocks opening a new position on this symbol until the ledger is readable again): ${err.message}`);
    return true;
  }
};

// Most recent N CLOSED trades, newest first — used by protect.js to
// check consecutive-loss / drawdown rules. Never includes open trades.
// v10.29: if the ledger can't be read, returns [] for this cycle only —
// same reasoning as getOpen().
const getRecentClosed = (n = 10) => {
  try {
    return load()
      .filter(e => e.status === 'closed')
      .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
      .slice(0, n);
  } catch (err) {
    console.error(`[position-ledger] getRecentClosed could not read the ledger — returning empty for this cycle only: ${err.message}`);
    return [];
  }
};

module.exports = { recordOpened, recordClosed, markPendingClose, clearPendingClose, forceCloseStalePending, countOpen, getOpen, isSymbolOpen, getRecentClosed, LEDGER_FILE };
