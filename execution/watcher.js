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
const HEARTBEAT_FILE = path.join(__dirname, 'heartbeat.json');
const POLL_INTERVAL_MS = 60 * 1000; // check every 60s — matches the 15m scan cadence with margin to spare

// v10.24 FIX — every git exec in this file used to run with no timeout.
// On a phone's mobile connection, `git pull`/`git push` over HTTPS can
// hang on a half-open socket indefinitely instead of erroring. Nothing
// downstream ever saw a failure to react to — the async function just
// never resolved. Every git exec below now has a hard wall-clock cap;
// killSignal SIGKILL because a plain SIGTERM doesn't reliably stop git
// mid-network-call on Android/Termux.
const GIT_TIMEOUT_MS = 25000;
const gitExec = (cmd, opts = {}) =>
  execSync(cmd, { cwd: REPO_ROOT, stdio: 'pipe', timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL', ...opts });

// v10.24 FIX — the actual mechanism behind "watcher needs 2x pkill
// before it comes clear." setInterval fires every 60s NO MATTER WHAT,
// even if the previous cycle (pullLatest + protect + checkForNewSignals)
// hasn't finished. Combine that with any hang (a slow git pull, a slow
// Bybit call) and cycles start stacking: two, three, four overlapping
// runs all doing `git pull` at once, all fighting over .git/index.lock,
// which is exactly the repeated "ref-lock race" / "pull blocked by
// local changes" pairs seen twice in a row in the real watcher log —
// two overlapping cycles hitting the same recovery path back to back.
// The process stays alive (pgrep still matches it) while doing nothing
// useful, and new FIRED signals in signals.log.json just sit unexecuted
// the whole time. This flag makes a cycle skip cleanly instead of
// stacking if the previous one is still running.
let cycleInProgress = false;

const writeHeartbeat = (status, extra = {}) => {
  try {
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify({
      status, at: new Date().toISOString(), ...extra,
    }, null, 2));
  } catch (err) {
    console.error(`[watcher] Could not write heartbeat: ${err.message}`);
  }
};

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
    gitExec('git pull --quiet');
  } catch (err) {
    const msg = err.message || '';
    const isRefLockRace = msg.includes('cannot lock ref');
    const isLocalConflict = msg.includes('untracked working tree files would be overwritten')
      || msg.includes('Your local changes to the following files would be overwritten');
    if (isRefLockRace) {
      console.error('[watcher] git pull hit a ref-lock race (another git process updated the same ref at the same instant) — waiting 3s and retrying once.');
      await sleep(3000);
      try {
        gitExec('git pull --quiet');
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
        gitExec('git pull --quiet');
        // A file we deleted above might not have been part of THIS
        // pull's incoming diff (e.g. only open-positions.json changed
        // remotely, not state.json) — git's merge only recreates files
        // it actually merged, so a deleted-but-undiffed file would
        // otherwise stay missing from disk. Force both back to exactly
        // what's now in HEAD (guaranteed to succeed post-pull) so
        // neither file is ever left missing.
        gitExec('git checkout HEAD -- open-positions.json state.json');
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

const runCycle = async () => {
  if (cycleInProgress) {
    // The previous cycle is still running — this is the case that used
    // to silently stack overlapping git/API calls. Skip this tick
    // cleanly instead; the next tick will try again, and the heartbeat
    // file's age (see check-status.js) makes this visible from Termux
    // if it keeps happening instead of resolving within a cycle or two.
    console.error('[watcher] Previous cycle still in progress — skipping this tick instead of stacking on top of it.');
    writeHeartbeat('skipped_overlap');
    return;
  }
  cycleInProgress = true;
  try {
    await pullLatest();
    await runProtectionCycle();
    await checkForNewSignals();
    writeHeartbeat('ok');
  } catch (err) {
    // v10.24 FIX — previously an uncaught error anywhere in this chain
    // would crash the whole process silently into the log file, with
    // nothing to auto-restart it until you noticed and ran
    // start-watcher.sh again by hand. Logging + heartbeating here keeps
    // the process (and setInterval) alive so it can recover on its own
    // next tick if the error was transient.
    console.error(`[watcher] Cycle failed: ${err.message}`);
    writeHeartbeat('error', { error: err.message });
  } finally {
    cycleInProgress = false;
  }
};

(async () => {
  console.log('--- MVS execution watcher started ---');
  console.log(`Polling every ${POLL_INTERVAL_MS / 1000}s. Ctrl+C to stop.\n`);

  await runCycle();
  setInterval(runCycle, POLL_INTERVAL_MS);
})();
