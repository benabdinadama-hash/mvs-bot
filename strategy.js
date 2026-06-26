/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — MONTHLY VALUE SNIPER v8.2
 *  "Structure is everything. If price isn't at a pillar, it's not a trade."
 *  By Abdin
 *
 *  KUCOIN API EDITION — FOR GHANA
 *
 *  FOUNDATION (no lagging indicators — ever):
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  POC  → Point of Control  (highest-volume price — institutional)   │
 *  │  VAH  → Value Area High   (top of 70% volume zone — supply wall)   │
 *  │  VAL  → Value Area Low    (bottom of 70% volume zone — demand wall)│
 *  │  FIBO → All 6 levels: 23.6 / 38.2 / 50 / 61.8 / 78.6 / 88.6      │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 *  TWO-TIMEFRAME ARCHITECTURE:
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  4H  → Bias gate (structural direction — POC/VAH/VAL/Fib vote)     │
 *  │  4H  → Zone cross-check (entry must align with 4H structure)         │
 *  │  ENTRY → Entry engine (15min candles, scanned every 45min) (confluence + rejection + absorption + SL/TP)  │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 *  v8.2 CHANGES FROM v8.1 (fit GitHub Actions free tier on a PRIVATE repo):
 *  ✅ Symbols: 8 → 4 (BTC/ETH/SOL/XRP kept — most liquid, tightest spread)
 *  ✅ Scan cadence: every 15min → every 45min (entry candles still 15min —
 *     only how often we check them changed; see mvs-scan.yml for the math)
 *  ✅ mvs-scan.yml + mvs-commands.yml merged into ONE workflow/job — halves
 *     the fixed per-run overhead (checkout + Node setup + npm install) that
 *     was being paid twice as often as necessary
 *  ✅ npm dependency caching added to setup-node — cuts install time further
 *  ⚠️  WHY: GitHub Actions free minutes for private repos are capped at
 *     2000/month, billed in whole minutes per run. The v8.1 setup (8 symbols
 *     x 2 timeframes, scan every 15min + commands every 5min) needed
 *     roughly 8,000-14,000 min/month — 4-7x over quota. This is a structural
 *     run-count problem, not something fixable by making the code faster.
 *     v8.2 fits safely under quota even in a pessimistic 2-min-billed-per-run
 *     scenario. Going back to 8 symbols / 15min cadence requires making the
 *     repo PUBLIC (GitHub Actions minutes are free & unlimited for public
 *     repos) or accepting GitHub billing the overage on the private plan.
 *
 *  v8.1 CHANGES FROM v8.0 (scale for daily signal frequency — same gates):
 *  ✅ Entry timeframe 1H → 15min (4H bias gate UNCHANGED — same strictness)
 *  ✅ Symbols: 1 → 8 liquid pairs (more opportunities, not looser rules)
 *  ✅ Lookbacks scaled to preserve identical real-world calendar windows
 *  ✅ Cooldown bar-math fixed to use config.ENTRY_BAR_SECONDS (was hardcoded
 *     to 3600s/1H — would have silently broken on a 15min timeframe)
 *  ✅ Signal cooldown: 5 bars(1H) → 20 bars(15min) — same 5-hour real window
 *
 *  v8.0 CHANGES FROM v7.2:
 *  ✅ EMA removed entirely — zero lagging indicators
 *  ✅ VAH added — full value area now: POC + VAH + VAL
 *  ✅ 4H zone cross-check — entry price must sit near a 4H structural level
 *  ✅ 4H bias uses dedicated FIB lookback (BIAS_FIB_LOOKBACK) for correct swing
 *  ✅ POC_RECLAIM added as 4th rejection pattern — strongest institutional signal
 *  ✅ Zone invalidation raised 0.5×ATR → 1.0×ATR (stops false voids on volatile bars)
 *  ✅ Signal cooldown raised 3 → 5 bars (safer re-test window)
 *  ✅ TP3 added — VAH (BUY) / VAL (SELL) as full structural exit
 *  ✅ 4H bias is now 3-of-4 vote: POC + VAH + VAL + Fib50%
 *  ✅ Telegram alert shows all levels, both TF structures, and HTF cross-check
 * ═══════════════════════════════════════════════════════════════════════
 */

const axios       = require('axios');
const fs          = require('fs');
const path        = require('path');
const TelegramBot = require('node-telegram-bot-api');
const config      = require('./config');

const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });

// ── Telegram send with a hard timeout ───────────────────────────────────────
// bot.sendMessage() has NO timeout of its own. If Telegram throttles us
// (429/retry-after) or the connection just stalls, a bare `await` can hang
// forever — which is what was making MVS Scan run for hours instead of
// seconds. This races the real call against a 10s timer and always settles.
const sendSafe = (chatId, text, opts, ms = 10000) =>
  Promise.race([
    bot.sendMessage(chatId, text, opts),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Telegram send timed out')), ms)),
  ]).catch((e) => {
    console.error(`  ⚠️ Telegram send failed/timed out: ${e.message}`);
    return null;
  });

// ── Persistence ──────────────────────────────────────────────────────────────
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

const logDiag = (entry) => {
  const log = loadJSON(DIAG_FILE, []);
  log.push({ ...entry, ts: new Date().toISOString() });
  fs.writeFileSync(DIAG_FILE, JSON.stringify(log.slice(-2000), null, 2));
};

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 1: DATA FETCH
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 2: ATR — Average True Range (Wilder smoothing)
//  The only technical calculation used — purely for scaling tolerances and SL.
//  It measures current volatility in price terms, not direction.
// ─────────────────────────────────────────────────────────────────────────────

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
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
};

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 3: FIBONACCI — All 6 Levels
//
//  23.6% & 38.2% → Momentum gauge (logged, not entry gates)
//  50.0%         → TP1 (primary take-profit — mid-swing equilibrium)
//  61.8% – 78.6% → Entry pocket (golden zone)
//  88.6%         → Structural extreme (beyond this = remap territory)
// ─────────────────────────────────────────────────────────────────────────────

const calcFib = (high, low) => {
  const diff = high - low;
  return {
    level236: high - diff * 0.236,
    level382: high - diff * 0.382,
    level500: high - diff * 0.500,   // TP1
    level618: high - diff * 0.618,   // entry zone top
    level786: high - diff * 0.786,   // entry zone bottom
    level886: high - diff * 0.886,   // structural extreme
    zoneHigh: high - diff * config.FIB_ZONE_LOW,   // 60% — pocket upper
    zoneLow:  high - diff * config.FIB_ZONE_HIGH,  // 80% — pocket lower
    swingHigh: high,
    swingLow:  low,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 4: VOLUME PROFILE — POC + VAH + VAL (daily-anchored)
//
//  Anchored to current UTC day. Falls back to last 48 bars if session is young.
//
//  POC → price bucket with highest traded volume = institutional magnet
//  VAL → bottom boundary of the 70% value area = demand defense line
//  VAH → top boundary of the 70% value area = supply defense line
//
//  Returns { pocPrice, vahPrice, valPrice, maxVol, totalVol, barCount }
// ─────────────────────────────────────────────────────────────────────────────

const calcVolumeProfile = (data, rows = config.VP_ROWS) => {
  const startOfDayMs = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  const sessionBars  = data.filter(d => d.time * 1000 >= startOfDayMs);
  const workingBars  = sessionBars.length >= 8 ? sessionBars : data.slice(-48);

  if (workingBars.length < 4) return null;

  const high  = Math.max(...workingBars.map(d => d.high));
  const low   = Math.min(...workingBars.map(d => d.low));
  const range = high - low;
  if (range === 0 || !isFinite(range)) return null;

  const rowSize = range / rows;
  const bins    = {};

  workingBars.forEach(d => {
    const price = (d.high + d.low) / 2;
    const idx   = Math.min(Math.floor((price - low) / rowSize), rows - 1);
    bins[idx]   = (bins[idx] || 0) + d.volume;
  });

  // Build volume array and find POC
  let maxVol = 0, pocIdx = 0, totalVol = 0;
  const volArr = [];
  for (let i = 0; i < rows; i++) {
    const v = bins[i] || 0;
    volArr.push(v);
    totalVol += v;
    if (v > maxVol) { maxVol = v; pocIdx = i; }
  }

  const pocPrice = low + (pocIdx + 0.5) * rowSize;

  // Value Area: expand from POC outward until 70% of total volume is captured.
  //
  // BUGFIX (v8.2): the loop used to compare addLow/addHigh with >= even once
  // an edge was exhausted (addHigh or addLow forced to 0 at the boundary).
  // On sparse/low-volume data, once BOTH neighbors were 0, `0 >= 0` kept
  // picking the "expand high" branch — incrementing hiIdx PAST rows-1
  // forever, since cumVol stopped growing (adding 0 each time) so the
  // while-condition's volume target was never satisfied. This caused a
  // genuine infinite loop (confirmed by direct reproduction), which is the
  // most likely real explanation for the bot going silent: a hung run burns
  // its full timeout every time it hits this data shape, with no signal, no
  // state update, and no Telegram alert ever sent.
  //
  // Fix: track whether each side still HAS room to expand (not just whether
  // its volume contribution would win the comparison), and stop expanding a
  // side the moment it's exhausted. The loop now strictly shrinks the
  // remaining search space every iteration, so it always terminates.
  const targetVol = totalVol * config.VALUE_AREA_PCT;
  let cumVol = volArr[pocIdx];
  let loIdx  = pocIdx;
  let hiIdx  = pocIdx;

  while (cumVol < targetVol && (loIdx > 0 || hiIdx < rows - 1)) {
    const lowOpen  = loIdx > 0;
    const highOpen = hiIdx < rows - 1;
    const addLow   = lowOpen  ? volArr[loIdx - 1] : -Infinity;
    const addHigh  = highOpen ? volArr[hiIdx + 1] : -Infinity;

    if (!lowOpen && !highOpen) break; // both edges exhausted — nothing left to expand

    if (highOpen && (!lowOpen || addHigh >= addLow)) {
      hiIdx++;
      cumVol += volArr[hiIdx];
    } else {
      loIdx--;
      cumVol += volArr[loIdx];
    }
  }

  const valPrice = low + (loIdx + 0.5) * rowSize;
  const vahPrice = low + (hiIdx + 0.5) * rowSize;

  return { pocPrice, vahPrice, valPrice, maxVol, totalVol, barCount: workingBars.length };
};

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 5: 4H BIAS ENGINE
//
//  Determines higher-timeframe structural direction using a 3-of-4 vote
//  across all four pillars on the 4H chart.
//
//  VOTE TABLE:
//  ┌─────────────────┬──────────────────────────┬──────────────────────────┐
//  │ Pillar          │ Bullish vote              │ Bearish vote             │
//  ├─────────────────┼──────────────────────────┼──────────────────────────┤
//  │ POC position    │ price > 4H POC            │ price < 4H POC           │
//  │ VAH position    │ price > 4H VAH            │ price < 4H VAH           │
//  │ VAL position    │ price > 4H VAL            │ price < 4H VAL           │
//  │ Fib 50% level   │ price > 4H swing midpoint │ price < 4H swing midpoint│
//  └─────────────────┴──────────────────────────┴──────────────────────────┘
//
//  3+ bullish → BULLISH bias → only BUY entries pass
//  3+ bearish → BEARISH bias → only SELL entries pass
//  2-2 tie    → NEUTRAL → no entries (ambiguous — skip)
//
//  Returns { bias, bullVotes, poc4h, vah4h, val4h, fibMid4h, price4h, votes }
//  or null if insufficient data.
// ─────────────────────────────────────────────────────────────────────────────

const get4HBias = async (symbol) => {
  const data4h = await getKlines(symbol, config.BIAS_TIMEFRAME, config.BIAS_LOOKBACK);
  if (data4h.length < 50) {
    console.log(`  ⚠️ 4H BIAS: Insufficient data (${data4h.length} bars). Skipping bias gate.`);
    return null;
  }

  const price4h = data4h[data4h.length - 1].close;

  // Volume profile on 4H
  const vp4h = calcVolumeProfile(data4h);
  if (!vp4h) {
    console.log(`  ⚠️ 4H BIAS: Volume profile failed. Skipping.`);
    return null;
  }

  // Fib 50% on 4H using dedicated lookback (BIAS_FIB_LOOKBACK bars = same calendar window as entry TF)
  const fibData4h = data4h.slice(-config.BIAS_FIB_LOOKBACK);
  const swing4h = {
    high: Math.max(...fibData4h.map(d => d.high)),
    low:  Math.min(...fibData4h.map(d => d.low))
  };
  const fibMid4h = (swing4h.high + swing4h.low) / 2;

  // 3-of-4 vote
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

  console.log(
    `  📡 4H BIAS: $${price4h.toFixed(4)} | ` +
    `POC $${vp4h.pocPrice.toFixed(4)} [${votes.poc}] | ` +
    `VAH $${vp4h.vahPrice.toFixed(4)} [${votes.vah}] | ` +
    `VAL $${vp4h.valPrice.toFixed(4)} [${votes.val}] | ` +
    `Fib50% $${fibMid4h.toFixed(4)} [${votes.fib}] → ${bias} (${bullVotes}/4)`
  );

  return {
    bias, bullVotes,
    poc4h:    vp4h.pocPrice,
    vah4h:    vp4h.vahPrice,
    val4h:    vp4h.valPrice,
    fibMid4h, price4h, votes
  };
};

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 6: 4H ZONE CROSS-CHECK
//
//  After the bias confirms direction, this checks whether the entry price
//  actually sits near a 4H structural level (POC, VAH, VAL, or Fib 61.8/78.6).
//
//  This is the multi-timeframe confluence layer: when the entry zone
//  overlaps with a 4H structural level, both timeframes are pointing to the
//  same price — the highest-conviction setup possible.
//
//  Tolerance: entry-TF ATR × HTFZONE_ATR_MULT (scales with entry volatility).
//
//  Returns { aligned: bool, nearestLevel: string, distance: number }
// ─────────────────────────────────────────────────────────────────────────────

const check4HZoneAlignment = (entryPrice, bias4h, atr1h) => {
  if (!bias4h) return { aligned: true, nearestLevel: 'N/A', distance: 0 }; // no data = don't block

  const tol = atr1h * config.HTFZONE_ATR_MULT;

  // All 4H structural levels that matter at the entry price
  const levels = [
    { name: '4H POC',    price: bias4h.poc4h    },
    { name: '4H VAH',    price: bias4h.vah4h    },
    { name: '4H VAL',    price: bias4h.val4h    },
    { name: '4H Fib50%', price: bias4h.fibMid4h },
  ];

  let nearest = null;
  let minDist = Infinity;

  for (const lvl of levels) {
    const dist = Math.abs(entryPrice - lvl.price);
    if (dist < minDist) {
      minDist = dist;
      nearest = lvl;
    }
  }

  const aligned = minDist <= tol;

  console.log(
    `  🔗 4H ZONE CHECK: entry $${entryPrice.toFixed(4)} | ` +
    `nearest ${nearest.name} $${nearest.price.toFixed(4)} | ` +
    `dist $${minDist.toFixed(4)} vs tol $${tol.toFixed(4)} → ${aligned ? '✅ ALIGNED' : '❌ NOT ALIGNED'}`
  );

  return { aligned, nearestLevel: nearest.name, nearestPrice: nearest.price, distance: minDist };
};

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 7: CONFLUENCE ENGINE — ATR-Relative Tolerance
//
//  Scores how tightly a Fib level overlaps with a volume pivot (POC, VAH, VAL).
//  Score 2 = tight (within 0.5× tol) — very high probability
//  Score 1 = acceptable (within 1× tol)
//  Score 0 = no confluence
// ─────────────────────────────────────────────────────────────────────────────

const confluenceScore = (fibLevel, pivot, atr) => {
  if (!pivot || !fibLevel || !atr || !isFinite(pivot) || !isFinite(fibLevel)) return 0;
  const tol  = atr * config.CONFLUENCE_ATR_MULT;
  const dist = Math.abs(fibLevel - pivot);
  if (dist <= tol * 0.5) return 2;
  if (dist <= tol)       return 1;
  return 0;
};

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 8: REJECTION DETECTOR — 2-of-4 Pattern Rule
//
//  Four patterns — signal fires if ≥ REJECTION_MIN_PATTERNS (2) match.
//
//  1. POC_RECLAIM (NEW — strongest institutional signal):
//     Candle wicked through POC but CLOSED back above it (BUY) or below (SELL).
//     This is institutions defending the Point of Control with body conviction.
//
//  2. PIN_BAR:
//     Long wick (> 1.5× body) into the zone — rejection at the level.
//
//  3. ENGULFING:
//     Body fully engulfs prior candle in the direction of the trade.
//
//  4. CLOSE_REJECTION:
//     Candle entered the Fib zone but closed cleanly outside it.
//
//  ABSORPTION VETO (directional):
//     High-volume directional close (body > 60% of range) in the opposing
//     direction vetoes the signal — institutions absorbing against you.
//
//  Returns { valid, patterns[], absorptionVeto, score }
// ─────────────────────────────────────────────────────────────────────────────

const detectRejection = (candles, zoneLow, zoneHigh, direction, pocPrice) => {
  if (candles.length < 2) return { valid: false, patterns: [], absorptionVeto: false, score: 0 };

  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];

  // Must have touched the zone
  const touchedZone = c.low <= zoneHigh && c.high >= zoneLow;
  if (!touchedZone) return { valid: false, patterns: [], absorptionVeto: false, score: 0 };

  const body      = Math.abs(c.close - c.open);
  const fullRange = c.high - c.low;
  const bodyRatio = fullRange > 0 ? body / fullRange : 0;

  // ── Directional absorption veto ──
  let absorptionVeto = false;
  if (bodyRatio > config.ABSORPTION_BODY_RATIO) {
    if (direction === 'SELL' && c.close > c.open)  absorptionVeto = true;
    if (direction === 'BUY'  && c.close < c.open)  absorptionVeto = true;
  }

  const patterns = [];

  if (direction === 'BUY') {
    // 1. POC reclaim: wicked below POC, closed above it
    if (pocPrice && c.low < pocPrice && c.close > pocPrice) patterns.push('POC_RECLAIM');

    // 2. Pin bar: lower wick > 1.5× body
    const lowerWick = Math.min(c.open, c.close) - c.low;
    if (lowerWick > body * 1.5 && body > 0) patterns.push('PIN_BAR');

    // 3. Bullish body-engulfing
    if (c.close > c.open && c.close > p.close && c.open < p.open) patterns.push('ENGULFING');

    // 4. Close rejection: wick into zone, closed above zone
    if (c.low <= zoneHigh && c.close > zoneHigh) patterns.push('CLOSE_REJECTION');

  } else {
    // 1. POC reclaim: wicked above POC, closed below it
    if (pocPrice && c.high > pocPrice && c.close < pocPrice) patterns.push('POC_RECLAIM');

    // 2. Pin bar: upper wick > 1.5× body
    const upperWick = c.high - Math.max(c.open, c.close);
    if (upperWick > body * 1.5 && body > 0) patterns.push('PIN_BAR');

    // 3. Bearish body-engulfing
    if (c.close < c.open && c.close < p.close && c.open > p.open) patterns.push('ENGULFING');

    // 4. Close rejection: wick into zone, closed below zone
    if (c.high >= zoneLow && c.close < zoneLow) patterns.push('CLOSE_REJECTION');
  }

  const score = patterns.length;
  const valid = !absorptionVeto && score >= config.REJECTION_MIN_PATTERNS;

  return { valid, patterns, absorptionVeto, score };
};

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 9: ZONE INVALIDATION CHECK
// ─────────────────────────────────────────────────────────────────────────────

const isZoneInvalidated = (closePrice, zoneRef, atr, direction) => {
  const margin = atr * config.ZONE_INVALIDATION_ATR_MULT;
  if (direction === 'BUY'  && closePrice < zoneRef - margin) return true;
  if (direction === 'SELL' && closePrice > zoneRef + margin) return true;
  return false;
};

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 10: SIGNAL COOLDOWN
// ─────────────────────────────────────────────────────────────────────────────

const isCoolingDown = (symbol, direction, currentBarTime) => {
  const state = loadJSON(STATE_FILE, {});
  const s = state[symbol];
  if (!s || !s.lastSignalBar || !s.lastSignalDir) return false;
  if (s.lastSignalDir !== direction) return false;
  const barsSince = Math.round((currentBarTime - s.lastSignalBar) / config.ENTRY_BAR_SECONDS);
  return barsSince < config.SIGNAL_COOLDOWN_BARS;
};

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 11: MAIN STRATEGY ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const runStrategy = async (symbol) => {
  const now = new Date().toISOString();
  console.log(`\n[${now}] 🔍 MVS v8.2 scanning ${symbol}...`);

  {
    const state = loadJSON(STATE_FILE, {});
    state._lastRunAt = now;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  try {

    // ── STEP 0: 4H BIAS ─────────────────────────────────────────────────
    // First gate. Determines structural direction on the higher timeframe.
    // NEUTRAL bias (2-2 tie) blocks all entries — market is undecided.
    const bias4h = await get4HBias(symbol);

    if (bias4h && bias4h.bias === 'NEUTRAL') {
      console.log(`  ⛔ 4H BIAS NEUTRAL (${bias4h.bullVotes}/4 bull votes) — market structure undecided. No entry.`);
      logDiag({ symbol, bias4h: 'NEUTRAL', bullVotes: bias4h.bullVotes, fired: false, reason: '4H_NEUTRAL' });
      return;
    }

    // ── STEP 1: FETCH ENTRY-TF DATA ────────────────────────────────────────────
    const data = await getKlines(symbol, config.TIMEFRAME, config.VP_LOOKBACK);
    if (data.length < 50) {
      console.log(`  ⚠️ Insufficient entry-TF data (${data.length} bars). Skipping.`);
      return;
    }

    const current = data[data.length - 1];
    const price   = current.close;
    const barTime = current.time;

    // ── STEP 2: ATR ──────────────────────────────────────────────────────
    const atr = calcATR(data);
    if (!atr) {
      console.log(`  ⚠️ ATR calculation failed. Skipping.`);
      return;
    }

    // ── STEP 3: ENTRY-TF FIBONACCI (FIB_LOOKBACK-bar swing) ────────────────────────────
    const fibData = data.slice(-config.FIB_LOOKBACK);
    const swing = {
      high: Math.max(...fibData.map(d => d.high)),
      low:  Math.min(...fibData.map(d => d.low))
    };

    // A2: Structural remap — price broke the entry-TF FIB_LOOKBACK-bar swing
    if (price > swing.high || price < swing.low) {
      console.log(`  🔄 A2 STRUCTURAL REMAP: ${symbol} broke 200-bar swing.`);
      saveState(symbol, { signal: 'A2_REMAP', price, swingHigh: swing.high, swingLow: swing.low });
      logSignal(symbol, { signal: 'A2_REMAP', price });
      await sendSafe(config.TELEGRAM_CHAT_ID,
        `🔄 *[${symbol}] A2 — Structural Remap*\n\nPrice broke the 200-bar swing.\nAll previous zones are VOID.\nRecalculating next scan.\n⏰ ${new Date().toUTCString()}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const fib      = calcFib(swing.high, swing.low);
    const midPoint = (swing.high + swing.low) / 2;
    const direction = price > midPoint ? 'BUY' : 'SELL';

    // ── STEP 4: 4H DIRECTION GATE ────────────────────────────────────────
    // 4H bias must agree with entry-TF direction.
    if (bias4h) {
      const biasAligned =
        (direction === 'BUY'  && bias4h.bias === 'BULLISH') ||
        (direction === 'SELL' && bias4h.bias === 'BEARISH');

      if (!biasAligned) {
        console.log(`  ⛔ 4H BIAS BLOCK: ${direction} rejected — 4H is ${bias4h.bias} (${bias4h.bullVotes}/4 bull | POC ${bias4h.votes.poc} VAH ${bias4h.votes.vah} VAL ${bias4h.votes.val} Fib ${bias4h.votes.fib})`);
        logDiag({
          symbol, barTime, price,
          bias4h: bias4h.bias, bullVotes: bias4h.bullVotes,
          direction, biasAligned: false,
          fired: false, reason: '4H_BIAS_BLOCKED'
        });
        return;
      }
      console.log(`  ✅ 4H BIAS: ${bias4h.bias} (${bias4h.bullVotes}/4) — aligned with ${direction}`);
    }

    // ── STEP 5: D4 OVER-EXTENSION CHECK ─────────────────────────────────
    // Beyond 88.6% = structural extreme. The swing is likely invalid.
    const D4_pass = !(
      (direction === 'BUY'  && price < fib.level886) ||
      (direction === 'SELL' && price > fib.level886)
    );
    if (!D4_pass) {
      console.log(`  ⏭️ D4 OVER-EXTENDED: Price beyond 88.6% structural extreme.`);
      logDiag({ symbol, barTime, price, atr: atr.toFixed(4), D4_pass, fired: false, reason: 'D4_OVER_EXTENDED' });
      return;
    }

    // ── STEP 6: EARLY ZONE-PROXIMITY SKIP ───────────────────────────────
    // Save compute — don't run VP/confluence if price isn't anywhere near zone.
    {
      const earlyZoneLow  = fib.zoneLow  - atr * 0.1;
      const earlyZoneHigh = fib.zoneHigh + atr * 0.1;
      if (price < earlyZoneLow - atr || price > earlyZoneHigh + atr) {
        console.log(`  ⏳ Price not near zone ($${fib.zoneLow.toFixed(2)}–$${fib.zoneHigh.toFixed(2)}). Waiting.`);
        return;
      }
    }

    // ── STEP 7: ENTRY-TF VOLUME PROFILE — POC + VAH + VAL ─────────────────────
    const vp = calcVolumeProfile(data);
    if (!vp) {
      console.log(`  ⚠️ Volume Profile failed. Skipping.`);
      return;
    }
    console.log(`  📊 POC $${vp.pocPrice.toFixed(2)} | VAH $${vp.vahPrice.toFixed(2)} | VAL $${vp.valPrice.toFixed(2)} | Bars: ${vp.barCount}`);
    console.log(`  📐 ATR(14): $${atr.toFixed(2)} | Direction: ${direction}`);
    console.log(`  🎯 Entry-TF Fib zone: $${fib.zoneLow.toFixed(2)} – $${fib.zoneHigh.toFixed(2)} (60–80% pocket)`);

    saveState(symbol, {
      signal: 'SCANNED', price,
      poc: vp.pocPrice, vah: vp.vahPrice, val: vp.valPrice,
      swingHigh: swing.high, swingLow: swing.low, atr, direction
    });

    // ── STEP 8: ENTRY-TF CONFLUENCE CHECK (Fib × POC / VAH / VAL) ─────────────
    // Check 61.8%, 78.6%, and zone midpoint against POC, VAH, and VAL.
    // Best scoring combination wins.
    const fibMid      = (fib.zoneHigh + fib.zoneLow) / 2;
    const checkLevels = [fib.level618, fib.level786, fibMid];
    const checkPivots = [
      { name: 'POC', price: vp.pocPrice },
      { name: 'VAH', price: vp.vahPrice },
      { name: 'VAL', price: vp.valPrice },
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
      console.log(`  ❌ A1: No Fib/POC/VAH/VAL confluence at current price. Waiting.`);
      logDiag({
        symbol, barTime, price, atr: atr.toFixed(4),
        poc: vp.pocPrice, vah: vp.vahPrice, val: vp.valPrice,
        fibZoneLow: fib.zoneLow, fibZoneHigh: fib.zoneHigh,
        D4_pass, A1_pass, fired: false, reason: 'A3_NO_CONFLUENCE'
      });
      return;
    }

    const fibPct = bestFibLevel === fib.level618 ? '61.8%'
                 : bestFibLevel === fib.level786 ? '78.6%'
                 : '70% mid-pocket';

    console.log(`  ✅ A1 CONFLUENCE (score ${bestScore}/2): Fib ${fibPct} ($${bestFibLevel.toFixed(2)}) ↔ ${bestPivot.name} ($${bestPivot.price.toFixed(2)})`);

    // ── STEP 9: 4H ZONE CROSS-CHECK ─────────────────────────────────────
    // Is the entry price near a 4H structural level?
    // This is the highest-conviction filter in the entire bot.
    const htfCheck = check4HZoneAlignment(bestFibLevel, bias4h, atr);
    if (!htfCheck.aligned) {
      console.log(`  ⛔ 4H ZONE MISMATCH: entry $${bestFibLevel.toFixed(2)} not near any 4H structural level (nearest: ${htfCheck.nearestLevel} $${htfCheck.nearestPrice.toFixed(2)}, dist $${htfCheck.distance.toFixed(2)}). Waiting.`);
      logDiag({
        symbol, barTime, price, atr: atr.toFixed(4),
        bestFibLevel, htfNearest: htfCheck.nearestLevel,
        htfDist: htfCheck.distance, D4_pass, A1_pass,
        fired: false, reason: 'HTF_ZONE_MISMATCH'
      });
      return;
    }
    console.log(`  ✅ 4H ZONE ALIGNED: entry near ${htfCheck.nearestLevel} ($${htfCheck.nearestPrice.toFixed(2)})`);

    // ── STEP 10: ZONE INVALIDATION CHECK ────────────────────────────────
    if (isZoneInvalidated(price, bestFibLevel, atr, direction)) {
      console.log(`  ❌ ZONE INVALIDATED: Price closed through Fib zone by > ATR×${config.ZONE_INVALIDATION_ATR_MULT}.`);
      logDiag({ symbol, barTime, price, D4_pass, A1_pass, fired: false, reason: 'ZONE_INVALIDATED' });
      return;
    }

    // ── STEP 11: SIGNAL COOLDOWN ─────────────────────────────────────────
    if (isCoolingDown(symbol, direction, barTime)) {
      console.log(`  ⏸️ COOLDOWN: ${direction} on ${symbol} suppressed (< ${config.SIGNAL_COOLDOWN_BARS} bars since last).`);
      logDiag({ symbol, barTime, price, D4_pass, A1_pass, fired: false, reason: 'COOLDOWN' });
      return;
    }

    // ── STEP 12: REJECTION CANDLE (2-of-4 rule) ─────────────────────────
    const entryZoneLow  = fib.zoneLow  - atr * 0.1;
    const entryZoneHigh = fib.zoneHigh + atr * 0.1;

    const rejection = detectRejection(data, entryZoneLow, entryZoneHigh, direction, vp.pocPrice);

    logDiag({
      symbol, barTime, price,
      atr:             atr.toFixed(4),
      bias4h:          bias4h ? bias4h.bias : 'N/A',
      bullVotes4h:     bias4h ? bias4h.bullVotes : 'N/A',
      htfAligned:      htfCheck.aligned,
      htfNearest:      htfCheck.nearestLevel,
      poc:             vp.pocPrice, vah: vp.vahPrice, val: vp.valPrice,
      fibZoneLow:      fib.zoneLow, fibZoneHigh: fib.zoneHigh,
      D4_pass, A1_pass,
      confluenceScore: bestScore,
      confluenceLevel: fibPct,
      confluencePivot: bestPivot.name,
      patterns:        rejection.patterns,
      absorptionVeto:  rejection.absorptionVeto,
      rejectionScore:  rejection.score,
      fired:           rejection.valid,
      reason: rejection.valid           ? 'B_SIGNAL_FIRED'
             : rejection.absorptionVeto ? 'D1_ABSORPTION_VETO'
             : `PATTERNS_${rejection.score}_OF_${config.REJECTION_MIN_PATTERNS}`
    });

    if (!rejection.valid) {
      if (rejection.absorptionVeto) {
        console.log(`  ⏳ D1 ABSORPTION VETO: ${direction} suppressed — opposing institutional absorption candle.`);
        const skipMsg =
          `⏳ *[${symbol}] D1 — Directional Absorption*\n\n` +
          `Zone touched at ${bestPivot.name} ($${bestFibLevel.toFixed(2)}) ` +
          `but a ${direction === 'BUY' ? 'bearish' : 'bullish'} absorption candle appeared.\n` +
          `Institutions absorbing against your direction. Skip.\n\n` +
          `⏰ ${new Date().toUTCString()}`;
        await sendSafe(config.TELEGRAM_CHAT_ID, skipMsg, { parse_mode: 'Markdown' });
      } else {
        console.log(`  ⏳ WEAK REJECTION: ${rejection.score}/${config.REJECTION_MIN_PATTERNS} patterns. Waiting for stronger signal.`);
      }
      return;
    }

    // ── STEP 13: SL / TP CALCULATION ────────────────────────────────────
    // SL: beyond swing wick ± 0.25×ATR
    const swingWick = direction === 'BUY' ? swing.low  : swing.high;
    const slPrice   = direction === 'BUY'
      ? swingWick - atr * config.SL_ATR_MULT
      : swingWick + atr * config.SL_ATR_MULT;

    // TP1: 50% Fib — equilibrium, close 50% of position
    const tp1Price = fib.level500;

    // TP2: POC — institutional magnet, runner target
    const tp2Price = vp.pocPrice;

    // TP3: VAH (BUY) or VAL (SELL) — full structural exit
    const tp3Price = direction === 'BUY' ? vp.vahPrice : vp.valPrice;

    const entryPrice = bestFibLevel;
    const risk    = Math.abs(entryPrice - slPrice);
    const reward1 = Math.abs(tp1Price - entryPrice);
    const reward2 = Math.abs(tp2Price - entryPrice);
    const reward3 = Math.abs(tp3Price - entryPrice);
    const rr1 = risk > 0 ? (reward1 / risk).toFixed(2) : 'N/A';
    const rr2 = risk > 0 ? (reward2 / risk).toFixed(2) : 'N/A';
    const rr3 = risk > 0 ? (reward3 / risk).toFixed(2) : 'N/A';

    // ── STEP 14: TELEGRAM ALERT ──────────────────────────────────────────
    const emoji     = direction === 'BUY' ? '🟢' : '🔴';
    const signalTag = direction === 'BUY' ? 'B1 — Bullish Sniper' : 'B2 — Bearish Sniper';
    const patternStr = rejection.patterns.join(' + ');

    const bias4hLine = bias4h
      ? `🧭 *4H Bias:* ${bias4h.bias} (${bias4h.bullVotes}/4 — POC ${bias4h.votes.poc} | VAH ${bias4h.votes.vah} | VAL ${bias4h.votes.val} | Fib ${bias4h.votes.fib})`
      : `🧭 *4H Bias:* N/A`;

    const htfLine = `🔗 *4H Zone:* Entry near ${htfCheck.nearestLevel} ($${htfCheck.nearestPrice.toFixed(2)}) ✅`;

    const message = `
${emoji} *${symbol} — MVS ${signalTag}*

📊 *Direction:* ${direction}
${bias4hLine}
${htfLine}

💵 *Entry:* $${entryPrice.toFixed(2)} (Fib ${fibPct} ↔ ${bestPivot.name})
🎯 *TP1* (50% Fib — close 50%): $${tp1Price.toFixed(2)} | R:R ${rr1}:1
🏁 *TP2* (POC runner): $${tp2Price.toFixed(2)} | R:R ${rr2}:1
🏆 *TP3* (${direction === 'BUY' ? 'VAH' : 'VAL'} full exit): $${tp3Price.toFixed(2)} | R:R ${rr3}:1
🛑 *SL* (swing wick + ATR buffer): $${slPrice.toFixed(2)}

📈 *Entry-TF Structure:*
   • POC: $${vp.pocPrice.toFixed(2)} | VAH: $${vp.vahPrice.toFixed(2)} | VAL: $${vp.valPrice.toFixed(2)}
   • Confluence score: ${bestScore}/2

🕯 *Rejection (${rejection.score}/${config.REJECTION_MIN_PATTERNS} patterns):* ${patternStr}
📐 *ATR(14):* $${atr.toFixed(2)}

⏰ *Time:* ${new Date().toUTCString()}
⚡ *MVS v8.2 — Structure is everything.*
    `.trim();

    await sendSafe(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log(`  ✅ B-SIGNAL FIRED: ${symbol} | ${direction} @ $${entryPrice.toFixed(2)} | Patterns: ${patternStr}`);

    saveState(symbol, {
      signal: signalTag, direction,
      entryPrice, tp1Price, tp2Price, tp3Price, slPrice,
      rr1, rr2, rr3,
      patterns: rejection.patterns,
      lastSignalBar: barTime,
      lastSignalDir: direction
    });

    logSignal(symbol, {
      signal: signalTag, direction,
      entryPrice, tp1Price, tp2Price, tp3Price, slPrice,
      rr1, rr2, rr3,
      confluencePivot: bestPivot.name,
      fibPct, patterns: rejection.patterns,
      bias4h: bias4h ? bias4h.bias : 'N/A',
      htfNearest: htfCheck.nearestLevel
    });

  } catch (err) {
    console.error(`  ❌ Error processing ${symbol}:`, err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║   MVS — Monthly Value Sniper v8.2   by Abdin               ║');
console.log('║   Foundation: POC + VAH + VAL + FIBO  |  No lagging data   ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`   Assets  : ${config.SYMBOLS.join(', ')}`);
console.log(`   Entry   : ${config.TIMEFRAME}  →  Bias: ${config.BIAS_TIMEFRAME} (3-of-4 pillar vote)`);
console.log(`   VP bars : ${config.VP_LOOKBACK} (entry-TF) | ${config.BIAS_LOOKBACK} (4H)`);
console.log(`   Fib bars: ${config.FIB_LOOKBACK} (entry-TF) | ${config.BIAS_FIB_LOOKBACK} (4H)`);
console.log(`   Confluence: ATR×${config.CONFLUENCE_ATR_MULT} | HTF zone: ATR×${config.HTFZONE_ATR_MULT}`);
console.log(`   Rejection : ${config.REJECTION_MIN_PATTERNS}-of-4 patterns (POC_RECLAIM, PIN_BAR, ENGULFING, CLOSE_REJECTION)`);
console.log(`   Cooldown  : ${config.SIGNAL_COOLDOWN_BARS} bars | Zone void: ATR×${config.ZONE_INVALIDATION_ATR_MULT}`);
console.log('');

(async () => {
  for (const sym of config.SYMBOLS) {
    await runStrategy(sym);
    if (config.SYMBOLS.indexOf(sym) < config.SYMBOLS.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.log('\n✅ Scan complete. Exiting.');
  process.exit(0);
})();
