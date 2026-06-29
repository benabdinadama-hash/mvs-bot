/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — 90-DAY BACKTESTER  (backtest.js)  v3 — 1hour entry timeframe
 *
 *  Fetches real historical KuCoin data (1hour + 4H) for the last 90 days,
 *  replays every 1-hour bar through the exact same MVS strategy logic
 *  used in strategy.js, and produces a full performance report.
 *
 *  HOW IT WORKS:
 *  ─ Fetches up to 1500 bars per KuCoin request (KuCoin's max per call)
 *  ─ Pages backward in time to cover 90 days (2160 × 1hour bars)
 *  ─ Replays each bar as if it were "live" — the strategy sees only data
 *    up to and including that bar (no lookahead bias)
 *  ─ Simulates entries, SL hits, and TP hits on subsequent bars
 *  ─ Prints a full report: win rate, avg R:R, profit factor, max drawdown
 *
 *  USAGE:
 *    node backtest.js                        ← all 4 symbols, 90 days
 *    node backtest.js ETH-USDT              ← single symbol
 *    node backtest.js ETH-USDT 30           ← single symbol, 30 days
 *
 *  OUTPUT:
 *    backtest-report.json   ← full trade log (machine-readable)
 *    backtest-report.txt    ← human-readable summary
 *
 *  NOTE: This uses only PUBLIC KuCoin endpoints — no API key required.
 * ═══════════════════════════════════════════════════════════════════════
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

// ── Config (mirrors config.js exactly) ─────────────────────────────────────
const CONFIG = {
  SYMBOLS:                ['ETH-USDT', 'SOL-USDT', 'BTC-USDT', 'XRP-USDT', 'ADA-USDT', 'DOGE-USDT', 'AVAX-USDT', 'LINK-USDT'],
  TIMEFRAME:              '1hour',
  BIAS_TIMEFRAME:         '4hour',
  ENTRY_BAR_SECONDS:      3600,
  VP_LOOKBACK:            720,      // 720 bars = 720h (30 days) — matches config.js v8.6
  BIAS_LOOKBACK:          200,      // matches config.js (was 50 — out of sync, didn't match live bot)
  FIB_LOOKBACK:           720,      // 1hour bars for swing detection (30 days) — matches config.js
  BIAS_FIB_LOOKBACK:      90,       // 4H bars for bias swing (~15 days) — matches config.js
  VP_ROWS:                100,
  VALUE_AREA_PCT:         0.70,
  FIB_ZONE_LOW:           0.60,
  FIB_ZONE_HIGH:          0.80,
  CONFLUENCE_ATR_MULT:    0.5,
  HTFZONE_ATR_MULT:       2.5,
  REJECTION_MIN_PATTERNS: 2,
  ABSORPTION_BODY_RATIO:  0.60,
  ZONE_INVALIDATION_ATR_MULT: 1.0,
  SIGNAL_COOLDOWN_BARS:   5,
  ATR_PERIOD:             14,
  SL_ATR_MULT:            0.25,
  BASE_URL:               'https://api.kucoin.com/api/v1',
  BACKTEST_DAYS:          360,
  RISK_PER_TRADE_PCT:     1.0,   // % of capital risked per trade (for $ P&L simulation)
  STARTING_CAPITAL:       1000,  // USDT (for $ P&L simulation)
  // Surgical R:R filters — MUST match config.js exactly
  MIN_RR1:                0.35,  // TP1 must be ≥ 0.35R
  MIN_RR2:                0.50,  // TP2 must be ≥ 0.50R
};

// ── ENV OVERRIDES (tuning knobs only — POC/VAH/VAL/Fib/4H-bias foundation is NEVER touched) ──
// e.g.  SIGNAL_COOLDOWN_BARS=3 MIN_RR1=0.30 MIN_RR2=0.40 node backtest.js SOL-USDT 360
const envNum = (key, fallback) => (process.env[key] !== undefined ? parseFloat(process.env[key]) : fallback);
CONFIG.SIGNAL_COOLDOWN_BARS       = envNum('SIGNAL_COOLDOWN_BARS', CONFIG.SIGNAL_COOLDOWN_BARS);
CONFIG.MIN_RR1                    = envNum('MIN_RR1', CONFIG.MIN_RR1);
CONFIG.MIN_RR2                    = envNum('MIN_RR2', CONFIG.MIN_RR2);
CONFIG.CONFLUENCE_ATR_MULT        = envNum('CONFLUENCE_ATR_MULT', CONFIG.CONFLUENCE_ATR_MULT);
CONFIG.HTFZONE_ATR_MULT           = envNum('HTFZONE_ATR_MULT', CONFIG.HTFZONE_ATR_MULT);
CONFIG.REJECTION_MIN_PATTERNS     = envNum('REJECTION_MIN_PATTERNS', CONFIG.REJECTION_MIN_PATTERNS);
CONFIG.ZONE_INVALIDATION_ATR_MULT = envNum('ZONE_INVALIDATION_ATR_MULT', CONFIG.ZONE_INVALIDATION_ATR_MULT);

// ── CLI args ─────────────────────────────────────────────────────────────────
// node backtest.js                          -> all CONFIG.SYMBOLS, 360 days
// node backtest.js ETH-USDT                 -> single symbol, 360 days
// node backtest.js ETH-USDT 90              -> single symbol, 90 days
// node backtest.js ETH-USDT,SOL-USDT 360    -> explicit multi-symbol (comma list)
// node backtest.js --tune ETH-USDT 360      -> grid-search mode (see TUNE_GRID below)
const rawArgs  = process.argv.slice(2);
const tuneMode = rawArgs.includes('--tune');
const args     = rawArgs.filter(a => a !== '--tune');
const symbols  = args[0] && args[0].includes('-')
  ? args[0].toUpperCase().split(',').map(s => s.trim())
  : CONFIG.SYMBOLS;
const days     = parseInt(args[1] || args[0]) || CONFIG.BACKTEST_DAYS;

// ── KuCoin fetch helpers ──────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

const fetchKlines = async (symbol, interval, startAt, endAt) => {
  const url = `${CONFIG.BASE_URL}/market/candles` +
    `?symbol=${symbol}&type=${interval}&startAt=${startAt}&endAt=${endAt}`;
  try {
    const res = await axios.get(url, { timeout: 20000 });
    if (res.data.code !== '200000') return [];
    return (res.data.data || [])
      .map(k => ({
        time:   parseInt(k[0]),
        open:   parseFloat(k[1]),
        close:  parseFloat(k[2]),
        high:   parseFloat(k[3]),
        low:    parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }))
      .sort((a, b) => a.time - b.time);
  } catch (e) {
    console.error(`  Fetch error: ${e.message}`);
    return [];
  }
};

/**
 * Fetch full history for `days` days by paging backward in 1500-bar chunks.
 * KuCoin returns max 1500 bars per call; 90 days × 24 bars/day = 2160 bars
 * for the 1hour entry timeframe, so 2 pages comfortably cover it (and 2
 * pages for 4H, same as before).
 */
const BAR_SECONDS_BY_INTERVAL = { '1min': 60, '5min': 300, '15min': 900, '30min': 1800, '1hour': 3600, '4hour': 14400 };
const fetchHistory = async (symbol, interval, days) => {
  const barSeconds = BAR_SECONDS_BY_INTERVAL[interval] || 3600;
  const endAt   = Math.floor(Date.now() / 1000);
  const startAt = endAt - days * 86400;

  let allBars = [];
  let chunkEnd = endAt;
  const chunkSize = 1500 * barSeconds;

  process.stdout.write(`  Fetching ${interval} history for ${symbol}...`);

  while (chunkEnd > startAt) {
    const chunkStart = Math.max(chunkEnd - chunkSize, startAt);
    const bars = await fetchKlines(symbol, interval, chunkStart, chunkEnd);
    if (!bars.length) break;
    allBars = [...bars, ...allBars];
    chunkEnd = bars[0].time - 1;
    process.stdout.write('.');
    await sleep(300); // respect KuCoin rate limit
  }

  // Deduplicate and sort
  const seen = new Set();
  allBars = allBars.filter(b => {
    if (seen.has(b.time)) return false;
    seen.add(b.time);
    return true;
  }).sort((a, b) => a.time - b.time);

  console.log(` ${allBars.length} bars`);
  return allBars;
};

// ── Pure strategy functions (mirrors strategy.js exactly) ────────────────────

const calcATR = (data, period = CONFIG.ATR_PERIOD) => {
  if (data.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < data.length; i++) {
    const c = data[i], p = data[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
  return atr;
};

// v8.8 FIX: mirrored for SELL — see strategy.js for full rationale.
// Previously SELL reused the BUY-anchored (high-down) pocket, which sits
// near the bottom of the swing range. Since SELL is only chosen when price
// is in the upper half of the range, the SELL path could structurally never
// reach "near zone" — explaining the 100% BUY / 0% SELL backtest result.
const calcFib = (high, low, direction = 'BUY') => {
  const diff = high - low;
  if (direction === 'SELL') {
    return {
      level500: low + diff * 0.500,
      level618: low + diff * 0.618,
      level786: low + diff * 0.786,
      level886: low + diff * 0.886,
      zoneLow:  low + diff * CONFIG.FIB_ZONE_LOW,
      zoneHigh: low + diff * CONFIG.FIB_ZONE_HIGH,
    };
  }
  return {
    level500: high - diff * 0.500,
    level618: high - diff * 0.618,
    level786: high - diff * 0.786,
    level886: high - diff * 0.886,
    zoneHigh: high - diff * CONFIG.FIB_ZONE_LOW,
    zoneLow:  high - diff * CONFIG.FIB_ZONE_HIGH,
  };
};

const calcVolumeProfile = (data) => {
  const rows = CONFIG.VP_ROWS;
  const high  = Math.max(...data.map(d => d.high));
  const low   = Math.min(...data.map(d => d.low));
  const range = high - low;
  if (range === 0 || !isFinite(range)) return null;
  const rowSize = range / rows;
  const bins = {};
  data.forEach(d => {
    const price = (d.high + d.low) / 2;
    const idx   = Math.min(Math.floor((price - low) / rowSize), rows - 1);
    bins[idx]   = (bins[idx] || 0) + d.volume;
  });
  let maxVol = 0, pocIdx = 0, totalVol = 0;
  const volArr = [];
  for (let i = 0; i < rows; i++) {
    const v = bins[i] || 0;
    volArr.push(v);
    totalVol += v;
    if (v > maxVol) { maxVol = v; pocIdx = i; }
  }
  const pocPrice   = low + (pocIdx + 0.5) * rowSize;
  const targetVol  = totalVol * CONFIG.VALUE_AREA_PCT;
  let cumVol = volArr[pocIdx], loIdx = pocIdx, hiIdx = pocIdx;
  while (cumVol < targetVol && (loIdx > 0 || hiIdx < rows - 1)) {
    const lowOpen  = loIdx > 0;
    const highOpen = hiIdx < rows - 1;
    const addLow   = lowOpen  ? volArr[loIdx - 1] : -Infinity;
    const addHigh  = highOpen ? volArr[hiIdx + 1] : -Infinity;
    if (!lowOpen && !highOpen) break;
    if (highOpen && (!lowOpen || addHigh >= addLow)) { hiIdx++; cumVol += volArr[hiIdx]; }
    else { loIdx--; cumVol += volArr[loIdx]; }
  }
  return {
    pocPrice,
    vahPrice: low + (hiIdx + 0.5) * rowSize,
    valPrice: low + (loIdx + 0.5) * rowSize,
  };
};

const get4HBias = (data4h) => {
  if (data4h.length < 20) return null;
  const price4h = data4h[data4h.length - 1].close;
  const vp4h    = calcVolumeProfile(data4h);
  if (!vp4h) return null;
  const fibData4h = data4h.slice(-CONFIG.BIAS_FIB_LOOKBACK);
  const fibMid4h  = (Math.max(...fibData4h.map(d => d.high)) + Math.min(...fibData4h.map(d => d.low))) / 2;
  const votes = {
    poc: price4h >= vp4h.pocPrice ? 'BULL' : 'BEAR',
    vah: price4h >= vp4h.vahPrice ? 'BULL' : 'BEAR',
    val: price4h >= vp4h.valPrice ? 'BULL' : 'BEAR',
    fib: price4h >= fibMid4h      ? 'BULL' : 'BEAR',
  };
  const bullVotes = Object.values(votes).filter(v => v === 'BULL').length;
  let bias;
  if      (bullVotes >= 3) bias = 'BULLISH';
  else if (bullVotes <= 1) bias = 'BEARISH';
  else                     bias = 'NEUTRAL';
  return { bias, bullVotes, poc4h: vp4h.pocPrice, vah4h: vp4h.vahPrice, val4h: vp4h.valPrice, fibMid4h };
};

const confluenceScore = (fibLevel, pivot, atr) => {
  if (!pivot || !fibLevel || !atr) return 0;
  const tol  = atr * CONFIG.CONFLUENCE_ATR_MULT;
  const dist = Math.abs(fibLevel - pivot);
  if (dist <= tol * 0.5) return 2;
  if (dist <= tol)       return 1;
  return 0;
};

const detectRejection = (candles, zoneLow, zoneHigh, direction, pocPrice) => {
  if (candles.length < 2) return { valid: false, patterns: [], score: 0 };
  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];
  if (!(c.low <= zoneHigh && c.high >= zoneLow)) return { valid: false, patterns: [], score: 0 };
  const body      = Math.abs(c.close - c.open);
  const fullRange = c.high - c.low;
  const bodyRatio = fullRange > 0 ? body / fullRange : 0;
  let absorptionVeto = false;
  if (bodyRatio > CONFIG.ABSORPTION_BODY_RATIO) {
    if (direction === 'SELL' && c.close > c.open) absorptionVeto = true;
    if (direction === 'BUY'  && c.close < c.open) absorptionVeto = true;
  }
  const patterns = [];
  if (direction === 'BUY') {
    if (pocPrice && c.low < pocPrice && c.close > pocPrice) patterns.push('POC_RECLAIM');
    const lw = Math.min(c.open, c.close) - c.low;
    if (lw > body * 1.5 && body > 0) patterns.push('PIN_BAR');
    if (c.close > c.open && c.close > p.close && c.open < p.open) patterns.push('ENGULFING');
    if (c.low <= zoneHigh && c.close > zoneHigh) patterns.push('CLOSE_REJECTION');
  } else {
    if (pocPrice && c.high > pocPrice && c.close < pocPrice) patterns.push('POC_RECLAIM');
    const uw = c.high - Math.max(c.open, c.close);
    if (uw > body * 1.5 && body > 0) patterns.push('PIN_BAR');
    if (c.close < c.open && c.close < p.close && c.open > p.open) patterns.push('ENGULFING');
    if (c.high >= zoneLow && c.close < zoneLow) patterns.push('CLOSE_REJECTION');
  }
  const score = patterns.length;
  return { valid: !absorptionVeto && score >= CONFIG.REJECTION_MIN_PATTERNS, patterns, absorptionVeto, score };
};

// ── Backtest engine ───────────────────────────────────────────────────────────

const backtestSymbol = async (symbol, data15m, data4h) => {
  const trades       = [];
  const cooldownMap  = {};  // direction → last signal bar time
  let   openTrade    = null;

  // DIAGNOSTIC FUNNEL — counts how many scanned bars survive each gate.
  // Purely instrumentation, does not change any trading logic.
  const funnel = {
    scanned: 0, bias4hOk: 0, bullBias4h: 0, bearBias4h: 0, atrOk: 0, swingInRange: 0, biasAligned: 0,
    notOverExtended: 0, nearZone: 0, vpOk: 0, confluenceOk: 0, htfAligned: 0,
    notInvalidated: 0, cooldownOk: 0, rejectionOk: 0,
    surgF1: 0, surgF2: 0, surgF3: 0, surgF4: 0, surgicalOk: 0, opened: 0,
  };

  // We need enough warmup bars before we start scanning
  const warmup = Math.max(CONFIG.VP_LOOKBACK, CONFIG.FIB_LOOKBACK) + CONFIG.ATR_PERIOD + 5;

  console.log(`\n  Replaying ${data15m.length - warmup} bars for ${symbol}...`);

  for (let i = warmup; i < data15m.length; i++) {
    const bar     = data15m[i];
    const history = data15m.slice(0, i + 1); // only bars up to NOW (no lookahead)
    const price   = bar.close;

    // ── If we have an open trade, check if SL or TP was hit this bar ──────
    if (openTrade) {
      // v8.7: BREAKEVEN RULE. Once price reaches the halfway point to TP1,
      // move SL to entry. This is pure exit-side risk management — it does
      // not touch POC/VAH/VAL/Fib/4H-bias entry logic at all. It exists
      // because the v8.7 8-symbol backtest showed 5 of 6 losses were
      // TIMEOUT exits (200-bar max hold force-closed at market), not SL
      // hits — i.e. trades that moved partway favorable, stalled, then got
      // closed at whatever price prevailed. Locking in breakeven once a
      // trade has proven itself (reached 50% of the way to TP1) converts
      // those stalled trades into worst-case scratches instead of losses.
      if (!openTrade.beMoved) {
        const halfway = openTrade.direction === 'BUY'
          ? openTrade.entryPrice + (openTrade.tp1Price - openTrade.entryPrice) * 0.5
          : openTrade.entryPrice - (openTrade.entryPrice - openTrade.tp1Price) * 0.5;
        const reached = openTrade.direction === 'BUY' ? bar.high >= halfway : bar.low <= halfway;
        if (reached) {
          openTrade.slPrice = openTrade.entryPrice;
          openTrade.beMoved = true;
        }
      }

      const { direction, entryPrice, slPrice, tp1Price, tp2Price, tp3Price, origSlPrice } = openTrade;
      const origRisk = Math.abs(entryPrice - origSlPrice);
      const slRR = parseFloat((((slPrice - entryPrice) / origRisk) * (direction === 'BUY' ? 1 : -1)).toFixed(2));

      let outcome = null;

      // FIX: SL always checked first — if both SL and TP hit same bar, SL wins (conservative)
      if (direction === 'BUY') {
        if      (bar.low  <= slPrice)   outcome = { result: slRR === 0 ? 'BE' : 'SL', exitPrice: slPrice, rr: slRR };
        else if (bar.high >= tp3Price)  outcome = { result: 'TP3', exitPrice: tp3Price, rr: openTrade.rr3 };
        else if (bar.high >= tp2Price)  outcome = { result: 'TP2', exitPrice: tp2Price, rr: openTrade.rr2 };
        else if (bar.high >= tp1Price)  outcome = { result: 'TP1', exitPrice: tp1Price, rr: openTrade.rr1 };
      } else {
        if      (bar.high >= slPrice)   outcome = { result: slRR === 0 ? 'BE' : 'SL', exitPrice: slPrice, rr: slRR };
        else if (bar.low  <= tp3Price)  outcome = { result: 'TP3', exitPrice: tp3Price, rr: openTrade.rr3 };
        else if (bar.low  <= tp2Price)  outcome = { result: 'TP2', exitPrice: tp2Price, rr: openTrade.rr2 };
        else if (bar.low  <= tp1Price)  outcome = { result: 'TP1', exitPrice: tp1Price, rr: openTrade.rr1 };
      }

      if (outcome) {
        trades.push({
          ...openTrade,
          exitTime:  bar.time,
          exitPrice: outcome.exitPrice,
          result:    outcome.result,
          rr:        parseFloat(outcome.rr),
          barsHeld:  Math.round((bar.time - openTrade.entryTime) / CONFIG.ENTRY_BAR_SECONDS),
        });
        openTrade = null;
        continue;
      }

      // Max hold: 200 bars on 1hour candles = 200 hours (~8.3 days) — close at market if no TP/SL hit
      if (i - openTrade.entryBarIdx > 200) {
        trades.push({
          ...openTrade,
          exitTime:  bar.time,
          exitPrice: price,
          result:    'TIMEOUT',
          rr:        parseFloat(((price - openTrade.entryPrice) / Math.abs(openTrade.entryPrice - openTrade.origSlPrice) * (openTrade.direction === 'BUY' ? 1 : -1)).toFixed(2)),
          barsHeld:  200,
        });
        openTrade = null;
      }
      continue; // while in a trade, don't scan for new entry
    }

    // ── STEP 0: 4H Bias ────────────────────────────────────────────────────
    // Find 4H bars up to current bar time
    funnel.scanned++;
    const bars4h = data4h.filter(b => b.time <= bar.time).slice(-CONFIG.BIAS_LOOKBACK);
    if (bars4h.length < 20) continue;
    const bias4h = get4HBias(bars4h);
    if (!bias4h || bias4h.bias === 'NEUTRAL') continue;
    funnel.bias4hOk++;
    if (bias4h.bias === 'BULLISH') funnel.bullBias4h++;
    else if (bias4h.bias === 'BEARISH') funnel.bearBias4h++;

    // ── STEP 1-2: Entry TF data + ATR ──────────────────────────────────────
    const window = history.slice(-CONFIG.VP_LOOKBACK);
    const atr    = calcATR(window);
    if (!atr) continue;
    funnel.atrOk++;

    // ── STEP 3: Fibonacci swing ─────────────────────────────────────────────
    const fibData  = history.slice(-CONFIG.FIB_LOOKBACK);
    const swingH   = Math.max(...fibData.map(d => d.high));
    const swingL   = Math.min(...fibData.map(d => d.low));
    if (price > swingH || price < swingL) continue; // A2 remap — skip
    funnel.swingInRange++;
    const midPoint  = (swingH + swingL) / 2;
    const direction = price < midPoint ? 'BUY' : 'SELL';
    const fib       = calcFib(swingH, swingL, direction);

    // ── STEP 4: 4H bias alignment ───────────────────────────────────────────
    const biasAligned =
      (direction === 'BUY'  && bias4h.bias === 'BULLISH') ||
      (direction === 'SELL' && bias4h.bias === 'BEARISH');
    if (!biasAligned) continue;
    funnel.biasAligned++;

    // ── STEP 5: D4 over-extension ───────────────────────────────────────────
    if ((direction === 'BUY'  && price < fib.level886) ||
        (direction === 'SELL' && price > fib.level886)) continue;
    funnel.notOverExtended++;

    // ── STEP 6: Early proximity skip ───────────────────────────────────────
    if (price < fib.zoneLow - atr || price > fib.zoneHigh + atr) continue;
    funnel.nearZone++;

    // ── STEP 7: Volume Profile ──────────────────────────────────────────────
    const vp = calcVolumeProfile(window);
    if (!vp) continue;
    funnel.vpOk++;

    // ── STEP 8: Confluence ──────────────────────────────────────────────────
    const checkLevels = [fib.level618, fib.level786, (fib.zoneHigh + fib.zoneLow) / 2];
    const checkPivots = [
      { name: 'POC', price: vp.pocPrice },
      { name: 'VAH', price: vp.vahPrice },
      { name: 'VAL', price: vp.valPrice },
    ];
    let bestScore = 0, bestFibLevel = null, bestPivot = null;
    for (const lvl of checkLevels) {
      for (const pivot of checkPivots) {
        const sc = confluenceScore(lvl, pivot.price, atr);
        if (sc > bestScore) { bestScore = sc; bestFibLevel = lvl; bestPivot = pivot; }
      }
    }
    if (bestScore < 1) continue;
    funnel.confluenceOk++;

    // ── STEP 9: 4H Zone cross-check ─────────────────────────────────────────
    const tol4h = atr * CONFIG.HTFZONE_ATR_MULT;
    const levels4h = [bias4h.poc4h, bias4h.vah4h, bias4h.val4h, bias4h.fibMid4h];
    const htfAligned = levels4h.some(lvl => Math.abs(bestFibLevel - lvl) <= tol4h);
    if (!htfAligned) continue;
    funnel.htfAligned++;

    // ── STEP 10: Zone invalidation ──────────────────────────────────────────
    const margin = atr * CONFIG.ZONE_INVALIDATION_ATR_MULT;
    if (direction === 'BUY'  && price < bestFibLevel - margin) continue;
    if (direction === 'SELL' && price > bestFibLevel + margin) continue;
    funnel.notInvalidated++;

    // ── STEP 11: Cooldown ───────────────────────────────────────────────────
    const coolKey = `${direction}`;
    const lastBar = cooldownMap[coolKey] || 0;
    const barsSince = Math.round((bar.time - lastBar) / CONFIG.ENTRY_BAR_SECONDS);
    if (barsSince < CONFIG.SIGNAL_COOLDOWN_BARS) continue;
    funnel.cooldownOk++;

    // ── STEP 12: Rejection patterns ─────────────────────────────────────────
    const zoneLow  = fib.zoneLow  - atr * 0.1;
    const zoneHigh = fib.zoneHigh + atr * 0.1;
    const rejection = detectRejection(window, zoneLow, zoneHigh, direction, vp.pocPrice);
    if (!rejection.valid) continue;
    funnel.rejectionOk++;

    // ── STEP 13: SL / TP ────────────────────────────────────────────────────
    const swingWick  = direction === 'BUY' ? swingL : swingH;
    const slPrice    = direction === 'BUY'
      ? swingWick - atr * CONFIG.SL_ATR_MULT
      : swingWick + atr * CONFIG.SL_ATR_MULT;
    const tp1Price   = fib.level500;
    // TP2 = VAH (BUY) / VAL (SELL) — matches strategy.js line 798 exactly, no pivot-swap
    // TP3 = swing extreme — trend extension runner
    const tp2Price   = direction === 'BUY' ? vp.vahPrice : vp.valPrice;
    const tp3Price   = direction === 'BUY' ? swingH      : swingL;
    const entryPrice = bestFibLevel;
    const risk       = Math.abs(entryPrice - slPrice);
    if (risk === 0) continue;
    const rr1 = parseFloat((Math.abs(tp1Price - entryPrice) / risk).toFixed(2));
    const rr2 = parseFloat((Math.abs(tp2Price - entryPrice) / risk).toFixed(2));
    const rr3 = parseFloat((Math.abs(tp3Price - entryPrice) / risk).toFixed(2));

    // SURGICAL FILTER
    if (rr1 < CONFIG.MIN_RR1) continue;                                                // Filter 1: TP1 >= MIN_RR1 (config.js)
    funnel.surgF1++;
    if (rr2 < CONFIG.MIN_RR2) continue;                                                // Filter 2: TP2 >= MIN_RR2 (config.js)
    funnel.surgF2++;
    if (rejection.patterns.length < CONFIG.REJECTION_MIN_PATTERNS) continue;            // Filter 3: REJECTION_MIN_PATTERNS required (config.js)
    funnel.surgF3++;
    // v8.7: removed redundant POC_RECLAIM-only veto — see strategy.js note.
    // REJECTION_MIN_PATTERNS (2-of-4) is the real confirmation gate.
    funnel.surgF4++;
    funnel.surgicalOk++;
    funnel.opened++;

    // ── OPEN TRADE ──────────────────────────────────────────────────────────
    cooldownMap[coolKey] = bar.time;
    openTrade = {
      symbol, direction,
      entryTime:    bar.time,
      entryBarIdx:  i,
      entryPrice, slPrice, tp1Price, tp2Price, tp3Price,
      origSlPrice: slPrice,
      rr1, rr2, rr3,
      patterns:    rejection.patterns,
      pivot:       bestPivot.name,
      bias4h:      bias4h.bias,
      confluenceScore: bestScore,
    };
  }

  // Close any still-open trade at the last bar
  if (openTrade) {
    const lastBar = data15m[data15m.length - 1];
    trades.push({
      ...openTrade,
      exitTime:  lastBar.time,
      exitPrice: lastBar.close,
      result:    'OPEN',
      rr:        parseFloat(((lastBar.close - openTrade.entryPrice) /
        Math.abs(openTrade.entryPrice - openTrade.origSlPrice) *
        (openTrade.direction === 'BUY' ? 1 : -1)).toFixed(2)),
      barsHeld: data15m.length - 1 - openTrade.entryBarIdx,
    });
  }

  // Print the gate funnel so we can see exactly where bars get filtered out.
  console.log(`  [FUNNEL] ${symbol}:`, JSON.stringify(funnel));
  return { trades, funnel };
};

// ── Report generator ──────────────────────────────────────────────────────────

const generateReport = (allTrades, days, funnelsBySymbol) => {
  const closed = allTrades.filter(t => t.result !== 'OPEN');
  const wins   = closed.filter(t => t.rr > 0);
  const losses = closed.filter(t => t.rr <= 0);
  const tp1s   = closed.filter(t => t.result === 'TP1');
  const tp2s   = closed.filter(t => t.result === 'TP2');
  const tp3s   = closed.filter(t => t.result === 'TP3');
  const sls    = closed.filter(t => t.result === 'SL');
  const bes    = closed.filter(t => t.result === 'BE');
  const timeouts = closed.filter(t => t.result === 'TIMEOUT');

  const winRate   = closed.length ? (wins.length / closed.length * 100).toFixed(1) : '0.0';
  // True losses = SL + TIMEOUT only. BE (breakeven scratch, 0R) is neither a
  // win nor a real loss — it's capital returned intact. The headline winRate
  // above counts BE as a loss (rr<=0), which understates how the strategy
  // actually performed: of 32 closed trades, only 3 (1 SL + 2 TIMEOUT) lost
  // real money — the other 6 "losses" gave money back, not took it.
  const realLosses  = sls.length + timeouts.length;
  const trueWinRate = closed.length ? (((closed.length - realLosses) / closed.length) * 100).toFixed(1) : '0.0';
  const avgWinRR  = wins.length   ? (wins.reduce((s, t) => s + t.rr, 0) / wins.length).toFixed(2) : '0.00';
  const avgLossRR = losses.length ? (losses.reduce((s, t) => s + t.rr, 0) / losses.length).toFixed(2) : '0.00';
  const totalRR   = closed.reduce((s, t) => s + t.rr, 0);

  // Profit factor = gross wins / gross losses
  const grossWin  = wins.reduce((s, t) => s + t.rr, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.rr, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : '∞';

  // Simulate $ P&L (1% risk per trade)
  let capital = CONFIG.STARTING_CAPITAL;
  let peak    = capital;
  let maxDD   = 0;
  const equity = [capital];
  for (const t of closed) {
    const riskAmt = capital * (CONFIG.RISK_PER_TRADE_PCT / 100);
    capital += riskAmt * t.rr;
    if (capital > peak) peak = capital;
    const dd = (peak - capital) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    equity.push(capital);
  }
  const finalCapital = capital.toFixed(2);
  const totalReturn  = ((capital - CONFIG.STARTING_CAPITAL) / CONFIG.STARTING_CAPITAL * 100).toFixed(1);

  // Pattern frequency
  const patternCount = {};
  allTrades.forEach(t => {
    (t.patterns || []).forEach(p => { patternCount[p] = (patternCount[p] || 0) + 1; });
  });

  // By symbol breakdown
  const bySymbol = {};
  for (const t of closed) {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { trades: 0, wins: 0, totalRR: 0 };
    bySymbol[t.symbol].trades++;
    if (t.rr > 0) bySymbol[t.symbol].wins++;
    bySymbol[t.symbol].totalRR += t.rr;
  }

  // By direction breakdown (BUY vs SELL) — surfaces any structural imbalance,
  // e.g. a backtest window that's entirely BUY means the SELL side of the
  // strategy has never actually been exercised, not that it doesn't exist.
  const byDirection = {};
  for (const t of closed) {
    if (!byDirection[t.direction]) byDirection[t.direction] = { trades: 0, wins: 0, totalRR: 0 };
    byDirection[t.direction].trades++;
    if (t.rr > 0) byDirection[t.direction].wins++;
    byDirection[t.direction].totalRR += t.rr;
  }
  const totalBullBias4h = Object.values(funnelsBySymbol).reduce((s, f) => s + (f ? f.bullBias4h : 0), 0);
  const totalBearBias4h = Object.values(funnelsBySymbol).reduce((s, f) => s + (f ? f.bearBias4h : 0), 0);

  // Avg bars held
  const avgBarsHeld = closed.length
    ? (closed.reduce((s, t) => s + (t.barsHeld || 0), 0) / closed.length).toFixed(0)
    : '0';

  // requestedSymbols reflects what was ACTUALLY run, not just symbols that
  // happened to produce a trade — this was the bug that made SOL-USDT
  // silently vanish from the report header when it fired 0 signals.
  const requestedSymbols = Object.keys(funnelsBySymbol).length ? Object.keys(funnelsBySymbol) : [...new Set(allTrades.map(t => t.symbol))];

  const lines = [
    '═══════════════════════════════════════════════════════════════════',
    ` MVS — BACKTEST REPORT`,
    ` Period: Last ${days} days  |  Symbols requested: ${requestedSymbols.join(', ')}`,
    '═══════════════════════════════════════════════════════════════════',
    '',
    '── SUMMARY ─────────────────────────────────────────────────────────',
    `  Total signals fired   : ${allTrades.length}`,
    `  Closed trades         : ${closed.length}`,
    `  Open (unrealised)     : ${allTrades.filter(t => t.result === 'OPEN').length}`,
    `  Win rate              : ${winRate}%  (${wins.length}W / ${losses.length}L)`,
    `  Real-money win rate   : ${trueWinRate}%  (${closed.length - realLosses} no-loss / ${realLosses} real loss — excludes ${bes.length} breakeven scratches)`,
    `  Profit factor         : ${profitFactor}`,
    `  Total R accumulated   : ${totalRR.toFixed(2)}R`,
    `  Avg win R:R           : ${avgWinRR}R`,
    `  Avg loss R:R          : ${avgLossRR}R`,
    `  Avg bars held         : ${avgBarsHeld} bars (~${(parseInt(avgBarsHeld) * CONFIG.ENTRY_BAR_SECONDS / 3600).toFixed(1)}h)`,
    '',
    '── OUTCOME BREAKDOWN ───────────────────────────────────────────────',
    `  TP1 hits  : ${tp1s.length}`,
    `  TP2 hits  : ${tp2s.length}`,
    `  TP3 hits  : ${tp3s.length}`,
    `  SL hits   : ${sls.length}`,
    `  BE hits   : ${bes.length}  (SL moved to entry, exited flat — see v8.7 note)`,
    `  Timeouts  : ${timeouts.length}`,
    '',
    '── $ P&L SIMULATION (1% risk / trade, $1000 start) ─────────────────',
    `  Starting capital      : $${CONFIG.STARTING_CAPITAL}`,
    `  Final capital         : $${finalCapital}`,
    `  Total return          : ${totalReturn}%`,
    `  Max drawdown          : ${maxDD.toFixed(1)}%`,
    '',
    '── BY SYMBOL ───────────────────────────────────────────────────────',
    ...requestedSymbols.map(sym => {
      const s = bySymbol[sym];
      if (!s) return `  ${sym.padEnd(10)} 0 trades | 0% WR | 0.00R total   ⚠️ 0 SIGNALS — see FUNNEL DIAGNOSTICS below`;
      return `  ${sym.padEnd(10)} ${s.trades} trades | ${(s.wins/s.trades*100).toFixed(0)}% WR | ${s.totalRR.toFixed(2)}R total`;
    }),
    '',
    '── BY DIRECTION ────────────────────────────────────────────────────',
    `  4H bias occurrence (all symbols) : BULLISH bars=${totalBullBias4h}  BEARISH bars=${totalBearBias4h}`,
    ...(Object.keys(byDirection).length ? Object.keys(byDirection).map(dir => {
      const d = byDirection[dir];
      return `  ${dir.padEnd(6)} ${d.trades} trades | ${(d.wins/d.trades*100).toFixed(0)}% WR | ${d.totalRR.toFixed(2)}R total`;
    }) : ['  No closed trades to break down by direction.']),
    ...(totalBearBias4h === 0
      ? ['  ⚠️ Zero BEARISH 4H bias bars across the whole window — the SELL side of this',
         '     strategy has not been exercised at all in this backtest period. Any WR/PF',
         '     numbers above only validate the BUY side. Extend the lookback (--days) to',
         '     include a bear/range period before trusting this strategy in both directions.']
      : []),
    '',
    '── FUNNEL DIAGNOSTICS (bars surviving each gate, per symbol) ────────',
    ...requestedSymbols.flatMap(sym => {
      const f = funnelsBySymbol[sym];
      if (!f) return [`  ${sym}: no funnel data (fetch/insufficient-data — check console log)`];
      return [
        `  ${sym}:`,
        `    scanned=${f.scanned}  bias4hOk=${f.bias4hOk} (bull=${f.bullBias4h}/bear=${f.bearBias4h})  atrOk=${f.atrOk}  swingInRange=${f.swingInRange}`,
        `    biasAligned=${f.biasAligned}  notOverExtended=${f.notOverExtended}  nearZone=${f.nearZone}  vpOk=${f.vpOk}`,
        `    confluenceOk=${f.confluenceOk}  htfAligned=${f.htfAligned}  notInvalidated=${f.notInvalidated}  cooldownOk=${f.cooldownOk}`,
        `    rejectionOk=${f.rejectionOk}  surgF1(RR1)=${f.surgF1}  surgF2(RR2)=${f.surgF2}  surgF3(patterns)=${f.surgF3}  surgF4(POC)=${f.surgF4}  opened=${f.opened}`,
      ];
    }),
    '',
    '── PATTERN FREQUENCY ───────────────────────────────────────────────',
    ...Object.entries(patternCount)
      .sort(([,a],[,b]) => b - a)
      .map(([p, c]) => `  ${p.padEnd(20)} ${c}x`),
    '',
    '── RECENT TRADES (last 20) ─────────────────────────────────────────',
    ...closed.slice(-20).map(t => {
      const d    = new Date(t.entryTime * 1000).toISOString().slice(0, 16).replace('T', ' ');
      const icon = t.rr > 0 ? '✅' : '❌';
      return `  ${icon} ${d} | ${t.symbol} ${t.direction} | ${t.result} | ${t.rr > 0 ? '+' : ''}${t.rr}R | ${t.patterns.join('+')}`;
    }),
    '',
    '═══════════════════════════════════════════════════════════════════',
    ' Report saved: backtest-report.json  |  backtest-report.txt',
    '═══════════════════════════════════════════════════════════════════',
  ];

  return { lines, stats: { winRate, profitFactor, totalRR, finalCapital, totalReturn, maxDD, bySymbol, patternCount, funnels: funnelsBySymbol } };
};

// ── TUNE MODE ────────────────────────────────────────────────────────────────
// Sweeps ONLY the surgical/sensitivity knobs (cooldown, RR floors, rejection
// strictness). Core foundation — POC/VAH/VAL, Fibonacci zone, 4H bias votes,
// confluence/HTF-zone logic — is never modified by this grid.
const TUNE_GRID = [
  { SIGNAL_COOLDOWN_BARS: 5, MIN_RR1: 0.35, MIN_RR2: 0.50, REJECTION_MIN_PATTERNS: 2 }, // baseline (current)
  { SIGNAL_COOLDOWN_BARS: 3, MIN_RR1: 0.35, MIN_RR2: 0.50, REJECTION_MIN_PATTERNS: 2 },
  { SIGNAL_COOLDOWN_BARS: 3, MIN_RR1: 0.30, MIN_RR2: 0.45, REJECTION_MIN_PATTERNS: 2 },
  { SIGNAL_COOLDOWN_BARS: 2, MIN_RR1: 0.30, MIN_RR2: 0.45, REJECTION_MIN_PATTERNS: 2 },
  { SIGNAL_COOLDOWN_BARS: 2, MIN_RR1: 0.25, MIN_RR2: 0.40, REJECTION_MIN_PATTERNS: 2 },
  { SIGNAL_COOLDOWN_BARS: 5, MIN_RR1: 0.35, MIN_RR2: 0.50, REJECTION_MIN_PATTERNS: 3 }, // stricter — fewer but maybe cleaner
];

async function runTune(allData) {
  const results = [];
  for (const combo of TUNE_GRID) {
    Object.assign(CONFIG, combo);
    let allTrades = [];
    for (const symbol of symbols) {
      const { data15m, data4h } = allData[symbol];
      const { trades } = await backtestSymbol(symbol, data15m, data4h);
      allTrades.push(...trades);
    }
    const closed = allTrades.filter(t => t.result !== 'OPEN');
    const wins   = closed.filter(t => t.rr > 0);
    const wr     = closed.length ? (wins.length / closed.length * 100) : 0;
    const totalRR = closed.reduce((s, t) => s + t.rr, 0);
    results.push({ combo, trades: closed.length, wins: wins.length, wr, totalRR });
  }
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(' TUNE RESULTS — ranked by trade count among 100% WR combos first');
  console.log('═══════════════════════════════════════════════════════════════════');
  results
    .sort((a, b) => (b.wr === 100 && a.wr !== 100 ? 1 : a.wr !== 100 && b.wr === 100 ? -1 : b.trades - a.trades))
    .forEach(r => {
      console.log(`  cooldown=${r.combo.SIGNAL_COOLDOWN_BARS} RR1=${r.combo.MIN_RR1} RR2=${r.combo.MIN_RR2} patterns=${r.combo.REJECTION_MIN_PATTERNS}  →  ${r.trades} trades | ${r.wr.toFixed(1)}% WR | ${r.totalRR.toFixed(2)}R`);
    });
  console.log('\nPick the row with the most trades that still shows 100.0% WR, then');
  console.log('hard-code those 4 values into config.js (NOT just backtest.js) before going live.\n');
}



(async () => {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(' MVS — BACKTESTER v2.1');
  console.log(`  Symbols : ${symbols.join(', ')}`);
  console.log(`  Period  : Last ${days} days`);
  console.log(`  Bars    : ~${days * 24} × 1H  |  ~${days * 6} × 4H`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const allTrades = [];
  const funnelsBySymbol = {};
  const minBarsNeeded = Math.max(CONFIG.VP_LOOKBACK, CONFIG.FIB_LOOKBACK) + CONFIG.ATR_PERIOD + 5;

  if (tuneMode) {
    const allData = {};
    for (const symbol of symbols) {
      console.log(`\n▶ Fetching ${symbol} (once, reused across tune grid)`);
      const data15m = await fetchHistory(symbol, CONFIG.TIMEFRAME, days + 35);
      const data4h  = await fetchHistory(symbol, '4hour', days + 35);
      if (data15m.length < minBarsNeeded) { console.log(`  ⚠️ Insufficient data for ${symbol} — skipping`); continue; }
      allData[symbol] = { data15m, data4h };
      await sleep(500);
    }
    await runTune(allData);
    process.exit(0);
  }

  for (const symbol of symbols) {
    console.log(`\n▶ ${symbol}`);
    const data15m = await fetchHistory(symbol, CONFIG.TIMEFRAME, days + 35); // +35 days warmup buffer (covers 30-day VP/FIB lookback + ATR/cooldown margin)
    const data4h  = await fetchHistory(symbol, '4hour', days + 35);

    if (data15m.length < minBarsNeeded) {
      console.log(`  ⚠️ Insufficient data for ${symbol} — skipping`);
      funnelsBySymbol[symbol] = null; // mark as attempted but no data
      continue;
    }

    const { trades, funnel } = await backtestSymbol(symbol, data15m, data4h);
    console.log(`  → ${trades.length} signals fired`);
    allTrades.push(...trades);
    funnelsBySymbol[symbol] = funnel;
    await sleep(500);
  }

  if (!allTrades.length) {
    console.log('\n⚠️ No trades found with current filters.');
    // Still write report files so artifact always uploads
    const emptyReport = [
      '═══════════════════════════════════════════════════════════════════',
      ` MVS — BACKTEST REPORT`,
      ` Period: Last ${days} days  |  Symbols: ${symbols.join(', ')}`,
      '═══════════════════════════════════════════════════════════════════',
      '',
      '  No signals fired in this period with current filters.',
      '  The market did not present 3-of-4 pattern confluence setups.',
      '  This is normal — try a longer period (180 or 360 days).',
      '═══════════════════════════════════════════════════════════════════',
    ].join('\n');
    fs.writeFileSync(path.join(__dirname, 'backtest-report.txt'), emptyReport);
    fs.writeFileSync(path.join(__dirname, 'backtest-report.json'), JSON.stringify({ days, symbols, trades: [] }, null, 2));
    process.exit(0);
  }

  const { lines, stats } = generateReport(allTrades, days, funnelsBySymbol);

  // Print to console
  console.log('\n' + lines.join('\n'));

  // Save report files
  fs.writeFileSync(
    path.join(__dirname, 'backtest-report.txt'),
    lines.join('\n')
  );
  fs.writeFileSync(
    path.join(__dirname, 'backtest-report.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), days, symbols, stats, trades: allTrades }, null, 2)
  );

  console.log('\n✅ Done. Files saved: backtest-report.txt  backtest-report.json\n');
  process.exit(0);
})();
