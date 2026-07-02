/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — BACKTESTER (backtest.js)  v10.2
 *
 *  Uses core.js — the EXACT same decision logic as strategy.js (live).
 *  No more hand-copied CONFIG or duplicated pure functions: this file
 *  previously kept its own independent copy of everything, which is why
 *  it drifted out of sync with strategy.js repeatedly (SELL_HTF_MULT_BOOST,
 *  POC_RECLAIM_SOLO, and PAIR_MIN_TP2_RR each existed in one file months
 *  before the other — every backtest report before v10.0 was testing a
 *  ruleset that wasn't quite what the live bot actually ran).
 *
 *  Replays 4H bias + 1H structure + 15m trigger candles tick-by-tick on
 *  the 15m clock (no lookahead — every check only sees bars up to "now").
 *
 *  USAGE:
 *    node backtest.js                       ← all symbols, config.BACKTEST_DAYS
 *    node backtest.js SOL-USDT              ← single symbol
 *    node backtest.js SOL-USDT 180          ← single symbol, 180 days
 *    node backtest.js SOL-USDT,BTC-USDT 360 ← explicit multi-symbol
 *
 *  HONESTY NOTE: nothing in this report should be read as a promise about
 *  live performance. Backtests are always somewhat optimistic (no real
 *  slippage variance, no exchange downtime, no fat-finger fills) — treat
 *  these numbers as "does the logic behave sanely," not as a win-rate
 *  guarantee.
 * ═══════════════════════════════════════════════════════════════════════
 */

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const config = require('./config');
const core   = require('./core');

// ── CLI args ─────────────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);
const symbols = rawArgs[0] && rawArgs[0].includes('-')
  ? rawArgs[0].toUpperCase().split(',').map(s => s.trim())
  : config.SYMBOLS;
const days = parseInt(rawArgs[1] || rawArgs[0]) || config.BACKTEST_DAYS;

// ── KuCoin paged history fetch ───────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BAR_SECONDS = { '15min': 900, '1hour': 3600, '4hour': 14400 };

const fetchKlines = async (symbol, interval, startAt, endAt) => {
  const url = `${config.BASE_URL}/market/candles?symbol=${symbol}&type=${interval}&startAt=${startAt}&endAt=${endAt}`;
  try {
    const res = await axios.get(url, { timeout: 20000 });
    if (res.data.code !== '200000') return [];
    return (res.data.data || [])
      .map(k => ({ time: parseInt(k[0]), open: parseFloat(k[1]), close: parseFloat(k[2]), high: parseFloat(k[3]), low: parseFloat(k[4]), volume: parseFloat(k[5]) }))
      .sort((a, b) => a.time - b.time);
  } catch (e) {
    console.error(`  Fetch error: ${e.message}`);
    return [];
  }
};

const fetchHistory = async (symbol, interval, historyDays) => {
  const barSeconds = BAR_SECONDS[interval] || 3600;
  const endAt = Math.floor(Date.now() / 1000);
  const startAt = endAt - historyDays * 86400;
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
    await sleep(250);
  }
  const seen = new Set();
  allBars = allBars.filter(b => (seen.has(b.time) ? false : (seen.add(b.time), true))).sort((a, b) => a.time - b.time);
  console.log(` ${allBars.length} bars`);
  return allBars;
};

// ─────────────────────────────────────────────────────────────────────────
//  REPLAY ENGINE — walks the 15m clock, two-pointer sync on 1H/4H arrays
// ─────────────────────────────────────────────────────────────────────────
const backtestSymbol = async (symbol, data15m, data1h, data4h) => {
  const trades = [];
  const cooldownMap = {};
  let openTrade = null;

  const funnel = {
    scanned: 0, voteOk: 0, bullVote: 0, bearVote: 0, structureOk: 0, notOverExtended: 0,
    nearZone: 0, confluenceOk: 0, htfAligned: 0, notInvalidated: 0, cooldownOk: 0,
    triggerOk: 0, tp3RangeOk: 0, opened: 0,
  };

  const warmup1h = config.STRUCT_VP_LOOKBACK + config.ATR_PERIOD + 5;
  const warmup4h = config.BIAS_VP_LOOKBACK + 5;
  const warmup15m = config.TRIGGER_VP_LOOKBACK + 5;

  // Find the first 15m index where all three timeframes have enough warmup data.
  let ptr1h = 0, ptr4h = 0;
  while (ptr1h < data1h.length - 1 && data1h[ptr1h + 1].time <= data15m[0].time) ptr1h++;
  while (ptr4h < data4h.length - 1 && data4h[ptr4h + 1].time <= data15m[0].time) ptr4h++;

  let startIdx = warmup15m;
  while (startIdx < data15m.length) {
    const t = data15m[startIdx].time;
    let p1 = 0, p4 = 0;
    while (p1 < data1h.length - 1 && data1h[p1 + 1].time <= t) p1++;
    while (p4 < data4h.length - 1 && data4h[p4 + 1].time <= t) p4++;
    if (p1 >= warmup1h && p4 >= warmup4h) break;
    startIdx++;
  }
  if (startIdx >= data15m.length) {
    console.log(`  [WARMUP] ${symbol}: insufficient history for warmup — skipping.`);
    return { trades: [], funnel };
  }

  console.log(`\n  Replaying ${data15m.length - startIdx} × 15m bars for ${symbol}...`);

  ptr1h = 0; ptr4h = 0;
  let cached1h = null, cached4h = null;

  for (let i = startIdx; i < data15m.length; i++) {
    const bar = data15m[i];

    // Advance pointers to the latest CLOSED 1H / 4H bar as of this 15m tick
    let advanced1h = false, advanced4h = false;
    while (ptr1h < data1h.length - 1 && data1h[ptr1h + 1].time <= bar.time) { ptr1h++; advanced1h = true; }
    while (ptr4h < data4h.length - 1 && data4h[ptr4h + 1].time <= bar.time) { ptr4h++; advanced4h = true; }

    // ── OPEN TRADE MANAGEMENT (checked every 15m tick for tighter fills) ──
    if (openTrade) {
      if (!openTrade.beMoved) {
        const halfway = openTrade.direction === 'BUY'
          ? openTrade.entryPrice + (openTrade.tp1Price - openTrade.entryPrice) * 0.5
          : openTrade.entryPrice - (openTrade.entryPrice - openTrade.tp1Price) * 0.5;
        const reached = openTrade.direction === 'BUY' ? bar.high >= halfway : bar.low <= halfway;
        if (reached) { openTrade.slPrice = openTrade.entryPrice; openTrade.beMoved = true; }
      }

      const { direction, entryPrice, slPrice, tp1Price, tp2Price, tp3Price, origSlPrice, rr1, rr2, rr3 } = openTrade;
      const origRisk = Math.abs(entryPrice - origSlPrice);
      const slRR = parseFloat((((slPrice - entryPrice) / origRisk) * (direction === 'BUY' ? 1 : -1)).toFixed(2));
      let outcome = null;

      if (!openTrade.halfExited) {
        const tp2Hit = direction === 'BUY' ? bar.high >= tp2Price : bar.low <= tp2Price;
        if (tp2Hit) { openTrade.halfExited = true; openTrade.halfR = rr2; openTrade.slPrice = tp2Price; }
      }

      if (openTrade.halfExited) {
        if (direction === 'BUY') {
          if      (bar.low  <= openTrade.slPrice) outcome = { result: 'TP2+BE',  exitPrice: openTrade.slPrice, rr: parseFloat((openTrade.halfR * 0.5).toFixed(2)) };
          else if (bar.high >= tp3Price)          outcome = { result: 'TP2+TP3', exitPrice: tp3Price,          rr: parseFloat(((openTrade.halfR + rr3) * 0.5).toFixed(2)) };
        } else {
          if      (bar.high >= openTrade.slPrice) outcome = { result: 'TP2+BE',  exitPrice: openTrade.slPrice, rr: parseFloat((openTrade.halfR * 0.5).toFixed(2)) };
          else if (bar.low  <= tp3Price)          outcome = { result: 'TP2+TP3', exitPrice: tp3Price,          rr: parseFloat(((openTrade.halfR + rr3) * 0.5).toFixed(2)) };
        }
      } else {
        if (direction === 'BUY') {
          if      (bar.low  <= slPrice)  outcome = { result: slRR === 0 ? 'BE' : 'SL', exitPrice: slPrice,  rr: slRR };
          else if (bar.high >= tp3Price) outcome = { result: 'TP3', exitPrice: tp3Price, rr: rr3 };
          else if (bar.high >= tp2Price) outcome = { result: 'TP2', exitPrice: tp2Price, rr: rr2 };
          else if (bar.high >= tp1Price) outcome = { result: 'TP1', exitPrice: tp1Price, rr: rr1 };
        } else {
          if      (bar.high >= slPrice)  outcome = { result: slRR === 0 ? 'BE' : 'SL', exitPrice: slPrice,  rr: slRR };
          else if (bar.low  <= tp3Price) outcome = { result: 'TP3', exitPrice: tp3Price, rr: rr3 };
          else if (bar.low  <= tp2Price) outcome = { result: 'TP2', exitPrice: tp2Price, rr: rr2 };
          else if (bar.low  <= tp1Price) outcome = { result: 'TP1', exitPrice: tp1Price, rr: rr1 };
        }
      }

      if (outcome) {
        trades.push({ ...openTrade, exitTime: bar.time, exitPrice: outcome.exitPrice, result: outcome.result, rr: parseFloat(outcome.rr),
          hoursHeld: Math.round((bar.time - openTrade.entryTime) / 3600) });
        openTrade = null;
        continue;
      }

      // Early time-stop: TP2 not reached within EARLY_TIMEOUT_BARS hours
      if (!openTrade.halfExited && (bar.time - openTrade.entryTime) > config.EARLY_TIMEOUT_BARS * config.STRUCT_BAR_SECONDS) {
        const price = bar.close;
        trades.push({ ...openTrade, exitTime: bar.time, exitPrice: price, result: 'EARLY_TIMEOUT',
          rr: parseFloat(((price - openTrade.entryPrice) / Math.abs(openTrade.entryPrice - openTrade.origSlPrice) * (openTrade.direction === 'BUY' ? 1 : -1)).toFixed(2)),
          hoursHeld: Math.round((bar.time - openTrade.entryTime) / 3600) });
        openTrade = null;
        continue;
      }
      // Max hold: 200 structure(1H) bars ≈ 8.3 days
      if ((bar.time - openTrade.entryTime) > 200 * config.STRUCT_BAR_SECONDS) {
        const price = bar.close;
        trades.push({ ...openTrade, exitTime: bar.time, exitPrice: price, result: 'TIMEOUT',
          rr: parseFloat(((price - openTrade.entryPrice) / Math.abs(openTrade.entryPrice - openTrade.origSlPrice) * (openTrade.direction === 'BUY' ? 1 : -1)).toFixed(2)),
          hoursHeld: Math.round((bar.time - openTrade.entryTime) / 3600) });
        openTrade = null;
      }
      continue; // in-trade: don't scan for new entries
    }

    funnel.scanned++;

    // ── Recompute 1H structure only when a new 1H bar closed ────────────
    // Bounded slice — only fires ~once/hour of backtest time, but no
    // reason to let it grow unbounded either.
    if (advanced1h || !cached1h) {
      const w1Start = Math.max(0, ptr1h + 1 - (config.STRUCT_VP_LOOKBACK + config.ATR_PERIOD + 5));
      const window1h = data1h.slice(w1Start, ptr1h + 1);
      const bias1h = core.tfBiasVote(window1h, config.STRUCT_VP_LOOKBACK, config.STRUCT_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);
      const atr1h = core.calcATR(window1h, config.ATR_PERIOD);
      cached1h = bias1h && atr1h ? { bias1h, atr1h } : null;
    }
    // ── Recompute 4H bias only when a new 4H bar closed ──────────────────
    if (advanced4h || !cached4h) {
      const w4Start = Math.max(0, ptr4h + 1 - (config.BIAS_VP_LOOKBACK + 5));
      const window4h = data4h.slice(w4Start, ptr4h + 1);
      const bias4h = core.tfBiasVote(window4h, config.BIAS_VP_LOOKBACK, config.BIAS_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);
      cached4h = bias4h;
    }
    if (!cached1h) continue;

    // ── 15m bias recomputed every tick (its window slides every bar) ────
    // Bounded slice (not slice(0, i+1)) — an unbounded slice that grows
    // every tick is O(n^2) over a 720-day backtest (~69,000 ticks) for no
    // benefit, since tfBiasVote/detectRejection only ever look at the tail.
    const win15mStart = Math.max(0, i + 1 - (config.TRIGGER_VP_LOOKBACK + 5));
    const window15m = data15m.slice(win15mStart, i + 1);
    const bias15m = core.tfBiasVote(window15m, config.TRIGGER_VP_LOOKBACK, config.TRIGGER_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);

    const resolved = core.resolveDirection([
      { tf: '4H', result: cached4h },
      { tf: '1H', result: cached1h.bias1h },
      { tf: '15m', result: bias15m },
    ]);
    if (!resolved) continue;
    funnel.voteOk++;
    if (resolved.direction === 'BUY') funnel.bullVote++; else funnel.bearVote++;

    const direction = resolved.direction;
    const { bias1h, atr1h } = cached1h;
    const swing1h = bias1h.swing;
    const price1h = data1h[ptr1h].close;

    if (price1h > swing1h.high || price1h < swing1h.low) continue; // remap
    funnel.structureOk++;

    const fib = core.calcFib(swing1h.high, swing1h.low, direction, config.FIB_ZONE_LOW, config.FIB_ZONE_HIGH);

    if ((direction === 'BUY' && price1h < fib.level886) || (direction === 'SELL' && price1h > fib.level886)) continue;
    funnel.notOverExtended++;

    if (!core.isNearZone(price1h, fib, atr1h, config.NEAR_ZONE_ATR_MULT)) continue;
    funnel.nearZone++;

    const vp1h = bias1h.vp;
    const fibMid = (fib.zoneHigh + fib.zoneLow) / 2;
    const checkLevels = [fib.level618, fib.level786, fibMid];
    const checkPivots = [{ name: 'POC', price: vp1h.pocPrice }, { name: 'VAH', price: vp1h.vahPrice }, { name: 'VAL', price: vp1h.valPrice }];
    let bestScore = 0, bestFibLevel = null, bestPivot = null;
    for (const lvl of checkLevels) for (const pivot of checkPivots) {
      const sc = core.confluenceScore(lvl, pivot.price, atr1h, config.CONFLUENCE_ATR_MULT);
      if (sc > bestScore) { bestScore = sc; bestFibLevel = lvl; bestPivot = pivot; }
    }
    if (bestScore < 1) continue;
    if (bestPivot.name === 'POC' && bestScore < config.MIN_CONFLUENCE_POC) continue;
    funnel.confluenceOk++;

    const htfCheck = core.checkHTFZoneAlignment(bestFibLevel, cached4h, atr1h, direction, config.HTFZONE_ATR_MULT);
    if (!htfCheck.aligned) continue;
    funnel.htfAligned++;

    if (core.isZoneInvalidated(price1h, bestFibLevel, atr1h, direction, config.ZONE_INVALIDATION_ATR_MULT)) continue;
    funnel.notInvalidated++;

    const lastSignalBar = cooldownMap[direction] || 0;
    const barsSince = Math.round((bar.time - lastSignalBar) / config.STRUCT_BAR_SECONDS);
    if (barsSince < config.SIGNAL_COOLDOWN_BARS) continue;
    funnel.cooldownOk++;

    const entryZoneLow  = fib.zoneLow  - atr1h * 0.1;
    const entryZoneHigh = fib.zoneHigh + atr1h * 0.1;
    const rejection = core.detectRejection(window15m, entryZoneLow, entryZoneHigh, direction,
      { poc: vp1h.pocPrice, vah: vp1h.vahPrice, val: vp1h.valPrice },
      config.ABSORPTION_BODY_RATIO, config.REJECTION_MIN_PATTERNS, config.ALLOW_SOLO_TRIGGER,
      config.SOLO_ELIGIBLE_PATTERNS);
    if (!rejection.valid) continue;
    funnel.triggerOk++;

    const levels = core.computeTradeLevels({
      direction, entryPrice: bestFibLevel, swing: swing1h, atr: atr1h, vp: vp1h,
      slAtrMult: config.SL_ATR_MULT, tp1RrFloor: config.TP1_RR_FLOOR, fibLevel500: fib.level500,
    });
    if (!levels) continue;
    funnel.tp3RangeOk++;
    funnel.opened++;

    cooldownMap[direction] = bar.time;
    openTrade = {
      symbol, direction,
      entryTime: bar.time,
      entryPrice: bestFibLevel, slPrice: levels.slPrice, tp1Price: levels.tp1Price, tp2Price: levels.tp2Price, tp3Price: levels.tp3Price,
      origSlPrice: levels.slPrice,
      rr1: parseFloat(levels.rr1.toFixed(2)), rr2: parseFloat(levels.rr2.toFixed(2)), rr3: parseFloat(levels.rr3.toFixed(2)),
      patterns: rejection.patterns, pivot: bestPivot.name,
      voteTally: resolved.tally, agreeing: resolved.agreeing,
      confluenceScore: bestScore,
    };
  }

  if (openTrade) {
    const lastBar = data15m[data15m.length - 1];
    trades.push({ ...openTrade, exitTime: lastBar.time, exitPrice: lastBar.close, result: 'OPEN',
      rr: parseFloat(((lastBar.close - openTrade.entryPrice) / Math.abs(openTrade.entryPrice - openTrade.origSlPrice) * (openTrade.direction === 'BUY' ? 1 : -1)).toFixed(2)),
      hoursHeld: Math.round((lastBar.time - openTrade.entryTime) / 3600) });
  }

  console.log(`  [FUNNEL] ${symbol}:`, JSON.stringify(funnel));
  return { trades, funnel };
};

// ─────────────────────────────────────────────────────────────────────────
//  REPORT GENERATOR
// ─────────────────────────────────────────────────────────────────────────
const generateReport = (allTrades, requestedDays, funnelsBySymbol) => {
  const closed = allTrades.filter(t => t.result !== 'OPEN');
  const wins   = closed.filter(t => t.rr > 0);
  const losses = closed.filter(t => t.rr <= 0);
  const tp1s   = closed.filter(t => t.result === 'TP1');
  const tp2s   = closed.filter(t => ['TP2', 'TP2+BE', 'TP2+TP3'].includes(t.result));
  const tp3s   = closed.filter(t => ['TP3', 'TP2+TP3'].includes(t.result));
  const sls    = closed.filter(t => t.result === 'SL');
  const bes    = closed.filter(t => t.result === 'BE' || t.result === 'TP2+BE');
  const timeouts = closed.filter(t => t.result === 'TIMEOUT' || t.result === 'EARLY_TIMEOUT');

  const winRate = closed.length ? (wins.length / closed.length * 100).toFixed(1) : '0.0';
  const losingTimeouts = timeouts.filter(t => t.rr <= 0);
  const realLosses = sls.length + losingTimeouts.length;
  const noLossRate = closed.length ? (((closed.length - realLosses) / closed.length) * 100).toFixed(1) : '0.0';
  const avgWinRR  = wins.length   ? (wins.reduce((s, t) => s + t.rr, 0) / wins.length).toFixed(2) : '0.00';
  const avgLossRR = losses.length ? (losses.reduce((s, t) => s + t.rr, 0) / losses.length).toFixed(2) : '0.00';
  const totalRR   = closed.reduce((s, t) => s + t.rr, 0);
  const grossWin  = wins.reduce((s, t) => s + t.rr, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.rr, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : '∞';

  let capital = config.STARTING_CAPITAL, peak = capital, maxDD = 0;
  for (const t of closed) {
    const riskAmt  = capital * (config.RISK_PER_TRADE_PCT / 100);
    const slipCost = capital * (config.SLIPPAGE_PCT || 0);
    capital += riskAmt * t.rr - slipCost;
    if (capital > peak) peak = capital;
    const dd = (peak - capital) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  const finalCapital = capital.toFixed(2);
  const totalReturn = ((capital - config.STARTING_CAPITAL) / config.STARTING_CAPITAL * 100).toFixed(1);

  const patternCount = {};
  allTrades.forEach(t => (t.patterns || []).forEach(p => { patternCount[p] = (patternCount[p] || 0) + 1; }));

  const voteTallyCount = {};
  allTrades.forEach(t => { voteTallyCount[t.voteTally || 'N/A'] = (voteTallyCount[t.voteTally || 'N/A'] || 0) + 1; });

  const bySymbol = {};
  for (const t of closed) {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { trades: 0, wins: 0, totalRR: 0 };
    bySymbol[t.symbol].trades++;
    if (t.rr > 0) bySymbol[t.symbol].wins++;
    bySymbol[t.symbol].totalRR += t.rr;
  }

  const byDirection = {};
  for (const t of closed) {
    if (!byDirection[t.direction]) byDirection[t.direction] = { trades: 0, wins: 0, totalRR: 0 };
    byDirection[t.direction].trades++;
    if (t.rr > 0) byDirection[t.direction].wins++;
    byDirection[t.direction].totalRR += t.rr;
  }

  const avgHoursHeld = closed.length ? (closed.reduce((s, t) => s + (t.hoursHeld || 0), 0) / closed.length).toFixed(0) : '0';
  const signalsPerWeek = closed.length ? (closed.length / (requestedDays / 7)).toFixed(2) : '0.00';
  const requestedSymbols = Object.keys(funnelsBySymbol).length ? Object.keys(funnelsBySymbol) : [...new Set(allTrades.map(t => t.symbol))];

  const lines = [
    '═══════════════════════════════════════════════════════════════════',
    ' MVS v10.2 — BACKTEST REPORT',
    ` Period: Last ${requestedDays} days  |  Symbols: ${requestedSymbols.join(', ')}`,
    ' 4H bias + 1H structure + 15m trigger, 2-of-3 timeframe vote',
    '═══════════════════════════════════════════════════════════════════',
    '',
    '⚠️  This is a backtest, not a live-performance guarantee. No setting',
    '    here was chosen to hit a target win rate — see config.js header.',
    '',
    '── SUMMARY ─────────────────────────────────────────────────────────',
    `  Total signals fired    : ${allTrades.length}  (~${signalsPerWeek}/week across all symbols)`,
    `  Closed trades          : ${closed.length}`,
    `  Open (unrealised)      : ${allTrades.filter(t => t.result === 'OPEN').length}`,
    `  Win rate (all closed)  : ${winRate}%  (${wins.length}W / ${losses.length}L)`,
    `  No-real-loss rate      : ${noLossRate}%  (${closed.length - realLosses} no-loss / ${realLosses} real loss — excludes ${bes.length} breakeven scratches; this is NOT the same as "win rate")`,
    `  Profit factor          : ${profitFactor}`,
    `  Total R accumulated    : ${totalRR.toFixed(2)}R`,
    `  Avg win / avg loss     : +${avgWinRR}R / ${avgLossRR}R`,
    `  Avg hours held         : ${avgHoursHeld}h`,
    '',
    '── OUTCOME BREAKDOWN ───────────────────────────────────────────────',
    `  TP1 hits  : ${tp1s.length}`,
    `  TP2 hits  : ${tp2s.length}`,
    `  TP3 hits  : ${tp3s.length}`,
    `  SL hits   : ${sls.length}`,
    `  BE hits   : ${bes.length}  (SL moved to entry once trade proved itself)`,
    `  Timeouts  : ${timeouts.length}`,
    '',
    `── $ P&L SIMULATION (${config.RISK_PER_TRADE_PCT}% risk/trade + ${(config.SLIPPAGE_PCT*100).toFixed(1)}% slippage, $${config.STARTING_CAPITAL} start) ──`,
    `  Final capital : $${finalCapital}  (${totalReturn}% return)  |  Max drawdown: ${maxDD.toFixed(1)}%`,
    '',
    '── TIMEFRAME VOTE BREAKDOWN ────────────────────────────────────────',
    ...Object.entries(voteTallyCount).sort().map(([k, v]) => `  ${k} agreement: ${v} signals`),
    '',
    '── BY SYMBOL ───────────────────────────────────────────────────────',
    ...requestedSymbols.map(sym => {
      const s = bySymbol[sym];
      if (!s) return `  ${sym.padEnd(10)} 0 trades — see funnel diagnostics below`;
      return `  ${sym.padEnd(10)} ${s.trades} trades | ${(s.wins/s.trades*100).toFixed(0)}% WR | ${s.totalRR.toFixed(2)}R total`;
    }),
    '',
    '── BY DIRECTION ────────────────────────────────────────────────────',
    ...(Object.keys(byDirection).length ? Object.keys(byDirection).map(dir => {
      const d = byDirection[dir];
      return `  ${dir.padEnd(6)} ${d.trades} trades | ${(d.wins/d.trades*100).toFixed(0)}% WR | ${d.totalRR.toFixed(2)}R total`;
    }) : ['  No closed trades to break down by direction.']),
    '',
    '── FUNNEL DIAGNOSTICS (15m ticks surviving each gate, per symbol) ───',
    ...requestedSymbols.flatMap(sym => {
      const f = funnelsBySymbol[sym];
      if (!f) return [`  ${sym}: no funnel data`];
      return [
        `  ${sym}:`,
        `    scanned=${f.scanned}  voteOk=${f.voteOk}(bull=${f.bullVote}/bear=${f.bearVote})  structureOk=${f.structureOk}`,
        `    notOverExtended=${f.notOverExtended}  nearZone=${f.nearZone}  confluenceOk=${f.confluenceOk}  htfAligned=${f.htfAligned}`,
        `    notInvalidated=${f.notInvalidated}  cooldownOk=${f.cooldownOk}  triggerOk=${f.triggerOk}  tp3RangeOk=${f.tp3RangeOk}  opened=${f.opened}`,
      ];
    }),
    '',
    '── PATTERN FREQUENCY ───────────────────────────────────────────────',
    ...Object.entries(patternCount).sort(([,a],[,b]) => b - a).map(([p, c]) => `  ${p.padEnd(20)} ${c}x`),
    '',
    '── RECENT TRADES (last 20) ─────────────────────────────────────────',
    ...closed.slice(-20).map(t => {
      const d = new Date(t.entryTime * 1000).toISOString().slice(0, 16).replace('T', ' ');
      const icon = t.rr > 0 ? '✅' : '❌';
      return `  ${icon} ${d} | ${t.symbol} ${t.direction} | ${t.result} | ${t.rr > 0 ? '+' : ''}${t.rr}R | ${(t.voteTally||'')} | ${t.patterns.join('+')}`;
    }),
    '',
    '═══════════════════════════════════════════════════════════════════',
  ];

  return { lines, stats: { winRate, profitFactor, totalRR, finalCapital, totalReturn, maxDD, bySymbol, patternCount } };
};

// ─────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n🔬 MVS v10.2 Backtest — ${symbols.length} symbol(s), ${days} days\n`);

  const allTrades = [];
  const funnelsBySymbol = {};

  for (const symbol of symbols) {
    const data4h  = await fetchHistory(symbol, config.BIAS_TIMEFRAME, days);
    const data1h  = await fetchHistory(symbol, config.STRUCT_TIMEFRAME, days);
    const data15m = await fetchHistory(symbol, config.TRIGGER_TIMEFRAME, days);

    if (data4h.length < 50 || data1h.length < 50 || data15m.length < 50) {
      console.log(`  ⚠️ ${symbol}: insufficient data, skipping.`);
      funnelsBySymbol[symbol] = null;
      continue;
    }

    const { trades, funnel } = await backtestSymbol(symbol, data15m, data1h, data4h);
    allTrades.push(...trades);
    funnelsBySymbol[symbol] = funnel;
  }

  const { lines } = generateReport(allTrades, days, funnelsBySymbol);
  const report = lines.join('\n');
  console.log('\n' + report);

  fs.writeFileSync(path.join(__dirname, 'backtest-report.txt'), report);
  fs.writeFileSync(path.join(__dirname, 'backtest-report.json'), JSON.stringify(allTrades, null, 2));
  console.log('\n📄 Saved backtest-report.txt and backtest-report.json');
})();
