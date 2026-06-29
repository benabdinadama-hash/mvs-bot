/**
 * MVS — Monthly Value Sniper v8.7
 * KuCoin API Configuration for Ghana
 *
 * FOUNDATION: POC + VAH + VAL + FIBO (all 6 levels). Nothing else.
 * TIMEFRAMES:  4H bias gate → 1hour entry candles, scanned every 15min.
 * SYMBOLS:     8 liquid pairs — ETH, SOL, BTC, XRP, ADA, DOGE, AVAX, LINK
 *              (90.6% real-money WR across 360-day, 8-pair backtest — see README)
 *              repo is PUBLIC — GitHub Actions minutes are unlimited and free.
 *
 * NO lagging indicators. Every parameter here is structural price/volume data.
 */

module.exports = {

  // ── Telegram ────────────────────────────────────────────────────────────
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID:   process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE',

  // ── Assets ──────────────────────────────────────────────────────────────
  // v8.7: repo is PUBLIC, so GitHub Actions minutes are unlimited/free —
  // no quota reason left to stay at 2 symbols. Back to 8 liquid pairs: the
  // safest way to get more signals/week without touching strategy logic —
  // every pair still passes the exact same POC/VAH/VAL/Fib + 4H-bias +
  // rejection + R:R gates. More markets scanned ≠ looser filter.
  SYMBOLS: [
    'ETH-USDT', 'SOL-USDT', 'BTC-USDT', 'XRP-USDT',
    'ADA-USDT', 'DOGE-USDT', 'AVAX-USDT', 'LINK-USDT'
  ],

  // ── Timeframes ──────────────────────────────────────────────────────────
  TIMEFRAME:      '1hour',   // entry timeframe (v8.5: reverted from 15min — fewer/cleaner signals)
  BIAS_TIMEFRAME: '4hour',   // higher-timeframe bias — UNCHANGED, still the strict gate

  // Entry bar duration in seconds. MUST match TIMEFRAME above — used for
  // cooldown math (bars-since-last-signal). KuCoin bar seconds reference:
  // 1min=60, 5min=300, 15min=900, 30min=1800, 1hour=3600, 4hour=14400.
  ENTRY_BAR_SECONDS: 3600,

  // ── Scan Frequency ──────────────────────────────────────────────────────
  // NOTE: this constant is documentation only — the actual cron schedule
  // lives in .github/workflows/mvs-scan.yml and must be kept in sync with
  // this value by hand. v8.5: entry candle is now 1hour, but the scan still
  // runs every 15min so a fresh 1H candle is picked up within 15min of close
  // (not left waiting up to an hour for the next scan).
  SCAN_CRON: '*/15 * * * *',

  // ── Data lookbacks ──────────────────────────────────────────────────────
  // Scaled for 1hour bars — same real-world calendar windows as before,
  // only the resolution changed, not how much history is used.
  // v8.6: MONTHLY re-calibration. Previous values (120 / 200 / 60) anchored
  // POC/VAH/VAL/Fib to only 5–8 days of 1hour bars — far shorter than the
  // actual monthly range traders read off the chart, which squeezed all
  // structural levels into an unrealistically tight band and starved the
  // bot of valid signals. Lookbacks below are now genuinely monthly.
  VP_LOOKBACK:        720,   // 720 bars = 720h (30 days) — true monthly value area
  BIAS_LOOKBACK:      200,   // 4H bars for bias module        (≈ 33 days) — unchanged
  FIB_LOOKBACK:       720,   // 1hour bars for swing detection (30 days) — matches VP window
  BIAS_FIB_LOOKBACK:   90,   // 4H bars for bias swing         (≈ 15 days)

  // ── Volume Profile ──────────────────────────────────────────────────────
  VP_ROWS: 100,              // 100 price buckets = sharp resolution

  // Value Area: 70% of session volume defines VAL (bottom) and VAH (top).
  // Together they bracket the fair-value zone for the session.
  VALUE_AREA_PCT: 0.70,

  // ── Fibonacci ───────────────────────────────────────────────────────────
  // Entry pocket: 60–80% of swing range (contains both 61.8% and 78.6%).
  FIB_ZONE_LOW:  0.60,
  FIB_ZONE_HIGH: 0.80,

  // ── Confluence engine ───────────────────────────────────────────────────
  // Tolerance = ATR × CONFLUENCE_ATR_MULT.
  // A Fib level within this band of POC/VAH/VAL is a confluence hit.
  // UNCHANGED — same strictness as the 1H version.
  CONFLUENCE_ATR_MULT: 0.5,

  // 4H zone cross-check: entry price must be within this many ATRs of
  // a 4H structural level (4H POC, VAH, VAL, or key Fib) to pass.
  // v8.5: loosened 1.5 → 2.5 — was too tight on 1hour candles, was choking
  // off otherwise-valid signals.
  HTFZONE_ATR_MULT: 2.5,

  // ── Rejection candle (2-of-4 rule) ──────────────────────────────────────
  // Patterns: POC_RECLAIM, PIN_BAR, ENGULFING, CLOSE_REJECTION
  // Signal fires if ≥ REJECTION_MIN_PATTERNS match. UNCHANGED.
  REJECTION_MIN_PATTERNS: 2,

  // ── Absorption veto ─────────────────────────────────────────────────────
  // body/range > this ratio → directional absorption candle.
  // Bullish absorption vetoes SELL; bearish absorption vetoes BUY. UNCHANGED.
  ABSORPTION_BODY_RATIO: 0.60,

  // ── Zone invalidation ───────────────────────────────────────────────────
  // Zone void after price CLOSES beyond zone ref by > ATR × this multiplier.
  // UNCHANGED.
  ZONE_INVALIDATION_ATR_MULT: 1.0,

  // ── Signal cooldown ─────────────────────────────────────────────────────
  // Suppress re-alert on same zone+direction for N bars after firing.
  // 5 bars on 1hour = 5 real hours — SAME real-world cooldown window as
  // the 20-bar setting on 15min.
  SIGNAL_COOLDOWN_BARS: 5,

  // ── ATR ─────────────────────────────────────────────────────────────────
  ATR_PERIOD: 14,

  // ── Risk management ─────────────────────────────────────────────────────
  SL_ATR_MULT: 0.25,   // SL = swing wick ± 0.25 × ATR
  // TP1 = 50% Fib (close 50% of position)
  // TP2 = POC of entry session (runner)
  // TP3 = VAH (BUY runner) or VAL (SELL runner) — full pillar exit

  // ── Surgical filter R:R thresholds ──────────────────────────────────────
  // v8.8 REVERT: was loosened 0.65→0.35 to admit 61.8% Fib entries, but the
  // 720-day/96-trade backtest shows this split the trade population sharply
  // bimodal by rr1: a ~0.65 cluster (46 trades, 41% BE rate, 85% real WR)
  // from shallow 61.8% entries, vs a ~1.3 cluster (50 trades, 14% BE rate,
  // 93% real WR) from deeper 78.6% entries — because SL is swing-wick
  // anchored (fixed) while TP1 is the fixed 50% level, so rr1 only tracks
  // entry depth. The 61.8% cluster wasn't producing more real losses, just
  // far more breakeven scratches (capital tied up ~200 bars for 0R). Setting
  // MIN_RR1 to 1.0 sits in the clean gap between the two clusters (0.66–1.23)
  // and removes the weak shallow-entry population without touching the
  // strong deep-entry one. Re-tune from data if a future backtest shifts
  // these clusters.
  MIN_RR1: 1.0,    // TP1 must be ≥ 1.0R
  MIN_RR2: 0.50,   // TP2 must be ≥ 0.50R (rr2 is continuous, no bimodal split — left as-is)

  // ── KuCoin API ──────────────────────────────────────────────────────────
  BASE_URL: 'https://api.kucoin.com/api/v1',

};
