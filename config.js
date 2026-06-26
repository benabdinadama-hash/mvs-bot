/**
 * MVS — Monthly Value Sniper v8.1
 * KuCoin API Configuration for Ghana
 *
 * FOUNDATION: POC + VAH + VAL + FIBO (all 6 levels). Nothing else.
 * TIMEFRAMES:  4H bias gate → 15min entry.
 * SYMBOLS:     8 liquid pairs (more opportunities, same gates — not looser gates).
 *
 * NO lagging indicators. Every parameter here is structural price/volume data.
 */

module.exports = {

  // ── Telegram ────────────────────────────────────────────────────────────
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID:   process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE',

  // ── Assets ──────────────────────────────────────────────────────────────
  // 8 liquid pairs = 8x the chances for the SAME strict gates to find a real
  // touch. This is how signal frequency goes up without lowering accuracy.
  SYMBOLS: [
    'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT',
    'BNB-USDT', 'AVAX-USDT', 'LINK-USDT', 'ADA-USDT'
  ],

  // ── Timeframes ──────────────────────────────────────────────────────────
  TIMEFRAME:      '15min',   // entry timeframe (was 1hour — finer granularity, same structure)
  BIAS_TIMEFRAME: '4hour',   // higher-timeframe bias — UNCHANGED, still the strict gate

  // Entry bar duration in seconds. MUST match TIMEFRAME above — used for
  // cooldown math (bars-since-last-signal). KuCoin bar seconds reference:
  // 1min=60, 5min=300, 15min=900, 30min=1800, 1hour=3600, 4hour=14400.
  ENTRY_BAR_SECONDS: 900,

  // ── Scan Frequency ──────────────────────────────────────────────────────
  SCAN_CRON: '*/15 * * * *',   // matches the 15min entry timeframe

  // ── Data lookbacks ──────────────────────────────────────────────────────
  // Scaled to preserve the SAME real-world calendar windows as the old
  // 1H setup — only the resolution changed, not how much history is used.
  VP_LOOKBACK:        2000,  // 15min bars for volume profile (~21 days, same as before)
  BIAS_LOOKBACK:      200,   // 4H bars for bias module        (≈ 33 days) — unchanged
  FIB_LOOKBACK:       800,   // 15min bars for swing detection (~8 days, same as before)
  BIAS_FIB_LOOKBACK:   60,   // 4H bars for bias swing         (≈ 10 days) — unchanged

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
  // UNCHANGED — same strictness as the 1H version.
  HTFZONE_ATR_MULT: 1.5,

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
  // Scaled from 5 bars on 1H (= 5 real hours) to 20 bars on 15min
  // (= 5 real hours) — SAME real-world cooldown window, not shortened.
  SIGNAL_COOLDOWN_BARS: 20,

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
