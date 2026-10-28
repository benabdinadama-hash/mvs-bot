/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — config.variant-struct2h.js
 *  A/B test harness: structure timeframe changed 1H → 2H, everything
 *  else identical to the live config.
 *
 *  Usage: MVS_CONFIG_OVERRIDE=./config.variant-struct2h.js node backtest.js
 *  (backtest.js only — MVS_CONFIG_OVERRIDE is never read by strategy.js or
 *  any execution/*.js file, so this can never affect live trading.)
 *
 *  v10.43 REWRITE — same fix as config.variant-nomidpocket.js's v10.43
 *  rewrite (see that file's header for the full story): this used to be a
 *  full hand-copied snapshot of config.js frozen at the v10.15.9 era, so
 *  every key config.js gained since then was silently missing here too,
 *  making any A/B run against this file compare today's ruleset against a
 *  stale, incomplete one instead of isolating the one timeframe change
 *  this file exists to test. Fixed the same way: spread the live config,
 *  override only the keys this file exists to test.
 * ═══════════════════════════════════════════════════════════════════════
 */

module.exports = {
  ...require('./config'),

  // The isolated change this variant exists to test: structure timeframe
  // 1H → 2H. Both keys must move together — STRUCT_BAR_SECONDS feeds the
  // cooldown math (SIGNAL_COOLDOWN_BARS × STRUCT_BAR_SECONDS) and must
  // match whatever STRUCT_TIMEFRAME actually is, or cooldown timing goes
  // out of sync with the candle size being traded.
  STRUCT_TIMEFRAME: '2hour',
  STRUCT_BAR_SECONDS: 7200,
};
