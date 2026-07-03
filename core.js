/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — CORE STRATEGY LOGIC (core.js)  v10.2
 *
 *  Every pure function used to decide BUY/SELL/NO-TRADE lives here, and
 *  ONLY here. strategy.js (live/Telegram) and backtest.js (simulation)
 *  both require() this file instead of keeping their own copies.
 *
 *  WHY THIS FILE EXISTS:
 *  Every prior version kept two independent copies of the same logic —
 *  one in strategy.js, one in backtest.js. They drifted apart repeatedly
 *  (confirmed: strategy.js's check4HZoneAlignment() referenced a
 *  `direction` variable that was never passed in, so it threw on every
 *  call once a setup reached it — while backtest.js's copy of the same
 *  function had the parameter and worked fine). That single bug is the
 *  most likely reason live signals stayed at zero while backtests fired.
 *  A shared module makes that entire class of bug impossible: fix it
 *  once, it's fixed everywhere.
 *
 *  THREE-TIMEFRAME ARCHITECTURE (v10.0):
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  4H   → macro bias vote  (POC/VAH/VAL/Fib50 — same as before)       │
 *  │  1H   → structure TF: swing, Fib golden pocket, POC/VAH/VAL zone    │
 *  │  15m  → trigger TF: the actual rejection candle that fires entry    │
 *  │                                                                     │
 *  │  Direction requires 2-of-3 timeframes to agree (4H/1H/15m each      │
 *  │  cast one BULLISH/BEARISH/NEUTRAL vote using the same POC/VAH/VAL/  │
 *  │  Fib50 structural vote). This is what "1H + 15m combo, confirmed    │
 *  │  by 4H" means mechanically: no single timeframe can force a trade   │
 *  │  on its own.                                                        │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 *  HONESTY NOTE: nothing in here targets or claims a specific win rate.
 *  Per-symbol / per-direction filter overrides that existed in prior
 *  versions (tuned against one 85-trade backtest) have been removed.
 *  Every symbol and every direction runs through the identical rule set.
 *  That is a deliberate choice to reduce overfitting, not an oversight.
 *
 *  v10.1 FIX LOG (2026-07-02):
 *  ─ isNearZone() added and now shared by strategy.js + backtest.js. Found
 *    strategy.js was applying a ~1.1×ATR "close enough to the 1H zone"
 *    band (fib.zoneLow - atr*0.1 - atr) while backtest.js applied exactly
 *    ±1.0×ATR. Same class of bug the v10.0 rewrite was meant to eliminate:
 *    live was quietly running looser than what the backtest report
 *    (55.7% WR / PF 7.30 / 97 signals over 720d) actually measured. Fixed
 *    by moving the check into this file so there is only one copy of the
 *    threshold. See NEAR_ZONE_ATR_MULT in config.js.
 *
 *  v10.2 FREQUENCY PASS (2026-07-02, requested by user — traded win rate
 *  for signal count, on purpose, with eyes open):
 *  ─ detectRejection()'s solo-trigger pattern list moved out of this file
 *    into config.SOLO_ELIGIBLE_PATTERNS (was hardcoded to 2 patterns here).
 *  ─ No win-probability logic changed — every gate below still runs the
 *    same math on every symbol/direction. Only the THRESHOLDS moved (see
 *    config.js v10.2 notes). This file's job (identical live/backtest
 *    logic is unaffected by that — thresholds live in config either way.
 *
 *  v10.3 RISK-TIERING PASS (2026-07-02, requested by user — analyzed the
 *  v10.2 backtest-report.json to find the actual source of every SL):
 *  ─ Added computeRiskMultiplier(). NOT a new entry gate — no trade that
 *    used to fire is now blocked, and frequency is unchanged. It only
 *    scales position size down for two segments the trade log shows are
 *    structurally weaker (see function comment for the exact numbers).
 *  ─ User asked whether excluding 4H would help, on the theory that 4H's
 *    far/slow levels fight against 1H/15m chop. The trade log says the
 *    opposite: 1H+4H is the single best-performing combo (88.9% WR, 0
 *    SL/18). The actual weak segment is trades where 1H does NOT agree
 *    with the direction (agreeing == 15m+4H only) — that combo owns 83%
 *    of all SLs. 4H isn't the problem; 1H disagreement is. Handled via
 *    sizing here rather than excluding 4H or blocking that combo outright,
 *    since blocking it would cut ~78% of signal volume.
 *
 *  v10.4 FIX LOG (2026-07-03, from backtest-report.json — 215 closed
 *  trades, v10.3 ruleset):
 *  ─ TP3 minimum extension added (see computeTradeLevels). The v10.3
 *    report showed TP3 hits: 0 across 216 signals — not bad luck. Median
 *    gap between TP2 and TP3, on the 19 trades that actually reached TP2,
 *    was 0.09R (min 0.00R). TP3 = current 1H VAH/VAL, TP1 = max(50% Fib,
 *    entry + 1.2R), and the only prior check was tp3Price > tp1Price with
 *    NO minimum margin — so trades where the value-area edge sat only
 *    fractions of a cent past TP1 still passed, then the trailing stop
 *    (moved to TP2 the moment TP2 hits) sat close enough to TP3 that
 *    ordinary 15m noise closed the trade before TP3 could ever register.
 *    See config.js TP3_MIN_EXTENSION_RR.
 *  ─ computeRiskMultiplier extended to also weigh in POC_RECLAIM pattern
 *    presence (see updated function header below). Independent, data-
 *    confirmed finding across THREE separate backtests now (this file's
 *    v10.3 log above only sliced by pivot × 1H-confirm; this is a second,
 *    orthogonal factor found in the same trade log). Position-size only —
 *    frequency and win-rate-by-count are both unaffected, exactly like
 *    the v10.3 change above.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────
//  ATR — Average True Range (Wilder smoothing)
// ─────────────────────────────────────────────────────────────────────────
const calcATR = (data, period = 14) => {
  if (data.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < data.length; i++) {
    const c = data[i], p = data[i - 1];
    trs.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    ));
  }
  if (trs.length < period) return null;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
};

// ─────────────────────────────────────────────────────────────────────────
//  FIBONACCI — direction-aware, all 6 levels
// ─────────────────────────────────────────────────────────────────────────
const calcFib = (high, low, direction, zoneLowPct = 0.60, zoneHighPct = 0.80) => {
  const diff = high - low;
  if (direction === 'SELL') {
    return {
      level236: low + diff * 0.236,
      level382: low + diff * 0.382,
      level500: low + diff * 0.500,
      level618: low + diff * 0.618,
      level786: low + diff * 0.786,
      level886: low + diff * 0.886,
      zoneLow:  low + diff * zoneLowPct,
      zoneHigh: low + diff * zoneHighPct,
      swingHigh: high, swingLow: low,
    };
  }
  return {
    level236: high - diff * 0.236,
    level382: high - diff * 0.382,
    level500: high - diff * 0.500,
    level618: high - diff * 0.618,
    level786: high - diff * 0.786,
    level886: high - diff * 0.886,
    zoneHigh: high - diff * zoneLowPct,
    zoneLow:  high - diff * zoneHighPct,
    swingHigh: high, swingLow: low,
  };
};

// ─────────────────────────────────────────────────────────────────────────
//  VOLUME PROFILE — POC + VAH + VAL
//  `lookback` and `rows` are passed explicitly so 4H/1H/15m can each use
//  their own window instead of sharing one global setting.
// ─────────────────────────────────────────────────────────────────────────
const calcVolumeProfile = (data, lookback, rows = 100, valueAreaPct = 0.70) => {
  const workingBars = data.slice(-lookback);
  if (workingBars.length < 4) return null;

  const high  = Math.max(...workingBars.map(d => d.high));
  const low   = Math.min(...workingBars.map(d => d.low));
  const range = high - low;
  if (range === 0 || !isFinite(range)) return null;

  const rowSize = range / rows;
  const bins = {};
  workingBars.forEach(d => {
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

  const pocPrice = low + (pocIdx + 0.5) * rowSize;

  // Expand from POC until valueAreaPct of volume is captured. Each side is
  // marked exhausted the moment it hits an edge so this always terminates.
  const targetVol = totalVol * valueAreaPct;
  let cumVol = volArr[pocIdx];
  let loIdx = pocIdx, hiIdx = pocIdx;

  while (cumVol < targetVol && (loIdx > 0 || hiIdx < rows - 1)) {
    const lowOpen  = loIdx > 0;
    const highOpen = hiIdx < rows - 1;
    if (!lowOpen && !highOpen) break;
    const addLow  = lowOpen  ? volArr[loIdx - 1] : -Infinity;
    const addHigh = highOpen ? volArr[hiIdx + 1] : -Infinity;
    if (highOpen && (!lowOpen || addHigh >= addLow)) {
      hiIdx++; cumVol += volArr[hiIdx];
    } else {
      loIdx--; cumVol += volArr[loIdx];
    }
  }

  const valPrice = low + (loIdx + 0.5) * rowSize;
  const vahPrice = low + (hiIdx + 0.5) * rowSize;

  return { pocPrice, vahPrice, valPrice, maxVol, totalVol, barCount: workingBars.length };
};

// ─────────────────────────────────────────────────────────────────────────
//  TIMEFRAME BIAS VOTE
//  Same 4-pillar vote (POC / VAH / VAL / Fib50) applied generically to
//  whichever timeframe's data you pass in. Used for 4H, 1H, and 15m.
//  3-4 bull votes → BULLISH | 3-4 bear votes → BEARISH | else NEUTRAL.
// ─────────────────────────────────────────────────────────────────────────
const tfBiasVote = (data, vpLookback, fibLookback, rows = 100, valueAreaPct = 0.70) => {
  if (data.length < Math.min(vpLookback, fibLookback, 30)) return null;

  const price = data[data.length - 1].close;
  const vp = calcVolumeProfile(data, vpLookback, rows, valueAreaPct);
  if (!vp) return null;

  const fibData = data.slice(-fibLookback);
  const swing = {
    high: Math.max(...fibData.map(d => d.high)),
    low:  Math.min(...fibData.map(d => d.low)),
  };
  const fibMid = (swing.high + swing.low) / 2;

  const votes = {
    poc: price >= vp.pocPrice ? 'BULL' : 'BEAR',
    vah: price >= vp.vahPrice ? 'BULL' : 'BEAR',
    val: price >= vp.valPrice ? 'BULL' : 'BEAR',
    fib: price >= fibMid      ? 'BULL' : 'BEAR',
  };
  const bullVotes = Object.values(votes).filter(v => v === 'BULL').length;

  let bias;
  if      (bullVotes >= 3) bias = 'BULLISH';
  else if (bullVotes <= 1) bias = 'BEARISH';
  else                     bias = 'NEUTRAL';

  return { bias, bullVotes, price, poc: vp.pocPrice, vah: vp.vahPrice, val: vp.valPrice, fibMid, votes, swing, vp };
};

// ─────────────────────────────────────────────────────────────────────────
//  NEAR-ZONE GATE — is price close enough to the 1H Fib pocket to bother
//  checking confluence at all? (bug fix: strategy.js used to hand-roll this
//  with an extra +0.1×ATR pad baked in on top of the ±1×ATR band, so live
//  ran a ~1.1×ATR band while backtest.js ran ~1.0×ATR — a silent drift
//  between what was tested and what actually fired live. Both files now
//  call this one function with the same config constant.)
// ─────────────────────────────────────────────────────────────────────────
const isNearZone = (price, fib, atr, padMult) => {
  const lo = fib.zoneLow  - atr * padMult;
  const hi = fib.zoneHigh + atr * padMult;
  return price >= lo && price <= hi;
};

// ─────────────────────────────────────────────────────────────────────────
//  2-OF-3 TIMEFRAME DIRECTION RESOLUTION
//  votes: [{ tf: '4H', result: <tfBiasVote output or null> }, ...]
//  Returns { direction, agreeing: [tf,...], tally } or null if no 2-of-3.
// ─────────────────────────────────────────────────────────────────────────
const resolveDirection = (votes) => {
  const usable = votes.filter(v => v.result && v.result.bias !== 'NEUTRAL');
  const bulls  = usable.filter(v => v.result.bias === 'BULLISH').map(v => v.tf);
  const bears  = usable.filter(v => v.result.bias === 'BEARISH').map(v => v.tf);

  if (bulls.length >= 2) return { direction: 'BUY',  agreeing: bulls, tally: `${bulls.length}/3` };
  if (bears.length >= 2) return { direction: 'SELL', agreeing: bears, tally: `${bears.length}/3` };
  return null;
};

// ─────────────────────────────────────────────────────────────────────────
//  CONFLUENCE ENGINE — how tightly a Fib level overlaps a volume pivot
//  Score 2 = tight (within 0.5×tol) | Score 1 = loose (within 1×tol)
// ─────────────────────────────────────────────────────────────────────────
const confluenceScore = (fibLevel, pivot, atr, atrMult) => {
  if (!pivot || !fibLevel || !atr || !isFinite(pivot) || !isFinite(fibLevel)) return 0;
  const tol  = atr * atrMult;
  const dist = Math.abs(fibLevel - pivot);
  if (dist <= tol * 0.5) return 2;
  if (dist <= tol) return 1;
  return 0;
};

// ─────────────────────────────────────────────────────────────────────────
//  4H ZONE CROSS-CHECK  (bug fix: direction is now a real parameter —
//  the old version read a `direction` that didn't exist in scope and
//  threw a ReferenceError on every call once a setup got this far)
// ─────────────────────────────────────────────────────────────────────────
const checkHTFZoneAlignment = (entryPrice, htfBias, atr, direction, atrMult) => {
  if (!htfBias) return { aligned: true, nearestLevel: 'N/A', nearestPrice: null, distance: 0 };

  const tol = atr * atrMult; // symmetric — no per-direction boost multiplier

  const levels = [
    { name: '4H POC',    price: htfBias.poc },
    { name: '4H VAH',    price: htfBias.vah },
    { name: '4H VAL',    price: htfBias.val },
    { name: '4H Fib50%', price: htfBias.fibMid },
  ];

  let nearest = null, minDist = Infinity;
  for (const lvl of levels) {
    const dist = Math.abs(entryPrice - lvl.price);
    if (dist < minDist) { minDist = dist; nearest = lvl; }
  }

  return { aligned: minDist <= tol, nearestLevel: nearest.name, nearestPrice: nearest.price, distance: minDist };
};

// ─────────────────────────────────────────────────────────────────────────
//  ZONE INVALIDATION
// ─────────────────────────────────────────────────────────────────────────
const isZoneInvalidated = (closePrice, zoneRef, atr, direction, atrMult) => {
  const margin = atr * atrMult;
  if (direction === 'BUY'  && closePrice < zoneRef - margin) return true;
  if (direction === 'SELL' && closePrice > zoneRef + margin) return true;
  return false;
};

// ─────────────────────────────────────────────────────────────────────────
//  REJECTION / TRIGGER DETECTOR — 5 patterns, symmetric BUY/SELL
//
//  1. POC_RECLAIM     — wicked through 1H POC, closed back on the trade side
//  2. VAH_VAL_RECLAIM — wicked through the defended boundary (VAL for BUY,
//                       VAH for SELL), closed back inside — same idea as
//                       POC_RECLAIM applied to the value-area edge
//  3. PIN_BAR         — wick > 1.5× body into the zone
//  4. ENGULFING       — body fully engulfs prior candle, trade direction
//  5. CLOSE_REJECTION — wicked into zone, closed cleanly outside it
//
//  Fires if patterns.length >= minPatterns (default 2-of-5), UNLESS
//  allowSolo is enabled and exactly one pattern fires that's in the
//  soloPatterns list (config.SOLO_ELIGIBLE_PATTERNS) — applies identically
//  to BUY and SELL, no direction-specific carve-out.
//
//  v10.2 NOTE: soloPatterns used to be hardcoded here to just POC_RECLAIM/
//  VAH_VAL_RECLAIM. It's now a parameter so config.js is the single place
//  that decides which patterns count as "strong enough alone" — no more
//  editing core.js to change strategy behavior.
// ─────────────────────────────────────────────────────────────────────────
const detectRejection = (candles, zoneLow, zoneHigh, direction, pivots, absorptionBodyRatio, minPatterns = 2, allowSolo = false, soloPatterns = ['POC_RECLAIM', 'VAH_VAL_RECLAIM']) => {
  if (candles.length < 2) return { valid: false, patterns: [], absorptionVeto: false, score: 0, solo: false };

  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];

  const touchedZone = c.low <= zoneHigh && c.high >= zoneLow;
  if (!touchedZone) return { valid: false, patterns: [], absorptionVeto: false, score: 0, solo: false };

  const body = Math.abs(c.close - c.open);
  const fullRange = c.high - c.low;
  const bodyRatio = fullRange > 0 ? body / fullRange : 0;

  let absorptionVeto = false;
  if (bodyRatio > absorptionBodyRatio) {
    if (direction === 'SELL' && c.close > c.open) absorptionVeto = true;
    if (direction === 'BUY'  && c.close < c.open) absorptionVeto = true;
  }

  const patterns = [];
  const { poc, vah, val } = pivots;

  if (direction === 'BUY') {
    if (poc && c.low < poc && c.close > poc) patterns.push('POC_RECLAIM');
    if (val && c.low < val && c.close > val) patterns.push('VAH_VAL_RECLAIM');
    const lowerWick = Math.min(c.open, c.close) - c.low;
    if (lowerWick > body * 1.5 && body > 0) patterns.push('PIN_BAR');
    if (c.close > c.open && c.close > p.close && c.open < p.open) patterns.push('ENGULFING');
    if (c.low <= zoneHigh && c.close > zoneHigh) patterns.push('CLOSE_REJECTION');
  } else {
    if (poc && c.high > poc && c.close < poc) patterns.push('POC_RECLAIM');
    if (vah && c.high > vah && c.close < vah) patterns.push('VAH_VAL_RECLAIM');
    const upperWick = c.high - Math.max(c.open, c.close);
    if (upperWick > body * 1.5 && body > 0) patterns.push('PIN_BAR');
    if (c.close < c.open && c.close < p.close && c.open > p.open) patterns.push('ENGULFING');
    if (c.high >= zoneLow && c.close < zoneLow) patterns.push('CLOSE_REJECTION');
  }

  const score = patterns.length;
  const solo = allowSolo && score === 1 && soloPatterns.includes(patterns[0]);
  const valid = !absorptionVeto && (score >= minPatterns || solo);

  return { valid, patterns, absorptionVeto, score, solo };
};

// ─────────────────────────────────────────────────────────────────────────
//  TRADE LEVELS — SL / TP1 / TP2 / TP3, unchanged math from prior version
//  (this part was not overfit — it's a straightforward R:R structure).
// ─────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────
//  RISK MULTIPLIER — evidence-based position-size tiering (v10.3, not a
//  new entry gate). Backing data (backtest-report.json, 246 closed trades,
//  v10.2 ruleset), split by pivot AND by whether 1H confirms direction:
//    POC + 1H confirms    : 46 trades | 73.9% WR | 3 SL  — fine, no cut
//    POC + 1H NOT confirm : 168 trades| 58.3% WR | 15 SL — the real bucket
//    VAH + 1H confirms    : 2 trades  | 50.0% WR | 0 SL  — too small, no cut
//    VAH + 1H NOT confirm : 16 trades | 81.2% WR | 0 SL  — no cut
//    VAL + 1H confirms    : 5 trades  | 80.0% WR | 0 SL  — no cut
//    VAL + 1H NOT confirm : 9 trades  | 77.8% WR | 0 SL  — no cut
//  First cut of this discounted POC everywhere and no-1H-confirm
//  everywhere, multiplied together — that also discounted the 46
//  POC+1H-confirms trades, which have no SL problem (73.9% WR) and are
//  33R of the backtest's total profit. Fixed to target ONLY the one cell
//  the data actually flags: POC pivot AND 1H not in the confirming vote.
//  Every other cell stays full size — not enough SL evidence anywhere
//  else to justify a cut (VAH/VAL: 0 SL across all 32 trades in every
//  split). Deliberately narrow: sizing changes only where the trade log
//  shows a real, dataset-wide reason to, same anti-overfitting stance as
//  the rest of this file.
// ─────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────
//  v10.4: extended with an independent, orthogonal second factor —
//  POC_RECLAIM pattern presence. Backing data (backtest-report.json, 215
//  closed trades, v10.3 ruleset — and this is the THIRD consecutive
//  backtest to show the same thing, at n=21/62/61 respectively):
//    Trades WITH POC_RECLAIM in the pattern list : 61 trades | 39.3% WR |
//      10 SL | avg +0.228R/trade
//    Trades WITHOUT POC_RECLAIM                  : 154 trades| 72.7% WR |
//      5 SL  | avg +0.770R/trade
//  Confirmed independent of the pivot/1H-confirm split above: even inside
//  the "strong" 1H-confirmed tier, adding POC_RECLAIM drags win rate from
//  74.4% down to 38.5% (n=13). Applied as a second multiplicative factor
//  (patternRiskMatrix), not folded into riskTierMatrix, precisely because
//  it's evidenced as independent — POC_RECLAIM is weak whether or not 1H
//  confirms. Same anti-overfitting stance: this is a discount, not a
//  block, and no other pattern (CLOSE_REJECTION/ENGULFING/PIN_BAR/
//  VAH_VAL_RECLAIM) has comparable evidence against it.
// ─────────────────────────────────────────────────────────────────────────
const computeRiskMultiplier = (pivotName, agreeing, patterns, riskTierMatrix, patternRiskMatrix, defaultMult = 1.0) => {
  const confirmKey = (Array.isArray(agreeing) && agreeing.includes('1H')) ? '1H' : 'NO1H';
  const key = `${pivotName}_${confirmKey}`;
  let mult = (riskTierMatrix && riskTierMatrix[key] != null) ? riskTierMatrix[key] : defaultMult;
  if (Array.isArray(patterns) && patternRiskMatrix) {
    for (const p of patterns) {
      if (patternRiskMatrix[p] != null) mult *= patternRiskMatrix[p];
    }
  }
  return Math.max(0.1, Math.min(1.0, mult));
};

const computeTradeLevels = ({ direction, entryPrice, swing, atr, vp, slAtrMult, tp1RrFloor, fibLevel500, tp3MinExtensionRR = 0 }) => {
  const swingWick = direction === 'BUY' ? swing.low : swing.high;
  const slPrice = direction === 'BUY'
    ? swingWick - atr * slAtrMult
    : swingWick + atr * slAtrMult;

  const risk = Math.abs(entryPrice - slPrice);
  if (risk <= 0) return null;

  const tp1Structural = fibLevel500;
  const tp1Dynamic = direction === 'BUY'
    ? entryPrice + risk * tp1RrFloor
    : entryPrice - risk * tp1RrFloor;
  const tp1Price = direction === 'BUY'
    ? Math.max(tp1Structural, tp1Dynamic)
    : Math.min(tp1Structural, tp1Dynamic);

  const tp3Price = direction === 'BUY' ? vp.vahPrice : vp.valPrice;
  // v10.4 FIX: this used to be `tp3Price > tp1Price` with no minimum
  // margin, which is why TP3 was hit 0 times in 216 live-equivalent
  // backtest signals — see core.js header v10.4 fix log for the data.
  // Now requires TP3 to clear TP1 by at least tp3MinExtensionRR (in R),
  // not just by any nonzero amount.
  const tp3ExtensionRR = Math.abs(tp3Price - tp1Price) / risk;
  const tp3Beyond = direction === 'BUY' ? tp3Price > tp1Price : tp3Price < tp1Price;
  if (!tp3Beyond || tp3ExtensionRR < tp3MinExtensionRR) return null;

  const tp2Price = tp1Price + (tp3Price - tp1Price) * 0.5;

  return {
    slPrice, tp1Price, tp2Price, tp3Price, risk,
    rr1: risk > 0 ? Math.abs(tp1Price - entryPrice) / risk : 0,
    rr2: risk > 0 ? Math.abs(tp2Price - entryPrice) / risk : 0,
    rr3: risk > 0 ? Math.abs(tp3Price - entryPrice) / risk : 0,
  };
};

module.exports = {
  calcATR, calcFib, calcVolumeProfile, tfBiasVote, isNearZone, resolveDirection,
  confluenceScore, checkHTFZoneAlignment, isZoneInvalidated,
  detectRejection, computeTradeLevels, computeRiskMultiplier,
};
