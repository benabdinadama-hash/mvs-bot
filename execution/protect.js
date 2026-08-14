/**
 * protect.js — the actual "protection system." Two jobs:
 *
 * 1. RECONCILE: the ledger previously had no way of knowing when a
 *    bot-opened trade closed on Bybit — recordClosed() existed but was
 *    never called. This checks every ledger entry still marked 'open'
 *    against Bybit's real closed-PnL history and updates it with the
 *    real outcome. Without this, countOpen() could overcount forever
 *    and MAX_CONCURRENT_TRADES could wrongly block new trades even
 *    after old ones closed.
 *
 * 2. CIRCUIT BREAKER: after reconciling, checks the bot's own recent
 *    closed trades for a losing streak. If MAX_CONSECUTIVE_LOSSES real
 *    losses happen in a row, this auto-engages the kill switch (same
 *    flag /pause uses) and sends a Telegram alert — no need for you to
 *    notice and react manually. /resume in Telegram re-enables it, same
 *    as always.
 *
 * Called once per watcher.js poll cycle, before checking for new
 * signals — see watcher.js.
 */

const bybit = require('./bybit-client');
const ledger = require('./position-ledger');
const killSwitch = require('./kill-switch');
const config = require('../config');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const MAX_CONSECUTIVE_LOSSES = config.MAX_CONSECUTIVE_LOSSES || 3;

// Same files position-tracker.js uses for the SIGNAL side (Telegram's
// "OPEN" display, check-telegram.js). Read/written directly here too —
// see syncSignalSide() below for why.
const OPEN_POSITIONS_FILE = path.join(__dirname, '..', 'open-positions.json');
const STATE_FILE = path.join(__dirname, '..', 'state.json');
const loadJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// Standalone Telegram alert — deliberately NOT reusing strategy.js's
// sendSafe/commands.js's send, so this safety-critical module has no
// dependency on the signal-generation pipeline and can't be broken by
// changes made there. Same env vars, same Telegram API, simpler call.
const sendAlert = async (text) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error('[protect] No Telegram credentials set — cannot send circuit-breaker alert. Logging only:', text);
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId, text, parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error('[protect] Failed to send Telegram alert:', err.message);
  }
};

// Checks Bybit's real closed-PnL history for a symbol, looking for a
// record that closed AFTER this ledger entry's recorded open time.
const findRealizedClose = async (entry) => {
  const res = await bybit.get('/v5/position/closed-pnl', {
    category: 'linear', symbol: entry.symbol, limit: 10,
  });
  if (res.retCode !== 0) throw new Error(`closed-pnl fetch failed: ${res.retMsg}`);

  const match = (res.result?.list || []).find(r =>
    Number(r.updatedTime) >= entry.entryTime && r.side === entry.side
  );
  return match ? { realizedPnl: parseFloat(match.closedPnl), closeReason: 'exchange_closed' } : null;
};

const reconcileLedger = async () => {
  const openEntries = ledger.getOpen();
  for (const entry of openEntries) {
    try {
      // Still open on Bybit? Check the live position list first — cheap,
      // avoids an unnecessary closed-pnl call for genuinely-still-open trades.
      const positions = await bybit.get('/v5/position/list', { category: 'linear', symbol: entry.symbol });
      const stillOpen = (positions.result?.list || []).some(p => parseFloat(p.size) > 0 && p.side === entry.side);
      if (stillOpen) continue;

      const closeInfo = await findRealizedClose(entry);
      if (closeInfo) {
        ledger.recordClosed(entry.orderId, closeInfo);
        console.log(`[protect] Reconciled ${entry.symbol} ${entry.side} — realized PnL: ${closeInfo.realizedPnl}`);
      } else {
        // Not open, but no matching closed-PnL record found yet (can lag
        // slightly behind). Leave as 'open' — will retry next cycle.
        console.log(`[protect] ${entry.symbol} ${entry.side} no longer open, but no closed-PnL match yet — will recheck next cycle.`);
      }
    } catch (err) {
      // Never let a reconciliation failure block the rest of the cycle.
      console.error(`[protect] Reconciliation failed for ${entry.symbol}: ${err.message}`);
    }
  }
};

// v10.17 FIX (revised) — checking against reconcileLedger() alone isn't
// enough: DOT-USDT was tagged [manual/other] in check-status.js output,
// meaning it was never opened by execute-signal.js and so was never in
// the bot's own ledger to begin with — reconcileLedger() has nothing to
// reconcile for it. This checks EVERY entry in open-positions.json (the
// file Telegram/check-telegram.js actually displays) directly against
// Bybit's real position list, regardless of whether the trade was bot-
// executed or placed manually. If Bybit shows no real open position
// matching that symbol+direction, the signal side is force-closed to
// match reality. Safe: only ever removes an entry, never invents one,
// and only acts when Bybit explicitly confirms zero matching exposure.
const syncOrphanedSignals = async () => {
  const openPositions = loadJSON(OPEN_POSITIONS_FILE, {});
  const symbols = Object.keys(openPositions);
  if (symbols.length === 0) return;

  for (const symbol of symbols) {
    try {
      const entry = openPositions[symbol];
      const positions = await bybit.get('/v5/position/list', { category: 'linear', symbol });
      // v10.18 FIX: was `p.side === entry.direction`. Bybit's API returns
      // side as 'Buy'/'Sell' (title case); this bot's `direction` field
      // is 'BUY'/'SELL' (all-caps) EVERYWHERE ELSE in the codebase — see
      // strategy.js direction === 'BUY' checks throughout. That case
      // mismatch meant this comparison could never be true, so EVERY
      // genuinely-open position got force-closed on the signal side on
      // EVERY single protect cycle (confirmed live: SOL-USDT and
      // AVAX-USDT both showing this every 60s while check-status.js
      // simultaneously confirmed both were still genuinely open on
      // Bybit with real non-zero PnL). Real trades/real SL-TP protection
      // were never affected — this function only ever touches the
      // Telegram-facing signal-side files — but state.json/Telegram's
      // "open" display was being spuriously wiped every cycle.
      const stillOpen = (positions.result?.list || []).some(p =>
        parseFloat(p.size) > 0 && p.side?.toUpperCase() === entry.direction?.toUpperCase()
      );
      if (stillOpen) continue; // genuinely still open — leave it alone

      delete openPositions[symbol];
      saveJSON(OPEN_POSITIONS_FILE, openPositions);

      const state = loadJSON(STATE_FILE, {});
      if (state[symbol]) {
        state[symbol] = {
          ...state[symbol],
          signal: 'CLOSED_EXCHANGE',
          exitTime: Math.floor(Date.now() / 1000),
          updatedAt: new Date().toISOString(),
          note: 'Closed on Bybit — synced from real account data (protect.js), not simulated candle replay. Origin (bot/manual) unknown.',
        };
        saveJSON(STATE_FILE, state);
      }
      console.log(`[protect] ${symbol} was stuck OPEN on the signal side — Bybit confirms 0 real position, force-synced closed.`);
    } catch (err) {
      console.error(`[protect] syncOrphanedSignals failed for ${symbol}: ${err.message} — left as-is, will retry next cycle.`);
    }
  }
};

const checkCircuitBreaker = async () => {
  if (killSwitch.isPaused()) return; // already paused, nothing to check

  const recent = ledger.getRecentClosed(MAX_CONSECUTIVE_LOSSES);
  if (recent.length < MAX_CONSECUTIVE_LOSSES) return; // not enough history yet

  const allLosses = recent.every(e => typeof e.realizedPnl === 'number' && e.realizedPnl < 0);
  if (!allLosses) return;

  killSwitch.setPaused(true);
  const summary = recent.map(e => `${e.symbol} ${e.side}: ${e.realizedPnl}`).join('\n');
  await sendAlert(
    `🛑 *Auto-pause triggered*\n\n` +
    `${MAX_CONSECUTIVE_LOSSES} losses in a row — execution paused automatically.\n\n${summary}\n\n` +
    `Send /resume when you've reviewed this and want to re-enable execution.`
  );
  console.log(`[protect] 🛑 Circuit breaker triggered — ${MAX_CONSECUTIVE_LOSSES} consecutive losses. Kill switch engaged.`);
};

// Single entry point called from watcher.js each cycle.
const runProtectionCycle = async () => {
  await reconcileLedger();
  await syncOrphanedSignals();
  await checkCircuitBreaker();
};

module.exports = { runProtectionCycle, reconcileLedger, syncOrphanedSignals, checkCircuitBreaker, MAX_CONSECUTIVE_LOSSES };
