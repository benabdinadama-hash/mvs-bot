/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — Monthly Value Sniper v10.2
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
    'BNB-USDT', 'DOT-USDT', 'LTC-USDT', 'TRX-USDT', 'POL-USDT'
  ],

  // ── Timeframes ──────────────────────────────────────────────────────────
  // Three-way vote. 4H = macro bias. 1H = structure (zone/Fib pocket).
  // 15m = trigger (the actual rejection candle that fires the signal).
  BIAS_TIMEFRAME:    '4hour',
  STRUCT_TIMEFRAME:  '1hour',
  TRIGGER_TIMEFRAME: '15min',

  // Bar durations in seconds — used for cooldown math. Must match the
  // timeframes above. KuCoin bar seconds: 15min=900, 1hour=3600, 4hour=14400.
  STRUCT_BAR_SECONDS:  3600,
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
  MIN_CONFLUENCE_POC: 1,

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
  SOLO_ELIGIBLE_PATTERNS: ['POC_RECLAIM', 'VAH_VAL_RECLAIM', 'CLOSE_REJECTION'],

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

  // ── TP structure ─────────────────────────────────────────────────────────
  TP1_RR_FLOOR: 1.2,          // TP1 = max(50%Fib, entry + 1.2×risk)
  // TP2 = midpoint between TP1 and TP3 (structural). TP3 = 1H VAH/VAL.

  // ── Backtest-only settings ──────────────────────────────────────────────
  BACKTEST_DAYS: 360,
  STARTING_CAPITAL: 1000,
  EARLY_TIMEOUT_BARS: 70,     // close sim trades early if TP2 not hit by then

  // ── KuCoin API ──────────────────────────────────────────────────────────
  BASE_URL: 'https://api.kucoin.com/api/v1',

};
