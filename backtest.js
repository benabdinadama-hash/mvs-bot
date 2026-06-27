/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — 90-DAY BACKTESTER  (backtest.js)
 *
 *  Fetches real historical KuCoin data (15min + 4H) for the last 90 days,
 *  replays every 15-minute bar through the exact same MVS strategy logic
 *  used in strategy.js, and produces a full performance report.
 *
 *  HOW IT WORKS:
 *  ─ Fetches up to 1500 bars per KuCoin request (KuCoin's max per call)
 *  ─ Pages backward in time to cover 90 days (8640 × 15min bars)
 *  ─ Replays each bar as if it were "live" — the strategy sees only data
 *    up to and including that bar (no lookahead bias)
 *  ─ Simulates entries, SL hits, and TP hits on subsequent bars
 *  ─ Prints a full report: win rate, avg R:R, profit factor, max drawdown
 *
 *  USAGE:
 *    node backtest.js                        ← all 4 symbols, 90 days
 *    node backtest.js BTC-USDT               ← single symbol
 *    node backtest.js BTC-USDT 30            ← single symbol, 30 days
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

// ── Config (mirrors strategy.js exactly) ─────────────────────────────────────
const CONFIG = {
  SYMBOLS:                ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT'],
  TIMEFRAME:              '15min',
  BIAS_TIMEFRAME:         '4hour',
  ENTRY_BAR_SECONDS:      900,
  VP_LOOKBACK:            200,      // bars of history used per scan window
  BIAS_LOOKBACK:          50,
  FIB_LOOKBACK:           100,
  BIAS_FIB_LOOKBACK:      30,
  VP_ROWS:                100,
  VALUE_AREA_PCT:         0.70,
  FIB_ZONE_LOW:           0.60,
  FIB_ZONE_HIGH:          0.80,
  CONFLUENCE_ATR_MULT:    0.5,
  HTFZONE_ATR_MULT:       1.5,
  REJECTION_MIN_PATTERNS: 2,
  ABSORPTION_BODY_RATIO:  0.60,
  ZONE_INVALIDATION_ATR_MULT: 1.0,
  SIGNAL_COOLDOWN_BARS:   20,
  ATR_PERIOD:             14,
  SL_ATR_MULT:            0.25,
  BASE_URL:               'https://api.kucoin.com/api/v1',
  BACKTEST_DAYS:          90,
  RISK_PER_TRADE_PCT:     1.0,   // % of capital risked per trade (for $ P&L simulation)
  STARTING_CAPITAL:       1000,  // USDT (for $ P&L simulation)
};

// ── CLI args ─────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const symbols = args[0] && args[0].includes('-') ? [args[0].toUpperCase()] : CONFIG.SYMBOLS;
const days    = parseInt(args[1] || args[0]) || CONFIG.BACKTEST_DAYS;

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
 * KuCoin returns max 1500 bars per call; 90 days × 96 bars/day = 8640 bars
 * so we need at minimum 6 pages for 15min, 2 pages for 4H.
 */
const fetchHistory = async (symbol, interval, days) => {
  const barSeconds = interval === '15min' ? 900 : 14400;
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

const calcFib = (high, low) => {
  const diff = high - low;
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

  // We need enough warmup bars before we start scanning
  const warmup = Math.max(CONFIG.VP_LOOKBACK, CONFIG.FIB_LOOKBACK) + CONFIG.ATR_PERIOD + 5;

  console.log(`\n  Replaying ${data15m.length - warmup} bars for ${symbol}...`);

  for (let i = warmup; i < data15m.length; i++) {
    const bar     = data15m[i];
    const history = data15m.slice(0, i + 1); // only bars up to NOW (no lookahead)
    const price   = bar.close;

    // ── If we have an open trade, check if SL or TP was hit this bar ──────
    if (openTrade) {
      const { direction, entryPrice, slPrice, tp1Price, tp2Price, tp3Price } = openTrade;

      let outcome = null;

      if (direction === 'BUY') {
        if (bar.low  <= slPrice)  outcome = { result: 'SL',  exitPrice: slPrice,  rr: -1 };
        else if (bar.high >= tp3Price) outcome = { result: 'TP3', exitPrice: tp3Price, rr: openTrade.rr3 };
        else if (bar.high >= tp2Price) outcome = { result: 'TP2', exitPrice: tp2Price, rr: openTrade.rr2 };
        else if (bar.high >= tp1Price) outcome = { result: 'TP1', exitPrice: tp1Price, rr: openTrade.rr1 };
      } else {
        if (bar.high >= slPrice)  outcome = { result: 'SL',  exitPrice: slPrice,  rr: -1 };
        else if (bar.low  <= tp3Price) outcome = { result: 'TP3', exitPrice: tp3Price, rr: openTrade.rr3 };
        else if (bar.low  <= tp2Price) outcome = { result: 'TP2', exitPrice: tp2Price, rr: openTrade.rr2 };
        else if (bar.low  <= tp1Price) outcome = { result: 'TP1', exitPrice: tp1Price, rr: openTrade.rr1 };
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

      // Max hold: 200 bars (50 hours) — close at market if no TP/SL hit
      if (i - openTrade.entryBarIdx > 200) {
        trades.push({
          ...openTrade,
          exitTime:  bar.time,
          exitPrice: price,
          result:    'TIMEOUT',
          rr:        parseFloat(((price - openTrade.entryPrice) / Math.abs(openTrade.entryPrice - openTrade.slPrice) * (openTrade.direction === 'BUY' ? 1 : -1)).toFixed(2)),
          barsHeld:  200,
        });
        openTrade = null;
      }
      continue; // while in a trade, don't scan for new entry
    }

    // ── STEP 0: 4H Bias ────────────────────────────────────────────────────
    // Find 4H bars up to current bar time
    const bars4h = data4h.filter(b => b.time <= bar.time).slice(-CONFIG.BIAS_LOOKBACK);
    if (bars4h.length < 20) continue;
    const bias4h = get4HBias(bars4h);
    if (!bias4h || bias4h.bias === 'NEUTRAL') continue;

    // ── STEP 1-2: Entry TF data + ATR ──────────────────────────────────────
    const window = history.slice(-CONFIG.VP_LOOKBACK);
    const atr    = calcATR(window);
    if (!atr) continue;

    // ── STEP 3: Fibonacci swing ─────────────────────────────────────────────
    const fibData  = history.slice(-CONFIG.FIB_LOOKBACK);
    const swingH   = Math.max(...fibData.map(d => d.high));
    const swingL   = Math.min(...fibData.map(d => d.low));
    if (price > swingH || price < swingL) continue; // A2 remap — skip
    const fib      = calcFib(swingH, swingL);
    const midPoint = (swingH + swingL) / 2;
    const direction = price < midPoint ? 'BUY' : 'SELL';

    // ── STEP 4: 4H bias alignment ───────────────────────────────────────────
    const biasAligned =
      (direction === 'BUY'  && bias4h.bias === 'BULLISH') ||
      (direction === 'SELL' && bias4h.bias === 'BEARISH');
    if (!biasAligned) continue;

    // ── STEP 5: D4 over-extension ───────────────────────────────────────────
    if ((direction === 'BUY'  && price < fib.level886) ||
        (direction === 'SELL' && price > fib.level886)) continue;

    // ── STEP 6: Early proximity skip ───────────────────────────────────────
    if (price < fib.zoneLow - atr || price > fib.zoneHigh + atr) continue;

    // ── STEP 7: Volume Profile ──────────────────────────────────────────────
    const vp = calcVolumeProfile(window);
    if (!vp) continue;

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

    // ── STEP 9: 4H Zone cross-check ─────────────────────────────────────────
    const tol4h = atr * CONFIG.HTFZONE_ATR_MULT;
    const levels4h = [bias4h.poc4h, bias4h.vah4h, bias4h.val4h, bias4h.fibMid4h];
    const htfAligned = levels4h.some(lvl => Math.abs(bestFibLevel - lvl) <= tol4h);
    if (!htfAligned) continue;

    // ── STEP 10: Zone invalidation ──────────────────────────────────────────
    const margin = atr * CONFIG.ZONE_INVALIDATION_ATR_MULT;
    if (direction === 'BUY'  && price < bestFibLevel - margin) continue;
    if (direction === 'SELL' && price > bestFibLevel + margin) continue;

    // ── STEP 11: Cooldown ───────────────────────────────────────────────────
    const coolKey = `${direction}`;
    const lastBar = cooldownMap[coolKey] || 0;
    const barsSince = Math.round((bar.time - lastBar) / CONFIG.ENTRY_BAR_SECONDS);
    if (barsSince < CONFIG.SIGNAL_COOLDOWN_BARS) continue;

    // ── STEP 12: Rejection patterns ─────────────────────────────────────────
    const zoneLow  = fib.zoneLow  - atr * 0.1;
    const zoneHigh = fib.zoneHigh + atr * 0.1;
    const rejection = detectRejection(window, zoneLow, zoneHigh, direction, vp.pocPrice);
    if (!rejection.valid) continue;

    // ── STEP 13: SL / TP ────────────────────────────────────────────────────
    const swingWick  = direction === 'BUY' ? swingL : swingH;
    const slPrice    = direction === 'BUY'
      ? swingWick - atr * CONFIG.SL_ATR_MULT
      : swingWick + atr * CONFIG.SL_ATR_MULT;
    const tp1Price   = fib.level500;
    const tp2Price   = vp.pocPrice;
    const tp3Price   = direction === 'BUY' ? vp.vahPrice : vp.valPrice;
    const entryPrice = bestFibLevel;
    const risk       = Math.abs(entryPrice - slPrice);
    if (risk === 0) continue;
    const rr1 = parseFloat((Math.abs(tp1Price - entryPrice) / risk).toFixed(2));
    const rr2 = parseFloat((Math.abs(tp2Price - entryPrice) / risk).toFixed(2));
    const rr3 = parseFloat((Math.abs(tp3Price - entryPrice) / risk).toFixed(2));

    // ── OPEN TRADE ──────────────────────────────────────────────────────────
    cooldownMap[coolKey] = bar.time;
    openTrade = {
      symbol, direction,
      entryTime:    bar.time,
      entryBarIdx:  i,
      entryPrice, slPrice, tp1Price, tp2Price, tp3Price,
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
        Math.abs(openTrade.entryPrice - openTrade.slPrice) *
        (openTrade.direction === 'BUY' ? 1 : -1)).toFixed(2)),
      barsHeld: data15m.length - 1 - openTrade.entryBarIdx,
    });
  }

  return trades;
};

// ── Report generator ──────────────────────────────────────────────────────────

const generateReport = (allTrades, days) => {
  const closed = allTrades.filter(t => t.result !== 'OPEN');
  const wins   = closed.filter(t => t.rr > 0);
  const losses = closed.filter(t => t.rr <= 0);
  const tp1s   = closed.filter(t => t.result === 'TP1');
  const tp2s   = closed.filter(t => t.result === 'TP2');
  const tp3s   = closed.filter(t => t.result === 'TP3');
  const sls    = closed.filter(t => t.result === 'SL');
  const timeouts = closed.filter(t => t.result === 'TIMEOUT');

  const winRate   = closed.length ? (wins.length / closed.length * 100).toFixed(1) : '0.0';
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

  // Avg bars held
  const avgBarsHeld = closed.length
    ? (closed.reduce((s, t) => s + (t.barsHeld || 0), 0) / closed.length).toFixed(0)
    : '0';

  const lines = [
    '═══════════════════════════════════════════════════════════════════',
    ' MVS — 90-DAY BACKTEST REPORT',
    ` Period: Last ${days} days  |  Symbols: ${[...new Set(allTrades.map(t => t.symbol))].join(', ')}`,
    '═══════════════════════════════════════════════════════════════════',
    '',
    '── SUMMARY ─────────────────────────────────────────────────────────',
    `  Total signals fired   : ${allTrades.length}`,
    `  Closed trades         : ${closed.length}`,
    `  Open (unrealised)     : ${allTrades.filter(t => t.result === 'OPEN').length}`,
    `  Win rate              : ${winRate}%  (${wins.length}W / ${losses.length}L)`,
    `  Profit factor         : ${profitFactor}`,
    `  Total R accumulated   : ${totalRR.toFixed(2)}R`,
    `  Avg win R:R           : ${avgWinRR}R`,
    `  Avg loss R:R          : ${avgLossRR}R`,
    `  Avg bars held         : ${avgBarsHeld} bars (~${(parseInt(avgBarsHeld) * 15 / 60).toFixed(1)}h)`,
    '',
    '── OUTCOME BREAKDOWN ───────────────────────────────────────────────',
    `  TP1 hits  : ${tp1s.length}`,
    `  TP2 hits  : ${tp2s.length}`,
    `  TP3 hits  : ${tp3s.length}`,
    `  SL hits   : ${sls.length}`,
    `  Timeouts  : ${timeouts.length}`,
    '',
    '── $ P&L SIMULATION (1% risk / trade, $1000 start) ─────────────────',
    `  Starting capital      : $${CONFIG.STARTING_CAPITAL}`,
    `  Final capital         : $${finalCapital}`,
    `  Total return          : ${totalReturn}%`,
    `  Max drawdown          : ${maxDD.toFixed(1)}%`,
    '',
    '── BY SYMBOL ───────────────────────────────────────────────────────',
    ...Object.entries(bySymbol).map(([sym, s]) =>
      `  ${sym.padEnd(10)} ${s.trades} trades | ${(s.wins/s.trades*100).toFixed(0)}% WR | ${s.totalRR.toFixed(2)}R total`
    ),
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

  return { lines, stats: { winRate, profitFactor, totalRR, finalCapital, totalReturn, maxDD, bySymbol, patternCount } };
};

// ── MAIN ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(' MVS — 90-DAY BACKTESTER');
  console.log(`  Symbols : ${symbols.join(', ')}`);
  console.log(`  Period  : Last ${days} days`);
  console.log(`  Bars    : ~${days * 96} × 15min  |  ~${days * 6} × 4H`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const allTrades = [];

  for (const symbol of symbols) {
    console.log(`\n▶ ${symbol}`);
    const data15m = await fetchHistory(symbol, '15min', days + 10); // +10 days warmup buffer
    const data4h  = await fetchHistory(symbol, '4hour', days + 10);

    if (data15m.length < 500) {
      console.log(`  ⚠️ Insufficient data for ${symbol} — skipping`);
      continue;
    }

    const trades = await backtestSymbol(symbol, data15m, data4h);
    console.log(`  → ${trades.length} signals fired`);
    allTrades.push(...trades);
    await sleep(500);
  }

  if (!allTrades.length) {
    console.log('\n⚠️ No trades found. The strategy may be very selective — try widening CONFLUENCE_ATR_MULT in config.');
    process.exit(0);
  }

  const { lines, stats } = generateReport(allTrades, days);

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
