/**
 * MVS — Monthly Value Sniper v9.0
 * KuCoin API Configuration for Ghana
 *
 * FOUNDATION: POC + VAH + VAL + FIBO (all 6 levels). Nothing else.
 * TIMEFRAMES:  4H bias gate → 1hour entry candles, scanned every 15min.
 * SYMBOLS:     8 liquid pairs — ETH, SOL, BTC, XRP, ADA, DOGE, AVAX, LINK
 *              repo is PUBLIC — GitHub Actions minutes are unlimited and free.
 *
 * NO lagging indicators. Every parameter here is structural price/volume data.
 *
 * v8.9 SIGNAL-FREQUENCY IMPROVEMENTS (100% WR target maintained):
 *  ─ TP restructure: TP1 = dynamic 1.2R floor (was fixed 50%Fib).
 *    Root cause: MIN_RR1=1.0 was blocking 80% of valid rejection setups
 *    because TP1=50%Fib is geometrically tiny at 61.8%Fib entries (rr1≈0.31).
 *    Now TP1 = max(50%Fib, entry + 1.2×risk). TP2 = structural 50%Fib.
 *    TP3 = VAH/VAL. Entry filter foundation completely unchanged.
 *  ─ CONFLUENCE_ATR_MULT: 0.5 → 0.65 — 64-71% of nearZone bars were dying
 *    at confluence; modest widening keeps quality while admitting more setups.
 *  ─ HTFZONE_ATR_MULT: 2.5 → 3.0 — 4H zone check widened slightly.
 *
 * v9.0 CALIBRATION (backtest funnel analysis — 720d / 8 pairs):
 *  ─ POC_RECLAIM_SOLO: new flag. When true, a single POC_RECLAIM pattern at
 *    an A1 Golden Zone + HTF-aligned bar fires the signal (no 2nd pattern
 *    needed). POC_RECLAIM = institutions defending the most-traded price with
 *    body conviction — highest-quality single pattern. Default OFF.
 *  ─ PAIR_MIN_TP2_RR: per-pair TP2 RR floor override. ADA and DOGE lose 56–67%
 *    of rejection-confirmed setups at the RR filter — their tighter ranges
 *    mean the 50%Fib is geometrically closer to entry. Lowered to 0.35R for
 *    these two pairs only. All other pairs keep 0.50R. Foundation unchanged.
 *  ─ SELL_HTF_MULT_BOOST: SELL setups have better WR (86%) and R (+14.21R)
 *    than BUY (74% / +13.84R) but BEARISH bars outnumber BULLISH 56k vs 49k
 *    yet trade counts are nearly equal — SELL signals are being over-filtered
 *    by htfAligned. A 10% tolerance boost on SELL direction only recovers
 *    blocked SELL setups without loosening BUY quality.
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
  // v9.1: expanded from 8 → 13 liquid pairs to add signal frequency without
  // touching any gate logic — same POC/VAH/VAL/Fib + 4H-bias + rejection +
  // R:R rules apply identically to every symbol. More markets scanned ≠
  // looser filter. New adds chosen for KuCoin spot liquidity/volume depth
  // comparable to the existing 8: BNB, MATIC (POL), DOT, LTC, TRX.
  SYMBOLS: [
    'ETH-USDT', 'SOL-USDT', 'BTC-USDT', 'XRP-USDT',
    'ADA-USDT', 'DOGE-USDT', 'AVAX-USDT', 'LINK-USDT',
    'BNB-USDT', 'DOT-USDT', 'LTC-USDT', 'TRX-USDT', 'MATIC-USDT'
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
  // v8.9: widened 0.5 → 0.65. The nearZone → confluenceOk gate was losing
  // 64-71% of candidates; modest widening admits more genuine setups while
  // all other structural gates (4H bias, rejection, RR) remain intact.
  CONFLUENCE_ATR_MULT: 0.65,

  // 4H zone cross-check: entry price must be within this many ATRs of
  // a 4H structural level (4H POC, VAH, VAL, or key Fib) to pass.
  // v8.9: widened 2.5 → 3.0 (was 1.5 in v8.4, loosened to 2.5 in v8.5).
  HTFZONE_ATR_MULT: 3.0,

  // ── Rejection candle (2-of-4 rule) ──────────────────────────────────────
  // Patterns: POC_RECLAIM, PIN_BAR, ENGULFING, CLOSE_REJECTION
  // Signal fires if ≥ REJECTION_MIN_PATTERNS match. Default stays 2
  // (the validated v9.0 baseline: 79.8% WR / 5.99 PF over 720d/8 pairs).
  // Frequency test: set REJECTION_MIN_PATTERNS=1 env var to test allowing
  // any single pattern through (POC_RECLAIM_SOLO already proved one strong
  // pattern can suffice in isolation — this generalizes it to all 4).
  // ALL other gates (4H bias, confluence, HTF zone, RR, absorption veto)
  // stay fully active regardless of this value — only this threshold moves.
  // Validate via backtest before ever flipping the live default.
  REJECTION_MIN_PATTERNS: parseInt(process.env.REJECTION_MIN_PATTERNS, 10) || 2,

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

  // v8.10: 1% → 1.5% risk per trade. Backtest max drawdown was only 1.0%
  // at 1% risk, so there is structural headroom. Confirm with 3 months of
  // live data before pushing beyond 2%.
  RISK_PER_TRADE_PCT: 1.5,

  // v8.10: Conservative 0.1% slippage/spread assumption on entry+exit.
  // KuCoin limit orders rarely slip, but DOGE/ADA spreads can widen during
  // volatility. This keeps the equity sim honest.
  SLIPPAGE_PCT: 0.001,

  // v8.10: POC confluence gate. POC_RECLAIM entries with weak Fib alignment
  // (confluenceScore=1) are the only category that produced hard SL losses.
  // Requiring score>=2 at POC entries means the Fib level must sit TIGHTLY
  // on top of POC (within 0.5×ATR), not just loosely near it (within 1×ATR).
  // VAH/VAL entries are exempt — they are cleaner boundary levels.
  MIN_CONFLUENCE_POC: 2,

  // ── TP structure (v8.9 restructure) ─────────────────────────────────────
  // Previous problem: TP1=fixed 50%Fib caused MIN_RR1=1.0 to block 80% of
  // valid setups. At a 61.8%Fib entry, 50%Fib is only 0.31R away — nowhere
  // near 1.0R. The 78.6%Fib entry cluster naturally hits 1.3R, which is why
  // all 51 fired trades in the 720-day backtest had rr1≈1.25-1.31 (one cluster).
  //
  // v8.9 fix: TP1 is now dynamic = max(50%Fib, entry + TP1_RR_FLOOR × risk)
  // This guarantees at least 1.2R on the first target regardless of entry depth.
  // TP2 = structural 50%Fib (the proper equilibrium exit — was TP1 before).
  // TP3 = VAH/VAL (full value-area runner — was TP2 before).
  // Entry logic, SL anchor, and ALL structural gates are completely unchanged.
  TP1_RR_FLOOR: 1.2,   // TP1 = max(50%Fib, entry + 1.2×risk)
  MIN_TP2_RR:   0.5,   // TP2 (50%Fib) must still be ≥ 0.5R from entry

  // ── v9.0: POC_RECLAIM solo gate ─────────────────────────────────────────
  // When true: a single POC_RECLAIM pattern at an A1 Golden Zone + HTF-aligned
  // bar is enough to fire a signal (REJECTION_MIN_PATTERNS overridden to 1
  // for this pattern only). POC_RECLAIM is the highest-conviction single
  // pattern — institutions reclaiming the most-traded price with body conviction.
  // All other gates (4H bias, confluence, HTF zone, RR, absorption veto)
  // remain fully active. Set false to keep the strict 2-of-4 rule for all.
  POC_RECLAIM_SOLO: true,

  // ── v9.0: Per-pair TP2 RR floor overrides ───────────────────────────────
  // Funnel analysis showed ADA and DOGE lose 56–67% of rejection-confirmed
  // setups at the RR gate because their tighter price ranges place the 50%Fib
  // closer to entry geometrically, even on valid structural setups.
  // Override MIN_TP2_RR per symbol here. Pairs not listed use MIN_TP2_RR (0.5).
  // All structural entry gates are completely unchanged.
  PAIR_MIN_TP2_RR: {
    'ADA-USDT':  0.35,
    'DOGE-USDT': 0.35,
  },

  // ── v9.0: SELL direction HTF zone tolerance boost ───────────────────────
  // SELL setups show 86% WR vs 74% BUY and +14.21R vs +13.84R BUY, yet
  // BEARISH 4H bars (56,190) outnumber BULLISH (48,893) while trade counts
  // are nearly equal (42 SELL vs 47 BUY). SELL signals are being suppressed
  // more than BEAR market structure warrants by the htfAligned check.
  // A 10% tolerance multiplier on SELL direction only (HTFZONE_ATR_MULT ×
  // SELL_HTF_MULT_BOOST) recovers blocked SELL setups without touching BUY
  // quality. Set to 1.0 to disable (no boost).
  SELL_HTF_MULT_BOOST: 1.10,

  // ── KuCoin API ──────────────────────────────────────────────────────────
  BASE_URL: 'https://api.kucoin.com/api/v1',

};
