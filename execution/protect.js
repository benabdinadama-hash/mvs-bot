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
const { execSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const GIT_TIMEOUT_MS = 25000;
const gitExec = (cmd) =>
  execSync(cmd, { cwd: REPO_ROOT, stdio: 'pipe', timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL' });

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
      if (stillOpen) {
        ledger.clearPendingClose(entry.orderId); // undo any stale mark from an earlier transient blip
        continue;
      }

      const closeInfo = await findRealizedClose(entry);
      if (closeInfo) {
        ledger.recordClosed(entry.orderId, closeInfo);
        console.log(`[protect] Reconciled ${entry.symbol} ${entry.side} — realized PnL: ${closeInfo.realizedPnl}`);
      } else {
        // Not open, but no matching closed-PnL record found yet (can lag
        // slightly behind). Mark it pending — see position-ledger.js
        // markPendingClose(): this starts a bounded clock so it can
        // never get stuck here forever, even if the exact-match never
        // arrives.
        ledger.markPendingClose(entry.orderId);
        console.log(`[protect] ${entry.symbol} ${entry.side} no longer open, but no closed-PnL match yet — will recheck next cycle.`);
      }
    } catch (err) {
      // Never let a reconciliation failure block the rest of the cycle.
      console.error(`[protect] Reconciliation failed for ${entry.symbol}: ${err.message}`);
    }
  }

  // v10.19 — bounded self-healing fallback. Any entry that's been stuck
  // "pending close" for more than 5 minutes gets force-closed here
  // (realizedPnl left null/unknown — check Bybit's trade history
  // directly for the exact figure). This guarantees countOpen() can
  // never overcount forever and silently block real future signals,
  // regardless of why the exact-match path above didn't resolve it.
  const forced = ledger.forceCloseStalePending();
  for (const entry of forced) {
    console.log(`[protect] ⚠️ ${entry.symbol} ${entry.side} force-closed after being stuck unmatched for 5+ min — countOpen() unblocked. Check Bybit's trade history directly for the real exit PnL.`);
    await sendAlert(
      `⚠️ *Ledger self-heal*\n${entry.symbol} ${entry.side} was stuck in the bot's ledger as "open" for 5+ minutes after actually closing on Bybit, and has now been force-marked closed so new signals aren't blocked.\n\nExact realized PnL wasn't found automatically — check Bybit's trade history for ${entry.symbol} around ${new Date(entry.entryTime).toISOString()} if you want the precise figure.`
    );
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
// v10.24 FIX — root cause of "Termux and Telegram don't correlate."
// Everything above this comment only ever wrote to the LOCAL copies of
// open-positions.json/state.json on the phone. Telegram's messages
// (commands.js, /status, the pinned "MVS Positions" message) run
// entirely on GitHub Actions (mvs-commands.yml), reading whatever is
// currently COMMITTED in the repo — which never received this fix.
// Net effect, confirmed against real logs: the phone would correctly
// show 0 real positions forever, Telegram would show the same stale
// "OPEN" forever, and because watcher.js's pullLatest() discards local
// changes to these two files on every conflicting pull (by design —
// see watcher.js), this fix was being silently redone locally every
// ~60s without ever once reaching GitHub. This pushes it for real, so
// the next GitHub Actions commands run picks it up and Telegram
// converges with reality within one 5-10 min commands cycle.
const pushSignalSideChanges = async (summary) => {
  try {
    gitExec('git add -f open-positions.json state.json');
    // Nothing staged (e.g. GitHub Actions already committed the exact
    // same end state in the meantime) — nothing to push, not an error.
    try {
      gitExec('git diff --cached --quiet');
      return; // exit code 0 = no staged diff
    } catch { /* exit code 1 = there IS a staged diff — continue below */ }

    gitExec(`git commit -m "[protect] ${summary}"`);

    // Two writers touch these files: GitHub Actions (adds new open
    // positions when a signal fires) and this function (removes ones
    // Bybit confirms closed). A push can legitimately be rejected if
    // GitHub Actions committed in between — pull (merge, not rebase;
    // see watcher.js's config note) and retry, bounded so this can
    // never hang the protection cycle forever.
    for (let i = 0; i < 3; i++) {
      try {
        gitExec('git push --quiet');
        console.log(`[protect] ✅ Pushed signal-side fix to GitHub: ${summary}`);
        return;
      } catch (err) {
        if (i === 2) throw err;
        console.error('[protect] Push rejected (GitHub Actions likely committed in between) — pulling and retrying...');
        gitExec('git pull --quiet');
      }
    }
  } catch (err) {
    // Never let a push failure block execution/protection — the local
    // files are already correct; this only affects how fast Telegram
    // catches up. Next cycle (60s) will try again.
    console.error(`[protect] Could not push signal-side fix (will retry next cycle): ${err.message}`);
  }
};

// v10.29 FIX — pullSucceeded (from watcher.js's runCycle, passed down
// through runProtectionCycle) gates the write-back below. Confirmed
// real: open-positions.json is written by BOTH GitHub Actions
// (strategy.js, the instant a signal fires) and this phone (here, when
// a position closes) — a genuine cross-machine race. If THIS cycle's
// git pull failed, the local copy this function just loaded might
// already be missing an entry GitHub Actions committed moments ago
// (e.g. a brand-new signal fire) that this phone simply hasn't pulled
// yet. Deleting some OTHER, unrelated symbol from that same stale copy
// and pushing it would silently carry the missing entry's absence back
// up to the shared remote too — permanently erasing the "already open"
// marker that was supposed to stop the same setup from firing (and
// re-alerting on Telegram) again on the next scan. Confirmed live:
// BTC-USDT re-fired the identical setup roughly a dozen times over 11+
// hours, spanning a stretch with heavy "git pull failed" activity in
// this exact log.
const syncOrphanedSignals = async (pullSucceeded = true) => {
  const openPositions = loadJSON(OPEN_POSITIONS_FILE, {});
  const symbols = Object.keys(openPositions);
  if (symbols.length === 0) return;

  const closedThisCycle = [];

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

      if (!pullSucceeded) {
        console.error(`[protect] ${symbol} looks closed on Bybit, but this cycle's git pull failed — skipping the open-positions.json write-back rather than risk pushing a stale local copy that could erase a signal GitHub Actions just committed. Will retry next cycle.`);
        continue;
      }

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
      closedThisCycle.push(symbol);
    } catch (err) {
      console.error(`[protect] syncOrphanedSignals failed for ${symbol}: ${err.message} — left as-is, will retry next cycle.`);
    }
  }

  if (closedThisCycle.length > 0) {
    await pushSignalSideChanges(`sync signal-side state — closed on Bybit: ${closedThisCycle.join(', ')}`);
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
const runProtectionCycle = async (pullSucceeded = true) => {
  await reconcileLedger();
  await syncOrphanedSignals(pullSucceeded);
  await checkCircuitBreaker();
};

module.exports = { runProtectionCycle, reconcileLedger, syncOrphanedSignals, checkCircuitBreaker, pushSignalSideChanges, MAX_CONSECUTIVE_LOSSES };
