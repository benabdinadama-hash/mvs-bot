/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — Monthly Value Sniper v10.15.6
 *  KuCoin API Configuration
 *
 *  FOUNDATION: POC + VAH + VAL + FIBO. No lagging indicators.
 *
 *  v10.0 — REBUILT AROUND A 3-TIMEFRAME VOTE (4H / 1H / 15m):
 *  ─ This is a SINGLE config file now. strategy.js (live) and backtest.js
 *    (simulation) both require() this exact file — previously backtest.js
 *    kept its own hand-copied CONFIG object that drifted out of sync with
 *    this one repeatedly (confirmed: POC_RECLAIM_SOLO, SELL_HTF_MULT_BOOST,
 *    and PAIR_MIN_TP2_RR all existed in one file months before the other).
 *  ─ Direction requires 2-of-3 timeframes (4H/1H/15m) to agree — see
 *    core.js resolveDirection(). 1H still supplies the structural zone
 *    (POC/VAH/VAL/Fib pocket); 15m supplies the trigger candle.
 *  ─ Volume Profile lookback (500 bars) and rows (100) now match the
 *    TradingView A-ICT/SMC PRO_v5 indicator settings you're charting
 *    against, so the bot's levels match what you see on screen.
 *  ─ REMOVED: all per-symbol and per-direction filter overrides
 *    (SELL_HTF_MULT_BOOST, BUY_CONFLUENCE_MIN vs SELL, PAIR_MIN_TP2_RR,
 *    POC_RECLAIM_SOLO restricted to SELL only). These were tuned against
 *    one 85-trade backtest and are the textbook definition of overfitting
 *    — they made that one backtest look better while making the system
 *    less likely to behave the same way on data it hasn't seen. Every
 *    symbol and direction now runs the identical rule set. If you want
 *    to reintroduce per-symbol tuning later, do it only after collecting
 *    a much larger out-of-sample trade count on THIS clean baseline.
 *
 *  v10.1 — fixed a live/backtest drift bug in the near-zone gate (see
 *  core.js header). No threshold values changed, just made them shared.
 *
 *  v10.2 — FREQUENCY PASS (2026-07-02). Explicitly requested: push signal
 *  count from ~0.94/week (97 signals / 720 days in the last backtest)
 *  toward 2-3/week, accepting that win rate will very likely drop below
 *  the 55.7% in that backtest. Six gates loosened — see each setting
 *  below for the specific before/after and the funnel data behind it.
 *  Two important honesty notes:
 *   1. This box has no network access to api.kucoin.com, so none of these
 *      numbers have been re-backtested. Run `node backtest.js` after
 *      deploying and treat the old 55.7%/97-signal report as stale.
 *   2. No setting here was chosen to hit a target win rate — that's a
 *      different thing from what just happened, which is choosing
 *      settings to hit a target FREQUENCY while being upfront that win
 *      rate is the cost. A "near 100% win rate" strategy does not exist
 *      at ANY frequency — see README for why.
 *
 *  v10.3 — RISK TIERING (added directly to the repo). Introduced
 *  computeRiskMultiplier() / RISK_TIER_MATRIX: position-size scaling for
 *  the POC-pivot / 1H-not-confirming segment, evidenced from the v10.2
 *  backtest (168 trades, 58.3% WR, 15 of 18 SLs). No entry gate touched —
 *  frequency unchanged. Well-scoped, reviewed and left as-is.
 *
 *  v10.4 — (2026-07-03) three fixes from the v10.3 backtest-report.json:
 *   1. LINK-USDT (0 signals/2yr) and AVAX-USDT (truncated to ~71 days) —
 *      NOT a data or strategy problem. backtest.js's history pager was
 *      silently treating "one HTTP call failed" the same as "reached the
 *      start of history" and giving up on all older data. Fixed in
 *      backtest.js (fetchKlines/fetchHistory) — see that file's header.
 *   2. TP3 hit 0 times in 216 signals — TP1 and TP3 were structurally
 *      allowed to sit fractions of a cent apart. Added TP3_MIN_EXTENSION_RR
 *      below. See core.js v10.4 fix log.
 *   3. PATTERN_RISK_MATRIX added — POC_RECLAIM pattern confirmed weak
 *      across three independent backtests now, independent of the v10.3
 *      pivot/confirm split. Position-size only, same as v10.3 — frequency
 *      and win-rate-by-count unaffected.
 *   Also hardened: Telegram send and live KuCoin fetch both retry on
 *   transient failure now instead of silently dropping the attempt — see
 *   strategy.js header.
 *
 *  v10.5 — (2026-07-03) requested: eliminate TP3, keep only TP1/TP2 as
 *  real targets, confirmed by FOUR separate backtests (30/360/720/1800
 *  days) all showing TP3 hits: 0.
 *   1. TP3 retired. TP2 is now the former TP3's VAH/VAL formula — the
 *      only far target left. TP1 is now a genuine 50% partial exit
 *      (PARTIAL_EXIT_PCT) that arms a hard breakeven stop for the rest,
 *      instead of the old instant full-close-at-TP1 behavior that was the
 *      actual reason TP2/TP3 were almost never reached in the first
 *      place — see core.js v10.5 fix log for the full mechanism. This is
 *      a real behavior fix, not a cosmetic rename: it changes what
 *      happens after TP1 is hit, and should increase avg R per trade
 *      without touching frequency or the pre-TP1 loss-protection logic.
 *   2. Separately: the r30 (30-day) backtest request came back with
 *      scanned=0 for all 14 symbols — not a quiet market. backtest.js
 *      fetched exactly `days` of history for warmup AND evaluation, but
 *      warming up the 4H volume profile alone needs ~34.2 days on its
 *      own, so any request under ~35 days could never produce a signal.
 *      Fixed with WARMUP_BUFFER_DAYS — see backtest.js v10.5 notes.
 *
 *  v10.6 — (2026-07-03) evaluated a third-party strategy spec (DeepSeek-
 *  authored, "Pi-9 VA Fib Reversal Bot") on request, adopted what held up,
 *  explicitly declined the rest:
 *   ADOPTED: TD Sequential "9" exhaustion count (Tom DeMark) as an
 *      independent, size-only confirmation signal — see core.js
 *      computeTDSequential(). Genuinely non-lagging, well-established, and
 *      structurally safe to add: it's additive-only (TD9_BOOST_MULT),
 *      clamped so it can never exceed normal size or block a signal, so
 *      it can't reduce frequency and can't introduce a new failure mode
 *      in the entry/gate logic that's already validated on 500+ trades.
 *   DECLINED: swapping TP2 from 1H VAH/VAL to a "Pi Target" (entry ± 
 *      VA_Range × π). The premise — "Pi solves the TP problem" — doesn't
 *      hold up: the actual TP problem was the v10.5 sequencing bug (TP1
 *      closing the whole trade before TP2 could ever be reached), already
 *      fixed. Swapping the TARGET FORMULA doesn't address that, and π as
 *      a multiplier has no evidence behind it in this system — it's an
 *      arbitrary constant, not a validated one. VAH/VAL stays: it's a
 *      real structural level with 500+ trades of backtest history behind
 *      it. Discussed with the user directly rather than silently skipped.
 *   DECLINED: 4H-based Value Area / Fibonacci (spec used 4H for both;
 *      this bot's validated version uses 1H). Swapping timeframes here
 *      would discard everything the four backtests (30/360/720/1800 day)
 *      validated and reintroduce unproven parameters — exactly what this
 *      codebase has been deliberately moving away from since v10.0.
 *   DECLINED: ADX filter, volume-confirmation filter, news filter — all
 *      would reduce signal frequency, which was explicitly the opposite
 *      of what was asked for this round ("maintain the signal firing
 *      system active as it is"). News filter also explicitly declined by
 *      the user directly.
 *
 *  v10.7 — EXPERIMENTAL, OFF BY DEFAULT (2026-07-04). Every SL across two
 *  fresh backtests (9 of 9 in a 360-day window, 15 of 15 in a 720-day
 *  window) was POC pivot. Rather than cut POC volume (costs frequency,
 *  the opposite of the ask), testing whether POC's SL is partly noise —
 *  POC is a single point that can shift bar to bar as volume rolls
 *  through the lookback, unlike VAH/VAL which are stable range
 *  boundaries — by widening ONLY POC's stop and shrinking size to match,
 *  so $ risk per trade is unchanged. See SL_ATR_MULT_MATRIX below and
 *  core.js computeRiskMultiplier() v10.7 note. Explicitly not trusted
 *  until backtested — SL_ATR_MULT_MATRIX_ENABLED defaults to false, and
 *  turning it on requires either an env var (for a one-off backtest run)
 *  or actually editing this file (for anything to change live).
 *
 *  v10.8 — EXPERIMENTAL, ALL OFF BY DEFAULT (2026-07-04). Three more
 *  testable theories for the same "every SL is POC" finding, chosen
 *  because they're mechanistically DIFFERENT from v10.7's SL-width test
 *  and from each other — each targets a different reason POC specifically
 *  (not VAH/VAL) might be a noisier level:
 *   #1 POC_PROMINENCE — POC is the most-CONTESTED price (most volume
 *      from both sides), not necessarily the strongest. If it only
 *      barely beats its neighbor price rows, it's a weak "winner" of a
 *      crowded zone rather than a level the market clearly agreed on.
 *   #2 POC_MIGRATION — is POC drifting toward the trade direction across
 *      recent windows (real, forming consensus) or static/noisy (no
 *      consensus yet)?
 *   #3 NAKED_POC — does an untested prior-window POC (never revisited
 *      since) sit near the current POC? Two profiles agreeing is
 *      stronger than one.
 *  All three: size-only, never gates, never reduce frequency, and are
 *  complete no-ops for VAH/VAL pivots regardless of whether they're
 *  enabled. See core.js for the functions and config below for the
 *  test-without-touching-live-behavior instructions.
 *
 *  v10.9 — (2026-07-05) two changes, explicitly requested:
 *   1. All three v10.8 POC quality factors (PROMINENCE / MIGRATION /
 *      NAKED_POC) flipped from off-by-default to ON by default — applied
 *      live directly rather than gated behind a backtest-first
 *      requirement. SL_ATR_MULT_MATRIX (v10.7) is a separate mechanism
 *      and was NOT included in this instruction — it stays off by
 *      default until asked for separately.
 *   2. signals.log.json and diag.log.json are now written NEWEST-FIRST
 *      (unshift, not push) instead of oldest-first, so the most recent
 *      activity is at the top of the file rather than requiring a scroll
 *      to the bottom of an ever-growing log. equity-curve.json (weekly
 *      snapshots) follows the same convention. See strategy.js and
 *      weekly-summary.js v10.9 notes for every place that reading code
 *      had to be updated to match (there were three — equity-curve math,
 *      "latest snapshot" lookup, and the displayed entry list).
 *
 *  v10.10 — FIVE-TIMEFRAME VOTE, 3-OF-5 (2026-07-06, explicitly requested:
 *  "FROM NOW WE ARE USING 5 TIMEFRAMES: 15MN, 30MN, 1H, 4H, 1D. VOTE OF 3
 *  OVER 5. WHEN 3 TF's AGREE ON 1 DIRECTION OUT OF THE 5 TF's, BOT SHOULD
 *  FIRE."):
 *   1. Added 1D and 30m as two new independent bias votes, using the exact
 *      same POC/VAH/VAL/Fib50 4-pillar vote as the other three timeframes
 *      (see core.js tfBiasVote — fully generic, unchanged).
 *   2. core.resolveDirection() now takes an explicit minAgree count (was
 *      hardcoded to 2). MIN_TF_AGREE below = 3, checked against all 5 TFs.
 *   3. 1H still supplies the structural zone, 15m still supplies the
 *      trigger candle — UNCHANGED. Only the direction-agreement vote
 *      gained two more independent opinions.
 *   4. /status (commands.js) now shows direction + full per-TF bias
 *      breakdown + vote tally — required saving those fields into
 *      state.json (previously only existed in diag.log.json), plus
 *      Telegram message-chunking so a 14-symbol × 5-TF status message
 *      can't hit Telegram's 4096-char hard limit.
 *   5. weekly-summary.js groups identical repeated entries with a "×N"
 *      count instead of printing N near-identical blocks in a row.
 *
 *  v10.11 — (2026-07-07) requested: investigate "bot isn't firing despite
 *  3-of-5 agreement" (screenshot of diag.log.json), and separately cut
 *  losses / raise win rate while holding 2-3 signals/week.
 *   1. NO BUG FOUND in the vote/fire logic. Checked all 541 diag.log.json
 *      entries programmatically: zero cases where reason was
 *      NO_3OF5_AGREEMENT while 3+ of the 5 biases actually agreed. The
 *      screenshot in question showed 2 BULLISH + 3 NEUTRAL (or 2
 *      BULLISH + 1 BEARISH + 2 NEUTRAL) — genuinely only 2-of-5, correctly
 *      not fired. NEUTRAL votes don't count toward either side; see
 *      resolveDirection() in core.js. Left that function untouched.
 *   2. The 383 "NO_2OF3_AGREEMENT" entries also visible in diag.log.json
 *      are NOT a live bug either — timestamps show they were written
 *      2026-07-03 to 2026-07-06 22:40, i.e. by the OLD 2-of-3 vote code
 *      that ran before v10.10 (3-of-5) was deployed. NO_3OF5_AGREEMENT
 *      entries only start at 2026-07-07 00:00, right after deploy. The
 *      log is a running history across versions, not evidence of two
 *      vote systems running at once.
 *   3. Two evidence-based changes made to actually cut losses (see each
 *      setting below for the full numbers): MIN_CONFLUENCE_POC reverted
 *      1 → 2, and POC_RECLAIM removed from SOLO_ELIGIBLE_PATTERNS. Both
 *      target the same confirmed weak point (POC-pivot / POC_RECLAIM
 *      entries own the large majority of this system's SLs across every
 *      backtest run to date) without touching the 3-of-5 vote itself,
 *      so the 2-3/week target from v10.10 is expected to mostly hold.
 *      NEITHER has been re-backtested on this box (no network access to
 *      api.kucoin.com here) — run `node backtest.js` after deploying.
 * ═══════════════════════════════════════════════════════════════════════
 */

module.exports = {

  // ── Telegram ────────────────────────────────────────────────────────────
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID:   process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE',

  // ── Assets ──────────────────────────────────────────────────────────────
  SYMBOLS: [
    'ETH-USDT', 'SOL-USDT', 'BTC-USDT', 'XRP-USDT',
    'ADA-USDT', 'DOGE-USDT', 'AVAX-USDT', 'LINK-USDT',
    'BNB-USDT', 'DOT-USDT', 'LTC-USDT', 'TRX-USDT', 'POL-USDT',
    'MNT-USDT', // v10.14: added — Mantle
  ],

  // ── Timeframes ──────────────────────────────────────────────────────────
  // v10.10: FIVE-WAY VOTE. 1D = macro-macro bias. 4H = macro bias.
  // 1H = structure (zone/Fib pocket, UNCHANGED). 30m = mid-rung bias.
  // 15m = trigger (the actual rejection candle that fires the signal,
  // UNCHANGED). Direction needs MIN_TF_AGREE (3) of these 5 to agree —
  // see core.js resolveDirection().
  DAILY_TIMEFRAME:   '1day',
  BIAS_TIMEFRAME:    '4hour',
  STRUCT_TIMEFRAME:  '1hour',
  HALF_TIMEFRAME:    '30min',
  TRIGGER_TIMEFRAME: '15min',

  // 3-of-5 direction vote (v10.10). Kept as a named constant, not a bare
  // "3", so the threshold and the TF count it's checked against can never
  // silently drift apart — see core.js resolveDirection(votes, minAgree).
  MIN_TF_AGREE: 3,

  // v10.15 NEW — requested: "a 5-of-5 unanimous vote and a bare 3-of-5
  // currently size identically... weighting confidence by vote strength."
  // See core.js computeVoteStrengthMultiplier() for the full mechanism
  // and why this is built as a discount-from-full rather than a boost
  // (clamp-ceiling reasoning — see the MULTI_TF_POC note above for the
  // same issue in more detail). Genuinely untested combination of tallies
  // — starting values below are a reasoned starting point (each extra
  // agreeing timeframe out of 5 shaves the "not fully confirmed" discount
  // in half: 3-of-5 at 0.70, 4-of-5 at 0.85, 5-of-5 at the full 1.0), not
  // a backtested optimum. Run `node backtest.js` and compare the BY VOTE
  // TALLY section (new in this version's report) against a run with this
  // flag off before trusting the numbers either way.
  // v10.15.1 REVERT (2026-07-09): defaulted to OFF. A fresh 360-day
  // backtest confirmed this cut simulated return roughly in half
  // ($1430 vs $1655 final capital on the identical 47-trade set, isolated
  // and verified) — NOT because it broke the underlying edge (win rate
  // barely moved), but because 3-of-5 tallies turned out to be 87% of
  // ALL real signals (41 of 47), not a rare weak case. Discounting the
  // overwhelming majority of trades by 30% by default was simply too
  // aggressive a starting point. Code kept intact and still fully
  // functional — set VOTE_STRENGTH_SIZE_ENABLED=true (or flip the
  // default below) to re-test, ideally with less aggressive starting
  // values than 0.70/0.85/1.0 given what this run showed.
  VOTE_STRENGTH_SIZE_ENABLED: process.env.VOTE_STRENGTH_SIZE_ENABLED === 'true' ? true : false,
  VOTE_STRENGTH_MULT: { 3: 0.70, 4: 0.85, 5: 1.0 },

  // v10.15 NEW — requested: a volatility/regime filter, since "same setup
  // in a quiet, orderly market vs. a violent, choppy one isn't the same
  // trade." Computes where the CURRENT 1H ATR ranks (0-100 percentile)
  // against this symbol's own trailing VOLATILITY_LOOKBACK_BARS of ATR
  // history, and skips the setup if it's in either extreme tail — very
  // high (chaotic/gappy — stops more likely to get blown through cleanly
  // rather than tag-and-reverse) or very low (dead/no follow-through —
  // even a correct read may not have the energy to reach TP1). Bounds
  // deliberately conservative (only the outer 5% on each side) since this
  // is untested and the goal is a light-touch regime filter, not an
  // aggressive new gate stacked on top of everything else this session.
  // Per-symbol, not global — a quiet day for BTC and a quiet day for a
  // small-cap alt aren't the same absolute ATR, which is exactly why this
  // is a percentile against the symbol's OWN history rather than a fixed
  // number. See core.js calcATRSeries()/calcATRPercentile().
  // v10.15.1 REVERT (2026-07-09): defaulted to OFF. Confirmed via funnel
  // diagnostics on a fresh 360-day run that this was cutting 15-20% of
  // vote-passing candidates on every symbol, taking signal count from 53
  // down to 47 — a real, substantial reduction with no confirmed
  // corresponding quality improvement (WR moved only within normal
  // sample noise). An untested 5th/95th-percentile threshold turned out
  // too aggressive for what this edge actually needs. Code kept intact —
  // set VOLATILITY_REGIME_ENABLED=true (or flip the default below) to
  // re-test, ideally with wider bounds (e.g. 2/98) than this run used.
  VOLATILITY_REGIME_ENABLED: process.env.VOLATILITY_REGIME_ENABLED === 'true' ? true : false,
  VOLATILITY_LOOKBACK_BARS: 200,      // ~8.3 days of 1H bars — trailing window the percentile is computed against
  VOLATILITY_MIN_PCTL: 5,             // below this percentile (too quiet) → skip
  VOLATILITY_MAX_PCTL: 95,            // above this percentile (too chaotic) → skip

  // Bar durations in seconds — used for cooldown math. Must match the
  // timeframes above. KuCoin bar seconds: 15min=900, 30min=1800,
  // 1hour=3600, 4hour=14400, 1day=86400.
  DAILY_BAR_SECONDS:   86400,
  STRUCT_BAR_SECONDS:  3600,
  HALF_BAR_SECONDS:    1800,
  TRIGGER_BAR_SECONDS: 900,

  // ── Scan frequency ──────────────────────────────────────────────────────
  // Actual cron lives in .github/workflows/mvs-scan.yml — keep in sync.
  // 15min cadence matches the 15m trigger timeframe: a fresh trigger
  // candle is checked within 15min of close.
  SCAN_CRON: '*/15 * * * *',

  // ── Data lookbacks ────────────────────────────────────────────────────────
  // 1H structure lookbacks matched to the TradingView A-ICT/SMC PRO_v5
  // indicator settings (screenshot: Lookback Bars 500, Swing Lookback 200)
  // so the bot's POC/VAH/VAL/Fib match what's plotted on your chart.
  STRUCT_VP_LOOKBACK:   500,   // 1H bars for POC/VAH/VAL (≈ 20.8 days)
  STRUCT_FIB_LOOKBACK:  200,   // 1H bars for swing/Fib   (≈ 8.3 days)

  // 4H macro bias — unchanged real-world calendar window from prior version.
  BIAS_VP_LOOKBACK:   200,   // 4H bars (≈ 33 days)
  BIAS_FIB_LOOKBACK:   90,   // 4H bars (≈ 15 days)

  // 1D macro-macro bias (v10.10, NEW) — a wide, slow-moving window
  // appropriate for a daily candle vote: 100 bars ≈ 100 days of history,
  // roughly triple the 4H bias window's real-world span, since 1D is
  // meant to catch multi-week/monthly structure the 4H vote is too fast
  // to hold a durable opinion on.
  DAILY_VP_LOOKBACK:  100,   // 1D bars (≈ 100 days)
  DAILY_FIB_LOOKBACK:  60,   // 1D bars (≈ 60 days)

  // 30m mid-rung bias (v10.10, NEW) — sits between 1H structure and 15m
  // trigger. Lookback chosen to mirror the 15m trigger TF's real-world
  // span (≈5 days) at half the bar count, since 30m bars are 2x as long.
  HALF_VP_LOOKBACK:   250,   // 30m bars (≈ 5.2 days)
  HALF_FIB_LOOKBACK:  100,   // 30m bars (≈ 2.1 days)

  // 15m trigger TF — its own independent vote + pattern detection window.
  TRIGGER_VP_LOOKBACK:  500,  // 15m bars (≈ 5.2 days)
  TRIGGER_FIB_LOOKBACK: 200,  // 15m bars (≈ 2.1 days)

  // ── Volume Profile ──────────────────────────────────────────────────────
  VP_ROWS: 100,               // matches TradingView "Profile Rows: 100"
  VALUE_AREA_PCT: 0.70,       // 70% of volume defines VAH/VAL

  // ── Fibonacci ───────────────────────────────────────────────────────────
  // Entry pocket: 60-80% retracement (contains 61.8% and 78.6%).
  FIB_ZONE_LOW:  0.60,
  FIB_ZONE_HIGH: 0.80,

  // ── Near-zone gate ───────────────────────────────────────────────────────
  // How close (in ATR(1H)) price must be to the 1H Fib 60-80% pocket before
  // the bot bothers checking confluence at all.
  // v10.1: pulled out of strategy.js/backtest.js into one shared constant
  // (core.isNearZone) — was previously ~1.1×ATR live vs 1.0×ATR backtest,
  // a silent drift bug.
  // v10.2 (FREQUENCY PASS): 1.0 → 1.5. This was the single biggest
  // bottleneck in the whole funnel — the v10.0 backtest funnel shows only
  // 2,246 of 50,983 vote-passing 15m ticks on ETH-USDT (4.4%) ever got
  // this close to the zone. Widening the net here does NOT skip the
  // confluence or trigger checks that come after it — it just lets more
  // candidate bars reach those checks. Expect this alone to meaningfully
  // raise signal count; expect win rate to drop somewhat too, since some
  // of the newly-admitted bars are further from the "true" zone.
  NEAR_ZONE_ATR_MULT: 1.5,

  // ── Confluence engine ───────────────────────────────────────────────────
  // Tolerance = 1H ATR × this multiplier. A Fib level within this band of
  // POC/VAH/VAL counts as confluence.
  // v10.2 (FREQUENCY PASS): 0.65 → 0.85. Second-largest bottleneck after
  // near-zone (ETH funnel: 1,224 of 2,246 near-zone bars passed, 54.5%).
  // Widening this admits looser Fib/POC-VAH-VAL overlaps as "confluence."
  CONFLUENCE_ATR_MULT: 0.85,

  // 4H zone cross-check tolerance — same multiplier, both directions
  // (the old SELL-only 1.10x boost has been removed — see header note).
  // v10.2 (FREQUENCY PASS): 3.0 → 4.0. This gate already passed ~93% of
  // confluence-qualified setups (ETH funnel: 1,140/1,224), so this is a
  // minor lever, but every bit counts toward 2-3 signals/week.
  HTFZONE_ATR_MULT: 4.0,

  // POC entries need tight alignment (score>=2) because POC is a single
  // point; VAH/VAL are boundary lines and pass at score>=1. This is a
  // structural distinction, not a per-symbol tune.
  // v10.2 (FREQUENCY PASS): 2 → 1, so POC now qualifies at the same
  // looseness as VAH/VAL. DISCLOSURE: the backtest data available shows
  // this is the highest-risk change in this pass — POC-pivot trades were
  // already the weakest bucket (52.4% WR over 82 trades, vs 75% WR for
  // VAH over 12 trades) and ALL 7 of the backtest's SL losses were POC
  // pivot at exactly the old score-2 threshold. Loosening it further will
  // very likely pull win rate down further, on top of the drop already
  // expected from the other v10.2 changes. Set back to 2 if the next
  // backtest run shows POC-pivot win rate degrading past what's useful.
  //
  // v10.11 (2026-07-07) — REVERTED 1 → 2, to raise win rate / cut losses
  // while holding ~2-3 signals/week. Evidence from the three backtest
  // reports reviewed this session:
  //  - 720-day: POC pivot 206 trades, 56.3% WR, 23 of 30 total SLs (77%)
  //    landed on POC pivot. VAH/VAL combined: 82 trades, only 7 SLs.
  //  - The v10.2 note above explicitly named this as the lever to revert
  //    "if the next backtest run shows POC-pivot win rate degrading past
  //    what's useful" — the 720-day report is that confirmation.
  //  - Frequency cushion: even at the loosest (score>=1) setting, signal
  //    count only averaged 2.4-2.8/week across 360/720-day windows —
  //    comfortably inside the 2-3/week target, so there's room to trade
  //    a little frequency for quality on this one gate.
  //  NOT yet re-backtested on this box (no network access to
  //  api.kucoin.com here) — run `node backtest.js` after deploying and
  //  compare the new POC-pivot WR/SL numbers against the reports above.
  MIN_CONFLUENCE_POC: 2,

  // ── Rejection / trigger candle (2-of-5 rule, on the 15m trigger TF) ────
  // Patterns: POC_RECLAIM, VAH_VAL_RECLAIM, PIN_BAR, ENGULFING, CLOSE_REJECTION
  REJECTION_MIN_PATTERNS: parseInt(process.env.REJECTION_MIN_PATTERNS, 10) || 2,

  // Solo trigger: a single pattern in SOLO_ELIGIBLE_PATTERNS is enough IF
  // every other gate (4H/1H/15m vote, confluence, HTF zone, RR) still
  // passes. Applies equally to BUY and SELL.
  ALLOW_SOLO_TRIGGER: process.env.ALLOW_SOLO_TRIGGER === 'false' ? false : true,

  // v10.0: turned solo ON, limited to the two "reclaim" patterns (price
  // wicks through a real level and closes back — structurally the
  // strongest single piece of evidence this system detects).
  // v10.2 (FREQUENCY PASS): added CLOSE_REJECTION — a full close outside
  // the zone boundary is also a clean, unambiguous single-candle signal,
  // not just noise. Deliberately did NOT add PIN_BAR or ENGULFING: those
  // are pure wick/body-ratio shapes with no confirmation against an actual
  // price level, and the backtest data shows they're weakest when they
  // co-occur with each other (ENGULFING+PIN_BAR combo: 44.4% WR, n=18 —
  // the worst multi-pattern bucket). Letting either fire alone is the one
  // lever in this whole pass I'm not willing to pull without more data.
  // The biggest remaining bottleneck in the funnel (triggerOk: only 121 of
  // 1,126 htf/invalidation-passing ETH ticks, ~10.7%) is intentionally
  // left the most conservative gate in this pass — this is where "cheap"
  // frequency is easiest to get and easiest to regret.
  // v10.11 (2026-07-07) — POC_RECLAIM REMOVED from this list. Per
  // PATTERN_RISK_MATRIX's own comment (v10.4 backtest, 215 closed
  // trades): setups where POC_RECLAIM was one of the firing patterns —
  // 61 trades, 39.3% WR, 10 SL, +0.228R/trade avg. Setups without it —
  // 154 trades, 72.7% WR, 5 SL, +0.770R/trade avg. That gap holds even
  // inside the "1H-confirmed" tier (still only 38.5% WR there). Letting
  // POC_RECLAIM fire ALONE was the biggest source of weak entries this
  // pattern produces; now it still counts toward REJECTION_MIN_PATTERNS
  // (2-of-2) and PATTERN_RISK_MATRIX still discounts its size when it
  // does fire, but it can no longer single-handedly trigger a signal.
  // Expected effect: fewer, better trades — not yet re-backtested here
  // (no network access to api.kucoin.com on this box). Run
  // `node backtest.js` after deploying and check the PATTERN FREQUENCY /
  // BY outcome sections against the reports from this session.
  SOLO_ELIGIBLE_PATTERNS: ['VAH_VAL_RECLAIM', 'CLOSE_REJECTION'],

  // ── Absorption veto ─────────────────────────────────────────────────────
  // Vetoes a trigger when an opposing full-body candle sits at the zone
  // (bodyRatio > this AND candle closed the "wrong" way for the direction).
  // v10.2 (FREQUENCY PASS): 0.60 → 0.70 — fewer candles get vetoed as
  // "institutional absorption," since a slightly larger body is now
  // tolerated before the veto kicks in.
  ABSORPTION_BODY_RATIO: 0.70,

  // ── Zone invalidation ───────────────────────────────────────────────────
  // 1H close beyond zone ref by > ATR × this multiplier voids the zone.
  ZONE_INVALIDATION_ATR_MULT: 1.0,

  // ── Signal cooldown ─────────────────────────────────────────────────────
  // Suppress re-alert on same symbol+direction for N structure(1H) bars.
  // v10.2 (FREQUENCY PASS): 5 → 3. Smaller lever than the others (this
  // gate already passed ~99% in the ETH funnel), but it does let
  // fast-trending symbols like LTC (16 of 97 backtest trades) re-signal
  // sooner instead of sitting out a trend.
  SIGNAL_COOLDOWN_BARS: 3,

  // ── ATR ─────────────────────────────────────────────────────────────────
  ATR_PERIOD: 14,

  // ── Risk management ─────────────────────────────────────────────────────
  SL_ATR_MULT: 0.25,          // SL = swing wick ± 0.25×ATR(1H)

  // ── EXPERIMENTAL (v10.7) — per-pivot SL width test, OFF by default ──────
  // Hypothesis: POC is a single price point (unlike VAH/VAL, which are
  // range boundaries), so it may be more prone to brief overshoot-then-
  // reverse noise tagging the SL before price does what the setup
  // predicted. This widens POC's stop so it can survive that overshoot,
  // and scales position size down proportionally (via
  // computeRiskMultiplier) so $ risk per trade stays exactly the same as
  // the unwidened baseline — NOT validated, this is here to be backtested,
  // not to be trusted yet.
  //
  // HOW TO TEST WITHOUT TOUCHING LIVE BEHAVIOR:
  //   SL_ATR_MULT_MATRIX_ENABLED=true node backtest.js
  // Compare the resulting SL count / win rate / total R against a normal
  // run (env var unset). Only flip the line below to `true` if the
  // backtest actually supports it — this file is what both strategy.js
  // (live) and backtest.js read, so changing the default here changes
  // live behavior the next time the bot runs.
  SL_ATR_MULT_MATRIX_ENABLED: process.env.SL_ATR_MULT_MATRIX_ENABLED === 'true' ? true : false,
  SL_ATR_MULT_MATRIX: {
    POC: 0.4,   // vs baseline 0.25 — first guess to test, not a tuned value
  },

  // ── POC QUALITY FACTORS (v10.8, applied LIVE as of v10.9) ──────────────
  // Three independent, testable hypotheses about why POC underperforms
  // VAH/VAL — every SL across two fresh backtests (9/9 in a 360-day
  // window, 15/15 in a 720-day window) was POC pivot. Each is a bounded,
  // size-only multiplier on top of everything else above — none of these
  // are gates, none can reduce signal frequency. Applied live directly
  // (per explicit instruction) rather than gated behind a backtest-first
  // requirement — unlike SL_ATR_MULT_MATRIX above, which is a SEPARATE,
  // still-experimental mechanism that hasn't been asked to go live yet
  // and stays off by default. See core.js computePOCProminence() /
  // computePOCMigration() / computeNakedPOC() / computePOCQualityMultiplier()
  // for the full mechanism behind each.
  //
  // #1 — POC PROMINENCE: is POC's volume a clear, singular peak, or does
  // it barely edge out its immediate neighbor price rows — a contested,
  // ambiguous "winner" rather than a level the market clearly agreed on?
  // Theory: POC is the most-CONTESTED price (most volume from BOTH
  // buyers and sellers), not necessarily the strongest one — unlike
  // VAH/VAL, which are range boundaries that see more decisive rejection.
  // v10.9: applied LIVE per explicit instruction — not gated behind a
  // backtest-first requirement the way SL_ATR_MULT_MATRIX above still is.
  // Env var can still force it off for an A/B comparison run if you want
  // one: POC_PROMINENCE_ENABLED=false node backtest.js
  POC_PROMINENCE_ENABLED: process.env.POC_PROMINENCE_ENABLED === 'false' ? false : true,
  POC_PROMINENCE_MIN_RATIO: 1.5,      // POC vol must beat avg-neighbor vol by 50%+ to count as decisive
  POC_PROMINENCE_PENALTY_MULT: 0.8,   // applied when POC is "contested" (ratio below the line above)

  // v10.13 (2026-07-07) NEW: upgraded from a size discount to an actual
  // gate, per direct per-trade analysis of backtest-report.json (not just
  // theory this time). Cross-checked 720-day (207 POC trades) and 360-day
  // (94 POC trades, a subset of the 720-day set — same replication caveat
  // as the migration note below, not two fully independent samples):
  //   "Decisive" POC (ratio >= 1.5): 59.7% WR (720d) / 60.3% WR (360d)
  //   "Contested" POC (ratio < 1.5): 48.3% WR (720d) / 50.0% WR (360d)
  // ~10pp gap, same direction both times — comparable in size to the
  // 1H-confirm gap that justified POC_REQUIRE_1H_CONFIRM as a gate in
  // v10.12, so it gets the same treatment: contested POC entries are now
  // skipped entirely (logged POC_PROMINENCE_GATED) rather than just taken
  // at 80% size. Set to false to fall back to the old size-only discount.
  POC_PROMINENCE_REQUIRE_DECISIVE: process.env.POC_PROMINENCE_REQUIRE_DECISIVE === 'false' ? false : true,

  // #2 — POC MIGRATION: has POC been drifting toward the trade direction
  // across recent windows (real, forming consensus / fair value moving),
  // or is it static / jumping around (balance, not trend)?
  // v10.9: applied LIVE per explicit instruction. Env var can still force
  // it off for an A/B comparison run: POC_MIGRATION_ENABLED=false node backtest.js
  //
  // v10.13 FIX (2026-07-07): the ORIGINAL THEORY WAS BACKWARDS. Checked
  // against the same two backtest-report.json files, split by whether
  // migration confirmed the trade direction:
  //   Migration CONFIRMS direction: 53.3% WR (720d) / 54.8% WR (360d)
  //   Migration AGAINST or static:  62.5% WR (720d) / 64.7% WR (360d)
  // The exact opposite of what v10.8 assumed ("migrating with direction =
  // forming consensus = good"). A plausible read: a POC that's already
  // migrated toward the trade direction is a level that's already been
  // "spent" — the value area re-rated before this entry arrived, so it's
  // chasing a level rather than catching a fresh one. BOOST_MULT below is
  // no longer applied to the confirming case (see core.js
  // computePOCQualityMultiplier v10.13 note) — PENALTY_MULT now applies
  // there instead, and the against/static case is left neutral. The
  // constant is kept (not deleted) in case a future run wants to test
  // rewarding the against-direction case specifically.
  POC_MIGRATION_ENABLED: process.env.POC_MIGRATION_ENABLED === 'false' ? false : true,
  POC_MIGRATION_OFFSET_BARS: 250,     // ~10.4 days of 1H bars back, for the "past POC" comparison window
  POC_MIGRATION_MIN_ATR: 0.5,         // minimum drift (in ATR) before it counts as "migrating," not noise
  POC_MIGRATION_BOOST_MULT: 1.2,      // kept for reference/future testing — no longer applied as of v10.13
  POC_MIGRATION_PENALTY_MULT: 0.8,    // v10.13: now applied when migration CONFIRMS direction (was: against)

  // #3 — NAKED / UNTESTED POC: does an earlier, now-closed window's POC
  // — never revisited by price since — sit close to the CURRENT POC?
  // Two independently-computed profiles agreeing on the same price is
  // stacked evidence, not just one profile's opinion.
  // v10.9: applied LIVE per explicit instruction. Env var can still force
  // it off for an A/B comparison run: NAKED_POC_ENABLED=false node backtest.js
  NAKED_POC_ENABLED: process.env.NAKED_POC_ENABLED === 'false' ? false : true,
  NAKED_POC_TOLERANCE_ATR: 0.5,       // how close current POC must sit to the naked historical POC
  NAKED_POC_BOOST_MULT: 1.15,

  // #4 — MULTI-TIMEFRAME POC ALIGNMENT (v10.15 NEW): does the 1H POC also
  // line up with the 4H POC and/or 1D POC? Two (or three) INDEPENDENTLY
  // computed volume profiles agreeing on the same price is a stronger
  // claim than one profile's opinion alone — same underlying logic as
  // NAKED_POC above, just comparing across timeframes instead of across
  // time windows on the same timeframe. bias4h.poc / bias1d.poc are
  // already computed by tfBiasVote() as part of the 5-TF vote — no new
  // KuCoin fetch needed, this is free given data already in hand.
  // GENUINELY UNTESTED — no prior trade data exists that tracked this
  // (it didn't exist as a factor until now), so it's a bounded SIZE
  // multiplier only, not a gate, exactly like NAKED_POC was when IT was
  // first introduced in v10.8. IMPORTANT CAVEAT discovered while adding
  // this: the final risk multiplier is clamped to a 1.0 ceiling
  // (Math.min(1.0, ...) in strategy.js/backtest.js) — a "boost" only
  // does anything for a trade that already has some OTHER discount
  // active (e.g. PATTERN_RISK_MATRIX below), pulling it back up toward,
  // never past, 1.0. For a trade with no other discount, this factor is
  // a no-op, same as NAKED_POC_BOOST_MULT and the old (pre-v10.13)
  // POC_MIGRATION_BOOST_MULT always were — neither had ever actually
  // mattered before this was noticed. Not changed here: raising the
  // ceiling itself is a real risk-management decision (it would mean a
  // trade CAN size above your configured RISK_PER_TRADE_PCT in the best
  // case) that deserves its own explicit choice, not a side effect of
  // adding an unrelated feature.
  MULTI_TF_POC_ENABLED: process.env.MULTI_TF_POC_ENABLED === 'false' ? false : true,
  MULTI_TF_POC_TOLERANCE_ATR: 0.75,   // how close 1H POC must sit to 4H/1D POC to count as "aligned"
  MULTI_TF_POC_BOOST_MULT: 1.15,      // same magnitude as NAKED_POC_BOOST_MULT — no evidence yet to justify a different number

  // ALL THREE ARE LIVE BY DEFAULT AS OF v10.9. To run an A/B comparison
  // against them being off (recommended at some point, even though it
  // wasn't required before shipping):
  //   POC_PROMINENCE_ENABLED=false node backtest.js
  //   POC_MIGRATION_ENABLED=false NAKED_POC_ENABLED=false node backtest.js
  // MIGRATION and NAKED_POC both make the bot fetch more 1H history than
  // it otherwise would (750-1000 bars vs the usual 500) — see strategy.js
  // v10.8 notes for how the fetch size adapts automatically to whatever
  // these flags are set to.

  RISK_PER_TRADE_PCT: 1.5,    // % of capital risked per trade in backtest sim
  SLIPPAGE_PCT: 0.001,        // 0.1% slippage/spread assumption

  // ── Risk tiering (v10.3) ──────────────────────────────────────────────
  // Position-size multiplier, NOT an entry gate — every trade that used to
  // fire still fires, at reduced size for the one segment the trade log
  // actually flags. See core.js computeRiskMultiplier() header for the
  // full pivot × 1H-confirm breakdown. Short version, from the v10.2
  // backtest-report.json (246 closed trades):
  //   POC pivot, 1H NOT in the confirming vote → 168 trades, 58.3% WR,
  //   15 of 18 total SLs (83%). Every other pivot/confirm combination —
  //   including POC when 1H DOES confirm (46 trades, 73.9% WR, only 3 SL)
  //   — has no SL evidence to justify a cut, so it stays at 1.0.
  // Only one key set below 1.0 on purpose: cutting more than the data
  // supports is exactly the v9.x overfitting mistake described above.
  RISK_TIER_MATRIX: {
    POC_NO1H: 0.75,
    // POC_1H, VAH_1H, VAH_NO1H, VAL_1H, VAL_NO1H all default to 1.0 below.
  },
  RISK_TIER_DEFAULT: 1.0,

  // ── POC + no-1H-confirm: GATE, not just a size cut (v10.12, 2026-07-07) ──
  // Requested: "definitely" solve the POC-SL problem. The evidence above
  // (POC_NO1H segment: 168 trades, 58.3% WR, 15 of 18 total SLs = 83% of
  // all losses in that 246-trade set) is exactly the same segment
  // RISK_TIER_MATRIX has been discounting to 0.75x size since v10.3 — but
  // discounting size still lets every one of those trades fire and still
  // eats the loss, just a smaller one. This flag removes that segment
  // from the entry funnel entirely: when the pivot is POC AND 1H is NOT
  // one of the 3+ agreeing timeframes, the setup is skipped, full stop —
  // same treatment POC already effectively gets from MIN_CONFLUENCE_POC
  // and the SOLO_ELIGIBLE_PATTERNS change made earlier this session, just
  // applied to the OTHER confirmed-weak POC segment instead of leaving it
  // as a smaller bet.
  // Cost: this is the biggest, most direct lever available and it WILL
  // reduce signal frequency further, on top of the two changes already
  // made today — POC_NO1H was 168 of 246 trades (68%) in the report that
  // surfaced this. Expect fewer signals; the 2-3/week target may need
  // revisiting once a fresh backtest shows where it actually lands.
  // Not yet re-backtested on this box (no network access to
  // api.kucoin.com here) — run `node backtest.js` after deploying and
  // check the funnel diagnostics (new POC_NO1H_GATED reason in
  // diag.log.json / backtest funnel) plus the BY PIVOT / BY CONFIDENCE
  // TIER sections against the reports from this session.
  // Set to false (or POC_REQUIRE_1H_CONFIRM=false env var for a one-off
  // backtest) to fall back to the old size-only treatment above.
  POC_REQUIRE_1H_CONFIRM: process.env.POC_REQUIRE_1H_CONFIRM === 'false' ? false : true,

  // ── Pattern risk tiering (v10.4) ────────────────────────────────────────
  // Second, independent multiplier — multiplies with RISK_TIER_MATRIX,
  // doesn't replace it. From backtest-report.json (215 closed trades,
  // v10.3 ruleset, THIRD consecutive backtest showing this):
  //   Trades where POC_RECLAIM is one of the firing patterns → 61 trades,
  //   39.3% WR, 10 SL, avg +0.228R/trade. Without it → 154 trades, 72.7%
  //   WR, 5 SL, avg +0.770R/trade. Holds independent of the 1H-confirm
  //   split (still only 38.5% WR inside the "strong" 1H-confirmed tier).
  // No other pattern has comparable evidence against it, so only
  // POC_RECLAIM is discounted here.
  PATTERN_RISK_MATRIX: {
    POC_RECLAIM: 0.65,
  },

  // ── TD Sequential "9" exhaustion boost (v10.6, added on request) ────────
  // Independent, additive-only supporting evidence — see core.js
  // computeTDSequential() header for the full reasoning. Bounded so it can
  // only ever restore size toward 1.0 (never past it, never a gate). No
  // backtest history of its own yet in this system, so the boost is kept
  // deliberately modest (1.15x) rather than assumed strong. Revisit with
  // real data once enough signals have fired with TD9 present to check.
  TD9_ENABLED: true,
  TD9_BOOST_MULT: 1.15,

  // ── TP structure (v10.5: TP3 eliminated — see core.js v10.5 fix log) ────
  TP1_RR_FLOOR: 1.2,          // TP1 = max(50%Fib, entry + 1.2×risk)
  // TP2 = 1H VAH/VAL (formerly TP3). TP1 is now a 50% PARTIAL exit that
  // arms a hard breakeven stop for the other half, which then targets
  // TP2. The old midpoint-of-TP1-and-TP3 formula for "TP2" is gone
  // entirely — that level never did much useful work, since under the
  // old sequencing TP1 closed the whole trade before it could matter.

  // Fraction of the position closed at TP1. Remaining (1 - this) rides to
  // TP2 with a breakeven stop. 0.5 = the standard, most defensible split;
  // change with real evidence only, not a hunch.
  PARTIAL_EXIT_PCT: 0.5,

  // v10.4 FIX (kept, renamed for v10.5): the far target used to only
  // require tp3Price > tp1Price (BUY) with NO minimum margin, which is
  // why the old TP3 hit 0 times across every single backtest run (30,
  // 360, 720, AND 1800 days, all showing 0). This value (0.25R) rejects
  // the worst ~15% of setups by TP1-TP2 gap (the ones where the far
  // target was structurally too close to be a meaningful second stage)
  // while keeping the other ~85%. Set to 0 to disable the floor entirely.
  TP2_MIN_EXTENSION_RR: 0.25,

  // ── Backtest-only settings ──────────────────────────────────────────────
  BACKTEST_DAYS: 360,
  STARTING_CAPITAL: 1000,
  EARLY_TIMEOUT_BARS: 70,     // close sim trades early if TP1 not hit by then (v10.5: was "TP2" under the old 3-target system)
  // v10.14: named constant replacing a bare "200" that was hardcoded
  // identically in two places in backtest.js's trade-management loop
  // (the open-loop TIMEOUT check and — implicitly, same 200 — nowhere
  // else, since the end-of-backtest "still open" branch used its own
  // separate math). Also now the shared ceiling used by
  // core.js evaluateOpenTrade() for BOTH backtest.js and the new live
  // position-tracker.js, so live and backtest can't drift on how long a
  // trade is allowed to stay open.
  MAX_HOLD_1H_BARS: 200,

  // ── KuCoin API ──────────────────────────────────────────────────────────
  BASE_URL: 'https://api.kucoin.com/api/v1',

};
