/**
 * watcher.js — runs continuously (in a loop) on a host Bybit doesn't
 * block (your phone via Termux). GitHub Actions keeps doing what it
 * already does well: scanning, generating signals, alerting Telegram,
 * writing signals.log.json. This script's only job is to notice new
 * fired signals in that log and execute them — nothing else.
 *
 * Idempotent by design: every signal it executes gets recorded in
 * execution/executed-signals.json, keyed by symbol+entryTime. A signal
 * already in that file is never executed twice, even if this script
 * restarts or the same log is re-read.
 *
 * Usage: node execution/watcher.js
 * (Runs forever — see Termux setup instructions for keeping it alive.)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { executeSignal } = require('./execute-signal');
const { runProtectionCycle } = require('./protect');

const REPO_ROOT = path.join(__dirname, '..');
const SIGNALS_LOG = path.join(REPO_ROOT, 'signals.log.json');
const EXECUTED_LOG = path.join(__dirname, 'executed-signals.json');
const POLL_INTERVAL_MS = 60 * 1000; // check every 60s — matches the 15m scan cadence with margin to spare

const loadExecuted = () => {
  try { return JSON.parse(fs.readFileSync(EXECUTED_LOG, 'utf8')); }
  catch { return {}; }
};

const saveExecuted = (data) => fs.writeFileSync(EXECUTED_LOG, JSON.stringify(data, null, 2));

const signalKey = (s) => `${s.symbol}_${s.entryTime}`;

const pullLatest = () => {
  try {
    execSync('git pull --quiet', { cwd: REPO_ROOT, stdio: 'pipe' });
  } catch (err) {
    console.error(`[watcher] git pull failed: ${err.message} — will retry next cycle.`);
  }
};

const checkForNewSignals = async () => {
  let signals;
  try {
    signals = JSON.parse(fs.readFileSync(SIGNALS_LOG, 'utf8'));
  } catch (err) {
    console.error(`[watcher] Could not read signals.log.json: ${err.message}`);
    return;
  }

  const executed = loadExecuted();
  const fired = (Array.isArray(signals) ? signals : []).filter(s => s.signal === 'FIRED');

  for (const s of fired) {
    const key = signalKey(s);
    if (executed[key]) continue; // already handled — never re-execute

    console.log(`[watcher] New signal found: ${s.symbol} ${s.direction} @ ${s.entryPrice} — executing...`);
    const result = await executeSignal({
      symbol: s.symbol, direction: s.direction,
      entryPrice: s.entryPrice, slPrice: s.slPrice, tp1Price: s.tp1Price,
    });
    console.log(`[watcher] Result:`, JSON.stringify(result));

    executed[key] = { result, checkedAt: Date.now() };
    saveExecuted(executed);
  }
};

(async () => {
  console.log('--- MVS execution watcher started ---');
  console.log(`Polling every ${POLL_INTERVAL_MS / 1000}s. Ctrl+C to stop.\n`);

  // Run once immediately, then on the interval.
  pullLatest();
  await runProtectionCycle();
  await checkForNewSignals();

  setInterval(async () => {
    pullLatest();
    await runProtectionCycle();
    await checkForNewSignals();
  }, POLL_INTERVAL_MS);
})();
