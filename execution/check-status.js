/**
 * check-status.js — one command, full picture:
 *   - real USDT balance (Unified Trading)
 *   - all open positions on the account (yours + the bot's, clearly labeled)
 *   - what the bot's own ledger thinks is open (execution/our-positions.json)
 *   - kill switch state (paused or active)
 *   - the last few lines from today's watcher log
 *
 * Usage: node execution/check-status.js
 */

const fs = require('fs');
const path = require('path');
const bybit = require('./bybit-client');
const ledger = require('./position-ledger');
const killSwitch = require('./kill-switch');

const line = () => console.log('─'.repeat(50));

(async () => {
  console.log('--- MVS Status Check ---\n');

  // 0. Watcher heartbeat — v10.24 addition. This is the single fastest
  // way to tell "watcher is alive and cycling normally" apart from
  // "watcher process still exists per pgrep, but is wedged and hasn't
  // completed a cycle in a while" — the exact failure mode that used
  // to require a blind 2x pkill-and-restart to even notice.
  try {
    const hb = JSON.parse(fs.readFileSync(path.join(__dirname, 'heartbeat.json'), 'utf8'));
    const ageSec = Math.round((Date.now() - new Date(hb.at).getTime()) / 1000);
    const stale = ageSec > 150; // more than ~2.5 missed cycles at 60s each
    console.log(`💓 Watcher heartbeat: ${hb.status} — ${ageSec}s ago${stale ? '  ⚠️ STALE — likely wedged, consider restarting the watcher' : ''}`);
  } catch {
    console.log('💓 Watcher heartbeat: (no heartbeat.json yet — old watcher.js, or not started since this update)');
  }
  line();

  // 1. Balance
  try {
    const wallet = await bybit.get('/v5/account/wallet-balance', { accountType: 'UNIFIED' });
    const usdt = wallet.result?.list?.[0]?.coin?.find(c => c.coin === 'USDT');
    console.log(`💰 USDT balance (Unified Trading): ${usdt ? usdt.walletBalance : '(not found)'}`);
  } catch (err) {
    console.log(`💰 Balance check failed: ${err.message}`);
  }
  line();

  // 2. All real positions on Bybit, cross-referenced against our own ledger
  try {
    const positions = await bybit.get('/v5/position/list', { category: 'linear', settleCoin: 'USDT' });
    const open = (positions.result?.list || []).filter(p => parseFloat(p.size) > 0);
    const ourOrderIds = new Set(ledger.getOpen().map(e => e.orderId));

    console.log(`📊 Open positions on Bybit right now: ${open.length}`);
    if (open.length === 0) {
      console.log('   (none)');
    } else {
      for (const p of open) {
        // Bybit's position list doesn't directly expose the original orderId,
        // so this is a best-effort label based on symbol/side matching our
        // ledger — not perfectly precise, but good enough to eyeball at a glance.
        const oursMatch = ledger.getOpen().some(e => e.symbol === p.symbol && e.side === p.side);
        const label = oursMatch ? '[MVS bot]' : '[manual/other]';
        console.log(`   ${label} ${p.symbol} ${p.side} size=${p.size} entry=${p.avgPrice} PnL=${p.unrealisedPnl}`);
      }
    }
  } catch (err) {
    console.log(`📊 Position check failed: ${err.message}`);
  }
  line();

  // 3. What our own ledger thinks is open (independent of the Bybit call above)
  const ourOpen = ledger.getOpen();
  console.log(`📒 Bot's own ledger — trades it believes are open: ${ourOpen.length}`);
  ourOpen.forEach(e => console.log(`   ${e.symbol} ${e.side} orderId=${e.orderId} leverage=${e.leverage}x opened=${new Date(e.entryTime).toISOString()}`));
  line();

  // 4. Kill switch
  const paused = killSwitch.isPaused();
  console.log(`⏸️  Kill switch: ${paused ? 'PAUSED — no new orders will be placed' : 'ACTIVE — executing normally'}`);
  line();

  // 5. Recent watcher activity
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const logFile = path.join(__dirname, 'logs', `watcher-${today}.log`);
  console.log(`📜 Last 10 lines of today's watcher log (${logFile}):`);
  try {
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    lines.slice(-10).forEach(l => console.log(`   ${l}`));
  } catch {
    console.log('   (no log file for today yet, or watcher not started today)');
  }
})();
