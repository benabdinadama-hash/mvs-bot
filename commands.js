/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — TELEGRAM COMMAND HANDLER  (v10.0)
 *
 *  Runs every 5 minutes via GitHub Actions (mvs-commands.yml).
 *  Polls Telegram getUpdates, executes any recognised command, saves offset.
 *
 *  v10.0: /about and /pairs no longer hardcode backtest numbers (win rate,
 *  R totals, per-pair stats) in the message text. That pattern has caused
 *  stale/misleading claims to survive multiple strategy rewrites in a row
 *  (v8.4's fix log literally says "corrected all stale... claims" — and
 *  the exact same class of staleness was still present, worse, by v9.1).
 *  A hardcoded number in a chat command will always eventually go stale
 *  the moment strategy.js or config.js changes; these commands now point
 *  to `node backtest.js` for current numbers instead of repeating one.
 *
 *  Commands handled:
 *    /scan       → run strategy.js right now, then reply with /status output
 *    /status     → last saved scan result from state.json
 *    /health     → KuCoin ping + last run timestamp
 *    /positions  → last active signal per symbol (signal-only, no live trades)
 *    /pairs      → tracked pairs + backtest stats
 *    /about      → strategy overview + how to run your own backtest
 *    /signal     → how to read a signal
 *    /source     → GitHub link
 *    /help       → command menu
 *    /start      → same as /help
 * ═══════════════════════════════════════════════════════════════════════
 */

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const config = require('./config');

const TG = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;

// ── Telegram helpers (pure axios — no node-telegram-bot-api) ─────────────
const tgCall = async (method, params = {}, ms = 12000) => {
  try {
    const res = await Promise.race([
      axios.post(`${TG}/${method}`, params),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${method} timed out`)), ms)),
    ]);
    return res.data;
  } catch (e) {
    console.error(`⚠️  Telegram ${method} failed: ${e.message}`);
    return null;
  }
};

const send = (text) =>
  tgCall('sendMessage', { chat_id: config.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' });

// ── State helpers ──────────────────────────────────────────────────────────
const STATE_FILE  = path.join(__dirname, 'state.json');
const LOG_FILE    = path.join(__dirname, 'signals.log.json');
const OFFSET_FILE = path.join(__dirname, 'tg-offset.json');

const loadJSON = (file, fallback) => {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
};
const saveJSON = (file, data) =>
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

// ── /help ──────────────────────────────────────────────────────────────────
const cmdHelp = async () => {
  await send(
`🤖 *MVS Command Menu*

/scan — run a fresh scan now
/status — last saved scan result
/health — KuCoin connectivity + last run time
/positions — last active signal (MVS is signal-only, no live position tracking)
/pairs — tracked pairs + backtest stats
/about — strategy overview
/signal — how to read a signal
/source — GitHub link
/help — this menu`
  );
};

// ── /status ───────────────────────────────────────────────────────────────
const cmdStatus = async () => {
  const state = loadJSON(STATE_FILE, null);
  if (!state) {
    return send('⚠️ No saved state yet. Run /scan or wait for the next scheduled scan.');
  }

  let msg = `📊 *MVS Status*\nLast run: ${state._lastRunAt || 'unknown'}\n`;
  for (const sym of config.SYMBOLS) {
    const s = state[sym];
    if (!s) { msg += `\n*${sym}*: no data yet`; continue; }
    msg += `\n\n*${sym}* — ${s.signal}\nPrice: $${Number(s.price).toFixed(2)}`;
    if (s.poc) {
      msg += ` | POC: $${Number(s.poc).toFixed(2)} | VAH: $${Number(s.vah).toFixed(2)} | VAL: $${Number(s.val).toFixed(2)}`;
    }
    if (s.entryPrice) {
      msg += `\nEntry: $${Number(s.entryPrice).toFixed(2)} | SL: $${Number(s.slPrice).toFixed(2)}`;
      msg += `\nTP1: $${Number(s.tp1Price).toFixed(2)} (R:R ${s.rr1}) | TP2: $${Number(s.tp2Price).toFixed(2)} (R:R ${s.rr2}) | TP3: $${Number(s.tp3Price).toFixed(2)} (R:R ${s.rr3})`;
    }
    msg += `\nUpdated: ${s.updatedAt}`;
  }
  await send(msg);
};

// ── /health ───────────────────────────────────────────────────────────────
const cmdHealth = async () => {
  const state = loadJSON(STATE_FILE, {});
  let kucoinOk = false;
  try {
    const res = await axios.get(`${config.BASE_URL}/timestamp`, { timeout: 8000 });
    kucoinOk = res.data && res.data.code === '200000';
  } catch (e) {
    kucoinOk = false;
  }
  await send(
`🩺 *MVS Health Check*

KuCoin API: ${kucoinOk ? '✅ reachable' : '❌ unreachable'}
Last scan run: ${state._lastRunAt || 'never'}
Symbols tracked: ${config.SYMBOLS.join(', ')}`
  );
};

// ── /positions ────────────────────────────────────────────────────────────
const cmdPositions = async () => {
  const state = loadJSON(STATE_FILE, {});
  let msg = `📌 *MVS Positions*\n_Note: MVS is signal-only — it does not place or track live trades. Below is the last active signal per symbol._\n`;
  for (const sym of config.SYMBOLS) {
    const s = state[sym];
    msg += `\n*${sym}*: ${s ? s.signal : 'no data'}${s && s.entryPrice ? ` @ $${Number(s.entryPrice).toFixed(2)}` : ''}`;
  }
  await send(msg);
};

// ── /scan ─────────────────────────────────────────────────────────────────
const cmdScan = async () => {
  await send('🔍 Running a fresh scan now, one moment...');
  const { execSync } = require('child_process');
  try {
    execSync('node strategy.js', { cwd: __dirname, stdio: 'inherit', timeout: 5 * 60 * 1000 });
  } catch (e) {
    await send(`⚠️ Scan finished with an error: ${e.message}`);
  }
  await cmdStatus();
};

// ── /about ───────────────────────────────────────────────────────────────
const cmdAbout = async () => {
  await send(
`📊 *MVS — Monthly Value Sniper* (v10.0)

Crypto signal bot built on one tendency: *price tends to revisit where the most volume was traded.* That's a real market pattern, not a guarantee about any single trade.

*Strategy:* Volume Profile (POC + VAH + VAL) + Fibonacci (61.8–78.6% pocket) across three timeframes — 4H macro bias, 1H structure, 15m trigger. Needs 2-of-3 timeframes to agree on direction before anything fires.

No hardcoded win-rate claim here. This bot does not target or achieve a 100% (or "near 100%") win rate — no trading system does. Run \`node backtest.js\` in the repo yourself for current, honest numbers over a window you haven't tuned against, and read the full funnel diagnostics, not just the headline win rate.

Zero lagging indicators. No EMA, no RSI. Pure structure — reviewed openly, not a black box.`
  );
};

// ── /pairs ────────────────────────────────────────────────────────────────
const cmdPairs = async () => {
  const pairList = config.SYMBOLS.map(s => `• *${s}*`).join('\n');
  await send(
`💱 *Tracked Pairs (${config.SYMBOLS.length} total)*

${pairList}

Per-pair win rate / R stats aren't hardcoded here anymore — they change
every time the strategy logic changes, and a stale number in a bot
response is worse than no number. Run \`node backtest.js\` for current
per-symbol stats.

Exchange: *KuCoin* — fully accessible from Ghana without VPN.`
  );
};

// ── /signal ───────────────────────────────────────────────────────────────
const cmdSignal = async () => {
  await send(
`📡 *How to Read a Signal*

When MVS fires, you'll receive:

🟢 *BUY* (or 🔴 *SELL*)
• *TF Vote:* which of 4H/1H/15m agreed, and the tally (2/3 or 3/3)
• *Entry:* the 1H Fib/POC/VAH/VAL confluence level
• *SL:* stop loss — 1H swing wick ± 0.25×ATR
• *TP1 / TP2 / TP3:* a 3-stage target ladder with R:R for each
• *15m trigger:* which rejection pattern(s) fired the signal

This is a probability-favored setup with a defined stop, not a guarantee.
Decide your own position size in advance — before an alert arrives, not
in the moment. A string of 3-4 losses in a row is normal variance, even
for a genuinely good strategy; size so that doesn't meaningfully hurt you.`
  );
};

// ── /source ───────────────────────────────────────────────────────────────
const cmdSource = async () => {
  await send(
`🔗 *MVS Source Code*

Fully open source — no black box.

GitHub: https://github.com/benabdinadama-hash/mvs-bot

Built by Abdin | Asterix Holdings Ltd | Accra, Ghana`
  );
};

const COMMANDS = {
  '/scan':      cmdScan,
  '/status':    cmdStatus,
  '/health':    cmdHealth,
  '/positions': cmdPositions,
  '/help':      cmdHelp,
  '/start':     cmdHelp,
  '/about':     cmdAbout,
  '/pairs':     cmdPairs,
  '/signal':    cmdSignal,
  '/source':    cmdSource,
};

// ─────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────
(async () => {

  // ── STEP 1: clear any active webhook ────────────────────────────────────
  const dwRes = await tgCall('deleteWebhook', { drop_pending_updates: false });
  if (dwRes && dwRes.ok) {
    console.log('✅ deleteWebhook OK');
  } else {
    console.warn('⚠️  deleteWebhook returned unexpected result — continuing anyway');
  }

  // ── STEP 2: load saved offset ────────────────────────────────────────────
  const offsetData = loadJSON(OFFSET_FILE, { offset: 0 });
  let currentOffset = offsetData.offset || 0;
  console.log(`📌 Starting from offset: ${currentOffset}`);

  // ── STEP 3: fetch updates ─────────────────────────────────────────────────
  const updRes = await tgCall('getUpdates', {
    offset:  currentOffset,
    timeout: 0,
    limit:   100,
  }, 15000);

  if (!updRes || !updRes.ok) {
    console.error('❌ getUpdates failed:', JSON.stringify(updRes));
    process.exit(1);
  }

  const updates = updRes.result;
  console.log(`📨 Received ${updates.length} update(s).`);

  if (!updates.length) {
    console.log('No new Telegram messages. Nothing to do.');
    process.exit(0);
  }

  // ── STEP 4: advance offset FIRST (prevents replay if push fails later) ───
  const newOffset = updates[updates.length - 1].update_id + 1;
  saveJSON(OFFSET_FILE, { offset: newOffset });
  console.log(`💾 Offset advanced to ${newOffset} (saved before processing).`);

  // ── STEP 5: process commands ──────────────────────────────────────────────
  for (const update of updates) {
    const msg     = update.message || update.edited_message;
    const rawText = (msg && msg.text || '').trim();
    const chatId  = msg && msg.chat && msg.chat.id;

    if (!rawText) continue;

    if (String(chatId) !== String(config.TELEGRAM_CHAT_ID)) {
      console.log(`  Ignored update ${update.update_id} from chat ${chatId} (not our chat)`);
      continue;
    }

    const cmd = rawText.toLowerCase().split(' ')[0].split('@')[0];

    if (COMMANDS[cmd]) {
      console.log(`▶️  Executing: ${cmd} (update_id ${update.update_id})`);
      await COMMANDS[cmd]();
    } else {
      console.log(`  Unknown command/text: "${rawText}" — ignored`);
    }
  }

  console.log(`✅ Done. Processed ${updates.length} update(s). Offset is now ${newOffset}.`);

})();
