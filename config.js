/**
 * MVS — Monthly Value Sniper v6.0
 * KuCoin API Configuration for Ghana
 * 
 * IMPORTANT: KuCoin works in Ghana. Binance and Bybit do NOT.
 * 
 * KuCoin Spot API: GET /api/v1/market/candles
 * Symbol format: BTC-USDT, SOL-USDT (hyphen-separated, NOT concatenated)
 * Response format: [time, open, close, high, low, volume, turnover]
 * Max 1500 records per request (more than enough for 500-bar VP)
 * 
 * PILLARS: POC + VAL + FIBO only. Nothing else.
 */

module.exports = {
  // ── Telegram Alerts ──
  // Pulled from GitHub Secrets (env vars) when running in Actions.
  // For local laptop testing, you can temporarily hardcode here instead.
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || 'YOUR_CHAT_ID_HERE',

  // ── Assets (KuCoin format: hyphen-separated) ──
  SYMBOLS: ['BTC-USDT', 'SOL-USDT'],

  // ── Timeframe ──
  TIMEFRAME: '1hour',

  // ── Scan Frequency ──
  SCAN_CRON: '*/30 * * * *',

  // ── Volume Profile ──
  VP_LOOKBACK: 500,    // 500 bars = ~21 days. Sweet spot for institutional footprint
  VP_ROWS: 100,        // 100 rows = sharp level resolution

  // ── Fibonacci ──
  FIB_LOOKBACK: 200,   // 200 bars = ~8+ days of swing structure

  // ── Confluence ──
  CONFLUENCE_TOL: 0.5,  // 0.5% tolerance for Fib/POC/VAL overlap

  // ── Risk Management ──
  SL_BUFFER: 0.2,       // 0.2% beyond 88.6% Fib
  TP_BUFFER: 0.0,         // 0.0% — TP is EXACTLY at 50% Fib

  // ── Rejection Zone ──
  REJECTION_ZONE_BUFFER: 0.005, // 0.5% buffer around entry zone for wick detection

  // ── KuCoin API (Ghana-compatible) ──
  BASE_URL: 'https://api.kucoin.com/api/v1',

  // KuCoin rate limits: 2000 requests per 30 seconds for public endpoints
  // Our 30-min scan uses ~2 requests per scan = well within limits
};