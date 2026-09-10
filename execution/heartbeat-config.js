/**
 * heartbeat-config.js — v10.30 addition.
 *
 * Shared between execution/watcher.js (which PUSHES the heartbeat, on
 * the phone) and execution/check-remote-heartbeat.js (which READS it, on
 * GitHub Actions) — one place for both intervals so they can't silently
 * drift apart from each other.
 *
 * NOT the same file/mechanism as execution/heartbeat.json — that one is
 * gitignored and purely local (see check-status.js), which is exactly
 * the gap this closes: on 2026-09-10 the Termux watcher wasn't running
 * for the entire day. GitHub Actions kept firing signals and Telegram
 * alerts exactly as designed, but nothing on the execution side ever
 * noticed, because the only heartbeat that existed lived solely on the
 * phone. execution/remote-heartbeat.json (this mechanism) is a real,
 * git-tracked file specifically so GitHub Actions — infrastructure that
 * doesn't depend on the phone's state — can see it too.
 */

module.exports = {
  // How often watcher.js is willing to push a fresh remote heartbeat.
  // Deliberately much less often than its 60s poll cycle — this needs a
  // git commit+push every time it fires, which is real cost (network,
  // and a chance to collide with GitHub Actions' own commits) for a
  // signal that's only ever consumed at 15-minute granularity anyway.
  REMOTE_HEARTBEAT_PUSH_INTERVAL_MS: 10 * 60 * 1000, // 10 min

  // How old the remote heartbeat has to be before check-remote-heartbeat.js
  // (run every scan, i.e. ~every 15 min) treats the watcher as down and
  // alerts. Set well above the push interval to absorb normal jitter —
  // a slow git push, a scan that runs a few minutes late, one missed
  // push cycle — without a false alarm. A GENUINE full-day outage (the
  // confirmed real case this exists for) blows past this by orders of
  // magnitude, so there's no tension between "tolerant of jitter" and
  // "catches the real thing."
  REMOTE_HEARTBEAT_STALE_MS: 35 * 60 * 1000, // 35 min
};
