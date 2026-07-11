/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — LIVE POSITION TRACKER (position-tracker.js)  v10.15.5
 *
 *  NEW in v10.14. Closes the gap flagged since v10.6: this bot fired
 *  alerts but never checked what happened to them afterward — the
 *  equity curve in weekly-summary.js was always empty because nothing
 *  ever logged an exit. This module is the fix.
 *
 *  Design constraint (explicit request): no dedicated/always-on server,
 *  no new hosting cost. This does NOT poll continuously — it runs once
 *  at the start of every existing 15-min scan (mvs-scan.yml already
 *  invokes strategy.js on that cadence; checkOpenPositions() is just
 *  called first, before new-signal scanning). Zero new infrastructure.
 *
 *  How it stays accurate on a 15-min cadence instead of continuous
 *  polling: every run, for every open position, it re-fetches ALL 15m
 *  candles from that position's entryTime up to now (KuCoin's per-request
 *  limit is 1500 candles — comfortably more than the ~800 a full
 *  MAX_HOLD_1H_BARS hold needs) and replays them one-by-one through
 *  core.js's evaluateOpenTrade() — the EXACT same function backtest.js
 *  uses. So even though the bot only "looks" every 15 minutes, it isn't
 *  just checking the current price — it's replaying the full candle-by-
 *  candle history since entry, so a SL/TP1/TP2 touch on any candle in
 *  between two scans is still caught, in the correct order, using the
 *  same high/low-based hit logic the backtest trusts.
 *
 *  Stateless-by-design: open-positions.json stores the ORIGINAL,
 *  unmutated trade parameters only (entry/SL/TP1/TP2/direction/time).
 *  Every run clones a fresh copy and replays from entryTime — it never
 *  persists tp1Hit/beMoved/halfR between runs. This costs a bit of
 *  redundant computation each cycle but buys real robustness: there's no
 *  "the tracker's persisted state drifted from what the candles actually
 *  say" failure mode, because there IS no persisted intermediate state.
 *  If this file's logic is ever wrong, it's wrong the same way every run,
 *  not wrong in a way that compounds silently over time.
 * ═══════════════════════════════════════════════════════════════════════
 */

const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const config  = require('./config');
const core    = require('./core');

const OPEN_POSITIONS_FILE = path.join(__dirname, 'open-positions.json');

// v10.15.2 CRITICAL FIX — see strategy.js's identical helper for the full
// story. `closedOutcome.result` can be `EARLY_TIMEOUT` (1 underscore),
// which silently breaks Telegram's legacy Markdown parsing for the whole
// close-notification message below — no error surfaces, nothing shows as
// failed, the position just never gets its close reported to Telegram.
const mdSafe = (s) => String(s ?? '').replace(/_/g, ' ');
const LOG_FILE            = path.join(__dirname, 'signals.log.json');
const STATE_FILE          = path.join(__dirname, 'state.json');

const loadJSON = (file, fallback) => {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return fallback; }
};
const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// ── KuCoin fetch — deliberately a standalone copy, not a shared import ──
// Same reasoning as backtest.js having its own fetchKlines separate from
// strategy.js's getKlines: this file must never accidentally trigger
// strategy.js's live-scan side effects just by being required, so it
// carries its own minimal, self-contained fetch function instead of
// importing one from a script with a top-level IIFE.
const getKlines = async (symbol, interval, limit, maxRetries = 2) => {
  const safeLimit = Math.min(limit, 1500);
  const url = `${config.BASE_URL}/market/candles?symbol=${symbol}&type=${interval}&limit=${safeLimit}`;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.get(url, { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
      if (res.data.code !== '200000') {
        console.error(`  ❌ [tracker] KuCoin API error (${symbol}, attempt ${attempt}/${maxRetries}): ${res.data.code} — ${res.data.msg || 'Unknown'}`);
        if (attempt === maxRetries) return [];
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      const sorted = (res.data.data || []).reverse();
      return sorted.map(k => ({
        time: parseInt(k[0]), open: parseFloat(k[1]), close: parseFloat(k[2]),
        high: parseFloat(k[3]), low: parseFloat(k[4]), volume: parseFloat(k[5]),
      }));
    } catch (e) {
      console.error(`  ❌ [tracker] KuCoin fetch error for ${symbol}, attempt ${attempt}/${maxRetries}:`, e.message);
      if (attempt === maxRetries) return [];
      await new Promise(r => setTimeout(r, 800));
    }
  }
  return [];
};

const sendTelegram = async (text) => {
  if (!config.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') return;
  try {
    await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: config.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown',
    }, { timeout: 15000 });
  } catch (e) {
    console.error('  ❌ [tracker] Telegram send failed:', e.message);
  }
};

const RESULT_EMOJI = {
  'TP1+TP2': '🎯', 'TP1+BE': '🟢', 'SL': '🔴', 'BE': '⚪',
  'EARLY_TIMEOUT': '⏱️', 'TIMEOUT': '⏱️',
};

// Updates the matching signals.log.json entry in place (found by symbol +
// entryTime, both written at FIRE time in strategy.js's logSignal call)
// rather than appending a new row — this is what lets
// weekly-summary.js's updateEquityCurve() find e.rr / e.exitTime on the
// SAME entry the original FIRED alert used, instead of needing to
// reconcile two separate rows per trade.
const closeLogEntry = (symbol, entryTime, outcome) => {
  const log = loadJSON(LOG_FILE, []);
  const idx = log.findIndex(e => e.symbol === symbol && e.entryTime === entryTime && e.rr === undefined);
  if (idx === -1) {
    console.error(`  ⚠️ [tracker] Could not find matching signals.log.json entry for ${symbol} @ entryTime=${entryTime} — exit computed but not recorded against the original alert. Equity curve will miss this one trade.`);
    return false;
  }
  log[idx] = { ...log[idx], ...outcome };
  saveJSON(LOG_FILE, log);
  return true;
};

const closeStateEntry = (symbol, outcome) => {
  const state = loadJSON(STATE_FILE, {});
  if (!state[symbol]) return;
  state[symbol] = {
    ...state[symbol],
    signal: `CLOSED_${outcome.result}`,
    exitPrice: outcome.exitPrice, rr: outcome.rr, exitTime: outcome.exitTime,
    hoursHeld: outcome.hoursHeld,
    updatedAt: new Date().toISOString(),
  };
  saveJSON(STATE_FILE, state);
};

const checkOpenPositions = async () => {
  const openPositions = loadJSON(OPEN_POSITIONS_FILE, {});
  const symbols = Object.keys(openPositions);
  if (!symbols.length) {
    console.log('  ℹ️  [tracker] No open positions to check.');
    return;
  }
  console.log(`  🔎 [tracker] Checking ${symbols.length} open position(s): ${symbols.join(', ')}`);

  for (const symbol of symbols) {
    const original = openPositions[symbol];
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const barsNeeded = Math.ceil((nowSec - original.entryTime) / 900) + 5; // 900s = 15min, +5 buffer
      const limit = Math.min(Math.max(barsNeeded, 10), 1500);
      const candles = await getKlines(symbol, config.TRIGGER_TIMEFRAME, limit);
      const bars = candles.filter(c => c.time > original.entryTime).sort((a, b) => a.time - b.time);

      if (!bars.length) {
        console.log(`  ⏳ [tracker] ${symbol}: no 15m bars yet since entry (${new Date(original.entryTime * 1000).toISOString()}) — too soon to check, or fetch came up short.`);
        continue;
      }

      if (barsNeeded > 1490) {
        // Position has been open longer than one fetch can cover (~15.6
        // days of 15m candles) — should never happen in normal operation
        // since MAX_HOLD_1H_BARS forces a close well before this, but if
        // scans were paused for an extended period, don't silently
        // mis-simulate on a truncated candle set. Flag it and move on;
        // next run will keep trying with the same (still truncated) window
        // until either it closes on what's fetchable or someone
        // investigates why it's been open this long.
        console.error(`  ⚠️ [tracker] ${symbol}: position open ${Math.round(barsNeeded * 15 / 60 / 24 * 10) / 10} days — longer than one fetch window can fully cover. Simulating on the most recent ${limit} bars only; may miss an earlier SL/TP touch if scans were paused for a long stretch.`);
      }

      let trade = { ...original }; // fresh clone — see file header on why this is stateless
      let closedOutcome = null;
      for (const bar of bars) {
        const { closed, trade: updatedTrade, outcome } = core.evaluateOpenTrade(trade, bar, config);
        trade = updatedTrade;
        if (closed) { closedOutcome = outcome; break; }
      }

      if (!closedOutcome) {
        console.log(`  📈 [tracker] ${symbol}: still open (${bars.length} bars checked since entry, no exit yet).`);
        continue;
      }

      const emoji = RESULT_EMOJI[closedOutcome.result] || 'ℹ️';
      console.log(`  ${emoji} [tracker] ${symbol}: CLOSED — ${closedOutcome.result} @ $${closedOutcome.exitPrice} (${closedOutcome.rr > 0 ? '+' : ''}${closedOutcome.rr}R, held ${closedOutcome.hoursHeld}h)`);

      const logged = closeLogEntry(symbol, original.entryTime, closedOutcome);
      closeStateEntry(symbol, closedOutcome);

      const rrStr = `${closedOutcome.rr > 0 ? '+' : ''}${closedOutcome.rr}R`;
      await sendTelegram(
        `${emoji} *${symbol} — Position Closed*\n\n` +
        `Result: *${mdSafe(closedOutcome.result)}* (${rrStr})\n` +
        `Exit: \`$${closedOutcome.exitPrice}\`\n` +
        `Held: ${closedOutcome.hoursHeld}h\n` +
        (logged ? '' : '\n⚠️ Could not match this to its original alert in signals.log.json — logged here for visibility, but it won\'t appear in the weekly equity curve.')
      );

      delete openPositions[symbol];
      saveJSON(OPEN_POSITIONS_FILE, openPositions);
    } catch (err) {
      console.error(`  ❌ [tracker] Error checking ${symbol}:`, err.message);
      // Deliberately don't delete/mutate this position on error — next
      // run tries again fresh, same stateless-replay reasoning as above.
    }
  }
};

// Runnable standalone (`node position-tracker.js`) for manual checks or a
// separate workflow, in addition to being called from strategy.js's main
// flow every scan. Guarded so requiring this file never has side effects.
if (require.main === module) {
  checkOpenPositions().then(() => process.exit(0)).catch(e => {
    console.error('Fatal error in position-tracker:', e);
    process.exit(1);
  });
}

module.exports = { checkOpenPositions };
