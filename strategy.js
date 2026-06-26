/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — MONTHLY VALUE SNIPER v7.1
 *  "If it doesn't reject the monthly anchor, it's not a trade."
 *  By Abdin
 *
 *  KUCOIN API EDITION — FOR GHANA
 *
 *  CORE PILLARS (UNCHANGED):
 *  ┌───────────────────────────────────────────────────────────────────┐
 *  │  1. POC  → Point of Control (daily-anchored volume magnet)       │
 *  │  2. VAL  → Value Area Low (70% cumulative — defender line)       │
 *  │  3. FIBO → ALL 6 levels: 23.6 / 38.2 / 50 / 61.8 / 78.6 / 88.6 │
 *  └───────────────────────────────────────────────────────────────────┘
 *
 *  v7.1 FIXES APPLIED ON TOP OF v7.0:
 *  ✅ True EMA(50) trend filter — blocks counter-trend BUY/SELL
 *  ✅ Body-engulfing rule (was full-engulf, almost never fired on 1H)
 *  ✅ VP fallback widened 24→48 bars (stabilizes early-UTC-session POC)
 *  ✅ Early zone-proximity short-circuit (perf only, same gate as before)
 *  ✅ ema50/trendAligned now recorded in diag.log.json
 *
 *  v7 FIXES (CARRIED OVER):
 *  ✅ ATR-relative confluence tolerance (replaces fixed 0.5%)
 *  ✅ Fib entry zone 60–80% pocket (replaces discrete 61.8/78.6 lines)
 *  ✅ 2-of-3 rejection patterns (replaces all-or-nothing gate)
 *  ✅ Daily-anchored POC/VAL (replaces rolling window — freezes until invalidated)
 *  ✅ ATR-based SL + explicit TP1/TP2 in every alert
 *  ✅ Directional absorption veto (bullish absorption vetoes SELL only)
 *  ✅ Zone invalidation after ATR×0.5 close-through
 *  ✅ Per-signal cooldown (1 signal per zone per direction)
 *  ✅ Per-bar diagnostic log (D4_pass, A1_pass, patterns, fired)
 * ═══════════════════════════════════════════════════════════════════════
 */

const axios      = require('axios');
const fs         = require('fs');
const path       = require('path');
const TelegramBot = require('node-telegram-bot-api');
const config     = require('./config');

const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });

// ── Persistence ──────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, 'state.json');
const LOG_FILE   = path.join(__dirname, 'signals.log.json');
const DIAG_FILE  = path.join(__dirname, 'diag.log.json');

const loadJSON = (file, fallback) => {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return fallback; }
};

const saveState = (symbol, data) => {
  const state = loadJSON(STATE_FILE, {});
  state[symbol] = { ...data, updatedAt: new Date().toISOString() };
  state._lastRunAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

const logSignal = (symbol, entry) => {
  const log = loadJSON(LOG_FILE, []);
  log.push({ symbol, ...entry, time: new Date().toISOString() });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log.slice(-500), null, 2));
};

/**
 * Per-bar diagnostic log — enables offline tuning.
 * Fields: symbol, barTime, price, atr, poc, val,
 *         fibZoneLow, fibZoneHigh, D4_pass, A1_pass,
 *         patterns[], absorptionVeto, cooldown, fired
 */
const logDiag = (entry) => {
  const log = loadJSON(DIAG_FILE, []);
  log.push({ ...entry, ts: new Date().toISOString() });
  fs.writeFileSync(DIAG_FILE, JSON.stringify(log.slice(-2000), null, 2));
};

// ─────────────────────────────────────────────────────────────────────────
//  SECTION 1: DATA FETCH
// ─────────────────────────────────────────────────────────────────────────

const getKlines = async (symbol, interval, limit) => {
  const url = `${config.BASE_URL}/market/candles?symbol=${symbol}&type=${interval}`;
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.data.code !== '200000') {
      console.error(`  ❌ KuCoin API error: ${res.data.code} — ${res.data.msg || 'Unknown'}`);
      return [];
    }
    const sorted = (res.data.data || []).reverse();
    return sorted.slice(-limit).map(k => ({
      time:   parseInt(k[0]),
      open:   parseFloat(k[1]),
      close:  parseFloat(k[2]),
      high:   parseFloat(k[3]),
      low:    parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
  } catch (e) {
    console.error(`  ❌ KuCoin fetch error for ${symbol}:`, e.message);
    return [];
  }
};

// ─────────────────────────────────────────────────────────────────────────
//  SECTION 2: ATR (Average True Range)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Calculate ATR(period) — Wilder smoothing.
 * Used for: confluence tolerance, SL distance, zone invalidation.
 */
const calcATR = (data, period = config.ATR_PERIOD) => {
  if (data.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < data.length; i++) {
    const c = data[i], p = data[i - 1];
    trs.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low  - p.close)
    ));
  }
  // Simple average for first ATR
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
};

// ─────────────────────────────────────────────────────────────────────────
//  SECTION 2B: EMA — Trend Filter (v7.1)
// ─────────────────────────────────────────────────────────────────────────

/**
 * True exponential moving average (not a flat average).
 * Seeded with an SMA of the first `period` bars, then EMA-smoothed forward.
 */
const calcEMA = (data, period = config.EMA_TREND_PERIOD) => {
  if (data.length < period) return null;
  const closes = data.map(d => d.close);
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
};

// ─────────────────────────────────────────────────────────────────────────
//  SECTION 3: FIBONACCI — All 6 Levels
// ─────────────────────────────────────────────────────────────────────────

/**
 * All 6 Fibonacci levels from swing high/low.
 *
 *  23.6% & 38.2% → Momentum gauge only (NOT entry)
 *  50.0%         → TP1 (primary take-profit)
 *  61.8%–78.6%   → Entry zone pocket (see FIB_ZONE_LOW / FIB_ZONE_HIGH)
 *  88.6%         → SL anchor (structural invalidation)
 */
const calcFib = (high, low) => {
  const diff = high - low;
  return {
    level236: high - diff * 0.236,
    level382: high - diff * 0.382,
    level500: high - diff * 0.500,  // TP1
    level618: high - diff * 0.618,
    level786: high - diff * 0.786,
    level886: high - diff * 0.886,  // SL anchor
    // Entry zone as a price range (60–80% pocket)
    zoneHigh: high - diff * config.FIB_ZONE_LOW,   // 60% = upper bound of pocket
    zoneLow:  high - diff * config.FIB_ZONE_HIGH,  // 80% = lower bound of pocket
  };
};

// ─────────────────────────────────────────────────────────────────────────
//  SECTION 4: VOLUME PROFILE — Daily-Anchored POC & VAL
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build Volume Profile anchored to the current UTC day.
 *
 * v7 CHANGE: uses only candles from today's UTC session (00:00–now).
 * If today has < 8 bars (early session), falls back to last 24H.
 * This prevents POC from drifting bar-by-bar; zones are frozen
 * until the next UTC day begins.
 *
 * Returns {pocPrice, valPrice, maxVol, totalVol, barCount}
 */
const calcPOCandVAL = (data, rows = config.VP_ROWS) => {
  // ── Anchor: current UTC day (or last 24H fallback) ──
  const nowMs = Date.now();
  const startOfDayMs = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  const sessionBars = data.filter(d => d.time * 1000 >= startOfDayMs);
  const workingBars = sessionBars.length >= 8 ? sessionBars : data.slice(-48);

  if (workingBars.length < 4) return null;

  const high = Math.max(...workingBars.map(d => d.high));
  const low  = Math.min(...workingBars.map(d => d.low));
  const range = high - low;
  if (range === 0 || !isFinite(range)) return null;

  const rowSize = range / rows;
  const bins    = {};

  workingBars.forEach(d => {
    const price = (d.high + d.low) / 2;
    const idx   = Math.min(Math.floor((price - low) / rowSize), rows - 1);
    bins[idx]   = (bins[idx] || 0) + d.volume;
  });

  let maxVol = 0, pocPrice = low, totalVol = 0;
  const volArr = [];

  for (let i = 0; i < rows; i++) {
    const v = bins[i] || 0;
    volArr.push(v);
    totalVol += v;
    if (v > maxVol) {
      maxVol   = v;
      pocPrice = low + (i + 0.5) * rowSize;
    }
  }

  // VAL: 70% cumulative volume from bottom
  const targetVol = totalVol * 0.70;
  let cumVol = 0, valPrice = low;
  for (let i = 0; i < rows; i++) {
    cumVol += volArr[i];
    if (cumVol >= targetVol) {
      valPrice = low + (i + 0.5) * rowSize;
      break;
    }
  }

  return { pocPrice, valPrice, maxVol, totalVol, barCount: workingBars.length };
};

// ─────────────────────────────────────────────────────────────────────────
//  SECTION 5: CONFLUENCE ENGINE — ATR-Relative Tolerance
// ─────────────────────────────────────────────────────────────────────────

/**
 * Score confluence between a Fib level and a volume pivot (POC or VAL).
 *
 * v7 CHANGE: tolerance = ATR × CONFLUENCE_ATR_MULT (not fixed 0.5%).
 * Returns a score 0–2:
 *   2 = within 0.5× tolerance (tight confluence — high probability)
 *   1 = within 1× tolerance   (acceptable confluence)
 *   0 = outside tolerance     (no confluence)
 */
const confluenceScore = (fibLevel, pivot, atr) => {
  if (!pivot || !fibLevel || !atr || !isFinite(pivot) || !isFinite(fibLevel)) return 0;
  const tol  = atr * config.CONFLUENCE_ATR_MULT;
  const dist = Math.abs(fibLevel - pivot);
  if (dist <= tol * 0.5) return 2;
  if (dist <= tol)       return 1;
  return 0;
};

// ─────────────────────────────────────────────────────────────────────────
//  SECTION 6: REJECTION DETECTOR — 2-of-3 Pattern Rule
// ─────────────────────────────────────────────────────────────────────────

/**
 * Detect rejection at a confluence zone using 2-of-3 pattern scoring.
 *
 * v7 PATTERNS:
 *  1. PIN_BAR         — Long wick (> 1.5× body) into zone
 *  2. ENGULFING       — Body fully engulfs prior candle
 *  3. CLOSE_REJECTION — Candle entered zone but closed OUTSIDE it
 *     (wicked in, was rejected, closed back — clean sweep)
 *
 * v7 ABSORPTION VETO (directional only):
 *  • High-vol bullish close (body > 60%, close near high) vetoes SELL only
 *  • High-vol bearish close (body > 60%, close near low)  vetoes BUY only
 *
 * Returns {valid, patterns[], absorptionVeto, score}
 */
const detectRejection = (candles, zoneLow, zoneHigh, direction) => {
  if (candles.length < 2) return { valid: false, patterns: [], absorptionVeto: false, score: 0 };

  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];

  // Must have touched the zone
  const touchedZone = c.low <= zoneHigh && c.high >= zoneLow;
  if (!touchedZone) return { valid: false, patterns: [], absorptionVeto: false, score: 0 };

  const body       = Math.abs(c.close - c.open);
  const fullRange  = c.high - c.low;
  const bodyRatio  = fullRange > 0 ? body / fullRange : 0;

  // ── Directional absorption veto ──
  let absorptionVeto = false;
  if (bodyRatio > config.ABSORPTION_BODY_RATIO) {
    const bullishClose = c.close > c.open;
    if (direction === 'SELL' && bullishClose)  absorptionVeto = true;
    if (direction === 'BUY'  && !bullishClose) absorptionVeto = true;
  }

  const patterns = [];

  if (direction === 'BUY') {
    // 1. Pin bar: lower wick > 1.5× body
    const lowerWick = Math.min(c.open, c.close) - c.low;
    if (lowerWick > body * 1.5 && body > 0) patterns.push('PIN_BAR');

    // 2. Bullish body-engulfing (close > prior close, open < prior open, direction-correct)
    if (c.close > c.open && c.close > p.close && c.open < p.open) patterns.push('ENGULFING');

    // 3. Close rejection: wick went into zone, closed above zone
    if (c.low <= zoneHigh && c.close > zoneHigh) patterns.push('CLOSE_REJECTION');

  } else {
    // 1. Pin bar: upper wick > 1.5× body
    const upperWick = c.high - Math.max(c.open, c.close);
    if (upperWick > body * 1.5 && body > 0) patterns.push('PIN_BAR');

    // 2. Bearish body-engulfing (close < prior close, open > prior open, direction-correct)
    if (c.close < c.open && c.close < p.close && c.open > p.open) patterns.push('ENGULFING');

    // 3. Close rejection: wick went into zone, closed below zone
    if (c.high >= zoneLow && c.close < zoneLow) patterns.push('CLOSE_REJECTION');
  }

  const score = patterns.length;
  const valid = !absorptionVeto && score >= config.REJECTION_MIN_PATTERNS;

  return { valid, patterns, absorptionVeto, score };
};

// ─────────────────────────────────────────────────────────────────────────
//  SECTION 7: ZONE INVALIDATION CHECK
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns true if price has closed THROUGH the zone by > ATR × mult.
 * When invalidated, the zone is discarded and no signal is fired.
 */
const isZoneInvalidated = (closePrice, zoneRef, atr, direction) => {
  const margin = atr * config.ZONE_INVALIDATION_ATR_MULT;
  if (direction === 'BUY'  && closePrice < zoneRef - margin) return true;
  if (direction === 'SELL' && closePrice > zoneRef + margin) return true;
  return false;
};

// ─────────────────────────────────────────────────────────────────────────
//  SECTION 8: SIGNAL COOLDOWN
// ─────────────────────────────────────────────────────────────────────────

/**
 * Enforce 1 signal per zone per direction.
 * Checks state.json for last B-signal on this symbol.
 * Returns true if we should suppress (cooldown active).
 */
const isCoolingDown = (symbol, direction, currentBarTime) => {
  const state = loadJSON(STATE_FILE, {});
  const s = state[symbol];
  if (!s || !s.lastSignalBar || !s.lastSignalDir) return false;
  if (s.lastSignalDir !== direction) return false;
  const barsSince = Math.round((currentBarTime - s.lastSignalBar) / 3600);
  return barsSince < config.SIGNAL_COOLDOWN_BARS;
};

// ─────────────────────────────────────────────────────────────────────────
//  SECTION 9: MAIN STRATEGY ENGINE
// ─────────────────────────────────────────────────────────────────────────

const runStrategy = async (symbol) => {
  const now = new Date().toISOString();
  console.log(`\n[${now}] 🔍 MVS v7.0 scanning ${symbol}...`);

  // ── ALWAYS stamp _lastRunAt so /health never shows "never" ──
  // This must happen before any early return so the health check reflects
  // the actual last time the workflow ran, even if no signal was generated.
  {
    const state = loadJSON(STATE_FILE, {});
    state._lastRunAt = now;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  try {
    // ── 1. FETCH ──────────────────────────────────────────────
    const data = await getKlines(symbol, config.TIMEFRAME, config.VP_LOOKBACK);
    if (data.length < 50) {
      console.log(`  ⚠️ Insufficient data (${data.length} bars). Skipping.`);
      return;
    }

    const current  = data[data.length - 1];
    const price    = current.close;
    const barTime  = current.time;

    // ── 2. ATR ────────────────────────────────────────────────
    const atr = calcATR(data);
    if (!atr) {
      console.log(`  ⚠️ ATR calculation failed. Skipping.`);
      return;
    }

    // ── 3. FIBONACCI (200-bar swing) ──────────────────────────
    const fibData = data.slice(-config.FIB_LOOKBACK);
    const swing = {
      high: Math.max(...fibData.map(d => d.high)),
      low:  Math.min(...fibData.map(d => d.low))
    };

    // A2: Structural remap — price broke the 200-bar swing
    if (price > swing.high || price < swing.low) {
      console.log(`  🔄 A2 STRUCTURAL REMAP: ${symbol} broke 200-bar swing.`);
      saveState(symbol, { signal: 'A2_REMAP', price, swingHigh: swing.high, swingLow: swing.low });
      logSignal(symbol, { signal: 'A2_REMAP', price });
      await bot.sendMessage(config.TELEGRAM_CHAT_ID,
        `🔄 *[${symbol}] A2 — Structural Remap*\n\nPrice broke the 200-bar swing.\nAll previous zones are VOID.\nRecalculating next scan.\n⏰ ${new Date().toUTCString()}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const fib     = calcFib(swing.high, swing.low);
    const midPoint = (swing.high + swing.low) / 2;
    const direction = price > midPoint ? 'BUY' : 'SELL';

    // ── 3B. TREND FILTER (v7.1) — true EMA gate ───────────────
    // Only take BUY above the trend EMA, SELL below it.
    // This is the single biggest lever for cutting counter-trend losses.
    const ema50 = calcEMA(data);
    const trendAligned = ema50 === null
      ? true // not enough data to judge trend — don't block on a null
      : (direction === 'BUY' ? price >= ema50 : price <= ema50);

    if (!trendAligned) {
      console.log(`  ⛔ TREND FILTER: ${direction} rejected — price $${price.toFixed(2)} vs EMA${config.EMA_TREND_PERIOD} $${ema50.toFixed(2)}.`);
      logDiag({
        symbol, barTime, price,
        ema50: ema50.toFixed(2),
        trendAligned: false,
        D4_pass: null, A1_pass: null, fired: false,
        reason: 'TREND_FILTER_BLOCKED'
      });
      return;
    }

    // D4: Over-extended — price beyond 88.6%
    const D4_pass = !(
      (direction === 'BUY'  && price < fib.level886) ||
      (direction === 'SELL' && price > fib.level886)
    );
    if (!D4_pass) {
      console.log(`  ⏭️ D4 OVER-EXTENDED: Beyond 88.6%. No setup.`);
      logDiag({ symbol, barTime, price, atr: atr.toFixed(4), ema50: ema50 ? ema50.toFixed(2) : null, trendAligned, D4_pass, A1_pass: false, fired: false, reason: 'D4_OVER_EXTENDED' });
      return;
    }

    // ── 3C. EARLY ZONE-PROXIMITY CHECK (perf only — not a correctness gate) ──
    // detectRejection() already enforces a touch of this same buffered zone
    // later on; this just skips the VP/confluence work early when price is
    // nowhere near the zone yet, to save compute on quiet bars.
    {
      const earlyZoneLow  = fib.zoneLow  - atr * 0.1;
      const earlyZoneHigh = fib.zoneHigh + atr * 0.1;
      if (price < earlyZoneLow - atr || price > earlyZoneHigh + atr) {
        console.log(`  ⏳ Price not yet near zone ($${fib.zoneLow.toFixed(2)}–$${fib.zoneHigh.toFixed(2)}). Waiting.`);
        return;
      }
    }

    // ── 4. VOLUME PROFILE (daily-anchored) ───────────────────
    const vp = calcPOCandVAL(data);
    if (!vp) {
      console.log(`  ⚠️ Volume Profile failed. Skipping.`);
      return;
    }
    console.log(`  📊 POC: $${vp.pocPrice.toFixed(2)} | VAL: $${vp.valPrice.toFixed(2)} | Bars used: ${vp.barCount}`);
    console.log(`  📐 ATR(14): $${atr.toFixed(2)} | Direction: ${direction}`);
    console.log(`  🎯 Fib zone: $${fib.zoneLow.toFixed(2)} – $${fib.zoneHigh.toFixed(2)} (60–80% pocket)`);

    // Save baseline scan state
    saveState(symbol, {
      signal: 'SCANNED', price, poc: vp.pocPrice, val: vp.valPrice,
      swingHigh: swing.high, swingLow: swing.low, atr, direction
    });

    // ── 5. CONFLUENCE CHECK (ATR-relative) ───────────────────
    // Check the full 60–80% Fib pocket midpoint AND both discrete levels
    // against both POC and VAL. Best score wins.
    const fibMid   = (fib.zoneHigh + fib.zoneLow) / 2;
    const checkLevels = [fib.level618, fib.level786, fibMid];
    const checkPivots = [
      { name: 'POC', price: vp.pocPrice },
      { name: 'VAL', price: vp.valPrice }
    ];

    let bestScore = 0, bestFibLevel = null, bestPivot = null;

    for (const lvl of checkLevels) {
      for (const pivot of checkPivots) {
        const sc = confluenceScore(lvl, pivot.price, atr);
        if (sc > bestScore) {
          bestScore    = sc;
          bestFibLevel = lvl;
          bestPivot    = pivot;
        }
      }
    }

    const A1_pass = bestScore >= 1;

    if (!A1_pass) {
      console.log(`  ❌ No Fib/POC/VAL confluence. A3 Zone Expiry (silent).`);
      logDiag({ symbol, barTime, price, atr: atr.toFixed(4), poc: vp.pocPrice, val: vp.valPrice,
                fibZoneLow: fib.zoneLow, fibZoneHigh: fib.zoneHigh,
                D4_pass, A1_pass, fired: false, reason: 'A3_NO_CONFLUENCE' });
      return;
    }

    const fibPct = bestFibLevel === fib.level618 ? '61.8%'
                 : bestFibLevel === fib.level786 ? '78.6%'
                 : '70% mid-pocket';

    console.log(`  ✅ A1 GOLDEN ZONE (score ${bestScore}/2): Fib ${fibPct} ($${bestFibLevel.toFixed(2)}) ↔ ${bestPivot.name} ($${bestPivot.price.toFixed(2)})`);

    // ── 6. ZONE INVALIDATION CHECK ───────────────────────────
    if (isZoneInvalidated(price, bestFibLevel, atr, direction)) {
      console.log(`  ❌ ZONE INVALIDATED: Price closed through Fib zone by > ATR×${config.ZONE_INVALIDATION_ATR_MULT}.`);
      logDiag({ symbol, barTime, price, D4_pass, A1_pass, fired: false, reason: 'ZONE_INVALIDATED' });
      return;
    }

    // ── 7. SIGNAL COOLDOWN ────────────────────────────────────
    if (isCoolingDown(symbol, direction, barTime)) {
      console.log(`  ⏸️ COOLDOWN: Signal for ${direction} on ${symbol} suppressed (< ${config.SIGNAL_COOLDOWN_BARS} bars since last).`);
      logDiag({ symbol, barTime, price, D4_pass, A1_pass, fired: false, reason: 'COOLDOWN' });
      return;
    }

    // ── 8. REJECTION CANDLE (2-of-3 rule) ────────────────────
    // Zone bounds: use ATR-relative buffer around the Fib zone
    const entryZoneLow  = fib.zoneLow  - atr * 0.1;
    const entryZoneHigh = fib.zoneHigh + atr * 0.1;

    const rejection = detectRejection(data, entryZoneLow, entryZoneHigh, direction);

    logDiag({
      symbol, barTime, price,
      atr: atr.toFixed(4),
      ema50: ema50 ? ema50.toFixed(2) : null,
      trendAligned,
      poc: vp.pocPrice, val: vp.valPrice,
      fibZoneLow: fib.zoneLow, fibZoneHigh: fib.zoneHigh,
      D4_pass, A1_pass,
      confluenceScore: bestScore,
      confluenceLevel: fibPct,
      confluencePivot: bestPivot.name,
      patterns: rejection.patterns,
      absorptionVeto: rejection.absorptionVeto,
      rejectionScore: rejection.score,
      fired: rejection.valid,
      reason: rejection.valid ? 'B_SIGNAL_FIRED'
              : rejection.absorptionVeto ? 'D1_ABSORPTION_VETO'
              : `PATTERNS_${rejection.score}_OF_${config.REJECTION_MIN_PATTERNS}`
    });

    if (!rejection.valid) {
      if (rejection.absorptionVeto) {
        console.log(`  ⏳ D1 DIRECTIONAL ABSORPTION VETO: ${symbol} — ${direction} suppressed.`);
        const skipMsg = `⏳ *[${symbol}] D1 — Directional Absorption*\n\nZone touched ($${bestFibLevel.toFixed(2)}) but a ${direction === 'BUY' ? 'bearish' : 'bullish'} absorption candle appeared.\nInstitutions are absorbing against your direction. Skip.\n\n⏰ ${new Date().toUTCString()}`;
        await bot.sendMessage(config.TELEGRAM_CHAT_ID, skipMsg, { parse_mode: 'Markdown' });
      } else {
        console.log(`  ⏳ WEAK REJECTION: Only ${rejection.score}/${config.REJECTION_MIN_PATTERNS} patterns. Waiting.`);
      }
      return;
    }

    // ── 9. SL / TP CALCULATION ────────────────────────────────
    // SL: swing wick extremity ± 0.25×ATR buffer
    const swingWick = direction === 'BUY' ? swing.low  : swing.high;
    const slPrice   = direction === 'BUY'
      ? swingWick - atr * config.SL_ATR_MULT
      : swingWick + atr * config.SL_ATR_MULT;

    // TP1: 50% Fib (remove 50% of position)
    const tp1Price = fib.level500;

    // TP2: POC (runner target — re-entry magnet)
    const tp2Price = vp.pocPrice;

    const entryPrice = bestFibLevel;
    const risk   = Math.abs(entryPrice - slPrice);
    const reward1 = Math.abs(tp1Price - entryPrice);
    const reward2 = Math.abs(tp2Price - entryPrice);
    const rr1 = risk > 0 ? (reward1 / risk).toFixed(2) : 'N/A';
    const rr2 = risk > 0 ? (reward2 / risk).toFixed(2) : 'N/A';

    // ── 10. TELEGRAM ALERT ────────────────────────────────────
    const emoji     = direction === 'BUY' ? '🟢' : '🔴';
    const signalTag = direction === 'BUY' ? 'B1 — Bullish Sniper' : 'B2 — Bearish Sniper';
    const patternStr = rejection.patterns.join(' + ');

    const message = `
${emoji} *${symbol} — MVS ${signalTag}*

📊 *Direction:* ${direction}
💵 *Entry Zone:* $${entryPrice.toFixed(2)} (Fib ${fibPct})
🎯 *TP1 (50% Fib — 50% close):* $${tp1Price.toFixed(2)} | R:R ${rr1}:1
🏁 *TP2 (POC runner):* $${tp2Price.toFixed(2)} | R:R ${rr2}:1
🛑 *SL (swing wick + ATR buffer):* $${slPrice.toFixed(2)}

📈 *Confluence:* Fib ${fibPct} ↔ ${bestPivot.name} (score ${bestScore}/2)
   • POC: $${vp.pocPrice.toFixed(2)}
   • VAL: $${vp.valPrice.toFixed(2)}

🕯 *Rejection (${rejection.score}/${config.REJECTION_MIN_PATTERNS} patterns):* ${patternStr}
📐 *ATR(14):* $${atr.toFixed(2)}

⏰ *Time:* ${new Date().toUTCString()}
⚡ *MVS v7.0 — "If it doesn't reject the monthly anchor, it's not a trade."*
    `.trim();

    await bot.sendMessage(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log(`  ✅ B-SIGNAL ALERT SENT for ${symbol} | ${direction} @ $${entryPrice.toFixed(2)}`);

    saveState(symbol, {
      signal: signalTag, direction, entryPrice, tp1Price, tp2Price, slPrice,
      rr1, rr2, patterns: rejection.patterns, lastSignalBar: barTime, lastSignalDir: direction
    });
    logSignal(symbol, { signal: signalTag, direction, entryPrice, tp1Price, tp2Price, slPrice, rr1, rr2 });

  } catch (err) {
    console.error(`  ❌ Error processing ${symbol}:`, err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────────────────

console.log('✅ MVS — Monthly Value Sniper v7.1 Started');
console.log('   KuCoin API — Ghana-compatible');
console.log('   Pillars: POC (daily-anchored) + VAL + FIBO (all 6 levels)');
console.log(`   Assets: ${config.SYMBOLS.join(', ')}`);
console.log(`   Timeframe: ${config.TIMEFRAME} | VP: ${config.VP_LOOKBACK} bars | Fib: ${config.FIB_LOOKBACK} bars`);
console.log(`   Confluence: ATR-relative (${config.CONFLUENCE_ATR_MULT}×ATR14)`);
console.log(`   Rejection: ${config.REJECTION_MIN_PATTERNS}-of-3 pattern rule`);
console.log(`   By Abdin\n`);

(async () => {
  for (const sym of config.SYMBOLS) {
    await runStrategy(sym);
    // Stagger fetches to avoid rate-limit bursts
    if (config.SYMBOLS.indexOf(sym) < config.SYMBOLS.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.log('\n✅ Scan complete. Exiting.');
  process.exit(0);
})();
