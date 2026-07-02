/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — MONTHLY VALUE SNIPER v10.3  (strategy.js — LIVE RUNNER)
 *
 *  All decision logic now lives in core.js (shared with backtest.js).
 *  This file only: fetches KuCoin data, calls core.js, sends Telegram
 *  alerts, and persists state/logs. See core.js header for the full
 *  architecture explanation and what changed from v9.x.
 *
 *  HONESTY NOTE: this bot does not target or achieve a 100% win rate.
 *  No trading system does, live or backtested. Treat every alert as a
 *  probability-favored setup with a defined stop-loss — not a guarantee.
 *  Size positions so that a string of 3-4 consecutive losses (normal,
 *  expected variance) does not meaningfully damage your account.
 * ═══════════════════════════════════════════════════════════════════════
 */

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const config = require('./config');
const core   = require('./core');

// ── Telegram send — pure axios, 10s timeout ─────────────────────────────────
const TG = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;
const sendSafe = (chatId, text, opts = {}, ms = 10000) =>
  Promise.race([
    axios.post(`${TG}/sendMessage`, { chat_id: chatId, text, ...opts }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Telegram send timed out')), ms)),
  ]).catch((e) => {
    console.error(`  ⚠️ Telegram send failed/timed out: ${e.message}`);
    return null;
  });

// ── Persistence ──────────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, 'state.json');
const LOG_FILE    = path.join(__dirname, 'signals.log.json');
const DIAG_FILE   = path.join(__dirname, 'diag.log.json');

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

// ── KuCoin data fetch ────────────────────────────────────────────────────────
const getKlines = async (symbol, interval, limit) => {
  const safeLimit = Math.min(limit + 20, 1500); // buffer for ATR/VP warmup
  const url = `${config.BASE_URL}/market/candles?symbol=${symbol}&type=${interval}&limit=${safeLimit}`;
  try {
    const res = await axios.get(url, { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
    if (res.data.code !== '200000') {
      console.error(`  ❌ KuCoin API error (${interval}): ${res.data.code} — ${res.data.msg || 'Unknown'}`);
      return [];
    }
    const sorted = (res.data.data || []).reverse();
    return sorted.slice(-limit).map(k => ({
      time: parseInt(k[0]), open: parseFloat(k[1]), close: parseFloat(k[2]),
      high: parseFloat(k[3]), low: parseFloat(k[4]), volume: parseFloat(k[5]),
    }));
  } catch (e) {
    console.error(`  ❌ KuCoin fetch error for ${symbol} (${interval}):`, e.message);
    return [];
  }
};

// ── Signal cooldown ──────────────────────────────────────────────────────────
const isCoolingDown = (symbol, direction, currentBarTime) => {
  const state = loadJSON(STATE_FILE, {});
  const s = state[symbol];
  if (!s || !s.lastSignalBar || !s.lastSignalDir) return false;
  if (s.lastSignalDir !== direction) return false;
  const barsSince = Math.round((currentBarTime - s.lastSignalBar) / config.STRUCT_BAR_SECONDS);
  return barsSince < config.SIGNAL_COOLDOWN_BARS;
};

// ── Duplicate-run guard ──────────────────────────────────────────────────────
// mvs-scan.yml now has two independent triggers: cron-job.org's ping (primary)
// and a GitHub-native `schedule:` backup (added so scanning survives a
// cron-job.org outage). Both call this same script via workflow_dispatch/
// schedule. If they ever land within a few minutes of each other, this stops
// the second invocation before it does any work — prevents duplicate Telegram
// alerts and duplicate state/log writes for the same 15m candle.
const DUPLICATE_RUN_GUARD_MS = 5 * 60 * 1000; // 5 min — well under the 15 min cadence

const isDuplicateRun = () => {
  const state = loadJSON(STATE_FILE, {});
  if (!state._lastRunAt) return false;
  const elapsed = Date.now() - new Date(state._lastRunAt).getTime();
  return elapsed >= 0 && elapsed < DUPLICATE_RUN_GUARD_MS;
};

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN STRATEGY ENGINE
// ─────────────────────────────────────────────────────────────────────────────
const runStrategy = async (symbol) => {
  const now = new Date().toISOString();
  console.log(`\n[${now}] 🔍 MVS v10.3 scanning ${symbol}...`);

  {
    const state = loadJSON(STATE_FILE, {});
    state._lastRunAt = now;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  try {
    // ── STEP 1: FETCH ALL THREE TIMEFRAMES ──────────────────────────────
    const [data4h, data1h, data15m] = await Promise.all([
      getKlines(symbol, config.BIAS_TIMEFRAME,    config.BIAS_VP_LOOKBACK),
      getKlines(symbol, config.STRUCT_TIMEFRAME,  config.STRUCT_VP_LOOKBACK),
      getKlines(symbol, config.TRIGGER_TIMEFRAME, config.TRIGGER_VP_LOOKBACK),
    ]);

    if (data1h.length < 50) {
      console.log(`  ⚠️ Insufficient 1H data (${data1h.length} bars). Skipping.`);
      logDiag({ symbol, fired: false, reason: 'INSUFFICIENT_1H_DATA', bars: data1h.length });
      return;
    }
    if (data15m.length < 50) {
      console.log(`  ⚠️ Insufficient 15m data (${data15m.length} bars). Skipping.`);
      logDiag({ symbol, fired: false, reason: 'INSUFFICIENT_15M_DATA', bars: data15m.length });
      return;
    }

    // ── STEP 2: THREE-TIMEFRAME BIAS VOTE ───────────────────────────────
    const bias4h  = data4h.length >= 50
      ? core.tfBiasVote(data4h, config.BIAS_VP_LOOKBACK, config.BIAS_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT)
      : null;
    const bias1h  = core.tfBiasVote(data1h, config.STRUCT_VP_LOOKBACK, config.STRUCT_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);
    const bias15m = core.tfBiasVote(data15m, config.TRIGGER_VP_LOOKBACK, config.TRIGGER_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);

    if (!bias1h) {
      console.log(`  ⚠️ 1H bias vote failed (volume profile). Skipping.`);
      logDiag({ symbol, fired: false, reason: '1H_BIAS_FAILED' });
      return;
    }

    const resolved = core.resolveDirection([
      { tf: '4H',  result: bias4h },
      { tf: '1H',  result: bias1h },
      { tf: '15m', result: bias15m },
    ]);

    console.log(
      `  📡 VOTE: 4H=${bias4h ? bias4h.bias : 'N/A'} | 1H=${bias1h.bias} | 15m=${bias15m ? bias15m.bias : 'N/A'}` +
      (resolved ? ` → ${resolved.direction} (${resolved.tally}: ${resolved.agreeing.join('+')})` : ' → NO 2-OF-3 AGREEMENT')
    );

    if (!resolved) {
      logDiag({ symbol, bias4h: bias4h?.bias, bias1h: bias1h.bias, bias15m: bias15m?.bias, fired: false, reason: 'NO_2OF3_AGREEMENT' });
      return;
    }

    const direction = resolved.direction;

    // ── STEP 3: 1H STRUCTURE — SWING / FIB POCKET ───────────────────────
    const swing1h = bias1h.swing;
    const price   = data1h[data1h.length - 1].close;
    const barTime = data1h[data1h.length - 1].time;

    const atr1h = core.calcATR(data1h, config.ATR_PERIOD);
    if (!atr1h) {
      console.log(`  ⚠️ 1H ATR calculation failed. Skipping.`);
      logDiag({ symbol, fired: false, reason: 'ATR_FAILED' });
      return;
    }

    // Structural remap — price broke the 1H swing entirely
    if (price > swing1h.high || price < swing1h.low) {
      console.log(`  🔄 STRUCTURAL REMAP: ${symbol} broke 1H swing. Zones void, recalculating next scan.`);
      saveState(symbol, { signal: 'REMAP', price, swingHigh: swing1h.high, swingLow: swing1h.low });
      logSignal(symbol, { signal: 'REMAP', price });
      return;
    }

    const fib = core.calcFib(swing1h.high, swing1h.low, direction, config.FIB_ZONE_LOW, config.FIB_ZONE_HIGH);

    // Over-extension: beyond 88.6% = structural extreme, swing likely invalid
    const overExtended = (direction === 'BUY' && price < fib.level886) || (direction === 'SELL' && price > fib.level886);
    if (overExtended) {
      console.log(`  ⏭️ OVER-EXTENDED: price beyond 88.6% structural extreme.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'OVER_EXTENDED' });
      return;
    }

    // Early zone-proximity skip — shared gate (core.isNearZone), identical
    // to backtest.js. Bug fix: this used to be hand-rolled here with an
    // extra 0.1×ATR pad stacked on top of the ±1×ATR band (~1.1×ATR total),
    // while backtest.js used exactly ±1.0×ATR — see core.js v10.1 fix log.
    if (!core.isNearZone(price, fib, atr1h, config.NEAR_ZONE_ATR_MULT)) {
      console.log(`  ⏳ Price not near 1H zone ($${fib.zoneLow.toFixed(2)}–$${fib.zoneHigh.toFixed(2)}). Waiting.`);
      return;
    }

    const vp1h = bias1h.vp;
    console.log(`  📊 1H POC $${vp1h.pocPrice.toFixed(2)} | VAH $${vp1h.vahPrice.toFixed(2)} | VAL $${vp1h.valPrice.toFixed(2)}`);

    saveState(symbol, {
      signal: 'SCANNED', price, direction,
      voteTally: resolved.tally, agreeing: resolved.agreeing,
      poc: vp1h.pocPrice, vah: vp1h.vahPrice, val: vp1h.valPrice,
      swingHigh: swing1h.high, swingLow: swing1h.low, atr1h,
    });

    // ── STEP 4: CONFLUENCE CHECK (Fib × POC/VAH/VAL on 1H) ───────────────
    const fibMid = (fib.zoneHigh + fib.zoneLow) / 2;
    const checkLevels = [fib.level618, fib.level786, fibMid];
    const checkPivots = [
      { name: 'POC', price: vp1h.pocPrice },
      { name: 'VAH', price: vp1h.vahPrice },
      { name: 'VAL', price: vp1h.valPrice },
    ];

    let bestScore = 0, bestFibLevel = null, bestPivot = null;
    for (const lvl of checkLevels) {
      for (const pivot of checkPivots) {
        const sc = core.confluenceScore(lvl, pivot.price, atr1h, config.CONFLUENCE_ATR_MULT);
        if (sc > bestScore) { bestScore = sc; bestFibLevel = lvl; bestPivot = pivot; }
      }
    }

    if (bestScore < 1) {
      console.log(`  ❌ No Fib/POC/VAH/VAL confluence at current price. Waiting.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'NO_CONFLUENCE' });
      return;
    }
    if (bestPivot.name === 'POC' && bestScore < config.MIN_CONFLUENCE_POC) {
      console.log(`  ⚠️ POC confluence too loose (score ${bestScore}, need ${config.MIN_CONFLUENCE_POC}). Skipping.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'POC_CONFLUENCE_TOO_LOOSE' });
      return;
    }

    const fibPct = bestFibLevel === fib.level618 ? '61.8%' : bestFibLevel === fib.level786 ? '78.6%' : '70% mid-pocket';
    console.log(`  ✅ CONFLUENCE (score ${bestScore}): Fib ${fibPct} ($${bestFibLevel.toFixed(2)}) ↔ ${bestPivot.name} ($${bestPivot.price.toFixed(2)})`);

    // ── STEP 5: 4H ZONE CROSS-CHECK ──────────────────────────────────────
    const htfCheck = core.checkHTFZoneAlignment(bestFibLevel, bias4h, atr1h, direction, config.HTFZONE_ATR_MULT);
    if (!htfCheck.aligned) {
      console.log(`  ⛔ 4H ZONE MISMATCH: nearest ${htfCheck.nearestLevel} dist $${htfCheck.distance.toFixed(2)}. Waiting.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'HTF_ZONE_MISMATCH' });
      return;
    }
    console.log(`  ✅ 4H ZONE ALIGNED: near ${htfCheck.nearestLevel} ($${(htfCheck.nearestPrice || 0).toFixed(2)})`);

    // ── STEP 6: ZONE INVALIDATION ─────────────────────────────────────────
    if (core.isZoneInvalidated(price, bestFibLevel, atr1h, direction, config.ZONE_INVALIDATION_ATR_MULT)) {
      console.log(`  ❌ ZONE INVALIDATED: 1H close beyond zone by > ATR×${config.ZONE_INVALIDATION_ATR_MULT}.`);
      logDiag({ symbol, barTime, price, fired: false, reason: 'ZONE_INVALIDATED' });
      return;
    }

    // ── STEP 7: SIGNAL COOLDOWN ───────────────────────────────────────────
    if (isCoolingDown(symbol, direction, barTime)) {
      console.log(`  ⏸️ COOLDOWN: ${direction} suppressed (< ${config.SIGNAL_COOLDOWN_BARS} 1H bars since last).`);
      return;
    }

    // ── STEP 8: 15m TRIGGER CANDLE ────────────────────────────────────────
    // The 1H structure defines WHERE the zone is. The 15m candle decides
    // WHEN to actually fire — tighter timing than waiting a full 1H close.
    const entryZoneLow  = fib.zoneLow  - atr1h * 0.1;
    const entryZoneHigh = fib.zoneHigh + atr1h * 0.1;

    const rejection = core.detectRejection(
      data15m, entryZoneLow, entryZoneHigh, direction,
      { poc: vp1h.pocPrice, vah: vp1h.vahPrice, val: vp1h.valPrice },
      config.ABSORPTION_BODY_RATIO, config.REJECTION_MIN_PATTERNS, config.ALLOW_SOLO_TRIGGER,
      config.SOLO_ELIGIBLE_PATTERNS
    );

    logDiag({
      symbol, barTime, price,
      bias4h: bias4h?.bias, bias1h: bias1h.bias, bias15m: bias15m?.bias,
      voteTally: resolved.tally, agreeing: resolved.agreeing,
      htfAligned: htfCheck.aligned, confluenceScore: bestScore, confluenceLevel: fibPct, confluencePivot: bestPivot.name,
      patterns: rejection.patterns, absorptionVeto: rejection.absorptionVeto,
      fired: rejection.valid,
      reason: rejection.valid ? 'SIGNAL_FIRED' : rejection.absorptionVeto ? 'ABSORPTION_VETO' : `PATTERNS_${rejection.score}_OF_${config.REJECTION_MIN_PATTERNS}`,
    });

    if (!rejection.valid) {
      if (rejection.absorptionVeto) {
        console.log(`  ⏳ ABSORPTION VETO: opposing institutional candle at zone. Skip.`);
      } else {
        console.log(`  ⏳ WEAK TRIGGER: ${rejection.score}/${config.REJECTION_MIN_PATTERNS} patterns on 15m. Waiting.`);
      }
      return;
    }

    // ── STEP 9: SL / TP CALCULATION ───────────────────────────────────────
    const levels = core.computeTradeLevels({
      direction, entryPrice: bestFibLevel, swing: swing1h, atr: atr1h, vp: vp1h,
      slAtrMult: config.SL_ATR_MULT, tp1RrFloor: config.TP1_RR_FLOOR, fibLevel500: fib.level500,
    });
    if (!levels) {
      console.log(`  ⏭️ Invalid TP structure (TP3 doesn't extend beyond TP1). Suppressed.`);
      return;
    }

    // ── STEP 10: TELEGRAM ALERT ───────────────────────────────────────────
    const emoji = direction === 'BUY' ? '🟢' : '🔴';
    const patternStr = rejection.patterns.join(' + ');
    const voteLine = `🗳️ *TF Vote (${resolved.tally}):* ${resolved.agreeing.join(' + ')} agree ${direction === 'BUY' ? 'BULLISH' : 'BEARISH'}` +
      (bias4h ? ` | 4H:${bias4h.bias}` : '') + ` 1H:${bias1h.bias}` + (bias15m ? ` 15m:${bias15m.bias}` : '');

    // v10.3: risk-tiered sizing — see core.js computeRiskMultiplier() for
    // the backtest evidence behind this. Not a filter: this signal fires
    // regardless of tier, only the suggested size changes.
    const riskMult = core.computeRiskMultiplier(bestPivot.name, resolved.agreeing, config.RISK_TIER_MATRIX, config.RISK_TIER_DEFAULT);
    const sizeLine = riskMult < 1
      ? `⚖️ *Suggested size:* ${Math.round(riskMult * 100)}% of normal (${bestPivot.name} pivot${resolved.agreeing.includes('1H') ? '' : ', 1H not in the confirming vote'} — historically weaker segment, see README)`
      : `⚖️ *Suggested size:* 100% of normal (${bestPivot.name} pivot, 1H confirms — historically strongest segment)`;

    const message = `
${emoji} *${symbol} — MVS Signal*

📊 *Direction:* ${direction}
${voteLine}
🔗 *4H Zone:* near ${htfCheck.nearestLevel} ✅

━━━━━━━━━━━━━━━━━━━━
💵 *Entry:* \`$${bestFibLevel.toFixed(4)}\` (1H Fib ${fibPct} ↔ ${bestPivot.name})
🛑 *SL:* \`$${levels.slPrice.toFixed(4)}\` (1H swing wick ± 0.25×ATR)
━━━━━━━━━━━━━━━━━━━━
🎯 *TP1:* \`$${levels.tp1Price.toFixed(4)}\`  R:R ${levels.rr1.toFixed(2)}:1
🏁 *TP2:* \`$${levels.tp2Price.toFixed(4)}\`  R:R ${levels.rr2.toFixed(2)}:1
🏆 *TP3* (${direction === 'BUY' ? 'VAH' : 'VAL'} runner): \`$${levels.tp3Price.toFixed(4)}\`  R:R ${levels.rr3.toFixed(2)}:1
━━━━━━━━━━━━━━━━━━━━
${sizeLine}
🕯 *15m trigger (${rejection.solo ? 'SOLO' : rejection.score + '/' + config.REJECTION_MIN_PATTERNS}):* ${patternStr}
📐 *ATR(1H):* $${atr1h.toFixed(4)}

⚠️ Probability-favored setup, not a guarantee. Size so 3-4 consecutive
losses (normal variance) don't meaningfully hurt your account. Never
risk capital you can't afford to lose on a single position.

⏰ *Time:* ${new Date().toUTCString()}
⚡ *MVS v10.3*
    `.trim();

    await sendSafe(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    console.log(`  ✅ SIGNAL FIRED: ${symbol} | ${direction} @ $${bestFibLevel.toFixed(2)} | ${patternStr}`);

    saveState(symbol, {
      signal: 'FIRED', direction,
      entryPrice: bestFibLevel, ...levels,
      patterns: rejection.patterns, riskMult,
      lastSignalBar: barTime, lastSignalDir: direction,
    });

    logSignal(symbol, {
      signal: 'FIRED', direction,
      entryPrice: bestFibLevel, ...levels,
      confluencePivot: bestPivot.name, fibPct, patterns: rejection.patterns,
      voteTally: resolved.tally, agreeing: resolved.agreeing, riskMult,
      bias4h: bias4h?.bias, bias1h: bias1h.bias, bias15m: bias15m?.bias,
    });

  } catch (err) {
    console.error(`  ❌ Error processing ${symbol}:`, err.message);
    logDiag({ symbol, fired: false, reason: 'EXCEPTION', error: err.message, stack: err.stack?.split('\n').slice(0, 3).join(' | ') });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║   MVS — Monthly Value Sniper v10.3                          ║');
console.log('║   4H bias + 1H structure + 15m trigger — 2-of-3 vote         ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`   Assets  : ${config.SYMBOLS.join(', ')}`);
console.log(`   TFs     : 4H(${config.BIAS_VP_LOOKBACK}) / 1H(${config.STRUCT_VP_LOOKBACK}) / 15m(${config.TRIGGER_VP_LOOKBACK})`);
console.log(`   Trigger : ${config.REJECTION_MIN_PATTERNS}-of-5 patterns min | solo=${config.ALLOW_SOLO_TRIGGER}`);
console.log(`   Cooldown: ${config.SIGNAL_COOLDOWN_BARS} × 1H bars`);
console.log('');

(async () => {
  if (isDuplicateRun()) {
    console.log(`⏸️  Skipping: a scan already ran within the last ${DUPLICATE_RUN_GUARD_MS / 60000} min ` +
      `(cron-job.org and the GitHub schedule backup likely overlapped). Exiting cleanly, no state changed.`);
    process.exit(0);
  }

  for (const sym of config.SYMBOLS) {
    await runStrategy(sym);
    if (config.SYMBOLS.indexOf(sym) < config.SYMBOLS.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  try {
    const finalState = loadJSON(STATE_FILE, {});
    finalState._lastRunAt = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(finalState, null, 2));
  } catch (e) { /* non-fatal */ }
  console.log('\n✅ Scan complete. Exiting.');
  process.exit(0);
})();
