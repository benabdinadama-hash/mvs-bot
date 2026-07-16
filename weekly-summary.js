/**
 * MVS — Weekly Summary  (v10.15.9 — pure axios, no node-telegram-bot-api)
 *
 * Reads signals.log.json, summarises the last 7 days, sends to Telegram.
 * Triggered every Monday 07:00 UTC by mvs-weekly.yml.
 *
 * v10.10: entries are grouped (×N) instead of repeated block-for-block —
 * see the "Entries" section below — and send() now chunks any message
 * over ~3800 chars into multiple sequential sends instead of risking
 * Telegram's 4096-char hard limit.
 */

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const config = require('./config');

const TG = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;

// v10.15.2 CRITICAL FIX — see strategy.js's identical helper for the full
// story. Pattern names like `POC_RECLAIM` embedded below carry an
// underscore, which silently breaks Telegram's legacy Markdown parsing
// for the entire message (no error surfaces, nothing shows as failed).
const mdSafe = (s) => String(s ?? '').replace(/_/g, ' ');

// v10.10: same message-chunking fix as commands.js — a weekly summary
// with several unique grouped setups plus the equity snapshot can exceed
// Telegram's 4096-char hard limit.
const TELEGRAM_SAFE_LEN = 3800;
const splitIntoChunks = (text, maxLen = TELEGRAM_SAFE_LEN) => {
  if (text.length <= maxLen) return [text];
  const paragraphs = text.split('\n\n');
  const chunks = [];
  let current = '';
  for (const p of paragraphs) {
    const candidate = current ? `${current}\n\n${p}` : p;
    if (candidate.length > maxLen && current) { chunks.push(current); current = p; }
    else current = candidate;
    while (current.length > maxLen) { chunks.push(current.slice(0, maxLen)); current = current.slice(maxLen); }
  }
  if (current) chunks.push(current);
  return chunks;
};

const send = async (text) => {
  const chunks = splitIntoChunks(text);
  let lastRes = null;
  for (let i = 0; i < chunks.length; i++) {
    const prefix = chunks.length > 1 ? `_(${i + 1}/${chunks.length})_\n` : '';
    try {
      const res = await Promise.race([
        axios.post(`${TG}/sendMessage`, {
          chat_id:    config.TELEGRAM_CHAT_ID,
          text:       prefix + chunks[i],
          parse_mode: 'Markdown',
        }),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('sendMessage timed out')), 12000)
        ),
      ]);
      lastRes = res.data;
    } catch (e) {
      console.error(`⚠️  Telegram sendMessage failed: ${e.message}`);
    }
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
  }
  return lastRes;
};

const LOG_FILE    = path.join(__dirname, 'signals.log.json');
const EQUITY_FILE = path.join(__dirname, 'equity-curve.json');

const loadJSON = (file, fallback) => {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
};

// ── Equity curve logger (v8.10 Improvement 8) ────────────────────────────────
// Reads closed trades from signals.log.json, simulates cumulative R and
// drawdown, and appends a weekly snapshot to equity-curve.json.
// This file is committed back to the repo by the workflow, giving a running
// picture of live performance that can be charted over time.
//
// v10.14 UPDATE: this note previously said closedEntries was ALWAYS
// empty because nothing ever logged an exit. That's fixed now —
// position-tracker.js runs at the start of every scan (see its header
// for the mechanism: no dedicated server, it rides the existing 15-min
// GitHub Actions cron and replays real 15m candles since each position's
// entryTime through the exact same core.js evaluateOpenTrade() logic
// backtest.js uses). When a position closes, it updates the ORIGINAL
// signals.log.json entry in place with exitTime/exitPrice/rr/result —
// so closedEntries below will start finding real rows once positions
// actually close. It will still be empty on any repo that hasn't fired
// a signal since v10.14 deployed, or whose open positions haven't
// closed yet — that's a timing gap, not the old missing-feature gap.
const updateEquityCurve = (log) => {
  const curve   = loadJSON(EQUITY_FILE, []);
  const RISK    = config.RISK_PER_TRADE_PCT || 1.5;
  const SLIP    = config.SLIPPAGE_PCT       || 0.001;
  const START   = 1000;

  // Use closed trade entries that have an rr field (logged on trade close).
  // v10.9 FIX: explicitly sorted ascending by exitTime here, regardless of
  // what order `log` arrives in. This function's cumulative-equity math
  // below (capital/peak/drawdown/cumulativeR) only makes sense processed
  // oldest-to-newest — and as of v10.9, signals.log.json itself is stored
  // NEWEST-first (see strategy.js logSignal()), so without this explicit
  // sort here this would silently simulate trades in reverse chronological
  // order the moment closedEntries ever actually contains data (it's
  // currently always empty — see the HONESTY NOTE above — but this fixes
  // the ordering assumption now rather than leaving a landmine for later).
  const closedEntries = log
    .filter(e => e.rr !== undefined && e.rr !== null && e.exitTime)
    .slice()
    .sort((a, b) => a.exitTime - b.exitTime);
  if (!closedEntries.length) return curve;

  // Build cumulative equity from scratch so the curve is always consistent
  let capital = START;
  let peak    = capital;
  let maxDD   = 0;
  const points = [{ date: null, capital, cumulativeR: 0, tradeN: 0, drawdownPct: 0 }];

  for (const [i, t] of closedEntries.entries()) {
    const riskAmt  = capital * (RISK / 100);
    const slipCost = capital * SLIP;
    capital += riskAmt * t.rr - slipCost;
    if (capital > peak) peak = capital;
    const dd = (peak - capital) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    points.push({
      date:          t.exitTime ? new Date(t.exitTime * 1000).toISOString().slice(0, 10) : null,
      capital:       parseFloat(capital.toFixed(2)),
      cumulativeR:   parseFloat(closedEntries.slice(0, i + 1).reduce((s, x) => s + (x.rr || 0), 0).toFixed(2)),
      tradeN:        i + 1,
      drawdownPct:   parseFloat(dd.toFixed(2)),
      result:        t.signal || t.result,
      symbol:        t.symbol,
    });
  }

  // Weekly snapshot for the curve file
  const weekLabel = new Date().toISOString().slice(0, 10);
  const latest    = points[points.length - 1];
  const snapshot  = {
    week:          weekLabel,
    totalTrades:   closedEntries.length,
    capital:       latest.capital,
    totalReturn:   parseFloat(((latest.capital - START) / START * 100).toFixed(1)),
    cumulativeR:   latest.cumulativeR,
    maxDrawdownPct: parseFloat(maxDD.toFixed(2)),
    equityPoints:  points,
  };

  // Append or replace the snapshot for this week.
  // v10.9: unshift (not push) — equity-curve.json is now newest-first,
  // same convention as signals.log.json / diag.log.json (see strategy.js
  // v10.9 notes). Replacing an existing week's entry keeps it at whatever
  // index it's already at rather than moving it, which is correct — only
  // a genuinely NEW week should end up at the front.
  const idx = curve.findIndex(s => s.week === weekLabel);
  if (idx >= 0) curve[idx] = snapshot;
  else curve.unshift(snapshot);

  // v10.15.6: atomic write (temp file + rename), same pattern applied
  // everywhere else this version — see strategy.js's atomicWriteJSON
  // comment for the full story. Low risk here specifically (this file
  // only runs weekly, nothing else touches EQUITY_FILE) but consistent
  // with every other write path now.
  const tmpEquity = `${EQUITY_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpEquity, JSON.stringify(curve, null, 2));
  fs.renameSync(tmpEquity, EQUITY_FILE);
  console.log(`✅ Equity curve updated → ${EQUITY_FILE} (${closedEntries.length} trades, capital $${latest.capital})`);
  return curve;
};

(async () => {
  const log    = loadJSON(LOG_FILE, []);

  // ── Update equity curve first (writes equity-curve.json) ────────────────
  const curve  = updateEquityCurve(log);
  // v10.9 FIX: curve is now newest-first (see updateEquityCurve above), so
  // the latest snapshot is curve[0], not curve[curve.length-1] — the old
  // code would have silently reported last WEEK's numbers as "latest" the
  // moment the curve had 2+ entries stored in the new order.
  const latest = curve.length ? curve[0] : null;

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent  = log.filter(e => new Date(e.time).getTime() >= weekAgo);

  if (!recent.length) {
    const equityLine = latest
      ? `\n\n📊 *Live Equity:* $${latest.capital} | +${latest.totalReturn}% total | ${latest.cumulativeR}R | Max DD ${latest.maxDrawdownPct}%`
      : '';
    await send(`📅 *MVS Weekly Summary*\n\nNo signals logged in the last 7 days.${equityLine}`);
    console.log('✅ Weekly summary sent (no signals).');
    return;
  }

  const counts = {};
  for (const e of recent) counts[e.signal] = (counts[e.signal] || 0) + 1;

  let msg = `📅 *MVS Weekly Summary*\n${recent.length} total events across ${config.SYMBOLS.join(', ')}\n`;
  for (const [signal, count] of Object.entries(counts)) {
    msg += `\n• ${signal}: ${count}`;
  }

  // v10.0: strategy.js now logs signal: 'FIRED' (was 'B1 — Bullish Sniper' /
  // 'B2 — Bearish Sniper'). Updated to match — otherwise this filter would
  // silently match zero entries forever and the weekly digest would always
  // report no trades even while the bot was firing signals live.
  // v10.5/v10.6: strategy.js's computeTradeLevels no longer returns
  // tp3Price/rr3 (TP3 was retired — see core.js v10.5 fix log). This used
  // to read e.tp3Price/e.rr3 here, which would print "$NaN" in every
  // weekly summary the moment those fields disappeared from newly logged
  // entries. Fixed to show the actual TP1/TP2 two-stage structure.
  const entries = recent.filter(e => e.signal === 'FIRED');
  if (entries.length) {
    // v10.10 FIX: this used to print every FIRED entry as its own full
    // block — the actual cause of the "wall of unreadable repeated text"
    // reported from screenshots (POL-USDT SELL @ $0.0735 printed 5-6
    // times in a row with only the SL/patterns differing by a cent).
    // Entries sharing symbol+direction+entryPrice+TP1+TP2+patterns are
    // now grouped into ONE line with a "×N" count and a time range,
    // instead of N near-identical blocks.
    const groups = [];
    for (const e of entries) {
      const key = `${e.symbol}|${e.direction}|${Number(e.entryPrice).toFixed(4)}|${Number(e.tp1Price).toFixed(4)}|${Number(e.tp2Price).toFixed(4)}|${(e.patterns || []).join('+')}`;
      let g = groups.find(g => g.key === key);
      if (!g) { g = { key, sample: e, times: [] }; groups.push(g); }
      g.times.push(e.time);
    }

    msg += `\n\n🎯 *Entries (${entries.length}${groups.length !== entries.length ? `, ${groups.length} unique setup${groups.length === 1 ? '' : 's'}` : ''}):*`;
    // v10.9 FIX (still applies): signals.log.json is newest-first, so
    // `entries` (and therefore `groups`, built in the same order) is
    // newest-first too — showing the 10 most recent unique setups.
    for (const g of groups.slice(0, 10)) {
      const e = g.sample;
      const n = g.times.length;
      msg += `\n\n${e.symbol} ${e.direction} @ $${Number(e.entryPrice).toFixed(4)}${n > 1 ? `  ×${n}` : ''}`;
      msg += `\n  SL $${Number(e.slPrice).toFixed(4)} · TP1 $${Number(e.tp1Price).toFixed(4)} · TP2 (runner) $${Number(e.tp2Price).toFixed(4)}`;
      msg += `\n  Patterns: ${(e.patterns || []).map(mdSafe).join(' + ')} · R:R ${e.rr1}/${e.rr2}`;
      if (n > 1) {
        const oldest = g.times[g.times.length - 1];
        const newest = g.times[0];
        msg += `\n  Fired ${n}× between ${new Date(oldest).toISOString().slice(0, 16).replace('T', ' ')} and ${new Date(newest).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
      } else {
        msg += `\n  ${new Date(e.time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
      }
    }
  }

  // Equity curve summary
  if (latest) {
    msg += `\n\n━━━━━━━━━━━━━━━━━━━━`;
    msg += `\n📊 *Live Equity Snapshot:*`;
    msg += `\n  Capital:     $${latest.capital}`;
    msg += `\n  Total return: +${latest.totalReturn}%`;
    msg += `\n  Cum. R:      ${latest.cumulativeR}R`;
    msg += `\n  Max drawdown: ${latest.maxDrawdownPct}%`;
    msg += `\n  Total trades: ${latest.totalTrades}`;
  }

  await send(msg);
  console.log('✅ Weekly summary sent.');
})();
