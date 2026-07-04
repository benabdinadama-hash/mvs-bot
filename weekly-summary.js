/**
 * MVS — Weekly Summary  (v10.6 — pure axios, no node-telegram-bot-api)
 *
 * Reads signals.log.json, summarises the last 7 days, sends to Telegram.
 * Triggered every Monday 07:00 UTC by mvs-weekly.yml.
 */

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const config = require('./config');

const TG = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;

const send = async (text) => {
  try {
    const res = await Promise.race([
      axios.post(`${TG}/sendMessage`, {
        chat_id:    config.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
      }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('sendMessage timed out')), 12000)
      ),
    ]);
    return res.data;
  } catch (e) {
    console.error(`⚠️  Telegram sendMessage failed: ${e.message}`);
    return null;
  }
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
// HONESTY NOTE (found during v10.6 review): closedEntries below requires
// e.rr and e.exitTime, but strategy.js's logSignal() only ever logs at
// signal-FIRE time (signal: 'FIRED') — there is no live exit-tracking
// (this bot alerts, it doesn't monitor open positions between scans). So
// closedEntries is currently ALWAYS empty, and everything below this
// comment down to "Weekly snapshot" never actually runs against real
// data — the equity curve and "Live Equity Snapshot" section further down
// stay silent/absent rather than showing fabricated numbers, which is the
// safe failure mode, but it's worth knowing this feature is not yet wired
// up rather than assuming it's quietly tracking your results. Building
// real exit-tracking would need the bot to poll KuCoin price against each
// open signal's SL/TP1/TP2 between scans and log the outcome when one
// hits — a real feature, just a bigger one than this pass covers.
const updateEquityCurve = (log) => {
  const curve   = loadJSON(EQUITY_FILE, []);
  const RISK    = config.RISK_PER_TRADE_PCT || 1.5;
  const SLIP    = config.SLIPPAGE_PCT       || 0.001;
  const START   = 1000;

  // Use closed trade entries that have an rr field (logged on trade close)
  const closedEntries = log.filter(e => e.rr !== undefined && e.rr !== null && e.exitTime);
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

  // Append or replace the snapshot for this week
  const idx = curve.findIndex(s => s.week === weekLabel);
  if (idx >= 0) curve[idx] = snapshot;
  else curve.push(snapshot);

  fs.writeFileSync(EQUITY_FILE, JSON.stringify(curve, null, 2));
  console.log(`✅ Equity curve updated → ${EQUITY_FILE} (${closedEntries.length} trades, capital $${latest.capital})`);
  return curve;
};

(async () => {
  const log    = loadJSON(LOG_FILE, []);

  // ── Update equity curve first (writes equity-curve.json) ────────────────
  const curve  = updateEquityCurve(log);
  const latest = curve.length ? curve[curve.length - 1] : null;

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
    msg += `\n\n🎯 *Entries (${entries.length}):*`;
    for (const e of entries.slice(-10)) {
      msg += `\n${e.symbol} ${e.direction} @ $${Number(e.entryPrice).toFixed(4)}`;
      msg += `\n  SL $${Number(e.slPrice).toFixed(4)} | TP1 $${Number(e.tp1Price).toFixed(4)} | TP2 (runner) $${Number(e.tp2Price).toFixed(4)}`;
      msg += `\n  Patterns: ${(e.patterns || []).join(' + ')} | R:R ${e.rr1}/${e.rr2}`;
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
