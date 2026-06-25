/**
 * MVS — Monthly Value Sniper v7.0
 * KuCoin API Configuration for Ghana
 *
 * PILLARS: POC + VAL + FIBO (all 6 levels). Nothing else.
 * TIMEFRAME: 1H only.
 * SYMBOLS: BTC-USDT, SOL-USDT (KuCoin Futures via Spot proxy)
 */

module.exports = {
  // ── Telegram ──
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID:   process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE',

  // ── Assets ──
  SYMBOLS: ['BTC-USDT', 'SOL-USDT'],

  // ── Timeframe ──
  TIMEFRAME: '1hour',

  // ── Scan Frequency ──
  SCAN_CRON: '*/30 * * * *',

  // ── Volume Profile ──
  VP_LOOKBACK: 500,   // 500 bars ≈ 21 days — institutional footprint
  VP_ROWS:     100,   // 100 rows = sharp resolution

  // ── Volume Profile anchoring ──
  // 'daily'   → POC/VAL computed fresh per UTC day (recommended)
  // 'session' → 500-bar rolling window (v6 behaviour)
  VP_ANCHOR: 'daily',

  // ── Fibonacci ──
  FIB_LOOKBACK: 200,  // 200 bars ≈ 8+ days of swing structure

  // ── Confluence ──
  // v7: ATR-relative tolerance replaces fixed 0.5%.
  // CONFLUENCE_ATR_MULT × ATR(14) is used as the tolerance band.
  // Typical result: ~0.8-1.2% on BTC, proportionally scaled on SOL.
  CONFLUENCE_ATR_MULT: 0.5,   // ×ATR(14) — widens/tightens automatically

  // ── Entry zone: Fib 60–80% pocket (not just 61.8 & 78.6 discretes) ──
  FIB_ZONE_LOW:  0.60,   // 60% of swing diff from high
  FIB_ZONE_HIGH: 0.80,   // 80% of swing diff from high

  // ── Rejection candle (2-of-3 rule) ──
  // Patterns: PIN_BAR, ENGULFING, CLOSE_REJECTION
  // Signal fires if ≥ REJECTION_MIN_PATTERNS match
  REJECTION_MIN_PATTERNS: 2,

  // ── Absorption: directional veto only (v7) ──
  // HIGH_VOL_BULLISH bar only vetoes SELL signals (not BUY)
  // HIGH_VOL_BEARISH bar only vetoes BUY signals (not SELL)
  ABSORPTION_BODY_RATIO: 0.60,  // body/range > 60% = directional absorption

  // ── Zone invalidation ──
  // Zone discarded after price closes beyond it by > ATR × this multiplier
  ZONE_INVALIDATION_ATR_MULT: 0.5,

  // ── Signal cooldown ──
  // Max 1 B-signal per zone per direction; resets after TP1 or invalidation
  // Stored in state.json, enforced in runStrategy()
  SIGNAL_COOLDOWN_BARS: 3,    // suppress re-alert for 3 bars (3H) after firing

  // ── ATR period ──
  ATR_PERIOD: 14,

  // ── Risk Management (ATR-based in v7) ──
  SL_ATR_MULT:  0.25,   // SL = swing wick ± 0.25 × ATR
  TP1_LEVEL:    0.500,  // TP1 = 50% Fib (50% size close)
  TP2_LEVEL:    'poc',  // TP2 = POC level (runner)

  // ── KuCoin API ──
  BASE_URL: 'https://api.kucoin.com/api/v1',
};
