/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — CORE STRATEGY LOGIC (core.js)  v10.14
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
 *  THREE-TIMEFRAME ARCHITECTURE (v10.0) — SUPERSEDED BY v10.10, SEE BELOW:
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
 *  FIVE-TIMEFRAME ARCHITECTURE (v10.10, current):
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  1D   → macro-macro bias vote (NEW)                                 │
 *  │  4H   → macro bias vote                                             │
 *  │  1H   → structure TF: swing, Fib golden pocket, POC/VAH/VAL zone    │
 *  │  30m  → mid-rung bias vote (NEW)                                    │
 *  │  15m  → trigger TF: the actual rejection candle that fires entry    │
 *  │                                                                     │
 *  │  Direction requires MIN_TF_AGREE (3) of these 5 timeframes to       │
 *  │  agree — same tfBiasVote() 4-pillar vote as before, just cast by    │
 *  │  two more independent timeframes now. 1H still supplies the         │
 *  │  structural zone and 15m still supplies the trigger candle —        │
 *  │  ONLY the direction-agreement vote changed. See resolveDirection()  │
 *  │  below, now generalized to accept any minAgree/total, not just 2/3. │
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
 *
 *  v10.5 FIX LOG (2026-07-03, requested change: eliminate TP3, keep only
 *  TP1/TP2 as real targets — confirmed by four separate backtests, 30/
 *  360/720/1800 days, ALL showing TP3 hits: 0):
 *  ─ Root cause was deeper than "TP3 is just hard to reach": TP1 used to
 *    be a full, instant close. The trade-management loop checked "did TP2
 *    get hit" BEFORE checking "did TP1 get hit," so in ordinary gradual
 *    price movement TP1 always closed the entire position first, and TP2/
 *    TP3 could only ever fire if a single 15m candle jumped through both
 *    TP1 and TP2 in the same bar — a rare gap/spike event. This is why
 *    TP2 hits were also rare (4-26 across hundreds of trades) even before
 *    TP3 itself is considered.
 *  ─ Fix: TP1 is now a genuine 50% partial exit that arms a hard
 *    breakeven stop for the remaining half, which then targets TP2 (the
 *    former TP3's VAH/VAL formula — the only far target that now exists).
 *    See computeTradeLevels() below and backtest.js/strategy.js v10.5
 *    notes for the sequencing fix itself.
 *  ─ This is a strict improvement, not just a rename: previously, a trade
 *    that reached TP1 was DONE at +rr1 (~1.2R), full stop, no upside left
 *    on the table even in a strong trend. Now that same trade banks 50%
 *    at TP1 (locking in real profit) and lets the other 50% chase the
 *    structural VAH/VAL target with a stop that can't go negative from
 *    there. Worst case for a trade that reaches TP1 is now ~0.5×rr1
 *    (still a win, just smaller); best case is meaningfully larger than
 *    the old flat rr1 payout.
 *
 *  v10.6 — added computeTDSequential() (TD Sequential "9" exhaustion
 *  count) as an independent, size-only confirmation signal — see that
 *  function's own header below for the full reasoning, and config.js
 *  v10.6 notes for what else was evaluated from the same source and
 *  explicitly declined (Pi-target TPs, 4H VA/Fib, ADX/volume/news
 *  filters).
 *
 *  v10.7 — EXPERIMENTAL, OFF BY DEFAULT. Hypothesis under test: POC is a
 *  single price point (unlike VAH/VAL, which are range boundaries), so it
 *  may be more prone to brief overshoot-then-reverse noise tagging the SL
 *  before price does what the setup predicted. computeRiskMultiplier()
 *  now accepts an optional SL-width risk-normalization factor: if a
 *  pivot's SL is deliberately widened (see config.js SL_ATR_MULT_MATRIX),
 *  position size is scaled down proportionally so $ risk per trade stays
 *  flat. This is NOT validated — it's a mechanism to test the hypothesis
 *  via backtest, not a conclusion. Has zero effect while
 *  SL_ATR_MULT_MATRIX_ENABLED is false (the default).
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

  // v10.8: pocIdx/volArr added (purely additive — every existing caller
  // that only reads pocPrice/vahPrice/valPrice/maxVol/totalVol/barCount is
  // completely unaffected). Needed by computePOCProminence() below, so it
  // can reuse this histogram instead of rebuilding it from scratch (which
  // would risk two implementations silently drifting apart over time).
  return { pocPrice, vahPrice, valPrice, maxVol, totalVol, barCount: workingBars.length, pocIdx, volArr };
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
//  N-OF-M TIMEFRAME DIRECTION RESOLUTION
//  votes: [{ tf: '4H', result: <tfBiasVote output or null> }, ...]
//  minAgree: how many of votes.length must agree (v10.10: explicit param,
//  was hardcoded to 2). Defaults to 2 for <=3 votes (preserves the original
//  2-of-3 behavior for any caller that doesn't pass one) or 3 for 4+ votes
//  (matches the 3-of-5 vote requested in v10.10) — but callers should pass
//  it explicitly (config.MIN_TF_AGREE) rather than rely on the default.
//  Returns { direction, agreeing: [tf,...], tally } or null if no majority.
// ─────────────────────────────────────────────────────────────────────────
const resolveDirection = (votes, minAgree) => {
  const total = votes.length;
  const need  = minAgree != null ? minAgree : (total >= 4 ? 3 : 2);
  const usable = votes.filter(v => v.result && v.result.bias !== 'NEUTRAL');
  const bulls  = usable.filter(v => v.result.bias === 'BULLISH').map(v => v.tf);
  const bears  = usable.filter(v => v.result.bias === 'BEARISH').map(v => v.tf);

  if (bulls.length >= need) return { direction: 'BUY',  agreeing: bulls, tally: `${bulls.length}/${total}` };
  if (bears.length >= need) return { direction: 'SELL', agreeing: bears, tally: `${bears.length}/${total}` };
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
const detectRejection = (candles, zoneLow, zoneHigh, direction, pivots, absorptionBodyRatio, minPatterns = 2, allowSolo = false, soloPatterns = ['VAH_VAL_RECLAIM', 'CLOSE_REJECTION']) => {
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
//
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
//  TD SEQUENTIAL "9" SETUP COUNT (v10.6, added on request)
// ─────────────────────────────────────────────────────────────────────────
//  Tom DeMark's TD Sequential Setup — pure price comparison, genuinely
//  non-lagging (no averaging/smoothing of any kind, matching this bot's
//  existing "no lagging indicators" design). Rule, exactly as specified:
//  Buy Setup count increments each bar where close < close[4 bars ago],
//  resets to 0 the instant a bar fails that test. "Buy 9" = the count
//  hits exactly 9 on the most recent bar (a fresh completion, not still
//  sitting at 9+ from bars ago). Sell Setup is the mirror condition.
//
//  This is used as ADDITIONAL, INDEPENDENT evidence — not a gate. It only
//  ever adjusts position size upward (see computeRiskMultiplier below),
//  and only within the existing size ceiling (1.0× = normal size). It can
//  never block a signal or push size above normal. This was a deliberate
//  choice: the existing 2-of-3 timeframe vote + confluence + trigger
//  system is validated against 500+ backtested trades across four
//  separate time horizons (30/360/720/1800 days); TD9 has zero backtest
//  history of its own in this system. Turning it into a hard requirement
//  would cut signal frequency based on an unvalidated assumption. Turning
//  it into a size-only bonus lets it help when it agrees, and costs
//  nothing when it doesn't fire (which, per DeMark's own statistics, is
//  most of the time — a real 9-count is a fairly rare, specific event).
// ─────────────────────────────────────────────────────────────────────────
const computeTDSequential = (bars) => {
  if (!Array.isArray(bars) || bars.length < 5) return { buyCount: 0, sellCount: 0, buy9: false, sell9: false };
  let buyCount = 0, sellCount = 0, buy9 = false, sell9 = false;
  for (let i = 4; i < bars.length; i++) {
    const c = bars[i].close, c4 = bars[i - 4].close;
    buyCount  = (c < c4) ? buyCount + 1 : 0;
    sellCount = (c > c4) ? sellCount + 1 : 0;
    buy9  = (buyCount === 9);
    sell9 = (sellCount === 9);
  }
  return { buyCount, sellCount, buy9, sell9 };
};

// ─────────────────────────────────────────────────────────────────────────
//  POC QUALITY FACTORS (v10.8, live by default as of v10.9)
// ─────────────────────────────────────────────────────────────────────────
//  Three independent, testable hypotheses about why POC-pivot trades
//  underperform VAH/VAL. Each is a bounded, size-only multiplier — none
//  of them are gates, none of them can reduce signal frequency. Applied
//  live directly per explicit instruction rather than gated behind a
//  backtest-first requirement — see config.js v10.9 notes.
// ─────────────────────────────────────────────────────────────────────────

//  #1 — POC PROMINENCE. POC is "whichever price got the single highest
//  volume" — but if the rows immediately next to it got almost as much
//  volume, POC only narrowly "won" a crowded, contested price zone rather
//  than being a level the market clearly, decisively agreed on. This is
//  the theory that POC is the most-CONTESTED price, not necessarily the
//  strongest one. Computed as POC's volume vs the average of its two
//  immediate neighbor rows — the higher this ratio, the more POC's volume
//  actually stands out, rather than just narrowly edging out its
//  neighbors. Reuses the histogram calcVolumeProfile() already built
//  (via the pocIdx/volArr fields added in v10.8) rather than rebuilding
//  it — one source of truth for the volume distribution, not two.
const computePOCProminence = (vp) => {
  if (!vp || !Array.isArray(vp.volArr) || vp.pocIdx == null) return { prominenceRatio: 1, computed: false };
  const { volArr, pocIdx } = vp;
  const lo = pocIdx > 0 ? volArr[pocIdx - 1] : null;
  const hi = pocIdx < volArr.length - 1 ? volArr[pocIdx + 1] : null;
  const neighbors = [lo, hi].filter(v => v != null);
  if (!neighbors.length) return { prominenceRatio: 1, computed: false };
  const avgNeighbor = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
  const pocVol = volArr[pocIdx];
  const prominenceRatio = avgNeighbor > 0 ? pocVol / avgNeighbor : (pocVol > 0 ? Infinity : 1);
  return { prominenceRatio, computed: true };
};

//  #2 — POC MIGRATION. A POC that has been drifting steadily in one
//  direction across recent windows reflects the market progressively
//  accepting new fair value — real conviction. A POC that's static or
//  jumping around between recalculations usually just means the market
//  hasn't decided anything yet — balance, not trend. Compares the
//  CURRENT window's POC against an earlier, non-overlapping window's POC
//  computed the identical way (same vpLookback/rows), offset back by
//  offsetBars. Requires the drift to clear a minimum ATR-relative
//  distance before calling it "migrating" — otherwise ordinary bin-to-bin
//  noise would trigger this on almost every scan.
const computePOCMigration = (bars, vpLookback, rows, offsetBars, atr, minMigrationAtrMult) => {
  const none = { migrating: false, direction: null, distance: 0, currentPOC: null, pastPOC: null };
  if (!Array.isArray(bars) || bars.length < vpLookback + offsetBars) return none;

  const currentVP = calcVolumeProfile(bars, vpLookback, rows);
  const pastBars = bars.slice(0, bars.length - offsetBars);
  const pastVP = calcVolumeProfile(pastBars, vpLookback, rows);
  if (!currentVP || !pastVP) return none;

  const distance = currentVP.pocPrice - pastVP.pocPrice;
  const meaningful = atr > 0 && Math.abs(distance) >= (atr * minMigrationAtrMult);
  return {
    migrating: meaningful,
    direction: meaningful ? (distance > 0 ? 'UP' : 'DOWN') : null,
    distance,
    currentPOC: currentVP.pocPrice,
    pastPOC: pastVP.pocPrice,
  };
};

//  #3 — NAKED / UNTESTED POC. A POC from an earlier, now-closed
//  (non-overlapping) window that price has NOT traded back through since
//  is treated in market-profile theory as a strong magnet — unfinished
//  business the market tends to revisit. If that untested prior POC also
//  sits close to the CURRENT window's POC, that's two separate profiles
//  agreeing on the same price — stacked evidence, not just one profile's
//  opinion. Needs bars.length >= vpLookback*2 (a prior window plus the
//  current one); gracefully returns "not naked, not aligned" otherwise —
//  this is a real data requirement (see config.js v10.8 notes on fetch
//  size), not a bug, and the caller should treat the no-data case as a
//  neutral no-op, never as a positive or negative signal.
const computeNakedPOC = (bars, vpLookback, rows, atr, currentPOC, toleranceAtrMult) => {
  const none = { naked: false, priorPOC: null, tested: null, aligned: false };
  if (!Array.isArray(bars) || bars.length < vpLookback * 2 || currentPOC == null) return none;

  const priorBars = bars.slice(0, bars.length - vpLookback);
  const priorVP = calcVolumeProfile(priorBars, vpLookback, rows);
  if (!priorVP) return none;
  const priorPOC = priorVP.pocPrice;

  const sinceBars = bars.slice(-vpLookback);
  const tested = sinceBars.some(b => b.low <= priorPOC && b.high >= priorPOC);
  const aligned = !tested && atr > 0 && Math.abs(currentPOC - priorPOC) <= (atr * toleranceAtrMult);

  return { naked: !tested, priorPOC, tested, aligned };
};

//  Combines all three into one multiplier for the call site. Returns 1.0
//  (complete no-op) for any pivot other than POC — VAH/VAL entries are
//  entirely untouched by this function, always, regardless of which
//  flags are enabled.
//
//  v10.13 FIX (2026-07-07): POC_MIGRATION direction was BACKWARDS. Checked
//  against actual per-trade data (720-day AND 360-day backtest-report.json,
//  207 and 94 POC trades respectively — 360-day is a subset of 720-day, so
//  treat as one replication, not two independent samples, but the direction
//  held both times): trades where POC was migrating WITH the trade
//  direction scored 53.3%/54.8% WR — WORSE than trades where it was static
//  or migrating against direction (62.5%/64.7% WR, both windows). The
//  original theory (migration = forming consensus = good) doesn't hold up;
//  a plausible alternative is that a POC which has already migrated toward
//  the trade direction represents a level that's already been "spent" —
//  the value area re-rated before this entry, so the entry is chasing
//  rather than catching a fresh level. Swapped: migration CONFIRMING
//  direction now gets the PENALTY, migrating AGAINST (or static) is
//  left at neutral 1.0 (the "against" bucket's outperformance is smaller
//  and its sample thinner — not confident enough to reward it further,
//  only confident enough to stop rewarding the confirming case).
const computePOCQualityMultiplier = (pivotName, direction, prominence, migration, nakedPOC, cfg) => {
  if (pivotName !== 'POC') return 1.0;
  let mult = 1.0;

  if (cfg.POC_PROMINENCE_ENABLED && prominence && prominence.computed) {
    const decisive = prominence.prominenceRatio >= cfg.POC_PROMINENCE_MIN_RATIO;
    if (!decisive) mult *= cfg.POC_PROMINENCE_PENALTY_MULT;
  }

  if (cfg.POC_MIGRATION_ENABLED && migration && migration.migrating) {
    const confirms = (direction === 'BUY' && migration.direction === 'UP') ||
                      (direction === 'SELL' && migration.direction === 'DOWN');
    // v10.13: confirms → penalty (was boost); against → neutral (was penalty).
    if (confirms) mult *= cfg.POC_MIGRATION_PENALTY_MULT;
  }

  if (cfg.NAKED_POC_ENABLED && nakedPOC && nakedPOC.aligned) {
    mult *= cfg.NAKED_POC_BOOST_MULT;
  }

  return mult;
};

//  v10.13 NEW: hard gate (not a size multiplier) for POC prominence.
//  Same per-trade data check as above: "contested" POC (prominenceRatio <
//  MIN_RATIO) scored 48.3%/50.0% WR across the two windows vs 59.7%/60.3%
//  for "decisive" POC — an ~10pp gap, replicated in direction both times
//  (360-day is a subset of 720-day, same caveat as the migration note).
//  That gap is comparable in size to the 1H-confirm gap that justified
//  making POC_REQUIRE_1H_CONFIRM an outright gate in v10.12, so it gets
//  the same treatment here rather than staying a partial size discount.
//  Returns true (never blocks) for any pivot other than POC, or when the
//  gate is disabled, or when prominence couldn't be computed (treated as
//  a neutral no-data case, not a rejection).
const isPOCProminenceTrusted = (pivotName, prominence, cfg) => {
  if (pivotName !== 'POC') return true;
  if (!cfg.POC_PROMINENCE_REQUIRE_DECISIVE) return true;
  if (!prominence || !prominence.computed) return true; // no data → don't block
  return prominence.prominenceRatio >= cfg.POC_PROMINENCE_MIN_RATIO;
};

const computeRiskMultiplier = (pivotName, agreeing, patterns, riskTierMatrix, patternRiskMatrix, defaultMult = 1.0, td9Confirms = false, td9BoostMult = 1.0, slAtrMultUsed = null, baselineSlAtrMult = null) => {
  const confirmKey = (Array.isArray(agreeing) && agreeing.includes('1H')) ? '1H' : 'NO1H';
  const key = `${pivotName}_${confirmKey}`;
  let mult = (riskTierMatrix && riskTierMatrix[key] != null) ? riskTierMatrix[key] : defaultMult;
  if (Array.isArray(patterns) && patternRiskMatrix) {
    for (const p of patterns) {
      if (patternRiskMatrix[p] != null) mult *= patternRiskMatrix[p];
    }
  }
  // v10.6: TD9 exhaustion count agreeing with trade direction is treated
  // as independent supporting evidence — it can partially restore a
  // discount, never push size past 1.0 (the clamp below is unconditional,
  // not just documentation).
  if (td9Confirms) mult *= td9BoostMult;
  // v10.7 (EXPERIMENTAL, off by default — see config.js SL_ATR_MULT_MATRIX):
  // if this trade's SL is wider than the baseline (per-pivot test to see
  // whether POC's SL rate is partly noise/overshoot rather than genuine
  // invalidation), scale size down proportionally so $ risk per trade
  // stays the same as it would've been at the baseline SL distance. This
  // is NOT a quality discount like the factors above — it's pure risk
  // normalization, applied on top of whatever the quality tiering above
  // already decided. Has no effect at all when slAtrMultUsed equals
  // baselineSlAtrMult (the default, unwidened case).
  if (slAtrMultUsed != null && baselineSlAtrMult != null && slAtrMultUsed > 0) {
    mult *= (baselineSlAtrMult / slAtrMultUsed);
  }
  return Math.max(0.1, Math.min(1.0, mult));
};

// ─────────────────────────────────────────────────────────────────────────
//  TRADE LEVELS — SL / TP1 / TP2 (v10.5: TP3 retired, see fix log below)
// ─────────────────────────────────────────────────────────────────────────
//  v10.5 REDESIGN: this used to compute THREE targets — TP1 (structural/
//  1.2R floor), TP2 (the arithmetic midpoint of TP1 and TP3), and TP3
//  (1H VAH/VAL). The trade-management loop (backtest.js) treated TP1 as a
//  FULL close the instant it was touched — meaning in ordinary gradual
//  price action, TP1 closed the whole position before TP2 could ever be
//  reached; TP2/TP3 only fired when a single 15m candle happened to jump
//  through both TP1 and TP2 in one bar. That's why TP3 hit 0 times across
//  every backtest run (30/360/720/1800 days all showed TP3 hits: 0) and
//  TP2 only fired a handful of times per hundred trades.
//
//  Rather than just delete TP3 and keep the same broken sequencing, this
//  is now a genuine two-stage exit: TP1 = 50% partial exit (locks in
//  profit, arms a hard breakeven stop for the other half), TP2 = the old
//  TP3's VAH/VAL formula — now the ONLY further target, for the runner
//  half. See backtest.js / strategy.js v10.5 notes for the management-
//  loop side of this.
// ─────────────────────────────────────────────────────────────────────────
const computeTradeLevels = ({ direction, entryPrice, swing, atr, vp, slAtrMult, tp1RrFloor, fibLevel500, tp2MinExtensionRR = 0 }) => {
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

  // TP2 (formerly TP3): the 1H value-area edge — the structural "how far
  // can this realistically run" target. Same minimum-extension guard as
  // before (renamed from TP3_MIN_EXTENSION_RR to TP2_MIN_EXTENSION_RR),
  // still doing the same job: reject setups where this target sits too
  // close to TP1 to ever be a meaningful second stage.
  const tp2Price = direction === 'BUY' ? vp.vahPrice : vp.valPrice;
  const tp2ExtensionRR = Math.abs(tp2Price - tp1Price) / risk;
  const tp2Beyond = direction === 'BUY' ? tp2Price > tp1Price : tp2Price < tp1Price;
  if (!tp2Beyond || tp2ExtensionRR < tp2MinExtensionRR) return null;

  return {
    slPrice, tp1Price, tp2Price, risk,
    rr1: risk > 0 ? Math.abs(tp1Price - entryPrice) / risk : 0,
    rr2: risk > 0 ? Math.abs(tp2Price - entryPrice) / risk : 0,
  };
};

// v10.14: extracted from backtest.js's inline per-bar trade-management
// loop so it can ALSO drive live position-tracking (position-tracker.js)
// against the exact same rules — same drift-prevention discipline as
// every gate shared between strategy.js and backtest.js elsewhere in
// this file. Takes one open trade and ONE bar (15m candle) that occurs
// strictly after entryTime, and returns either an unchanged/updated
// trade (still open) or a closed outcome. Caller is responsible for
// feeding bars in ascending time order, one at a time, stopping at the
// first bar that closes the trade.
//
// Mechanics (unchanged from the original backtest.js loop):
//  1. Once price reaches the halfway point to TP1, SL silently moves to
//     entry (breakeven) even before TP1 itself prints — this is a size-
//     neutral protection step, not a partial exit.
//  2. TP1 hit → exit config.PARTIAL_EXIT_PCT of the position at TP1,
//     move SL to entry for the remainder (again, in case step 1 hadn't
//     already done so), let the runner ride toward TP2.
//  3. From there: SL (now at breakeven) → 'TP1+BE' for the remainder,
//     or TP2 → 'TP1+TP2'. Full R blends the locked partial R with
//     whatever the runner did.
//  4. Before TP1 hits at all: plain SL → 'SL' (or 'BE' if slRR rounds to
//     exactly 0 — can happen if the breakeven-arm step above already
//     moved SL to entry before the full SL was ever touched).
//  5. EARLY_TIMEOUT: trade never reached TP1 within
//     config.EARLY_TIMEOUT_BARS × config.STRUCT_BAR_SECONDS — cut it
//     loose at the current close rather than let a going-nowhere trade
//     sit open indefinitely.
//  6. TIMEOUT: absolute hold-time ceiling, config.MAX_HOLD_1H_BARS ×
//     config.STRUCT_BAR_SECONDS from entry, regardless of TP1 status —
//     backstop for a runner that's neither hit TP2 nor come back to
//     breakeven after an unusually long hold.
const evaluateOpenTrade = (openTrade, bar, config) => {
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

  if (!openTrade.tp1Hit) {
    const tp1Hit = direction === 'BUY' ? bar.high >= tp1Price : bar.low <= tp1Price;
    if (tp1Hit) { openTrade.tp1Hit = true; openTrade.halfR = rr1; openTrade.slPrice = entryPrice; }
  }

  if (openTrade.tp1Hit) {
    if (direction === 'BUY') {
      if      (bar.low  <= openTrade.slPrice) outcome = { result: 'TP1+BE', exitPrice: openTrade.slPrice, rr: parseFloat((openTrade.halfR * config.PARTIAL_EXIT_PCT).toFixed(2)) };
      else if (bar.high >= tp2Price)          outcome = { result: 'TP1+TP2', exitPrice: tp2Price,          rr: parseFloat((openTrade.halfR * config.PARTIAL_EXIT_PCT + rr2 * (1 - config.PARTIAL_EXIT_PCT)).toFixed(2)) };
    } else {
      if      (bar.high >= openTrade.slPrice) outcome = { result: 'TP1+BE', exitPrice: openTrade.slPrice, rr: parseFloat((openTrade.halfR * config.PARTIAL_EXIT_PCT).toFixed(2)) };
      else if (bar.low  <= tp2Price)          outcome = { result: 'TP1+TP2', exitPrice: tp2Price,          rr: parseFloat((openTrade.halfR * config.PARTIAL_EXIT_PCT + rr2 * (1 - config.PARTIAL_EXIT_PCT)).toFixed(2)) };
    }
  } else {
    if (direction === 'BUY') {
      if (bar.low  <= slPrice) outcome = { result: slRR === 0 ? 'BE' : 'SL', exitPrice: slPrice, rr: slRR };
    } else {
      if (bar.high >= slPrice) outcome = { result: slRR === 0 ? 'BE' : 'SL', exitPrice: slPrice, rr: slRR };
    }
  }

  if (outcome) {
    return { closed: true, trade: openTrade, outcome: { ...outcome, exitTime: bar.time, hoursHeld: Math.round((bar.time - openTrade.entryTime) / 3600) } };
  }

  if (!openTrade.tp1Hit && (bar.time - openTrade.entryTime) > config.EARLY_TIMEOUT_BARS * config.STRUCT_BAR_SECONDS) {
    const price = bar.close;
    return { closed: true, trade: openTrade, outcome: {
      result: 'EARLY_TIMEOUT', exitPrice: price,
      rr: parseFloat(((price - openTrade.entryPrice) / Math.abs(openTrade.entryPrice - openTrade.origSlPrice) * (openTrade.direction === 'BUY' ? 1 : -1)).toFixed(2)),
      exitTime: bar.time, hoursHeld: Math.round((bar.time - openTrade.entryTime) / 3600),
    }};
  }

  if ((bar.time - openTrade.entryTime) > config.MAX_HOLD_1H_BARS * config.STRUCT_BAR_SECONDS) {
    const price = bar.close;
    const liveLegRR = (price - openTrade.entryPrice) / Math.abs(openTrade.entryPrice - openTrade.origSlPrice) * (openTrade.direction === 'BUY' ? 1 : -1);
    const rr = openTrade.tp1Hit ? (openTrade.halfR * config.PARTIAL_EXIT_PCT + liveLegRR * (1 - config.PARTIAL_EXIT_PCT)) : liveLegRR;
    return { closed: true, trade: openTrade, outcome: {
      result: 'TIMEOUT', exitPrice: price, rr: parseFloat(rr.toFixed(2)),
      exitTime: bar.time, hoursHeld: Math.round((bar.time - openTrade.entryTime) / 3600),
    }};
  }

  return { closed: false, trade: openTrade };
};

module.exports = {
  calcATR, calcFib, calcVolumeProfile, tfBiasVote, isNearZone, resolveDirection,
  confluenceScore, checkHTFZoneAlignment, isZoneInvalidated,
  detectRejection, computeTradeLevels, computeRiskMultiplier, computeTDSequential,
  computePOCProminence, computePOCMigration, computeNakedPOC, computePOCQualityMultiplier,
  isPOCProminenceTrusted, evaluateOpenTrade,
};
