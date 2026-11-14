#!/usr/bin/env node
/**
 * mvs-skips.js — MVS "skipped signals" journal (v1.0)
 *
 * READ-ONLY. Places NO orders, uses NO API keys, changes NO MVS file.
 * Question it answers: "Would the signals the live bot SKIPPED have won, if they had been entered
 * the way the bot really enters (market, at the moment it looked at them)?"
 *
 * Reads (never writes): <repo>/execution/executed-signals.json and <repo>/signals.log.json
 * Uses: public Bybit candles only.   Writes ONLY to: $HOME/mvs-skips/
 *
 *   node execution/shadow/mvs-skips.js --once      # evaluate everything not yet resolved, then exit
 *   node execution/shadow/mvs-skips.js             # loop every 10 min (new skips appear as the bot works)
 *   node execution/shadow/mvs-skips.js --report    # print results by skip reason
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', 'mvs-skips');
const OUT_STATE = path.join(OUT_DIR, 'state.json');
const OUT_LOG = path.join(OUT_DIR, 'skips.jsonl');
const BYBIT = 'https://api.bybit.com';
const REASONS = ['SIGNAL_STALE_PRICE_MOVED', 'NET_RR_TOO_LOW_AFTER_FEES', 'SYMBOL_ALREADY_OPEN', 'SYMBOL_ALREADY_OPEN_ON_EXCHANGE', 'BELOW_MIN_ORDER_QTY'];
const TIMEOUT_H = 72;      // same spirit as MVS's own early-timeout
const FEE_RT = 0.0011;     // taker 0.055% x 2 (round trip), as in fee-estimate.js
const PARTIAL = 0.5;       // MVS closes 50% at TP1 (PARTIAL_EXIT_PCT)

const TO = +process.env.MVS_SKIPS_TIMEOUT_MS || 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); };

function getOnce(url) {
  return new Promise((res, rej) => {
    const q = https.get(url, { headers: { 'User-Agent': 'mvs-skips/1.0' }, timeout: TO }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => { if (r.statusCode !== 200) return rej(new Error('HTTP ' + r.statusCode)); try { res(JSON.parse(b)); } catch (e) { rej(e); } });
      r.on('error', rej);
    });
    q.on('timeout', () => q.destroy(new Error('timeout'))); q.on('error', rej);
  });
}
async function getJSON(url, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) { try { return await getOnce(url); } catch (e) { last = e; if (/HTTP 4\d\d/.test(e.message)) break; await sleep(2000 * (i + 1)); } }
  throw last;
}

// ---------- pure logic (unit-tested) ----------
const toBybit = (s) => String(s).replace('/', '').replace('-', '');

/** Simulate the trade the bot WOULD have opened at market at `candles[0].o` using the signal's own SL/TP levels.
 *  SL first on a same-candle conflict (conservative). After TP1: 50% closed, SL for the rest moves to entry (BE), runner to TP2. */
function simulate(sig, candles) {
  const long = sig.direction === 'BUY';
  const sl = +sig.slPrice, tp1 = +sig.tp1Price, tp2 = +sig.tp2Price;
  if (!candles.length) return { status: 'NO_DATA' };
  const e = candles[0].o;
  const side = long ? 1 : -1;
  if (side * (tp1 - e) <= 0) return { status: 'RESOLVED', result: 'ALREADY_PAST_TP1', entry: e, netR: 0, note: 'price already beyond TP1 at entry - order would be rejected / no edge' };
  if (side * (e - sl) <= 0) return { status: 'RESOLVED', result: 'ALREADY_PAST_SL', entry: e, netR: -1, note: 'price already beyond SL at entry' };
  const risk = side * (e - sl);
  const feeR = FEE_RT * e / risk;
  const r1 = side * (tp1 - e) / risk, r2 = side * (tp2 - e) / risk;
  const hit = (k, p, up) => (up ? k.h >= p : k.l <= p);
  const tpUp = long, slUp = !long;
  let stage = 0;
  for (const k of candles) {
    if (stage === 0) {
      if (hit(k, sl, slUp)) return { status: 'RESOLVED', result: 'SL', entry: e, grossR: -1, netR: -1 - feeR };
      if (hit(k, tp1, tpUp)) { stage = 1; continue; }
    } else {
      if (hit(k, e, slUp)) { const g = PARTIAL * r1; return { status: 'RESOLVED', result: 'TP1+BE', entry: e, grossR: g, netR: g - feeR }; }
      if (hit(k, tp2, tpUp)) { const g = PARTIAL * r1 + (1 - PARTIAL) * r2; return { status: 'RESOLVED', result: 'TP1+TP2', entry: e, grossR: g, netR: g - feeR }; }
    }
    if (k.t - candles[0].t > TIMEOUT_H * 3600e3) {
      const mv = side * (k.c - e) / risk, g = stage === 1 ? PARTIAL * r1 + (1 - PARTIAL) * mv : mv;
      return { status: 'RESOLVED', result: stage === 1 ? 'TP1+TIMEOUT' : 'TIMEOUT', entry: e, grossR: g, netR: g - feeR };
    }
  }
  return { status: 'PENDING', entry: e };
}
function summarize(rows) {
  const by = {};
  for (const r of rows) {
    const g = (by[r.reason] = by[r.reason] || { n: 0, resolved: 0, pending: 0, wins: 0, sl: 0, netR: 0, kinds: {} });
    g.n++;
    if (r.status === 'PENDING' || r.status === 'NO_DATA') { g.pending++; continue; }
    g.resolved++; g.netR += r.netR || 0; g.kinds[r.result] = (g.kinds[r.result] || 0) + 1;
    if (r.netR > 0) g.wins++; if (r.result === 'SL') g.sl++;
  }
  return by;
}

// ---------- IO ----------
async function candlesFrom(sym, fromMs) {
  const j = await getJSON(`${BYBIT}/v5/market/kline?category=linear&symbol=${sym}&interval=5&start=${fromMs}&limit=1000`);
  const l = (j && j.result && j.result.list) || [];
  return l.map((x) => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] })).sort((a, b) => a.t - b.t).filter((k) => k.t >= fromMs - 300000);
}
async function pass() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ex = readJSON(path.join(REPO, 'execution', 'executed-signals.json'), {});
  const sigs = readJSON(path.join(REPO, 'signals.log.json'), []);
  const idx = {}; for (const s of sigs) idx[s.symbol + '_' + s.entryTime] = s;
  const st = readJSON(OUT_STATE, { done: {} });
  let n = 0, fails = 0;
  for (const [key, v] of Object.entries(ex)) {
    const reason = v && v.result && v.result.reason;
    if (!REASONS.includes(reason) || (v.result && v.result.executed)) continue;
    const prev = st.done[key];
    if (prev && prev.status === 'RESOLVED') continue;
    const s = idx[key]; if (!s) continue;
    const sym = toBybit(s.symbol);
    let c = [];
    try { c = await candlesFrom(sym, v.checkedAt); } catch (e) { console.log(`[skips] ${key}: ${e.message}`); if (++fails >= 3) { console.log('[skips] network looks down - stopping this pass, will retry later.'); break; } continue; }
    fails = 0;
    const sim = simulate(s, c.filter((k) => k.t >= v.checkedAt));
    const rec = { key, reason, symbol: s.symbol, direction: s.direction, checkedAt: v.checkedAt, ...sim };
    st.done[key] = rec; n++;
    if (sim.status === 'RESOLVED') fs.appendFileSync(OUT_LOG, JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n');
    await sleep(200);
  }
  writeJSON(OUT_STATE, st);
  console.log(`[skips] evaluated ${n} skipped signals this pass.`);
}
function report() {
  const st = readJSON(OUT_STATE, { done: {} });
  const by = summarize(Object.values(st.done));
  console.log('Skipped signals, simulated with the bot\'s real entry style (market at the moment it checked), after fees:');
  for (const [r, g] of Object.entries(by)) {
    console.log(`\n${r}\n  skipped ${g.n}, resolved ${g.resolved}, pending/no-data ${g.pending}`);
    console.log(`  wins ${g.wins}  stop-losses ${g.sl}  net ${g.netR.toFixed(2)} R  (avg ${(g.resolved ? g.netR / g.resolved : 0).toFixed(2)} R)  outcomes ${JSON.stringify(g.kinds)}`);
  }
  console.log('\nR = multiples of the planned risk. Positive net R on a skip reason means that filter may be skipping winners.');
}
async function main() {
  const a = process.argv.slice(2);
  if (a.includes('--report')) return report();
  if (a.includes('--once')) { await pass(); return report(); }
  console.log('[skips] mvs-skips started (read-only, no orders, no keys).');
  for (;;) { try { await pass(); } catch (e) { console.log('[skips] pass error:', e.message); } await sleep(600000); }
}
if (require.main === module) main();
module.exports = { simulate, summarize, toBybit };
