/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — Monthly Value Sniper v10.0
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
 *  ─ No setting in this file is chosen to hit a target win rate. A
 *    "near 100% win rate" strategy does not exist — see README for why.
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

  // ── Confluence engine ───────────────────────────────────────────────────
  // Tolerance = 1H ATR × this multiplier. A Fib level within this band of
  // POC/VAH/VAL counts as confluence.
  CONFLUENCE_ATR_MULT: 0.65,

  // 4H zone cross-check tolerance — same multiplier, both directions
  // (the old SELL-only 1.10x boost has been removed — see header note).
  HTFZONE_ATR_MULT: 3.0,

  // POC entries need tight alignment (score>=2) because POC is a single
  // point; VAH/VAL are boundary lines and pass at score>=1. This is a
  // structural distinction, not a per-symbol tune.
  MIN_CONFLUENCE_POC: 2,

  // ── Rejection / trigger candle (2-of-5 rule, on the 15m trigger TF) ────
  // Patterns: POC_RECLAIM, VAH_VAL_RECLAIM, PIN_BAR, ENGULFING, CLOSE_REJECTION
  REJECTION_MIN_PATTERNS: parseInt(process.env.REJECTION_MIN_PATTERNS, 10) || 2,

  // Solo trigger: a single POC_RECLAIM or VAH_VAL_RECLAIM pattern alone is
  // enough IF every other gate (4H/1H/15m vote, confluence, HTF zone, RR)
  // still passes. Applies equally to BUY and SELL.
  // Turned ON by default (2026-07-02): this gate exists specifically to
  // stop high-conviction reclaims (POC_RECLAIM / VAH_VAL_RECLAIM) from
  // being thrown away just because a second pattern didn't co-occur on
  // the same 15m candle — the backtest funnel shows VAH_VAL_RECLAIM alone
  // hit only 2/91 fires under the old 2-of-5 rule. Every other gate (vote,
  // confluence, HTF alignment, cooldown, RR) is unchanged, so this adds
  // frequency without loosening quality. Set ALLOW_SOLO_TRIGGER=false in
  // env to revert. Re-run `npm run backtest` after any change here before
  // trusting new numbers — this box can't reach api.kucoin.com to verify.
  ALLOW_SOLO_TRIGGER: process.env.ALLOW_SOLO_TRIGGER === 'false' ? false : true,

  // ── Absorption veto ─────────────────────────────────────────────────────
  ABSORPTION_BODY_RATIO: 0.60,

  // ── Zone invalidation ───────────────────────────────────────────────────
  // 1H close beyond zone ref by > ATR × this multiplier voids the zone.
  ZONE_INVALIDATION_ATR_MULT: 1.0,

  // ── Signal cooldown ─────────────────────────────────────────────────────
  // Suppress re-alert on same symbol+direction for N structure(1H) bars.
  SIGNAL_COOLDOWN_BARS: 5,

  // ── ATR ─────────────────────────────────────────────────────────────────
  ATR_PERIOD: 14,

  // ── Risk management ─────────────────────────────────────────────────────
  SL_ATR_MULT: 0.25,          // SL = swing wick ± 0.25×ATR(1H)
  RISK_PER_TRADE_PCT: 1.5,    // % of capital risked per trade in backtest sim
  SLIPPAGE_PCT: 0.001,        // 0.1% slippage/spread assumption

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
