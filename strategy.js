/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — MONTHLY VALUE SNIPER v6.0
 *  "If it doesn't reject the monthly anchor, it's not a trade."
 *  By Abdin
 *  
 *  KUCOIN API EDITION — FOR GHANA
 *  
 *  KuCoin Spot API: GET /api/v1/market/candles
 *  Symbol format: BTC-USDT, SOL-USDT (hyphen-separated)
 *  Response: [time, open, close, high, low, volume, turnover]
 *  Max 1500 records per request
 *  
 *  Why KuCoin? Binance and Bybit do NOT work in Ghana. KuCoin does.
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  CORE PILLARS (ONLY THESE THREE — NOTHING ELSE):
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  1. POC  → Point of Control (monthly volume magnet)               │
 *  │  2. VAL  → Value Area Low (70% cumulative — defender line)        │
 *  │  3. FIBO → Fibonacci (61.8%, 78.6%, 50%, 88.6%)                  │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 *  ELIMINATED: OB, VWAP, LVN, VAH, 4H bias, multi-TF, subjective zones
 */

const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 1: KUCOIN DATA FETCH (Ghana-compatible)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch OHLCV data from KuCoin Spot API
 * 
 * KUCOIN ENDPOINT: GET /api/v1/market/candles
 * KUCOIN SYMBOL FORMAT: BTC-USDT, SOL-USDT (hyphen-separated, NOT BTCUSDT)
 * KUCOIN RESPONSE: [time, open, close, high, low, volume, turnover]
 *   Index 0: time (timestamp in seconds)
 *   Index 1: open
 *   Index 2: close
 *   Index 3: high
 *   Index 4: low
 *   Index 5: volume
 *   Index 6: turnover (optional, not used)
 * 
 * KUCOIN TYPE PARAM: 1hour, 2hour, 4hour, 1day, 1week, 1month
 * KUCOIN MAX: 1500 records per request (covers our 500-bar need easily)
 * 
 * @param {string} symbol   — Trading pair (e.g., BTC-USDT)
 * @param {string} interval — Candle timeframe (1hour)
 * @param {number} limit    — Number of candles to fetch
 * @returns {Array}          — Array of {open, high, low, close, volume}
 */
const getKlines = async (symbol, interval, limit) => {
  const url = `${config.BASE_URL}/market/candles?symbol=${symbol}&type=${interval}`;

  try {
    const res = await axios.get(url, { 
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // KuCoin returns { code: "200000", data: [[time, open, close, high, low, volume, turnover], ...] }
    if (res.data.code !== '200000') {
      console.error(`  ❌ KuCoin API error: ${res.data.code} — ${res.data.msg || 'Unknown error'}`);
      return [];
    }

    const candles = res.data.data || [];

    // KuCoin returns data in reverse chronological order (newest first)
    // We need to reverse to chronological order (oldest first) for our calculations
    const sorted = candles.reverse();

    // Take only the last 'limit' candles if we got more than requested
    const limited = sorted.slice(-limit);

    return limited.map(k => ({
      time: parseInt(k[0]),      // Timestamp in seconds
      open: parseFloat(k[1]),    // Open price
      close: parseFloat(k[2]),   // Close price
      high: parseFloat(k[3]),    // High price
      low: parseFloat(k[4]),     // Low price
      volume: parseFloat(k[5])   // Volume
    }));

  } catch (error) {
    console.error(`  ❌ KuCoin fetch error for ${symbol}:`, error.message);
    return [];
  }
};

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 2: FIBONACCI (All 6 Levels — Pure Mathematical Gravity)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calculate all 6 Fibonacci retracement levels from a swing
 *
 * MVS ROLES:
 * • 23.6% & 38.2%  → Momentum gauge (trend strength only — NO ENTRY)
 * • 50.0%          → PRIMARY TP (100% exit — rubber band snap-back)
 * • 61.8% & 78.6%  → PRIMARY ENTRY ZONE (MUST overlap POC or VAL)
 * • 88.6%          → SL TRIGGER (structural invalidation + buffer)
 *
 * @param {number} high — Swing high
 * @param {number} low  — Swing low
 * @returns {Object}     — All 6 Fibonacci price levels
 */
const calcFib = (high, low) => {
  const diff = high - low;
  return {
    level236: high - diff * 0.236,   // A: Momentum gauge — NOT for entry
    level382: high - diff * 0.382,   // A: Momentum gauge — NOT for entry
    level500: high - diff * 0.500,   // C: PRIMARY TAKE-PROFIT (TP)
    level618: high - diff * 0.618,   // B: PRIMARY ENTRY ZONE #1
    level786: high - diff * 0.786,   // B: PRIMARY ENTRY ZONE #2
    level886: high - diff * 0.886,   // C: STOP-LOSS (SL) TRIGGER
  };
};

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 3: VOLUME PROFILE (POC & VAL ONLY — 500-Bar Monthly Anchor)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calculate Volume Profile — ONLY POC and VAL
 *
 * MVS PRINCIPLE: 500 bars = ~21 days of 1H data.
 * This is the institutional footprint sweet spot.
 *
 * PURE TRIO:
 * • POC = Point of Control (highest volume node — monthly price magnet)
 * • VAL = Value Area Low (70% cumulative volume floor — monthly defender)
 *
 * EXCLUDED: VAH, LVN, VPOC — noise. Only POC & VAL matter for confluence.
 *
 * @param {Array} data  — OHLCV candle array
 * @param {number} rows — Number of profile rows (default: 100)
 * @returns {Object|null} — {pocPrice, valPrice} or null if insufficient data
 */
const calcPOCandVAL = (data, rows = config.VP_ROWS || 100) => {
  if (data.length < 50) return null;

  const high = Math.max(...data.map(d => d.high));
  const low = Math.min(...data.map(d => d.low));
  const range = high - low;

  if (range === 0 || !isFinite(range)) return null;

  const rowSize = range / rows;
  const bins = {};

  // Distribute volume into price bins using candle midpoint
  data.forEach(d => {
    const price = (d.high + d.low) / 2;
    const idx = Math.min(Math.floor((price - low) / rowSize), rows - 1);
    bins[idx] = (bins[idx] || 0) + d.volume;
  });

  // ── POC: Point of Control (highest volume node) ──
  let maxVol = 0;
  let pocPrice = low;
  let totalVol = 0;
  const volArr = [];

  for (let i = 0; i < rows; i++) {
    const v = bins[i] || 0;
    volArr.push(v);
    totalVol += v;
    if (v > maxVol) {
      maxVol = v;
      pocPrice = low + (i + 0.5) * rowSize;
    }
  }

  // ── VAL: Value Area Low (70% cumulative volume from bottom) ──
  const targetVol = totalVol * 0.70;
  let cumVol = 0;
  let valPrice = low;

  for (let i = 0; i < rows; i++) {
    cumVol += volArr[i];
    if (cumVol >= targetVol) {
      valPrice = low + (i + 0.5) * rowSize;
      break;
    }
  }

  return { pocPrice, valPrice, maxVol, totalVol };
};

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 4: CONFLUENCE ENGINE (Fib vs POC/VAL — The Monthly Anchor)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if a Fibonacci level overlaps with a volume node (POC or VAL)
 *
 * MVS RULE: The 61.8% or 78.6% Fib MUST sit within 0.5% of POC or VAL.
 * This overlap is where monthly institutional limit orders are stacked.
 *
 * @param {number} level — Fibonacci price level
 * @param {number} pivot — POC or VAL price level
 * @param {number} tol   — Tolerance percentage (default: 0.5%)
 * @returns {boolean}    — True if confluent (overlap confirmed)
 */
const isConfluent = (level, pivot, tol = config.CONFLUENCE_TOL) => {
  if (!pivot || !level || level === 0 || !isFinite(level) || !isFinite(pivot)) return false;
  return (Math.abs(level - pivot) / level) * 100 <= tol;
};

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 5: REJECTION CANDLE DETECTOR (Strict Price Action Filter)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Detect institutional rejection at confluence zone
 *
 * MVS RULE: Price must enter the zone AND form a CLEAR rejection:
 * • BUY:  Lower wick > 2× body (Pin Bar) OR Bullish Engulfing
 * • SELL: Upper wick > 2× body (Pin Bar) OR Bearish Engulfing
 *
 * CRITICAL SKIP CONDITIONS (D-signals):
 * • Slow slide into zone (no wick) → D1 Absorption
 * • Price slices through zone without pausing → D2 Sharp Breakout
 * • Price beyond 88.6% before scan → D4 Over-Extended
 *
 * @param {Array} candles    — Recent candle array (last 2 minimum)
 * @param {number} zoneLow    — Lower bound of entry zone
 * @param {number} zoneHigh   — Upper bound of entry zone
 * @param {string} direction  — 'BUY' or 'SELL'
 * @returns {Object}         — {valid: boolean, type: string|null}
 */
const detectRejection = (candles, zoneLow, zoneHigh, direction) => {
  if (candles.length < 2) return { valid: false, type: null };

  const c = candles[candles.length - 1];  // Current candle
  const p = candles[candles.length - 2];  // Previous candle

  // Price must have entered the confluence zone
  const enteredZone = (c.low <= zoneHigh && c.high >= zoneLow);
  if (!enteredZone) return { valid: false, type: null };

  // ── D1: Absorption Check — Skip if body is small AND no significant wick ──
  const body = Math.abs(c.close - c.open);
  const candleRange = c.high - c.low;

  if (body > 0 && candleRange > 0) {
    const bodyToRangeRatio = body / candleRange;
    // If body is > 60% of range and no long wick = absorption, not rejection
    if (bodyToRangeRatio > 0.6) {
      return { valid: false, type: 'D1_ABSORPTION' };
    }
  }

  if (direction === 'BUY') {
    // ── B1: Bullish Pin Bar (lower wick > 2× body) ──
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const isPinBar = (lowerWick > body * 2 && body > 0);

    // ── B1: Bullish Engulfing ──
    const isEngulfing = (c.close > c.open && c.close > p.high && c.open < p.low);

    if (isPinBar) return { valid: true, type: 'B1_BULL_PIN' };
    if (isEngulfing) return { valid: true, type: 'B1_BULL_ENGULF' };

    return { valid: false, type: 'D1_ABSORPTION' };
  } else {
    // ── B2: Bearish Pin Bar (upper wick > 2× body) ──
    const upperWick = c.high - Math.max(c.open, c.close);
    const isPinBar = (upperWick > body * 2 && body > 0);

    // ── B2: Bearish Engulfing ──
    const isEngulfing = (c.close < c.open && c.close < p.low && c.open > p.high);

    if (isPinBar) return { valid: true, type: 'B2_BEAR_PIN' };
    if (isEngulfing) return { valid: true, type: 'B2_BEAR_ENGULF' };

    return { valid: false, type: 'D1_ABSORPTION' };
  }
};

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 6: MAIN STRATEGY — MVS Execution Engine (KuCoin Edition)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Execute MVS for a single symbol using KuCoin data
 * 
 * FLOW:
 * 1. Fetch 500 bars of 1H data from KuCoin (Ghana-compatible)
 * 2. Calculate 200-bar Fibonacci swing
 * 3. Calculate 500-bar Volume Profile (POC & VAL)
 * 4. Check Confluence: 61.8% or 78.6% overlaps POC or VAL?
 *    → NO: D-signal or A3 (silent expiry)
 *    → YES: A1 Golden Zone Alert → proceed to rejection check
 * 5. Determine bias from swing midpoint
 * 6. Detect rejection candle (Pin Bar or Engulfing)
 *    → NO: D1 Absorption → skip
 *    → YES: B1/B2 Sniper Entry → alert
 * 7. Calculate SL (88.6% + 0.2%) and TP (50% exact)
 * 
 * @param {string} symbol — Trading pair in KuCoin format (e.g., BTC-USDT)
 */
const runStrategy = async (symbol) => {
  const now = new Date().toISOString();
  console.log(`[${now}] 🔍 MVS scanning ${symbol} [KuCoin | 1H | VP:500 | Fib:200]...`);

  try {
    // ── Fetch 500 bars of 1H data from KuCoin ──
    // KuCoin returns up to 1500 records, so 500 is well within limits
    const data = await getKlines(symbol, config.TIMEFRAME, config.VP_LOOKBACK);

    if (data.length < 200) {
      console.log(`  ⚠️ Insufficient data (${data.length} bars). Need 200+. Skipping.`);
      return;
    }

    // ═══════════════════════════════════════════════════════════
    //  STEP 1: 1H FIBONACCI (200-bar swing)
    // ═══════════════════════════════════════════════════════════
    const fibData = data.slice(-config.FIB_LOOKBACK);
    const swing = {
      high: Math.max(...fibData.map(d => d.high)),
      low: Math.min(...fibData.map(d => d.low))
    };

    // A2: Structural Remap detection — if current price broke the swing
    const currentPrice = data[data.length - 1].close;
    const prevPrice = data[data.length - 2].close;

    if (currentPrice > swing.high || currentPrice < swing.low) {
      console.log(`  🔄 A2 STRUCTURAL REMAP: ${symbol} broke 200-bar swing. New Fib levels required.`);
      const msg = `🔄 *[${symbol}] A2 — Structural Remap*\nPrice broke the 200-bar swing high/low.\nAll previous entry zones are VOID.\nWaiting for next 30-min scan to recalculate.\n⏰ ${new Date().toUTCString()}`;
      await bot.sendMessage(config.TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
      return;
    }

    const fib = calcFib(swing.high, swing.low);

    // D4: Over-Extended — Price beyond 88.6%
    const midPoint = (swing.high + swing.low) / 2;
    const bias = currentPrice > midPoint ? 'BUY' : 'SELL';

    if ((bias === 'BUY' && currentPrice < fib.level886) || 
        (bias === 'SELL' && currentPrice > fib.level886)) {
      console.log(`  ⏭️ D4 OVER-EXTENDED: ${symbol} beyond 88.6%. No setup.`);
      return;
    }

    // ═══════════════════════════════════════════════════════════
    //  STEP 2: 1H VOLUME PROFILE (500-bar monthly anchor)
    // ═══════════════════════════════════════════════════════════
    const vp = calcPOCandVAL(data);

    if (!vp) {
      console.log(`  ⚠️ Volume Profile calculation failed for ${symbol}. Skipping.`);
      return;
    }

    console.log(`  📊 POC: $${vp.pocPrice.toFixed(2)} | VAL: $${vp.valPrice.toFixed(2)} | TotalVol: ${(vp.totalVol/1e6).toFixed(2)}M`);

    // ═══════════════════════════════════════════════════════════
    //  STEP 3: CONFLUENCE CHECK (Fib 61.8/78.6 vs POC/VAL)
    // ═══════════════════════════════════════════════════════════
    const entryLevels = [fib.level618, fib.level786];
    let entryPrice = 0;
    let confluentLevel = '';
    let confluentPivot = '';
    let zoneValid = false;

    for (const lvl of entryLevels) {
      const pocConfluence = isConfluent(lvl, vp.pocPrice);
      const valConfluence = isConfluent(lvl, vp.valPrice);

      if (pocConfluence) {
        zoneValid = true;
        entryPrice = lvl;
        confluentLevel = lvl === fib.level618 ? '61.8%' : '78.6%';
        confluentPivot = 'POC';
        console.log(`  ✅ A1 GOLDEN ZONE: Fib ${confluentLevel} ($${lvl.toFixed(2)}) overlaps POC ($${vp.pocPrice.toFixed(2)})`);
        break;
      }
      if (valConfluence) {
        zoneValid = true;
        entryPrice = lvl;
        confluentLevel = lvl === fib.level618 ? '61.8%' : '78.6%';
        confluentPivot = 'VAL';
        console.log(`  ✅ A1 GOLDEN ZONE: Fib ${confluentLevel} ($${lvl.toFixed(2)}) overlaps VAL ($${vp.valPrice.toFixed(2)})`);
        break;
      }
    }

    if (!zoneValid) {
      console.log(`  ❌ No Fib/POC/VAL confluence for ${symbol}. A3 Zone Expiry (silent).`);
      return;
    }

    // A1 Golden Zone Alert — send notification but do NOT trade yet
    const goldenMsg = `🔔 *[${symbol}] A1 — Golden Zone Active*\n\nFib ${confluentLevel} ($${entryPrice.toFixed(2)}) overlaps ${confluentPivot}\n• POC: $${vp.pocPrice.toFixed(2)}\n• VAL: $${vp.valPrice.toFixed(2)}\n\n⏳ Awaiting rejection candle...\n⏰ ${new Date().toUTCString()}`;
    await bot.sendMessage(config.TELEGRAM_CHAT_ID, goldenMsg, { parse_mode: 'Markdown' });

    // ═══════════════════════════════════════════════════════════
    //  STEP 4: BIAS DETERMINATION (Long/Short from swing midpoint)
    // ═══════════════════════════════════════════════════════════
    const direction = currentPrice > midPoint ? 'BUY' : 'SELL';
    console.log(`  📊 Bias: ${direction} (Price: $${currentPrice.toFixed(2)} vs Mid: $${midPoint.toFixed(2)})`);

    // ═══════════════════════════════════════════════════════════
    //  STEP 5: REJECTION CANDLE (The Entry Ticket)
    // ═══════════════════════════════════════════════════════════
    const buffer = entryPrice * config.REJECTION_ZONE_BUFFER;
    const zoneLow = entryPrice - buffer;
    const zoneHigh = entryPrice + buffer;

    const rejection = detectRejection(data, zoneLow, zoneHigh, direction);

    if (!rejection.valid) {
      if (rejection.type === 'D1_ABSORPTION') {
        console.log(`  ⏳ D1 ABSORPTION: ${symbol} touched zone but no rejection candle. Skipping.`);
        const skipMsg = `⏳ *[${symbol}] D1 — Absorption*\n\nPrice touched the confluence zone ($${entryPrice.toFixed(2)}) but formed no rejection candle.\nInstitutions are absorbing, not reversing.\n\n⏰ ${new Date().toUTCString()}`;
        await bot.sendMessage(config.TELEGRAM_CHAT_ID, skipMsg, { parse_mode: 'Markdown' });
      } else if (rejection.type === 'D2_SHARP_BREAKOUT') {
        console.log(`  🚫 D2 SHARP BREAKOUT: ${symbol} sliced through zone. Trend continuation.`);
        const skipMsg = `🚫 *[${symbol}] D2 — Sharp Breakout*\n\nPrice sliced through the confluence zone without pausing.\nTrend continuation detected. Do NOT fade.\n\n⏰ ${new Date().toUTCString()}`;
        await bot.sendMessage(config.TELEGRAM_CHAT_ID, skipMsg, { parse_mode: 'Markdown' });
      }
      return;
    }

    console.log(`  🎯 ${rejection.type} DETECTED — B-SIGNAL CONFIRMED!`);

    // ═══════════════════════════════════════════════════════════
    //  STEP 6: EXECUTION & EXITS (Pure Fibonacci exits)
    // ═══════════════════════════════════════════════════════════

    // Stop Loss: 0.2% beyond the 88.6% Fib level
    const slPrice = direction === 'BUY'
      ? fib.level886 * (1 - config.SL_BUFFER / 100)
      : fib.level886 * (1 + config.SL_BUFFER / 100);

    // Take Profit: EXACTLY at the 50.0% Fib level (no buffer)
    const tpPrice = fib.level500;

    // Risk/Reward calculation
    const risk = Math.abs(entryPrice - slPrice);
    const reward = Math.abs(tpPrice - entryPrice);
    const rr = risk > 0 ? (reward / risk).toFixed(2) : 'N/A';

    // ═══════════════════════════════════════════════════════════
    //  B-SIGNAL TELEGRAM ALERT — Sniper Entry
    // ═══════════════════════════════════════════════════════════
    const signalType = direction === 'BUY' ? 'B1 — Bullish Sniper' : 'B2 — Bearish Sniper';
    const emoji = direction === 'BUY' ? '🟢' : '🔴';

    const message = `
${emoji} *${symbol} — MVS ${signalType} ENTRY*

📊 *Direction:* ${direction}
💵 *Entry Zone:* $${entryPrice.toFixed(2)}
🎯 *TP (50% Fib):* $${tpPrice.toFixed(2)}
🛑 *SL (88.6% Fib + 0.2%):* $${slPrice.toFixed(2)}
📐 *R:R Ratio:* ${rr}:1

📈 *Confluence:* Fib ${confluentLevel} overlaps ${confluentPivot}
   • POC: $${vp.pocPrice.toFixed(2)}
   • VAL: $${vp.valPrice.toFixed(2)}

📉 *Rejection:* ${rejection.type.replace('_', ' ')}
   • 500-bar monthly anchor confirmed
   • 200-bar swing structure valid

⏰ *Time:* ${new Date().toUTCString()}
⚡ *MVS — "If it doesn't reject the monthly anchor, it's not a trade."*
    `;

    await bot.sendMessage(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log(`  ✅ B-SIGNAL ALERT SENT for ${symbol}!`);

  } catch (error) {
    console.error(`  ❌ Error processing ${symbol}:`, error.message);
  }
};

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 7: SCHEDULER & BOOT — 30-Minute Scans
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 7: BOOT — Single Scan & Exit (GitHub Actions runs this every
//  30 min via its own cron schedule — see .github/workflows/mvs-scan.yml)
// ═══════════════════════════════════════════════════════════════════════

console.log('✅ MVS — Monthly Value Sniper v6.0 Started');
console.log('   KuCoin API — Ghana-compatible');
console.log('   "If it doesn\'t reject the monthly anchor, it\'s not a trade."');
console.log(`   Assets: ${config.SYMBOLS.join(', ')}`);
console.log(`   Timeframe: ${config.TIMEFRAME} | VP: ${config.VP_LOOKBACK} bars | Fib: ${config.FIB_LOOKBACK} bars`);
console.log(`   By Abdin — Single scan (GitHub Actions mode)`);
console.log(`   Scanning...\n`);

(async () => {
  for (const sym of config.SYMBOLS) {
    await runStrategy(sym);
  }
  console.log('\n✅ Scan complete. Exiting.');
  process.exit(0);
})();
