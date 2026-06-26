/**
 * MVS — Monthly Value Sniper v8.0
 * KuCoin API Configuration for Ghana
 *
 * FOUNDATION: POC + VAH + VAL + FIBO (all 6 levels). Nothing else.
 * TIMEFRAMES:  4H bias gate → 1H entry.
 * SYMBOLS:     SOL-USDT only.
 *
 * NO lagging indicators. Every parameter here is structural price/volume data.
 */

module.exports = {

  // ── Telegram ────────────────────────────────────────────────────────────
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID:   process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE',

  // ── Assets ──────────────────────────────────────────────────────────────
  SYMBOLS: ['SOL-USDT'],

  // ── Timeframes ──────────────────────────────────────────────────────────
  TIMEFRAME:      '1hour',   // entry timeframe
  BIAS_TIMEFRAME: '4hour',   // higher-timeframe bias

  // ── Scan Frequency ──────────────────────────────────────────────────────
  SCAN_CRON: '*/30 * * * *',

  // ── Data lookbacks ──────────────────────────────────────────────────────
  VP_LOOKBACK:        500,   // 1H bars for volume profile  (≈ 21 days)
  BIAS_LOOKBACK:      200,   // 4H bars for bias module     (≈ 33 days)
  FIB_LOOKBACK:       200,   // 1H bars for swing detection (≈ 8 days)
  BIAS_FIB_LOOKBACK:   60,   // 4H bars for bias swing      (≈ 10 days — same calendar window as 1H)

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
  CONFLUENCE_ATR_MULT: 0.5,

  // 4H zone cross-check: 1H entry price must be within this many ATRs of
  // a 4H structural level (4H POC, VAH, VAL, or key Fib) to pass.
  // Uses 1H ATR for the tolerance band (same scale as entry).
  HTFZONE_ATR_MULT: 1.5,

  // ── Rejection candle (2-of-3 rule) ──────────────────────────────────────
  // Patterns: POC_RECLAIM, PIN_BAR, ENGULFING, CLOSE_REJECTION
  // Signal fires if ≥ REJECTION_MIN_PATTERNS match
  REJECTION_MIN_PATTERNS: 2,

  // ── Absorption veto ─────────────────────────────────────────────────────
  // body/range > this ratio → directional absorption candle.
  // Bullish absorption vetoes SELL; bearish absorption vetoes BUY.
  ABSORPTION_BODY_RATIO: 0.60,

  // ── Zone invalidation ───────────────────────────────────────────────────
  // Zone void after price CLOSES beyond zone ref by > ATR × this multiplier.
  // Raised from 0.5 → 1.0 to avoid killing setups on single volatile candles.
  ZONE_INVALIDATION_ATR_MULT: 1.0,

  // ── Signal cooldown ─────────────────────────────────────────────────────
  // Suppress re-alert on same zone+direction for N bars after firing.
  // Raised from 3 → 5 to avoid flipping on valid re-tests while
  // still catching the next swing.
  SIGNAL_COOLDOWN_BARS: 5,

  // ── ATR ─────────────────────────────────────────────────────────────────
  ATR_PERIOD: 14,

  // ── Risk management ─────────────────────────────────────────────────────
  SL_ATR_MULT: 0.25,   // SL = swing wick ± 0.25 × ATR
  // TP1 = 50% Fib (close 50% of position)
  // TP2 = POC of entry session (runner)
  // TP3 = VAH (BUY runner) or VAL (SELL runner) — full pillar exit

  // ── KuCoin API ──────────────────────────────────────────────────────────
  BASE_URL: 'https://api.kucoin.com/api/v1',

};
