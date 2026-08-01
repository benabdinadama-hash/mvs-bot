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

const MAX_CONSECUTIVE_LOSSES = config.MAX_CONSECUTIVE_LOSSES || 3;

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
  await checkCircuitBreaker();
};

module.exports = { runProtectionCycle, reconcileLedger, checkCircuitBreaker, MAX_CONSECUTIVE_LOSSES };
