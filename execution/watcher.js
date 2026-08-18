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

// v10.18 FIX — pullLatest() used to be a bare `git pull --quiet`, which
// silently fails FOREVER (not just once) whenever there's a conflict,
// and every subsequent pull just repeats the same failure — this is
// exactly what happened on 2026-08-13: protect.js's syncOrphanedSignals()
// wrote a local change to open-positions.json, that diverged from what
// GitHub Actions had committed remotely, and from that point on EVERY
// pull failed with "untracked working tree files would be overwritten,"
// silently, for hours — including the pull that would have delivered
// the SOL-USDT signal this function exists to catch. The bot never
// executed it; it had to be placed manually.
// Two independent failure modes, both handled below:
//  1. A stale .git/index.lock left behind by a killed/crashed git
//     process (blocks ALL git commands, not just pull, until removed).
//  2. Local uncommitted changes to open-positions.json / state.json —
//     the only two files this bot's LOCAL side (protect.js) ever
//     writes — conflicting with what GitHub Actions committed remotely.
//     Both are safe to discard before pulling: state.json is rewritten
//     fresh from Bybit/scan data every cycle, and open-positions.json's
//     local edits are pure deletions of entries Bybit confirms are
//     closed (see protect.js syncOrphanedSignals) — if discarded, the
//     very next protect cycle just re-derives and re-deletes them from
//     Bybit truth again. Nothing is lost either way; new remote signals
//     ARE, which is what actually matters.
const LOCK_FILE = path.join(REPO_ROOT, '.git', 'index.lock');
const LOCK_STALE_MS = 2 * 60 * 1000; // 2 min — a real git op finishes in ms; anything older is garbage from a dead process

const clearStaleLock = () => {
  try {
    const stat = fs.statSync(LOCK_FILE);
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
      fs.unlinkSync(LOCK_FILE);
      console.log('[watcher] Removed stale .git/index.lock (older than 2 min — from a previous killed process).');
    }
  } catch { /* no lock file present — nothing to do, this is the normal case */ }
};

// v10.23 FIX — a NEW, distinct git failure mode caught live: "error:
// cannot lock ref 'refs/remotes/origin/main': is at X but expected Y".
// This is a ref-lock RACE, not a local-file conflict (that's the
// isLocalConflict branch below, a different problem with a different
// fix) — it happens when two git operations hit this same repo at
// almost the same instant. Confirmed from the actual log: the "is at"
// value in one error became the "expected" value in the very next
// error, moments later — proof two concurrent git processes were both
// updating the same ref. Most likely cause: the watcher's own
// automatic pull racing against a manual `git pull` run from the
// same compound status-check command Ahmed runs by hand (which
// includes its own separate `git pull`) — right after restarting the
// watcher, which pulls immediately on startup. This is inherently
// transient (the other process finishes in well under a second) —
// unlike the local-conflict case, there's nothing to discard or fix,
// just a genuine timing collision that resolves itself. Short delay,
// then retry once.
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const pullLatest = async () => {
  clearStaleLock();
  try {
    execSync('git pull --quiet', { cwd: REPO_ROOT, stdio: 'pipe' });
  } catch (err) {
    const msg = err.message || '';
    const isRefLockRace = msg.includes('cannot lock ref');
    const isLocalConflict = msg.includes('untracked working tree files would be overwritten')
      || msg.includes('Your local changes to the following files would be overwritten');
    if (isRefLockRace) {
      console.error('[watcher] git pull hit a ref-lock race (another git process updated the same ref at the same instant) — waiting 3s and retrying once.');
      await sleep(3000);
      try {
        execSync('git pull --quiet', { cwd: REPO_ROOT, stdio: 'pipe' });
        console.log('[watcher] Pull recovered after the ref-lock race cleared.');
      } catch (err2) {
        console.error(`[watcher] Pull still hitting a ref-lock race after retry: ${err2.message} — will retry next cycle.`);
      }
    } else if (isLocalConflict) {
      console.error('[watcher] git pull blocked by local open-positions.json/state.json — discarding and retrying (both are safely re-derivable, see comment above).');
      try {
        // Deliberately plain `rm`, not `git checkout --`: the real error
        // ("untracked working tree files would be overwritten") means
        // git does NOT consider these tracked-and-modified on this local
        // branch — `git checkout --` only works on files git already
        // tracks and fails with "did not match any file(s) known to
        // git" here. Removing the file outright works for both that
        // case AND a genuinely-tracked-and-modified case, since either
        // way `git pull` immediately below recreates it fresh from the
        // merged remote result.
        for (const f of ['open-positions.json', 'state.json']) {
          const fp = path.join(REPO_ROOT, f);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
        execSync('git pull --quiet', { cwd: REPO_ROOT, stdio: 'pipe' });
        // A file we deleted above might not have been part of THIS
        // pull's incoming diff (e.g. only open-positions.json changed
        // remotely, not state.json) — git's merge only recreates files
        // it actually merged, so a deleted-but-undiffed file would
        // otherwise stay missing from disk. Force both back to exactly
        // what's now in HEAD (guaranteed to succeed post-pull) so
        // neither file is ever left missing.
        execSync('git checkout HEAD -- open-positions.json state.json', { cwd: REPO_ROOT, stdio: 'pipe' });
        console.log('[watcher] Pull recovered after discarding local changes.');
      } catch (err2) {
        console.error(`[watcher] Pull still failing after recovery attempt: ${err2.message} — will retry next cycle.`);
      }
    } else {
      console.error(`[watcher] git pull failed: ${msg} — will retry next cycle.`);
    }
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
  await pullLatest();
  await runProtectionCycle();
  await checkForNewSignals();

  setInterval(async () => {
    await pullLatest();
    await runProtectionCycle();
    await checkForNewSignals();
  }, POLL_INTERVAL_MS);
})();
