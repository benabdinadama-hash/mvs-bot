/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — config.variant-nomidpocket.js
 *  A/B test harness: MID_POCKET_EXCLUDE forced OFF, everything else
 *  identical to the live config.
 *
 *  Usage: MVS_CONFIG_OVERRIDE=./config.variant-nomidpocket.js node backtest.js
 *  (backtest.js only — MVS_CONFIG_OVERRIDE is never read by strategy.js or
 *  any execution/*.js file, so this can never affect live trading.)
 *
 *  v10.43 REWRITE — this file used to be a full hand-copied snapshot of
 *  config.js (frozen at the v10.15.9 era), overriding just one key. Every
 *  key config.js gained since then (MIN_CONFLUENCE_VAH_VAL, the liquidity-
 *  sweep/VWAP/TP2-extension-matrix flags, EXCLUDE_FIB_61_8,
 *  MAX_CONSECUTIVE_LOSSES, LIVE_STARTING_BALANCE_ILLUSTRATIVE, the current
 *  20-symbol list, and more) was silently MISSING here — a real A/B run
 *  against this file wasn't isolating MID_POCKET_EXCLUDE at all, it was
 *  comparing today's full ruleset against an entirely different, stale
 *  ruleset with several newer gates simply absent (reading as `undefined`,
 *  which made some gates no-ops instead of applying their real threshold).
 *  This is the exact "two independent copies drift apart" bug class this
 *  project's core.js/backtest.js headers already warn about at length —
 *  it had just resurfaced here, in the A/B tooling instead of the main
 *  config. Fixed by spreading the live config and overriding only the one
 *  key this file exists to test — now structurally unable to drift again,
 *  since any future config.js key is automatically inherited.
 *
 *  SECOND BUG fixed in the same pass: this file used to set
 *  MID_POCKET_EXCLUDE: true — but config.js's own default for that key was
 *  flipped from false to true back in v10.16 (see config.js's comment on
 *  that key), once the exclusion itself was validated and went live. This
 *  file never followed that flip, so for a long time it has actually been
 *  testing the SAME value as the live config — a completely meaningless
 *  A/B comparison (identical result to a plain baseline run) despite its
 *  name and purpose. Corrected to override the key to `false`, so running
 *  this variant now actually answers "what if mid-pocket entries were
 *  allowed back in" against the real current baseline, as its filename
 *  always claimed it did.
 * ═══════════════════════════════════════════════════════════════════════
 */

module.exports = {
  ...require('./config'),

  // The one isolated change this variant exists to test — see header.
  MID_POCKET_EXCLUDE: false,
};
