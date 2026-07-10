/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — MONTHLY VALUE SNIPER v10.15.3  (strategy.js — LIVE RUNNER)
 *
 *  All decision logic now lives in core.js (shared with backtest.js).
 *  This file only: fetches KuCoin data, calls core.js, sends Telegram
 *  alerts, and persists state/logs. See core.js header for the full
 *  architecture explanation and what changed from v9.x.
 *
 *  HONESTY NOTE: this bot does not target or achieve a 100% win rate.
 *  No trading system does, live or backtested. Treat every alert as a
 *  probability-favored setup with a defined stop-loss — not a guarantee.
 *  Size positions so that a string of 3-4 consecutive losses (normal,
 *  expected variance) does not meaningfully damage your account.
 *
 *  v10.4 RELIABILITY NOTE (2026-07-03): sendSafe (Telegram) and getKlines
 *  (KuCoin fetch) both now retry on transient failure instead of silently
 *  giving up after one attempt. Previously, a single brief Telegram outage
 *  or network blip at exactly the wrong moment would drop a real signal
 *  with only a line in the Action log — you'd have no way to know. Now:
 *  Telegram send retries 3x (1s/2s/3s backoff), KuCoin fetch retries 2x
 *  (0.8s backoff). If it still fails after that, it's a genuine outage on
 *  their end, not this bot, and it's logged loudly either way.
 *
 *  v10.7 EXPERIMENTAL NOTE (2026-07-04): SL_ATR_MULT_MATRIX support added
 *  — OFF by default. See config.js for what it does and how to backtest
 *  it before ever considering turning it on live. If enabled, the
 *  Telegram message's SL line and suggested-size line both reflect the
 *  actual widened value used — nothing is hidden if you do turn it on.
 *
 *  v10.8 NOTE (2026-07-04): three more POC-quality tests added
 *  (prominence, migration, naked POC) — logged to signals.log.json
 *  regardless of on/off state, so there's a real history to check.
 *  NAKED_POC and POC_MIGRATION make this file request more 1H history
 *  from KuCoin (750-1000 bars vs the usual 500), but ONLY when their flag
 *  is actually on — zero extra API load otherwise. See config.js for the
 *  reasoning behind each.
 *
 *  v10.9 (2026-07-05): all three v10.8 factors above flipped from off-by-
 *  default to ON by default — applied live per explicit instruction,
 *  not gated behind a backtest-first requirement (SL_ATR_MULT_MATRIX,
 *  v10.7, is a separate mechanism and stays off by default — that
 *  instruction didn't cover it). Also: signals.log.json and
 *  diag.log.json now write NEWEST-FIRST (unshift, not push) so the most
 *  recent activity is at the top of the file, not the bottom.
 *
 *  v10.10 (2026-07-06): FIVE-TIMEFRAME VOTE, 3-OF-5 — see config.js and
 *  core.js v10.10 notes for the full architecture. This file now fetches
 *  1D and 30m candles alongside the existing 4H/1H/15m, casts 5 bias
 *  votes instead of 3, and requires config.MIN_TF_AGREE (3) to agree
 *  before a direction resolves. Also fixed: state.json now carries the
 *  full bias breakdown (was diag.log.json-only before), and every scan
 *  updates state.json even when no direction resolves, so /status can
 *  never be more than one scan stale.
 * ═══════════════════════════════════════════════════════════════════════
 */

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const config = require('./config');
// v10.14: single source of truth for the version string — see backtest.js's
// identical comment for why this exists (recurring stale-version-string bug).
const MVS_VERSION = require('./package.json').version;
const core   = require('./core');
const { checkOpenPositions } = require('./position-tracker');

// ── Telegram send — pure axios, 10s timeout, retries on transient failure ──
// v10.4 FIX: this used to catch a failure/timeout and just return null —
// meaning a transient Telegram hiccup (their API has brief outages) would
// silently drop a real signal alert. You'd never know a signal fired
// unless you happened to check the Action logs. Now retries 3 times with
// a short backoff before giving up, and only THEN does it fail silently
// (logged loudly either way).
const TG = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;

// v10.15.2 CRITICAL FIX: Telegram's legacy Markdown parse mode (used
// throughout this bot) has NO escape mechanism — a single unpaired `_`,
// `*`, or `` ` `` anywhere in the message causes Telegram to reject the
// ENTIRE message with a 400 "can't parse entities" error. tgCall/sendSafe
// catch that error internally and just log it — so this failure is
// completely silent: no exception surfaces, the GitHub Actions run still
// shows green/success, and the message simply never arrives. Found via a
// live "commands not responding" report — traced to `patternStr` below
// embedding raw pattern names like `POC_RECLAIM` (1 underscore — always
// odd, always fatal) directly into the alert text. This is NOT limited to
// one command: any internal identifier with an underscore
// (`POC_RECLAIM`, `EARLY_TIMEOUT`, `NO_AGREEMENT`, etc.) silently breaks
// ANY message it appears in, including this bot's actual trade alerts.
// mdSafe() neutralizes this by replacing underscores with spaces for
// DISPLAY only — never touches the underlying value, so no comparison
// or logic anywhere else in the codebase is affected, only what gets
// rendered in a Telegram message.
const mdSafe = (s) => String(s ?? '').replace(/_/g, ' ');

// v10.10 FIX: sendSafe used to swallow a total delivery failure (all
// retries exhausted) and just return undefined/null. The caller had no
// way to tell "delivered" apart from "silently dropped" — so a signal
// could fire, get written to state.json/signals.log.json as FIRED (both
// happen unconditionally right after this call), and yet the live
// Telegram alert never actually reached the user. The bug only surfaced
// later, when the weekly digest read the log and reported the signal as
// fired — the first the user heard of it. Now sendSafe always returns an
// explicit { success, data|error } so the caller can react honestly, and
// the FIRED block below queues a failed alert for automatic redelivery
// on the next run instead of just recording success it never delivered.
const sendSafe = async (chatId, text, opts = {}, ms = 10000, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await Promise.race([
      axios.post(`${TG}/sendMessage`, { chat_id: chatId, text, ...opts }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Telegram send timed out')), ms)),
    ]).catch((e) => ({ __failed: true, message: e.message }));

    if (!result || !result.__failed) return { success: true, data: result?.data };

    console.error(`  ⚠️ Telegram send failed/timed out (attempt ${attempt}/${maxRetries}): ${result.message}`);
    if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1000 * attempt));
  }
  console.error(`  ❌ Telegram send FAILED after ${maxRetries} attempts — this alert was NOT delivered.`);
  return { success: false, error: 'Telegram send failed after all retries' };
};

// ── Persistence ──────────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, 'state.json');
const LOG_FILE    = path.join(__dirname, 'signals.log.json');
const DIAG_FILE   = path.join(__dirname, 'diag.log.json');
// v10.14: open-positions.json holds ONLY the immutable original trade
// parameters (entry/SL/TP1/TP2/direction/entryTime) for every FIRED
// signal not yet closed. position-tracker.js reads/writes this file;
// see its header for why it's deliberately kept stateless (no tp1Hit/
// beMoved persisted here — those get recomputed by replay every run).
const OPEN_POSITIONS_FILE = path.join(__dirname, 'open-positions.json');

const loadJSON = (file, fallback) => {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return fallback; }
};

const saveState = (symbol, data) => {
  const state = loadJSON(STATE_FILE, {});
  state[symbol] = { ...data, updatedAt: new Date().toISOString() };
  state._lastRunAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

// v10.14: records a newly-FIRED signal as an open position for
// position-tracker.js to check on every subsequent scan. Deliberately
// stores ONLY the immutable original trade parameters — see
// OPEN_POSITIONS_FILE comment above and position-tracker.js's header.
const saveOpenPosition = (symbol, trade) => {
  const open = loadJSON(OPEN_POSITIONS_FILE, {});
  open[symbol] = trade;
  fs.writeFileSync(OPEN_POSITIONS_FILE, JSON.stringify(open, null, 2));
};

// v10.9: both logs are now NEWEST-FIRST (unshift + slice from the front)
// instead of oldest-first (push + slice from the back) — requested so the
// most recent activity is at the top of the file when opened, instead of
// requiring a scroll to the bottom of an increasingly long log. Any code
// that reads these files and assumes chronological (oldest-first) order
// needs updating to match — see weekly-summary.js v10.9 notes for the
// three spots that assumption lived in (equity curve math, "latest
// snapshot" lookup, and the displayed entry list).
const logSignal = (symbol, entry) => {
  const log = loadJSON(LOG_FILE, []);
  log.unshift({ symbol, ...entry, time: new Date().toISOString() });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log.slice(0, 500), null, 2));
};

const logDiag = (entry) => {
  const log = loadJSON(DIAG_FILE, []);
  log.unshift({ ...entry, ts: new Date().toISOString() });
  fs.writeFileSync(DIAG_FILE, JSON.stringify(log.slice(0, 2000), null, 2));
};

// ── Pending-alert queue (v10.10) ─────────────────────────────────────────────
// A signal that fires but fails all 3 Telegram delivery attempts still gets
// written to state.json/signals.log.json (we don't want to lose the trade
// record). This queue is the other half of the fix: it remembers the exact
// message text so the NEXT scan run — before it does anything else — tries
// once to deliver it. This is a best-effort recovery for a genuine outage
// window, not a guarantee; if Telegram is down for the whole cooldown period
// the alert is still lost, but that's now a rare double-failure instead of
// the default behavior for any single-scan hiccup.
const PENDING_FILE = path.join(__dirname, 'pending-alerts.json');

const queuePendingAlert = (symbol, message) => {
  const pending = loadJSON(PENDING_FILE, []);
  pending.push({ symbol, message, queuedAt: new Date().toISOString() });
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
};

const flushPendingAlerts = async () => {
  const pending = loadJSON(PENDING_FILE, []);
  if (!pending.length) return;
  console.log(`\n📬 ${pending.length} undelivered alert(s) from a previous run — retrying delivery first...`);
  const stillPending = [];
  for (const item of pending) {
    const result = await sendSafe(config.TELEGRAM_CHAT_ID, item.message, { parse_mode: 'Markdown' });
    if (result.success) {
      console.log(`  ✅ Redelivered queued alert for ${item.symbol} (originally queued ${item.queuedAt}).`);
    } else {
      console.error(`  ❌ Still undelivered: ${item.symbol} (queued ${item.queuedAt}). Will retry again next run.`);
      stillPending.push(item);
    }
  }
  fs.writeFileSync(PENDING_FILE, JSON.stringify(stillPending, null, 2));
};

// ── KuCoin data fetch ────────────────────────────────────────────────────────
// v10.4 FIX: added light retry (2 attempts, short backoff) for the same
// reason as backtest.js's fetchKlines — a single transient network blip
// used to make the bot silently skip a symbol for that whole 15-min cycle.
// Low-severity live (next cycle retries fresh in 15 min regardless), but
// worth closing given the point of this pass is end-to-end reliability.
const getKlines = async (symbol, interval, limit, maxRetries = 2) => {
  const safeLimit = Math.min(limit + 20, 1500); // buffer for ATR/VP warmup
  const url = `${config.BASE_URL}/market/candles?symbol=${symbol}&type=${interval}&limit=${safeLimit}`;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.get(url, { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
      if (res.data.code !== '200000') {
        console.error(`  ❌ KuCoin API error (${interval}, attempt ${attempt}/${maxRetries}): ${res.data.code} — ${res.data.msg || 'Unknown'}`);
        if (attempt === maxRetries) return [];
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      const sorted = (res.data.data || []).reverse();
      return sorted.slice(-limit).map(k => ({
        time: parseInt(k[0]), open: parseFloat(k[1]), close: parseFloat(k[2]),
        high: parseFloat(k[3]), low: parseFloat(k[4]), volume: parseFloat(k[5]),
      }));
    } catch (e) {
      console.error(`  ❌ KuCoin fetch error for ${symbol} (${interval}, attempt ${attempt}/${maxRetries}):`, e.message);
      if (attempt === maxRetries) return [];
      await new Promise(r => setTimeout(r, 800));
    }
  }
  return [];
};

// ── Signal cooldown ──────────────────────────────────────────────────────────
const isCoolingDown = (symbol, direction, currentBarTime) => {
  const state = loadJSON(STATE_FILE, {});
  const s = state[symbol];
  if (!s || !s.lastSignalBar || !s.lastSignalDir) return false;
  if (s.lastSignalDir !== direction) return false;
  const barsSince = Math.round((currentBarTime - s.lastSignalBar) / config.STRUCT_BAR_SECONDS);
  return barsSince < config.SIGNAL_COOLDOWN_BARS;
};

// ── Duplicate-run guard ──────────────────────────────────────────────────────
// mvs-scan.yml now has two independent triggers: cron-job.org's ping (primary)
// and a GitHub-native `schedule:` backup (added so scanning survives a
// cron-job.org outage). Both call this same script via workflow_dispatch/
// schedule. If they ever land within a few minutes of each other, this stops
// the second invocation before it does any work — prevents duplicate Telegram
// alerts and duplicate state/log writes for the same 15m candle.
const DUPLICATE_RUN_GUARD_MS = 5 * 60 * 1000; // 5 min — well under the 15 min cadence

const isDuplicateRun = () => {
  const state = loadJSON(STATE_FILE, {});
  if (!state._lastRunAt) return false;
  const elapsed = Date.now() - new Date(state._lastRunAt).getTime();
  return elapsed >= 0 && elapsed < DUPLICATE_RUN_GUARD_MS;
};

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN STRATEGY ENGINE
// ─────────────────────────────────────────────────────────────────────────────
const runStrategy = async (symbol) => {
  const now = new Date().toISOString();
  console.log(`\n[${now}] 🔍 MVS v${MVS_VERSION} scanning ${symbol}...`);

  {
    const state = loadJSON(STATE_FILE, {});
    state._lastRunAt = now;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  try {
    // ── STEP 1: FETCH ALL FIVE TIMEFRAMES (v10.10) ──────────────────────
    // v10.8: POC_MIGRATION and NAKED_POC both need more 1H history than
    // the bot normally fetches (750 and 1000 bars respectively, vs the
    // usual 500) — but ONLY when those experimental flags are actually
    // on, so there's zero extra KuCoin API load in the default (off) case.
    let struct1hLimit = config.STRUCT_VP_LOOKBACK;
    if (config.NAKED_POC_ENABLED) struct1hLimit = Math.max(struct1hLimit, config.STRUCT_VP_LOOKBACK * 2);
    if (config.POC_MIGRATION_ENABLED) struct1hLimit = Math.max(struct1hLimit, config.STRUCT_VP_LOOKBACK + config.POC_MIGRATION_OFFSET_BARS);

    const [data1d, data4h, data1h, data30m, data15m] = await Promise.all([
      getKlines(symbol, config.DAILY_TIMEFRAME,   config.DAILY_VP_LOOKBACK),
      getKlines(symbol, config.BIAS_TIMEFRAME,    config.BIAS_VP_LOOKBACK),
      getKlines(symbol, config.STRUCT_TIMEFRAME,  struct1hLimit),
      getKlines(symbol, config.HALF_TIMEFRAME,    config.HALF_VP_LOOKBACK),
      getKlines(symbol, config.TRIGGER_TIMEFRAME, config.TRIGGER_VP_LOOKBACK),
    ]);

    if (data1h.length < 50) {
      console.log(`  ⚠️ Insufficient 1H data (${data1h.length} bars). Skipping.`);
      logDiag({ symbol, fired: false, reason: 'INSUFFICIENT_1H_DATA', bars: data1h.length });
      return;
    }
    if (data15m.length < 50) {
      console.log(`  ⚠️ Insufficient 15m data (${data15m.length} bars). Skipping.`);
      logDiag({ symbol, fired: false, reason: 'INSUFFICIENT_15M_DATA', bars: data15m.length });
      return;
    }

    // ── STEP 2: FIVE-TIMEFRAME BIAS VOTE (v10.10: 3-of-5) ───────────────
    // 1D and 4H are treated as optional (null if not enough history yet,
    // same tolerant handling the old code already gave 4H) — a short
    // symbol listing shouldn't crash the scan, it just has fewer possible
    // agreeing votes that scan.
    const bias1d  = data1d.length >= 50
      ? core.tfBiasVote(data1d, config.DAILY_VP_LOOKBACK, config.DAILY_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT)
      : null;
    const bias4h  = data4h.length >= 50
      ? core.tfBiasVote(data4h, config.BIAS_VP_LOOKBACK, config.BIAS_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT)
      : null;
    const bias1h  = core.tfBiasVote(data1h, config.STRUCT_VP_LOOKBACK, config.STRUCT_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);
    const bias30m = data30m.length >= 50
      ? core.tfBiasVote(data30m, config.HALF_VP_LOOKBACK, config.HALF_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT)
      : null;
    const bias15m = core.tfBiasVote(data15m, config.TRIGGER_VP_LOOKBACK, config.TRIGGER_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);

    if (!bias1h) {
      console.log(`  ⚠️ 1H bias vote failed (volume profile). Skipping.`);
      logDiag({ symbol, fired: false, reason: '1H_BIAS_FAILED' });
      return;
    }

    const resolved = core.resolveDirection([
      { tf: '1D',  result: bias1d },
      { tf: '4H',  result: bias4h },
      { tf: '1H',  result: bias1h },
      { tf: '30m', result: bias30m },
      { tf: '15m', result: bias15m },
    ], config.MIN_TF_AGREE);

    console.log(
      `  📡 VOTE: 1D=${bias1d ? bias1d.bias : 'N/A'} | 4H=${bias4h ? bias4h.bias : 'N/A'} | 1H=${bias1h.bias} | 30m=${bias30m ? bias30m.bias : 'N/A'} | 15m=${bias15m ? bias15m.bias : 'N/A'}` +
      (resolved ? ` → ${resolved.direction} (${resolved.tally}: ${resolved.agreeing.join('+')})` : ` → NO ${config.MIN_TF_AGREE}-OF-5 AGREEMENT`)
    );

    if (!resolved) {
      logDiag({
        symbol, bias1d: bias1d?.bias, bias4h: bias4h?.bias, bias1h: bias1h.bias,
        bias30m: bias30m?.bias, bias15m: bias15m?.bias,
        fired: false, reason: `NO_${config.MIN_TF_AGREE}OF5_AGREEMENT`,
      });
      // v10.10 FIX: previously nothing was saved to state.json when the
      // vote didn't resolve, so /status kept showing whatever the LAST
      // successful scan wrote — stale bias/direction, or nothing at all
      // for a symbol that had never once resolved. Now every scan updates
      // state.json with the current bias breakdown even when no signal
      // direction is decided, so /status is never more than one scan old.
      saveState(symbol, {
        signal: 'NO_AGREEMENT', direction: null, price: data1h[data1h.length - 1]?.close,
        bias1d: bias1d?.bias, bias4h: bias4h?.bias, bias1h: bias1h.bias,
        bias30m: bias30m?.bias, bias15m: bias15m?.bias,
      });
      return;
    }

    const direction = resolved.direction;

    // ── STEP 3: 1H STRUCTURE — SWING / FIB POCKET ───────────────────────
    const swing1h = bias1h.swing;
    const price   = data1h[data1h.length - 1].close;
    const barTime = data1h[data1h.length - 1].time;

    const atr1h = core.calcATR(data1h, config.ATR_PERIOD);
    if (!atr1h) {
      console.log(`  ⚠️ 1H ATR calculation failed. Skipping.`);
      logDiag({ symbol, fired: false, reason: 'ATR_FAILED' });
      return;
    }

    // v10.15 NEW — volatility/regime filter, requested: "same setup in a
    // quiet, orderly market vs. a violent, choppy one isn't the same
    // trade." Placed here (cheapest possible point — right after ATR,
    // before any of the more expensive structure/confluence/pattern work
    // below) since it's a pure regime check, independent of direction,
    // pivot, or pattern. See config.js VOLATILITY_REGIME_* for the full
    // rationale and honest untested-caveat.
    if (config.VOLATILITY_REGIME_ENABLED) {
      const atrSeries1h = core.calcATRSeries(data1h, config.ATR_PERIOD);
      const atrPctl = core.calcATRPercentile(atrSeries1h, config.VOLATILITY_LOOKBACK_BARS);
      if (atrPctl !== null && (atrPctl < config.VOLATILITY_MIN_PCTL || atrPctl > config.VOLATILITY_MAX_PCTL)) {
        console.log(`  ⏭️ VOLATILITY REGIME: ATR at ${atrPctl.toFixed(1)}th percentile (need ${config.VOLATILITY_MIN_PCTL}-${config.VOLATILITY_MAX_PCTL}). Skipping.`);
        logDiag({ symbol, barTime, price, fired: false, reason: 'VOLATILITY_REGIME_GATED', atrPctl: parseFloat(atrPctl.toFixed(1)) });
        return;
      }
    }

    // Structural remap — price broke the 1H swing entirely
    if (price > swing1h.high || price < swing1h.low) {
      console.log(`  🔄 STRUCTURAL REMAP: ${symbol} broke 1H swing. Zones void, recalculating next scan.`);
      saveState(symbol, { signal: 'REMAP', price, swingHigh: swing1h.high, swingLow: swing1h.low });
      logSignal(symbol, { signal: 'REMAP', price });
      return;
    }

    const fib = core.calcFib(swing1h.high, swing1h.low, direction, config.FIB_ZONE_LOW, config.FIB_ZONE_HIGH);

    // Over-extension: beyond 88.6% = structural extreme, swing likely invalid
    const overExtended = (direction === 'BUY' && price < fib.level886) || (direction === 'SELL' && price > fib.level886);
    if (overExtended) {
      console.log(`  ⏭️ OVER-EXTENDED: price beyond 88.6% structural extreme.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'OVER_EXTENDED' });
      return;
    }

    // Early zone-proximity skip — shared gate (core.isNearZone), identical
    // to backtest.js. Bug fix: this used to be hand-rolled here with an
    // extra 0.1×ATR pad stacked on top of the ±1×ATR band (~1.1×ATR total),
    // while backtest.js used exactly ±1.0×ATR — see core.js v10.1 fix log.
    if (!core.isNearZone(price, fib, atr1h, config.NEAR_ZONE_ATR_MULT)) {
      console.log(`  ⏳ Price not near 1H zone ($${fib.zoneLow.toFixed(2)}–$${fib.zoneHigh.toFixed(2)}). Waiting.`);
      return;
    }

    const vp1h = bias1h.vp;
    console.log(`  📊 1H POC $${vp1h.pocPrice.toFixed(2)} | VAH $${vp1h.vahPrice.toFixed(2)} | VAL $${vp1h.valPrice.toFixed(2)}`);

    saveState(symbol, {
      signal: 'SCANNED', price, direction,
      voteTally: resolved.tally, agreeing: resolved.agreeing,
      bias1d: bias1d?.bias, bias4h: bias4h?.bias, bias1h: bias1h.bias,
      bias30m: bias30m?.bias, bias15m: bias15m?.bias,
      poc: vp1h.pocPrice, vah: vp1h.vahPrice, val: vp1h.valPrice,
      swingHigh: swing1h.high, swingLow: swing1h.low, atr1h,
    });

    // ── STEP 4: CONFLUENCE CHECK (Fib × POC/VAH/VAL on 1H) ───────────────
    const fibMid = (fib.zoneHigh + fib.zoneLow) / 2;
    const checkLevels = [fib.level618, fib.level786, fibMid];
    const checkPivots = [
      { name: 'POC', price: vp1h.pocPrice },
      { name: 'VAH', price: vp1h.vahPrice },
      { name: 'VAL', price: vp1h.valPrice },
    ];

    let bestScore = 0, bestFibLevel = null, bestPivot = null;
    for (const lvl of checkLevels) {
      for (const pivot of checkPivots) {
        const sc = core.confluenceScore(lvl, pivot.price, atr1h, config.CONFLUENCE_ATR_MULT);
        if (sc > bestScore) { bestScore = sc; bestFibLevel = lvl; bestPivot = pivot; }
      }
    }

    if (bestScore < 1) {
      console.log(`  ❌ No Fib/POC/VAH/VAL confluence at current price. Waiting.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'NO_CONFLUENCE' });
      return;
    }
    if (bestPivot.name === 'POC' && bestScore < config.MIN_CONFLUENCE_POC) {
      console.log(`  ⚠️ POC confluence too loose (score ${bestScore}, need ${config.MIN_CONFLUENCE_POC}). Skipping.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'POC_CONFLUENCE_TOO_LOOSE' });
      return;
    }

    // v10.12: POC pivot without 1H in the agreeing vote is a confirmed
    // weak segment (168 trades, 58.3% WR, 15 of 18 total SLs in the
    // report that surfaced this) — gated out entirely now, not just
    // downsized. See config.js POC_REQUIRE_1H_CONFIRM for the full
    // rationale and how to A/B it.
    if (bestPivot.name === 'POC' && config.POC_REQUIRE_1H_CONFIRM && !resolved.agreeing.includes('1H')) {
      console.log(`  ⚠️ POC pivot without 1H confirmation — historically the weakest segment (83% of SLs in the confirming backtest). Skipping.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'POC_NO1H_GATED' });
      return;
    }

    // v10.14 FIX: this gate used to sit ~90 lines further down, inside
    // the Telegram-alert-building section (past SL/TP calculation) —
    // meaning a contested-POC setup still paid for a full
    // computeTradeLevels() call before being thrown away, and the two
    // POC gates that conceptually belong together (this one and the
    // POC_REQUIRE_1H_CONFIRM one just above) lived in different parts of
    // the pipeline entirely. Moved here, right next to its sibling gate,
    // both for a pipeline that actually matches its own documentation and
    // to skip SL/TP math for setups already known to be rejected. See
    // config.js POC_PROMINENCE_REQUIRE_DECISIVE for the full evidence.
    // `prominence` is computed here once and reused (not recomputed) by
    // the sizing-note section further down — see v10.13 comment there.
    const prominence = core.computePOCProminence(vp1h);
    if (!core.isPOCProminenceTrusted(bestPivot.name, prominence, config)) {
      console.log(`  ⚠️ POC contested (prominence ratio ${prominence.prominenceRatio.toFixed(2)} < ${config.POC_PROMINENCE_MIN_RATIO}) — historically the weaker POC segment. Skipping.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'POC_PROMINENCE_GATED' });
      return;
    }

    const fibPct = bestFibLevel === fib.level618 ? '61.8%' : bestFibLevel === fib.level786 ? '78.6%' : '70% mid-pocket';
    console.log(`  ✅ CONFLUENCE (score ${bestScore}): Fib ${fibPct} ($${bestFibLevel.toFixed(2)}) ↔ ${bestPivot.name} ($${bestPivot.price.toFixed(2)})`);

    // ── STEP 5: 4H ZONE CROSS-CHECK ──────────────────────────────────────
    const htfCheck = core.checkHTFZoneAlignment(bestFibLevel, bias4h, atr1h, direction, config.HTFZONE_ATR_MULT);
    if (!htfCheck.aligned) {
      console.log(`  ⛔ 4H ZONE MISMATCH: nearest ${htfCheck.nearestLevel} dist $${htfCheck.distance.toFixed(2)}. Waiting.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'HTF_4H_ZONE_MISMATCH' });
      return;
    }
    console.log(`  ✅ 4H ZONE ALIGNED: near ${htfCheck.nearestLevel} ($${(htfCheck.nearestPrice || 0).toFixed(2)})`);

    // ── STEP 6: ZONE INVALIDATION ─────────────────────────────────────────
    if (core.isZoneInvalidated(price, bestFibLevel, atr1h, direction, config.ZONE_INVALIDATION_ATR_MULT)) {
      console.log(`  ❌ ZONE INVALIDATED: 1H close beyond zone by > ATR×${config.ZONE_INVALIDATION_ATR_MULT}.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'ZONE_INVALIDATED' });
      return;
    }

    // ── STEP 7: SIGNAL COOLDOWN ───────────────────────────────────────────
    if (isCoolingDown(symbol, direction, barTime)) {
      console.log(`  ⏸️ COOLDOWN: ${direction} suppressed (< ${config.SIGNAL_COOLDOWN_BARS} 1H bars since last).`);
      // v10.15.3 FIX: same gap as TP2_EXTENSION_TOO_SHORT above — this was
      // the other gate with no diag.log.json record at all. Confirmed via
      // the live diag log's own reason distribution before fixing: zero
      // cooldown-related entries had ever been logged, across 1800+ scans.
      logDiag({ symbol, barTime, price, fired: false, reason: 'SIGNAL_COOLDOWN' });
      return;
    }

    // ── STEP 8: 15m TRIGGER CANDLE ────────────────────────────────────────
    // The 1H structure defines WHERE the zone is. The 15m candle decides
    // WHEN to actually fire — tighter timing than waiting a full 1H close.
    const entryZoneLow  = fib.zoneLow  - atr1h * 0.1;
    const entryZoneHigh = fib.zoneHigh + atr1h * 0.1;

    const rejection = core.detectRejection(
      data15m, entryZoneLow, entryZoneHigh, direction,
      { poc: vp1h.pocPrice, vah: vp1h.vahPrice, val: vp1h.valPrice },
      config.ABSORPTION_BODY_RATIO, config.REJECTION_MIN_PATTERNS, config.ALLOW_SOLO_TRIGGER,
      config.SOLO_ELIGIBLE_PATTERNS
    );

    logDiag({
      symbol, barTime, price,
      bias1d: bias1d?.bias, bias4h: bias4h?.bias, bias1h: bias1h.bias,
      bias30m: bias30m?.bias, bias15m: bias15m?.bias,
      voteTally: resolved.tally, agreeing: resolved.agreeing,
      // v10.14: renamed from "htfAligned" — a user asked which timeframe
      // "HTF" (Higher Time Frame) actually meant here, which is a fair
      // question given the field name alone doesn't say. Answer: the 4H
      // bias specifically — see the "4H ZONE CROSS-CHECK" step above,
      // checkHTFZoneAlignment(bestFibLevel, bias4h, ...). Renamed the
      // field itself instead of just documenting it, so the diag log is
      // self-explanatory without needing to check the code or docs.
      htf4hAligned: htfCheck.aligned, confluenceScore: bestScore, confluenceLevel: fibPct, confluencePivot: bestPivot.name,
      patterns: rejection.patterns, absorptionVeto: rejection.absorptionVeto,
      fired: rejection.valid,
      reason: rejection.valid ? 'SIGNAL_FIRED' : rejection.absorptionVeto ? 'ABSORPTION_VETO' : `PATTERNS_${rejection.score}_OF_${config.REJECTION_MIN_PATTERNS}`,
    });

    if (!rejection.valid) {
      if (rejection.absorptionVeto) {
        console.log(`  ⏳ ABSORPTION VETO: opposing institutional candle at zone. Skip.`);
      } else {
        console.log(`  ⏳ WEAK TRIGGER: ${rejection.score}/${config.REJECTION_MIN_PATTERNS} patterns on 15m. Waiting.`);
      }
      return;
    }

    // ── STEP 9: SL / TP CALCULATION ───────────────────────────────────────
    // v10.7 EXPERIMENTAL (off by default — see config.js SL_ATR_MULT_MATRIX):
    // per-pivot SL width test. slAtrMult falls back to the normal
    // config.SL_ATR_MULT whenever the feature is disabled OR this pivot
    // has no override, so this is a no-op unless explicitly turned on.
    const slAtrMult = config.SL_ATR_MULT_MATRIX_ENABLED && config.SL_ATR_MULT_MATRIX[bestPivot.name] != null
      ? config.SL_ATR_MULT_MATRIX[bestPivot.name]
      : config.SL_ATR_MULT;
    const levels = core.computeTradeLevels({
      direction, entryPrice: bestFibLevel, swing: swing1h, atr: atr1h, vp: vp1h,
      slAtrMult, tp1RrFloor: config.TP1_RR_FLOOR, fibLevel500: fib.level500,
      tp2MinExtensionRR: config.TP2_MIN_EXTENSION_RR,
    });
    if (!levels) {
      // v10.15.3 FIX: every other gate in this pipeline calls logDiag()
      // so it shows up in diag.log.json — this was the one exception,
      // console.log only. Found while diagnosing a "TRX-USDT gets 0
      // trades" report: the backtest's funnel counters could show
      // triggerOk=24, tp2RangeOk=0 (this exact gate rejecting all 24),
      // but the LIVE diag log had no equivalent record at all, since this
      // one case was never persisted — making it needlessly hard to
      // confirm live behavior matches backtest behavior for this specific
      // check. Reason string mirrors the D-signal taxonomy naming
      // convention used everywhere else (see README's Signal Taxonomy).
      console.log(`  ⏭️ Invalid TP structure (TP2 doesn't extend ≥${config.TP2_MIN_EXTENSION_RR}R beyond TP1). Suppressed.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'TP2_EXTENSION_TOO_SHORT' });
      return;
    }

    // ── STEP 10: TELEGRAM ALERT ───────────────────────────────────────────
    const emoji = direction === 'BUY' ? '🟢' : '🔴';
    const patternStr = rejection.patterns.map(mdSafe).join(' + ');
    const voteLine = `🗳️ *TF Vote (${resolved.tally}):* ${resolved.agreeing.join(' + ')} agree ${direction === 'BUY' ? 'BULLISH' : 'BEARISH'}` +
      (bias1d ? ` | 1D:${bias1d.bias}` : '') + (bias4h ? ` | 4H:${bias4h.bias}` : '') + ` 1H:${bias1h.bias}` +
      (bias30m ? ` 30m:${bias30m.bias}` : '') + (bias15m ? ` 15m:${bias15m.bias}` : '');

    // v10.6: TD Sequential "9" — independent, additive-only evidence. See
    // core.js computeTDSequential() header for the full reasoning. Only
    // ever restores size toward 1.0, never blocks, never exceeds normal.
    const td9 = config.TD9_ENABLED ? core.computeTDSequential(data1h) : { buy9: false, sell9: false };
    const td9Confirms = (direction === 'BUY' && td9.buy9) || (direction === 'SELL' && td9.sell9);

    // v10.8/v10.9 (live by default — see config.js): two more
    // independent POC-quality tests (prominence itself was already
    // computed and gated back in STEP 4 — see the v10.14 note there;
    // reused here via the `prominence` variable already in scope rather
    // than calling computePOCProminence() a second time). Each function
    // internally no-ops (returns a neutral/empty result) when its data
    // requirement isn't met or its flag is off, so these calls are
    // always safe to make.
    const migration = core.computePOCMigration(
      data1h, config.STRUCT_VP_LOOKBACK, config.VP_ROWS,
      config.POC_MIGRATION_OFFSET_BARS, atr1h, config.POC_MIGRATION_MIN_ATR
    );
    const nakedPOC = core.computeNakedPOC(
      data1h, config.STRUCT_VP_LOOKBACK, config.VP_ROWS,
      atr1h, vp1h.pocPrice, config.NAKED_POC_TOLERANCE_ATR
    );
    // v10.15 NEW — see core.js computeMultiTFPOCAlignment() and config.js
    // MULTI_TF_POC_* for the full rationale/caveat. bias4h.poc / bias1d.poc
    // come from tfBiasVote()'s own flat return fields (same ones
    // checkHTFZoneAlignment already uses) — no extra fetch needed.
    const multiTFPOC = core.computeMultiTFPOCAlignment(
      vp1h.pocPrice, bias4h?.poc, bias1d?.poc, atr1h, config.MULTI_TF_POC_TOLERANCE_ATR
    );

    // v10.3/v10.4/v10.5/v10.6/v10.7: risk-tiered sizing — see core.js
    // computeRiskMultiplier() for the backtest evidence behind this. Not a
    // filter: this signal fires regardless of tier, only the suggested
    // size changes.
    let riskMult = core.computeRiskMultiplier(
      bestPivot.name, resolved.agreeing, rejection.patterns,
      config.RISK_TIER_MATRIX, config.PATTERN_RISK_MATRIX, config.RISK_TIER_DEFAULT,
      td9Confirms, config.TD9_BOOST_MULT,
      slAtrMult, config.SL_ATR_MULT
    );
    // v10.8: applied as a separate multiplicative step (not folded into
    // computeRiskMultiplier itself) so each factor stays independently
    // switchable and its effect stays easy to isolate when reading a
    // backtest report. Always 1.0 (no-op) for VAH/VAL pivots regardless
    // of the inputs above, or if any/all of these flags get turned off.
    riskMult *= core.computePOCQualityMultiplier(bestPivot.name, direction, prominence, migration, nakedPOC, multiTFPOC, config);
    // v10.15 NEW — vote-strength sizing. See core.js
    // computeVoteStrengthMultiplier() for why this is a discount from
    // full at the strongest tally rather than a boost above it.
    riskMult *= core.computeVoteStrengthMultiplier(resolved.agreeing.length, config);
    riskMult = Math.max(0.1, Math.min(1.0, riskMult));

    const slWidened = slAtrMult !== config.SL_ATR_MULT;
    const weakReasons = [];
    if (!resolved.agreeing.includes('1H')) weakReasons.push('1H not in the confirming vote');
    if (rejection.patterns.includes('POC_RECLAIM')) weakReasons.push('POC RECLAIM pattern');
    const td9Suffix = td9Confirms ? ' | TD9 exhaustion confirms +boost' : '';
    // v10.7: SL-widening (when enabled) can push riskMult below 1.0 even
    // for an otherwise "strongest segment" trade — this is a size cut for
    // risk normalization, not a quality discount, so it's called out
    // separately rather than folded into weakReasons.
    const slWidenSuffix = slWidened ? ` | SL widened ${config.SL_ATR_MULT}→${slAtrMult}×ATR (EXPERIMENTAL, size cut to hold $ risk flat)` : '';
    // v10.8: same pattern — called out separately from weakReasons since
    // these are a distinct, independently-testable set of factors.
    // NOTE (found in v10.13 audit, gate itself relocated in v10.14): the
    // "contested POC" branch below can only ever fire for VAH/VAL-pivot
    // trades when POC_PROMINENCE_REQUIRE_DECISIVE is at its default
    // (true) — a POC pivot with contested prominence now returns early
    // at the prominence gate in STEP 4 (see the v10.14 note there),
    // before execution ever reaches this point. Left in (not dead code,
    // just conditionally unreachable for one pivot type) because: (a) it
    // still fires correctly for VAH/VAL trades, where prominence is
    // informational only and never gated, and (b) it becomes reachable
    // for POC trades again the moment someone sets
    // POC_PROMINENCE_REQUIRE_DECISIVE=false to fall back to size-only.
    const pocQualityNotes = [];
    if (config.POC_PROMINENCE_ENABLED && prominence.computed && prominence.prominenceRatio < config.POC_PROMINENCE_MIN_RATIO) {
      pocQualityNotes.push(`contested POC (ratio ${prominence.prominenceRatio.toFixed(2)} < ${config.POC_PROMINENCE_MIN_RATIO})`);
    }
    if (config.POC_MIGRATION_ENABLED && migration.migrating) {
      const confirms = (direction === 'BUY' && migration.direction === 'UP') || (direction === 'SELL' && migration.direction === 'DOWN');
      pocQualityNotes.push(`POC migrating ${migration.direction} (${confirms ? 'confirms' : 'against'} direction)`);
    }
    if (config.NAKED_POC_ENABLED && nakedPOC.aligned) {
      pocQualityNotes.push(`aligned with naked prior POC @ $${nakedPOC.priorPOC.toFixed(4)}`);
    }
    if (config.MULTI_TF_POC_ENABLED && multiTFPOC.anyAligned) {
      const which = [multiTFPOC.aligned4h && '4H', multiTFPOC.aligned1d && '1D'].filter(Boolean).join(' + ');
      pocQualityNotes.push(`POC aligned with ${which}`);
    }
    const pocQualitySuffix = pocQualityNotes.length ? ` | ${pocQualityNotes.join(', ')}` : '';
    const sizeLine = riskMult < 1
      ? `⚖️ *Suggested size:* ${Math.round(riskMult * 100)}% of normal (${bestPivot.name} pivot${weakReasons.length ? ', ' + weakReasons.join(' + ') + ' — historically weaker segment, see README' : ''}${td9Suffix}${slWidenSuffix}${pocQualitySuffix})`
      : `⚖️ *Suggested size:* 100% of normal (${bestPivot.name} pivot, 1H confirms — historically strongest segment${td9Suffix}${slWidenSuffix}${pocQualitySuffix})`;
    const td9Line = (td9.buy9 || td9.sell9)
      ? `\n🔢 *TD Sequential:* ${td9.buy9 ? 'Buy 9 just completed' : 'Sell 9 just completed'} (1H)${td9Confirms ? ' ✅ agrees with direction' : ' — opposite direction, informational only'}`
      : '';

    // v10.14: one open position per symbol is the model this bot tracks
    // (matches state.json's existing one-entry-per-symbol shape). If a
    // position is already open for this symbol when a fresh signal would
    // otherwise fire, skip firing rather than silently overwrite
    // open-positions.json and lose the ability to ever record how the
    // first one closed. Rare in practice — SIGNAL_COOLDOWN_BARS already
    // blocks same-direction re-fires — but an opposite-direction signal
    // could still land while a prior trade is still open.
    const openPositionsCheck = loadJSON(OPEN_POSITIONS_FILE, {});
    if (openPositionsCheck[symbol]) {
      console.log(`  ⏸️ ${symbol}: signal conditions met but a position is already open (since ${new Date(openPositionsCheck[symbol].entryTime * 1000).toISOString()}) — skipping new fire until it closes.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'POSITION_ALREADY_OPEN' });
      return;
    }

    const entryTime = data15m[data15m.length - 1].time;

    const message = `
${emoji} *${symbol} — MVS Signal*

📊 *Direction:* ${direction}
${voteLine}
🔗 *4H Zone:* near ${htfCheck.nearestLevel} ✅${td9Line}

━━━━━━━━━━━━━━━━━━━━
💵 *Entry:* \`$${bestFibLevel.toFixed(4)}\` (1H Fib ${fibPct} ↔ ${bestPivot.name})
🛑 *SL:* \`$${levels.slPrice.toFixed(4)}\` (1H swing wick ± ${slAtrMult}×ATR)
━━━━━━━━━━━━━━━━━━━━
🎯 *TP1 (exit ${Math.round(config.PARTIAL_EXIT_PCT * 100)}%, move SL to entry):* \`$${levels.tp1Price.toFixed(4)}\`  R:R ${levels.rr1.toFixed(2)}:1
🏁 *TP2 (runner, remaining ${Math.round((1 - config.PARTIAL_EXIT_PCT) * 100)}%, ${direction === 'BUY' ? 'VAH' : 'VAL'}):* \`$${levels.tp2Price.toFixed(4)}\`  R:R ${levels.rr2.toFixed(2)}:1
━━━━━━━━━━━━━━━━━━━━
${sizeLine}
🕯 *15m trigger (${rejection.solo ? 'SOLO' : rejection.score + '/' + config.REJECTION_MIN_PATTERNS}):* ${patternStr}
📐 *ATR(1H):* $${atr1h.toFixed(4)}

⚠️ Probability-favored setup, not a guarantee. Size so 3-4 consecutive
losses (normal variance) don't meaningfully hurt your account. Never
risk capital you can't afford to lose on a single position.

⏰ *Time:* ${new Date().toUTCString()}
⚡ *MVS v${MVS_VERSION}*
    `.trim();

    const sendResult = await sendSafe(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    const alertDelivered = sendResult.success;
    if (alertDelivered) {
      console.log(`  ✅ SIGNAL FIRED: ${symbol} | ${direction} @ $${bestFibLevel.toFixed(2)} | ${patternStr}`);
    } else {
      // v10.10 FIX: previously this branch didn't exist — a failed send was
      // indistinguishable from a successful one to everything downstream.
      // Now it's queued for automatic redelivery next run AND flagged in
      // both state.json and signals.log.json, so /status and the weekly
      // digest can honestly show which fires actually reached Telegram.
      console.error(`  ⚠️ SIGNAL FIRED but alert NOT delivered: ${symbol} | ${direction} @ $${bestFibLevel.toFixed(2)} | ${patternStr} — queued for retry.`);
      queuePendingAlert(symbol, message);
    }

    saveState(symbol, {
      signal: 'FIRED', direction,
      entryPrice: bestFibLevel, ...levels,
      patterns: rejection.patterns, riskMult,
      voteTally: resolved.tally, agreeing: resolved.agreeing,
      bias1d: bias1d?.bias, bias4h: bias4h?.bias, bias1h: bias1h.bias,
      bias30m: bias30m?.bias, bias15m: bias15m?.bias,
      lastSignalBar: barTime, lastSignalDir: direction,
      alertDelivered,
    });

    logSignal(symbol, {
      signal: 'FIRED', direction, entryTime,
      entryPrice: bestFibLevel, ...levels,
      confluencePivot: bestPivot.name, fibPct, patterns: rejection.patterns,
      voteTally: resolved.tally, agreeing: resolved.agreeing, riskMult,
      bias1d: bias1d?.bias, bias4h: bias4h?.bias, bias1h: bias1h.bias,
      bias30m: bias30m?.bias, bias15m: bias15m?.bias,
      // v10.8/v10.9 — logged for full record-keeping alongside everything else.
      td9Confirms, slAtrMult, prominence, migration, nakedPOC, multiTFPOC,
      // v10.10 — honest delivery flag (see sendSafe/flushPendingAlerts above).
      alertDelivered,
    });

    // v10.14: hand this off to position-tracker.js, which will replay
    // real 15m candles against it on every future scan until it closes —
    // see position-tracker.js header for the full mechanism.
    saveOpenPosition(symbol, {
      symbol, direction, entryTime,
      entryPrice: bestFibLevel,
      slPrice: levels.slPrice, tp1Price: levels.tp1Price, tp2Price: levels.tp2Price,
      origSlPrice: levels.slPrice,
      rr1: parseFloat(levels.rr1.toFixed(2)), rr2: parseFloat(levels.rr2.toFixed(2)),
      pivot: bestPivot.name, patterns: rejection.patterns,
    });

  } catch (err) {
    console.error(`  ❌ Error processing ${symbol}:`, err.message);
    logDiag({ symbol, fired: false, reason: 'EXCEPTION', error: err.message, stack: err.stack?.split('\n').slice(0, 3).join(' | ') });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────────────────────
console.log('');
const boxBorder = '╔══════════════════════════════════════════════════════════════╗';
console.log(boxBorder);
{
  // v10.14: version is now dynamic (package.json) — width and padding
  // both computed at runtime (from the border line's own length) instead
  // of hand-counted, so the box can't silently misalign the next time
  // the version string's length changes (e.g. "10.9.0" vs "10.14.0").
  const interiorWidth = [...boxBorder].length - 2; // minus the ╔ and ╗ chars
  const line1 = `MVS — Monthly Value Sniper v${MVS_VERSION}`;
  const line2 = '1D+4H+1H+30m+15m — 3-of-5 vote (1H zone, 15m trigger)';
  const pad = (s) => '   ' + s + ' '.repeat(Math.max(0, interiorWidth - 3 - [...s].length));
  console.log(`║${pad(line1)}║`);
  console.log(`║${pad(line2)}║`);
}
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`   Assets  : ${config.SYMBOLS.join(', ')}`);
console.log(`   TFs     : 1D(${config.DAILY_VP_LOOKBACK}) / 4H(${config.BIAS_VP_LOOKBACK}) / 1H(${config.STRUCT_VP_LOOKBACK}) / 30m(${config.HALF_VP_LOOKBACK}) / 15m(${config.TRIGGER_VP_LOOKBACK})`);
console.log(`   Trigger : ${config.REJECTION_MIN_PATTERNS}-of-5 patterns min | solo=${config.ALLOW_SOLO_TRIGGER}`);
console.log(`   Cooldown: ${config.SIGNAL_COOLDOWN_BARS} × 1H bars`);
console.log('');

(async () => {
  if (isDuplicateRun()) {
    console.log(`⏸️  Skipping: a scan already ran within the last ${DUPLICATE_RUN_GUARD_MS / 60000} min ` +
      `(cron-job.org and the GitHub schedule backup likely overlapped). Exiting cleanly, no state changed.`);
    process.exit(0);
  }

  // v10.10: retry any alert that fired last run but failed all 3 delivery
  // attempts (see sendSafe/queuePendingAlert above), before doing anything
  // else this run.
  await flushPendingAlerts();

  // v10.14: check every open position against real candle history BEFORE
  // scanning for new signals — see position-tracker.js header for why
  // this needs no dedicated server or separate schedule, just riding the
  // scan cycle that's already running every 15 min.
  try {
    await checkOpenPositions();
  } catch (e) {
    console.error('  ❌ position-tracker failed this run (non-fatal, new-signal scanning continues):', e.message);
  }

  for (const sym of config.SYMBOLS) {
    await runStrategy(sym);
    if (config.SYMBOLS.indexOf(sym) < config.SYMBOLS.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  try {
    const finalState = loadJSON(STATE_FILE, {});
    finalState._lastRunAt = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(finalState, null, 2));
  } catch (e) { /* non-fatal */ }
  console.log('\n✅ Scan complete. Exiting.');
  process.exit(0);
})();
