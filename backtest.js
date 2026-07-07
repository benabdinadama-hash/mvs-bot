/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — BACKTESTER (backtest.js)  v10.13.1
 *
 *  Uses core.js — the EXACT same decision logic as strategy.js (live).
 *  No more hand-copied CONFIG or duplicated pure functions: this file
 *  previously kept its own independent copy of everything, which is why
 *  it drifted out of sync with strategy.js repeatedly (SELL_HTF_MULT_BOOST,
 *  POC_RECLAIM_SOLO, and PAIR_MIN_TP2_RR each existed in one file months
 *  before the other — every backtest report before v10.0 was testing a
 *  ruleset that wasn't quite what the live bot actually ran).
 *
 *  Replays 1D + 4H + 1H + 30m + 15m bias votes (3-of-5 direction, v10.10)
 *  tick-by-tick on the 15m clock (no lookahead — every check only sees
 *  bars up to "now"). 1H still supplies the structural zone, 15m still
 *  supplies the trigger candle — unchanged from the prior 3-TF version.
 *
 *  USAGE:
 *    node backtest.js                       ← all symbols, config.BACKTEST_DAYS
 *    node backtest.js SOL-USDT              ← single symbol
 *    node backtest.js SOL-USDT 180          ← single symbol, 180 days
 *    node backtest.js SOL-USDT,BTC-USDT 360 ← explicit multi-symbol
 *
 *    SL_ATR_MULT_MATRIX_ENABLED=true node backtest.js
 *      ← v10.7 EXPERIMENTAL: test the per-pivot SL-width variant (see
 *        config.js) without touching the committed config. Compare the
 *        resulting SL count / win rate / total R against a normal run.
 *
 *    POC_PROMINENCE_ENABLED=false POC_MIGRATION_ENABLED=false NAKED_POC_ENABLED=false node backtest.js
 *      ← v10.8/v10.9: these three are LIVE by default (see config.js) —
 *        use these env vars to run an A/B comparison against them being
 *        off, individually or together.
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
const BAR_SECONDS = { '15min': 900, '30min': 1800, '1hour': 3600, '4hour': 14400, '1day': 86400 };
const FETCH_MAX_RETRIES = 5;

// v10.4 FIX: fetchKlines used to catch every error (network blip, timeout,
// rate limit, non-200000 code) and return [] — indistinguishable from a
// SUCCESSFUL call that legitimately found no older candles (i.e. walked
// back past the symbol's listing date). fetchHistory's loop then did
// `if (!bars.length) break`, treating both cases identically: "stop
// paging, we've reached the beginning."
//
// This is exactly what produced LINK-USDT: 995 bars (~10 days) and
// AVAX-USDT: 6866 bars (~71 days) in the last backtest, instead of the
// ~64,000+ bars every other symbol got — a single transient failure
// partway through paging back 720 days silently truncated ALL older
// history for those two symbols. It had nothing to do with LINK or AVAX
// actually lacking history.
//
// Fix: fetchKlines now returns { ok, bars } so the caller can tell "call
// failed" (ok:false — retry, then skip just that one chunk and keep
// paging further back) apart from "call succeeded, no data" (ok:true,
// bars:[] — genuine end of history, safe to stop).
const fetchKlines = async (symbol, interval, startAt, endAt) => {
  const url = `${config.BASE_URL}/market/candles?symbol=${symbol}&type=${interval}&startAt=${startAt}&endAt=${endAt}`;
  for (let attempt = 1; attempt <= FETCH_MAX_RETRIES; attempt++) {
    try {
      const res = await axios.get(url, { timeout: 20000 });
      if (res.data.code !== '200000') {
        console.error(`\n  ⚠️  KuCoin ${res.data.code} for ${symbol} ${interval} (attempt ${attempt}/${FETCH_MAX_RETRIES}): ${res.data.msg || 'unknown'}`);
        if (attempt === FETCH_MAX_RETRIES) return { ok: false, bars: [] };
        await sleep(500 * attempt);
        continue;
      }
      const bars = (res.data.data || [])
        .map(k => ({ time: parseInt(k[0]), open: parseFloat(k[1]), close: parseFloat(k[2]), high: parseFloat(k[3]), low: parseFloat(k[4]), volume: parseFloat(k[5]) }))
        .sort((a, b) => a.time - b.time);
      return { ok: true, bars };
    } catch (e) {
      console.error(`\n  ⚠️  Fetch error for ${symbol} ${interval} (attempt ${attempt}/${FETCH_MAX_RETRIES}): ${e.message}`);
      if (attempt === FETCH_MAX_RETRIES) return { ok: false, bars: [] };
      await sleep(500 * attempt);
    }
  }
  return { ok: false, bars: [] };
};

const fetchHistory = async (symbol, interval, historyDays) => {
  const barSeconds = BAR_SECONDS[interval] || 3600;
  const endAt = Math.floor(Date.now() / 1000);
  const startAt = endAt - historyDays * 86400;
  let allBars = [];
  let chunkEnd = endAt;
  const chunkSize = 1500 * barSeconds;
  let hadGap = false;

  process.stdout.write(`  Fetching ${interval} history for ${symbol}...`);
  while (chunkEnd > startAt) {
    const chunkStart = Math.max(chunkEnd - chunkSize, startAt);
    const { ok, bars } = await fetchKlines(symbol, interval, chunkStart, chunkEnd);
    if (!ok) {
      // Real failure after retries — do NOT stop paging. Log it loudly and
      // move the window back past this chunk so a single bad chunk can't
      // truncate everything older than it.
      hadGap = true;
      console.error(`  ⚠️  Giving up on ${symbol} ${interval} chunk [${new Date(chunkStart * 1000).toISOString()} – ${new Date(chunkEnd * 1000).toISOString()}] after ${FETCH_MAX_RETRIES} retries — data will have a gap here, continuing further back.`);
      chunkEnd = chunkStart - 1;
      continue;
    }
    if (!bars.length) break; // genuine end of history — safe to stop
    allBars = [...bars, ...allBars];
    chunkEnd = bars[0].time - 1;
    process.stdout.write('.');
    await sleep(250);
  }
  const seen = new Set();
  allBars = allBars.filter(b => (seen.has(b.time) ? false : (seen.add(b.time), true))).sort((a, b) => a.time - b.time);
  console.log(` ${allBars.length} bars${hadGap ? '  ⚠️  INCOMPLETE — see warnings above' : ''}`);
  return allBars;
};

// ─────────────────────────────────────────────────────────────────────────
//  REPLAY ENGINE — walks the 15m clock, two-pointer sync on 1H/4H arrays
// ─────────────────────────────────────────────────────────────────────────
// v10.5 FIX: `days` used to be passed straight into fetchHistory as BOTH
// the evaluation window AND the only source of warmup data — meaning a
// request for a short window (e.g. `node backtest.js 30`) fetched exactly
// 30 days of 4H candles, but warming up the 4H volume profile needs
// BIAS_VP_LOOKBACK+5 = 205 bars = ~34.2 days on its own. Result: with
// `days` below ~35, warmup NEVER completes and every symbol silently
// returns scanned=0 — confirmed exactly this way in a 30-day run (every
// symbol: scanned=0, voteOk=0, ... opened=0), which looks like "the bot
// went quiet" but is actually just this arithmetic. Fix: always fetch an
// extra buffer of history for warmup, then only evaluate/open trades
// within the actual requested `days` window — see backtestSymbol().
const WARMUP_BUFFER_DAYS = 40; // covers the 34.2-day 4H warmup with margin
const backtestSymbol = async (symbol, data15m, data1h, data4h, data1d, data30m, evalWindowStartTime = 0) => {
  const trades = [];
  const cooldownMap = {};
  let openTrade = null;

  const funnel = {
    scanned: 0, voteOk: 0, bullVote: 0, bearVote: 0, structureOk: 0, notOverExtended: 0,
    nearZone: 0, confluenceOk: 0, htfAligned: 0, notInvalidated: 0, cooldownOk: 0,
    triggerOk: 0, prominenceOk: 0, tp2RangeOk: 0, opened: 0,
  };

  const warmup1h  = config.STRUCT_VP_LOOKBACK + config.ATR_PERIOD + 5;
  const warmup4h  = config.BIAS_VP_LOOKBACK + 5;
  const warmup15m = config.TRIGGER_VP_LOOKBACK + 5;
  // v10.10: two more warmup floors, same pattern as 1H/4H/15m above.
  const warmup1d  = config.DAILY_VP_LOOKBACK + 5;
  const warmup30m = config.HALF_VP_LOOKBACK + 5;

  // Find the first 15m index where all five timeframes have enough warmup data.
  let ptr1h = 0, ptr4h = 0, ptr1d = 0, ptr30m = 0;
  while (ptr1h  < data1h.length  - 1 && data1h[ptr1h + 1].time   <= data15m[0].time) ptr1h++;
  while (ptr4h  < data4h.length  - 1 && data4h[ptr4h + 1].time   <= data15m[0].time) ptr4h++;
  while (ptr1d  < data1d.length  - 1 && data1d[ptr1d + 1].time   <= data15m[0].time) ptr1d++;
  while (ptr30m < data30m.length - 1 && data30m[ptr30m + 1].time <= data15m[0].time) ptr30m++;

  let startIdx = warmup15m;
  while (startIdx < data15m.length) {
    const t = data15m[startIdx].time;
    let p1 = 0, p4 = 0, pD = 0, p30 = 0;
    while (p1  < data1h.length  - 1 && data1h[p1 + 1].time   <= t) p1++;
    while (p4  < data4h.length  - 1 && data4h[p4 + 1].time   <= t) p4++;
    while (pD  < data1d.length  - 1 && data1d[pD + 1].time   <= t) pD++;
    while (p30 < data30m.length - 1 && data30m[p30 + 1].time <= t) p30++;
    // v10.5 FIX: warmup satisfied is no longer sufficient on its own —
    // also require we've reached the actual requested evaluation window,
    // so the extra WARMUP_BUFFER_DAYS of history feeds warmup ONLY, and
    // never gets counted as part of the days the user asked to evaluate.
    // v10.10: 1D and 30m warmup floors added to the same check.
    if (p1 >= warmup1h && p4 >= warmup4h && pD >= warmup1d && p30 >= warmup30m && t >= evalWindowStartTime) break;
    startIdx++;
  }
  if (startIdx >= data15m.length) {
    console.log(`  [WARMUP] ${symbol}: insufficient history for warmup — skipping.`);
    return { trades: [], funnel };
  }

  console.log(`\n  Replaying ${data15m.length - startIdx} × 15m bars for ${symbol}...`);

  ptr1h = 0; ptr4h = 0; ptr1d = 0; ptr30m = 0;
  let cached1h = null, cached4h = null, cached1d = null, cached30m = null;

  for (let i = startIdx; i < data15m.length; i++) {
    const bar = data15m[i];

    // Advance pointers to the latest CLOSED bar as of this 15m tick, for
    // every timeframe that isn't recomputed every tick (1D/4H/1H/30m —
    // 15m itself is recomputed every tick below since its own window
    // slides every bar).
    let advanced1h = false, advanced4h = false, advanced1d = false, advanced30m = false;
    while (ptr1h  < data1h.length  - 1 && data1h[ptr1h + 1].time   <= bar.time) { ptr1h++;  advanced1h  = true; }
    while (ptr4h  < data4h.length  - 1 && data4h[ptr4h + 1].time   <= bar.time) { ptr4h++;  advanced4h  = true; }
    while (ptr1d  < data1d.length  - 1 && data1d[ptr1d + 1].time   <= bar.time) { ptr1d++;  advanced1d  = true; }
    while (ptr30m < data30m.length - 1 && data30m[ptr30m + 1].time <= bar.time) { ptr30m++; advanced30m = true; }

    // ── OPEN TRADE MANAGEMENT (checked every 15m tick for tighter fills) ──
    // v10.5 REDESIGN — see core.js/backtest.js header for the full story.
    // Old behavior: TP1 caused an INSTANT FULL CLOSE, checked only after
    // TP2 was confirmed not-yet-hit — so in ordinary gradual price moves,
    // TP1 always closed the whole trade before TP2/TP3 got a chance. TP2/
    // TP3 only fired on single-candle gap-throughs. New behavior: TP1 is
    // a genuine 50% partial exit that arms a hard breakeven stop for the
    // runner half, which then targets TP2 (the former TP3 — 1H VAH/VAL).
    if (openTrade) {
      // Layer 1 (unchanged from prior versions): halfway-to-TP1 early
      // breakeven protection. This is independent of the TP1 partial-exit
      // logic below — it's what converts "reached halfway then reversed"
      // into a scratch (BE) instead of a full loss (SL), for trades that
      // never make it all the way to TP1 in the first place.
      if (!openTrade.beMoved) {
        const halfway = openTrade.direction === 'BUY'
          ? openTrade.entryPrice + (openTrade.tp1Price - openTrade.entryPrice) * 0.5
          : openTrade.entryPrice - (openTrade.entryPrice - openTrade.tp1Price) * 0.5;
        const reached = openTrade.direction === 'BUY' ? bar.high >= halfway : bar.low <= halfway;
        if (reached) { openTrade.slPrice = openTrade.entryPrice; openTrade.beMoved = true; }
      }

      const { direction, entryPrice, slPrice, tp1Price, tp2Price, origSlPrice, rr1, rr2 } = openTrade;
      const origRisk = Math.abs(entryPrice - origSlPrice);
      const slRR = parseFloat((((slPrice - entryPrice) / origRisk) * (direction === 'BUY' ? 1 : -1)).toFixed(2));
      let outcome = null;

      // Layer 2 (new): TP1 arms the partial exit instead of closing everything.
      if (!openTrade.tp1Hit) {
        const tp1Hit = direction === 'BUY' ? bar.high >= tp1Price : bar.low <= tp1Price;
        if (tp1Hit) { openTrade.tp1Hit = true; openTrade.halfR = rr1; openTrade.slPrice = entryPrice; }
      }

      if (openTrade.tp1Hit) {
        // Half position already banked at TP1 (rr1). Remaining half is
        // protected by a hard breakeven stop and targets TP2 (VAH/VAL).
        if (direction === 'BUY') {
          if      (bar.low  <= openTrade.slPrice) outcome = { result: 'TP1+BE', exitPrice: openTrade.slPrice, rr: parseFloat((openTrade.halfR * config.PARTIAL_EXIT_PCT).toFixed(2)) };
          else if (bar.high >= tp2Price)          outcome = { result: 'TP1+TP2', exitPrice: tp2Price,          rr: parseFloat((openTrade.halfR * config.PARTIAL_EXIT_PCT + rr2 * (1 - config.PARTIAL_EXIT_PCT)).toFixed(2)) };
        } else {
          if      (bar.high >= openTrade.slPrice) outcome = { result: 'TP1+BE', exitPrice: openTrade.slPrice, rr: parseFloat((openTrade.halfR * config.PARTIAL_EXIT_PCT).toFixed(2)) };
          else if (bar.low  <= tp2Price)          outcome = { result: 'TP1+TP2', exitPrice: tp2Price,          rr: parseFloat((openTrade.halfR * config.PARTIAL_EXIT_PCT + rr2 * (1 - config.PARTIAL_EXIT_PCT)).toFixed(2)) };
        }
      } else {
        // Full position still live, targeting TP1, protected by whatever
        // Layer 1 currently has slPrice set to (original SL, or breakeven
        // if halfway was already reached).
        if (direction === 'BUY') {
          if (bar.low  <= slPrice) outcome = { result: slRR === 0 ? 'BE' : 'SL', exitPrice: slPrice, rr: slRR };
        } else {
          if (bar.high >= slPrice) outcome = { result: slRR === 0 ? 'BE' : 'SL', exitPrice: slPrice, rr: slRR };
        }
      }

      if (outcome) {
        trades.push({ ...openTrade, exitTime: bar.time, exitPrice: outcome.exitPrice, result: outcome.result, rr: parseFloat(outcome.rr),
          hoursHeld: Math.round((bar.time - openTrade.entryTime) / 3600) });
        openTrade = null;
        continue;
      }

      // Early time-stop: only while still waiting on TP1 (full position live).
      if (!openTrade.tp1Hit && (bar.time - openTrade.entryTime) > config.EARLY_TIMEOUT_BARS * config.STRUCT_BAR_SECONDS) {
        const price = bar.close;
        trades.push({ ...openTrade, exitTime: bar.time, exitPrice: price, result: 'EARLY_TIMEOUT',
          rr: parseFloat(((price - openTrade.entryPrice) / Math.abs(openTrade.entryPrice - openTrade.origSlPrice) * (openTrade.direction === 'BUY' ? 1 : -1)).toFixed(2)),
          hoursHeld: Math.round((bar.time - openTrade.entryTime) / 3600) });
        openTrade = null;
        continue;
      }
      // Max hold: 200 structure(1H) bars ≈ 8.3 days. v10.5 FIX: if TP1 was
      // already banked, blend that locked-in rr1 with the live price on
      // the runner half instead of naively computing RR off the full
      // original position — the old code ignored tp1Hit here entirely,
      // which would have understated (or overstated) realized R for any
      // partial-exit trade that timed out on the runner leg.
      if ((bar.time - openTrade.entryTime) > 200 * config.STRUCT_BAR_SECONDS) {
        const price = bar.close;
        const liveLegRR = (price - openTrade.entryPrice) / Math.abs(openTrade.entryPrice - openTrade.origSlPrice) * (openTrade.direction === 'BUY' ? 1 : -1);
        const rr = openTrade.tp1Hit ? (openTrade.halfR * config.PARTIAL_EXIT_PCT + liveLegRR * (1 - config.PARTIAL_EXIT_PCT)) : liveLegRR;
        trades.push({ ...openTrade, exitTime: bar.time, exitPrice: price, result: 'TIMEOUT',
          rr: parseFloat(rr.toFixed(2)),
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
      // v10.8/v10.9 (live by default): POC_MIGRATION and NAKED_POC both
      // need more
      // history than window1h carries (750/1000 bars vs window1h's ~519)
      // — computed here, alongside window1h, so it's recomputed on the
      // same 1H-bar-close cadence rather than every 15m tick. Left equal
      // to window1h (free — no extra slicing) whenever both flags are
      // off, which is the default.
      let pocWideWindow1h = window1h;
      if (config.NAKED_POC_ENABLED || config.POC_MIGRATION_ENABLED) {
        let requiredBars = config.STRUCT_VP_LOOKBACK;
        if (config.NAKED_POC_ENABLED) requiredBars = Math.max(requiredBars, config.STRUCT_VP_LOOKBACK * 2);
        if (config.POC_MIGRATION_ENABLED) requiredBars = Math.max(requiredBars, config.STRUCT_VP_LOOKBACK + config.POC_MIGRATION_OFFSET_BARS);
        const wWideStart = Math.max(0, ptr1h + 1 - requiredBars);
        pocWideWindow1h = data1h.slice(wWideStart, ptr1h + 1);
      }
      cached1h = bias1h && atr1h ? { bias1h, atr1h, window1h, pocWideWindow1h } : null;
    }
    // ── Recompute 4H bias only when a new 4H bar closed ──────────────────
    if (advanced4h || !cached4h) {
      const w4Start = Math.max(0, ptr4h + 1 - (config.BIAS_VP_LOOKBACK + 5));
      const window4h = data4h.slice(w4Start, ptr4h + 1);
      const bias4h = core.tfBiasVote(window4h, config.BIAS_VP_LOOKBACK, config.BIAS_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);
      cached4h = bias4h;
    }
    // ── Recompute 1D bias only when a new 1D bar closed (v10.10, NEW) ────
    if (advanced1d || !cached1d) {
      const wDStart = Math.max(0, ptr1d + 1 - (config.DAILY_VP_LOOKBACK + 5));
      const windowD = data1d.slice(wDStart, ptr1d + 1);
      cached1d = data1d.length ? core.tfBiasVote(windowD, config.DAILY_VP_LOOKBACK, config.DAILY_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT) : null;
    }
    // ── Recompute 30m bias only when a new 30m bar closed (v10.10, NEW) ──
    if (advanced30m || !cached30m) {
      const w30Start = Math.max(0, ptr30m + 1 - (config.HALF_VP_LOOKBACK + 5));
      const window30 = data30m.slice(w30Start, ptr30m + 1);
      cached30m = data30m.length ? core.tfBiasVote(window30, config.HALF_VP_LOOKBACK, config.HALF_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT) : null;
    }
    if (!cached1h) continue;

    // ── 15m bias recomputed every tick (its window slides every bar) ────
    // Bounded slice (not slice(0, i+1)) — an unbounded slice that grows
    // every tick is O(n^2) over a 720-day backtest (~69,000 ticks) for no
    // benefit, since tfBiasVote/detectRejection only ever look at the tail.
    const win15mStart = Math.max(0, i + 1 - (config.TRIGGER_VP_LOOKBACK + 5));
    const window15m = data15m.slice(win15mStart, i + 1);
    const bias15m = core.tfBiasVote(window15m, config.TRIGGER_VP_LOOKBACK, config.TRIGGER_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);

    // v10.10: 5-way vote (1D/4H/1H/30m/15m), 3-of-5 required — see
    // config.MIN_TF_AGREE and core.js resolveDirection().
    const resolved = core.resolveDirection([
      { tf: '1D',  result: cached1d },
      { tf: '4H',  result: cached4h },
      { tf: '1H',  result: cached1h.bias1h },
      { tf: '30m', result: cached30m },
      { tf: '15m', result: bias15m },
    ], config.MIN_TF_AGREE);
    if (!resolved) continue;
    funnel.voteOk++;
    if (resolved.direction === 'BUY') funnel.bullVote++; else funnel.bearVote++;

    const direction = resolved.direction;
    const { bias1h, atr1h, window1h, pocWideWindow1h } = cached1h;
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
    // v10.12: mirrors the live gate in strategy.js — see config.js
    // POC_REQUIRE_1H_CONFIRM for rationale. Must stay in sync with the
    // live file or the backtest stops meaning anything about live
    // behavior (see this file's own v10.4 fix-log entry about exactly
    // that class of drift).
    if (bestPivot.name === 'POC' && config.POC_REQUIRE_1H_CONFIRM && !resolved.agreeing.includes('1H')) continue;
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

    // v10.13: POC prominence gate — computed here (once) so it can both
    // gate the trade AND be reused below without recomputing. Mirrors the
    // live gate in strategy.js — see config.js POC_PROMINENCE_REQUIRE_DECISIVE
    // for the per-trade evidence behind this.
    const prominenceForGate = core.computePOCProminence(vp1h);
    if (!core.isPOCProminenceTrusted(bestPivot.name, prominenceForGate, config)) continue;
    funnel.prominenceOk++;

    // v10.7 EXPERIMENTAL (off by default — see config.js SL_ATR_MULT_MATRIX):
    // identical lookup to strategy.js, same reasoning: no live/backtest
    // drift on this the way earlier versions drifted on the near-zone gate.
    const slAtrMult = config.SL_ATR_MULT_MATRIX_ENABLED && config.SL_ATR_MULT_MATRIX[bestPivot.name] != null
      ? config.SL_ATR_MULT_MATRIX[bestPivot.name]
      : config.SL_ATR_MULT;
    const levels = core.computeTradeLevels({
      direction, entryPrice: bestFibLevel, swing: swing1h, atr: atr1h, vp: vp1h,
      slAtrMult, tp1RrFloor: config.TP1_RR_FLOOR, fibLevel500: fib.level500,
      tp2MinExtensionRR: config.TP2_MIN_EXTENSION_RR,
    });
    if (!levels) continue;
    funnel.tp2RangeOk++;
    funnel.opened++;

    // v10.6: TD Sequential "9" — same computation as strategy.js, using
    // the identical window1h that fed bias1h/atr1h this tick, so live and
    // backtest can never drift on this the way earlier versions drifted
    // on the near-zone gate (see core.js v10.1 fix log).
    const td9 = config.TD9_ENABLED ? core.computeTDSequential(window1h) : { buy9: false, sell9: false };
    const td9Confirms = (direction === 'BUY' && td9.buy9) || (direction === 'SELL' && td9.sell9);

    // v10.8 (live as of v10.9) — same three computations as strategy.js,
    // using pocWideWindow1h (cached alongside window1h — see the 1H cache
    // block above) so live and backtest can never drift on this either.
    // prominence reuses the value already computed at the gate above
    // (v10.13) rather than calling computePOCProminence() twice.
    const prominence = prominenceForGate;
    const migration = core.computePOCMigration(
      pocWideWindow1h, config.STRUCT_VP_LOOKBACK, config.VP_ROWS,
      config.POC_MIGRATION_OFFSET_BARS, atr1h, config.POC_MIGRATION_MIN_ATR
    );
    const nakedPOC = core.computeNakedPOC(
      pocWideWindow1h, config.STRUCT_VP_LOOKBACK, config.VP_ROWS,
      atr1h, vp1h.pocPrice, config.NAKED_POC_TOLERANCE_ATR
    );

    cooldownMap[direction] = bar.time;
    openTrade = {
      symbol, direction,
      entryTime: bar.time,
      entryPrice: bestFibLevel, slPrice: levels.slPrice, tp1Price: levels.tp1Price, tp2Price: levels.tp2Price,
      origSlPrice: levels.slPrice,
      rr1: parseFloat(levels.rr1.toFixed(2)), rr2: parseFloat(levels.rr2.toFixed(2)),
      patterns: rejection.patterns, pivot: bestPivot.name,
      voteTally: resolved.tally, agreeing: resolved.agreeing,
      confluenceScore: bestScore, td9Confirms, slAtrMult,
      prominence, migration, nakedPOC,
    };
  }

  if (openTrade) {
    const lastBar = data15m[data15m.length - 1];
    // v10.6 FIX: this had the same blending gap that TIMEOUT had before
    // the v10.5 fix above — if TP1 was already banked on the trade still
    // open at the end of the backtest window, the unrealized R needs the
    // same halfR-blend, not a naive full-position calc from entry.
    const liveLegRR = (lastBar.close - openTrade.entryPrice) / Math.abs(openTrade.entryPrice - openTrade.origSlPrice) * (openTrade.direction === 'BUY' ? 1 : -1);
    const openRR = openTrade.tp1Hit ? (openTrade.halfR * config.PARTIAL_EXIT_PCT + liveLegRR * (1 - config.PARTIAL_EXIT_PCT)) : liveLegRR;
    trades.push({ ...openTrade, exitTime: lastBar.time, exitPrice: lastBar.close, result: 'OPEN',
      rr: parseFloat(openRR.toFixed(2)),
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
  // v10.5: result set changed — 'TP1' (old full-close) and all TP3-based
  // results are gone. New set: SL, BE (true 0R scratch, never reached
  // TP1), TP1+BE (banked TP1, gave back the runner half at breakeven —
  // still a REAL win, ~0.5×rr1, not a scratch), TP1+TP2 (both halves won),
  // EARLY_TIMEOUT, TIMEOUT.
  const tp1Reached = closed.filter(t => ['TP1+BE', 'TP1+TP2'].includes(t.result));
  const tp2Reached = closed.filter(t => t.result === 'TP1+TP2');
  const partialWins = closed.filter(t => t.result === 'TP1+BE');
  const sls    = closed.filter(t => t.result === 'SL');
  const bes    = closed.filter(t => t.result === 'BE'); // true 0R scratches only
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
    // v10.3/v10.4/v10.6/v10.7/v10.9: position size scaled by
    // computeRiskMultiplier — see config.js RISK_TIER_MATRIX /
    // PATTERN_RISK_MATRIX / TD9_BOOST_MULT / SL_ATR_MULT_MATRIX for the
    // backing data (SL_ATR_MULT_MATRIX is still experimental/off by
    // default — t.slAtrMult equals config.SL_ATR_MULT for every trade
    // unless it was explicitly enabled for this run).
    let riskMult = core.computeRiskMultiplier(t.pivot, t.agreeing, t.patterns, config.RISK_TIER_MATRIX, config.PATTERN_RISK_MATRIX, config.RISK_TIER_DEFAULT, t.td9Confirms, config.TD9_BOOST_MULT, t.slAtrMult, config.SL_ATR_MULT);
    // v10.8/v10.9: POC quality factors (prominence/migration/naked POC),
    // live by default — same combination logic as strategy.js, applied
    // here so the backtest's $ P&L simulation reflects live sizing
    // exactly, not an approximation of it.
    riskMult *= core.computePOCQualityMultiplier(t.pivot, t.direction, t.prominence, t.migration, t.nakedPOC, config);
    riskMult = Math.max(0.1, Math.min(1.0, riskMult));
    const riskAmt  = capital * (config.RISK_PER_TRADE_PCT / 100) * riskMult;
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

  // v10.3: confidence-tier breakdown — does 1H confirm the trade direction?
  // (agreeing includes '1H') vs not (agreeing == ['15m','4H'] only). See
  // core.js computeRiskMultiplier() for why this split exists.
  const byTier = {};
  for (const t of closed) {
    const tier = (t.agreeing || []).includes('1H') ? '1H-confirmed' : 'no-1H-confirm';
    if (!byTier[tier]) byTier[tier] = { trades: 0, wins: 0, sl: 0, totalRR: 0 };
    byTier[tier].trades++;
    if (t.rr > 0) byTier[tier].wins++;
    if (t.result === 'SL') byTier[tier].sl++;
    byTier[tier].totalRR += t.rr;
  }
  const byPivotTier = {};
  for (const t of closed) {
    const key = t.pivot || 'N/A';
    if (!byPivotTier[key]) byPivotTier[key] = { trades: 0, wins: 0, sl: 0, totalRR: 0 };
    byPivotTier[key].trades++;
    if (t.rr > 0) byPivotTier[key].wins++;
    if (t.result === 'SL') byPivotTier[key].sl++;
    byPivotTier[key].totalRR += t.rr;
  }

  const avgHoursHeld = closed.length ? (closed.reduce((s, t) => s + (t.hoursHeld || 0), 0) / closed.length).toFixed(0) : '0';
  const signalsPerWeek = closed.length ? (closed.length / (requestedDays / 7)).toFixed(2) : '0.00';
  const requestedSymbols = Object.keys(funnelsBySymbol).length ? Object.keys(funnelsBySymbol) : [...new Set(allTrades.map(t => t.symbol))];

  const lines = [
    '═══════════════════════════════════════════════════════════════════',
    ' MVS v10.10 — BACKTEST REPORT',
    ` Period: Last ${requestedDays} days  |  Symbols: ${requestedSymbols.join(', ')}`,
    ' 1D+4H+1H+30m+15m — 3-of-5 timeframe vote (1H zone, 15m trigger)',
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
    `  TP1 reached (partial banked) : ${tp1Reached.length}`,
    `  TP2 reached (full target)    : ${tp2Reached.length}`,
    `    ..of which runner gave back to BE : ${partialWins.length}`,
    `  SL hits                      : ${sls.length}`,
    `  BE hits (never reached TP1)  : ${bes.length}`,
    `  Timeouts                     : ${timeouts.length}`,
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
    '── BY CONFIDENCE TIER (v10.3 — drives RISK_MULT_NO_1H_CONFIRM) ──────',
    ...Object.entries(byTier).map(([k, v]) =>
      `  ${k.padEnd(15)} ${v.trades} trades | ${(v.wins/v.trades*100).toFixed(1)}% WR | ${v.sl} SL | ${v.totalRR.toFixed(2)}R total`),
    '',
    '── BY PIVOT (v10.3 — drives RISK_MULT_BY_PIVOT) ─────────────────────',
    ...Object.entries(byPivotTier).map(([k, v]) =>
      `  ${k.padEnd(15)} ${v.trades} trades | ${(v.wins/v.trades*100).toFixed(1)}% WR | ${v.sl} SL | ${v.totalRR.toFixed(2)}R total`),
    '',
    '── FUNNEL DIAGNOSTICS (15m ticks surviving each gate, per symbol) ───',
    ...requestedSymbols.flatMap(sym => {
      const f = funnelsBySymbol[sym];
      if (!f) return [`  ${sym}: no funnel data`];
      return [
        `  ${sym}:`,
        `    scanned=${f.scanned}  voteOk=${f.voteOk}(bull=${f.bullVote}/bear=${f.bearVote})  structureOk=${f.structureOk}`,
        `    notOverExtended=${f.notOverExtended}  nearZone=${f.nearZone}  confluenceOk=${f.confluenceOk}  htfAligned=${f.htfAligned}`,
        `    notInvalidated=${f.notInvalidated}  cooldownOk=${f.cooldownOk}  triggerOk=${f.triggerOk}  prominenceOk=${f.prominenceOk}  tp2RangeOk=${f.tp2RangeOk}  opened=${f.opened}`,
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
  console.log(`\n🔬 MVS v10.10 Backtest — ${symbols.length} symbol(s), ${days} days\n`);

  const allTrades = [];
  const funnelsBySymbol = {};
  // v10.5 FIX: fetch days+WARMUP_BUFFER_DAYS so short windows (e.g. 30)
  // still have enough history to warm up the 4H volume profile (~34.2
  // days) BEFORE the requested evaluation window starts. evalWindowStartTime
  // tells backtestSymbol() where the real "start counting" line is.
  const fetchDays = days + WARMUP_BUFFER_DAYS;
  const evalWindowStartTime = Math.floor(Date.now() / 1000) - days * 86400;

  for (const symbol of symbols) {
    const data1d  = await fetchHistory(symbol, config.DAILY_TIMEFRAME, fetchDays);
    const data4h  = await fetchHistory(symbol, config.BIAS_TIMEFRAME, fetchDays);
    const data1h  = await fetchHistory(symbol, config.STRUCT_TIMEFRAME, fetchDays);
    const data30m = await fetchHistory(symbol, config.HALF_TIMEFRAME, fetchDays);
    const data15m = await fetchHistory(symbol, config.TRIGGER_TIMEFRAME, fetchDays);

    // v10.10: 1D and 30m are treated as optional/best-effort here, same
    // tolerance strategy.js gives 1D/4H — a thin or gappy history on
    // either just means fewer possible agreeing votes for that symbol,
    // not a hard skip. 1H and 15m remain the two REQUIRED timeframes,
    // since 1H still supplies the structural zone and 15m the trigger.
    if (data1h.length < 50 || data15m.length < 50) {
      console.log(`  ⚠️ ${symbol}: insufficient 1H/15m data, skipping.`);
      funnelsBySymbol[symbol] = null;
      continue;
    }

    const { trades, funnel } = await backtestSymbol(symbol, data15m, data1h, data4h, data1d, data30m, evalWindowStartTime);
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
