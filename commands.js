/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — TELEGRAM COMMAND HANDLER
 *
 *  Your bot is NOT a long-running process — GitHub Actions runs strategy.js
 *  once per scan and exits. So it can't "listen" for /scan in real time.
 *
 *  This script is the workaround: a SEPARATE GitHub Actions workflow runs
 *  this file every few minutes. It checks Telegram for new messages since
 *  the last check, and if one is a recognized command, it executes it and
 *  replies. Typical delay: up to the poll interval (5 min recommended).
 *
 *  NOTE: Uses axios directly for ALL Telegram calls — no node-telegram-bot-api.
 *  The library's internal polling setup (even with polling:false) can silently
 *  conflict with manual getUpdates, and any active webhook causes a 409 error
 *  that crashes the whole handler. Axios + direct API calls are bulletproof.
 *
 *  Commands:
 *    /scan       → run a fresh scan right now, reply with zone/bias per symbol
 *    /status     → show the last saved scan result (no new scan)
 *    /health     → ping KuCoin, report last successful run time
 *    /positions  → MVS is signal-only (no position tracking). Reports last
 *                  active signal per symbol and says so explicitly.
 *    /help       → list commands
 * ═══════════════════════════════════════════════════════════════════════
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const config = require('./config');

const TG = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;

// ── Telegram helpers (pure axios — no node-telegram-bot-api) ──────────────
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

// ── State helpers ─────────────────────────────────────────────────────────
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
const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// ── /help ─────────────────────────────────────────────────────────────────
const cmdHelp = async () => {
  await send(
`🤖 *MVS Command Menu*

/scan — run a fresh scan now
/status — last saved scan result
/health — KuCoin connectivity + last run time
/positions — last active signal (MVS is signal-only, no live position tracking)
/help — this menu`
  );
};

// ── /status ──────────────────────────────────────────────────────────────
const cmdStatus = async () => {
  const state = loadJSON(STATE_FILE, null);
  if (!state) return send('⚠️ No saved state yet. Run /scan or wait for the next scheduled scan.');

  let msg = `📊 *MVS Status*\nLast run: ${state._lastRunAt || 'unknown'}\n`;
  for (const sym of config.SYMBOLS) {
    const s = state[sym];
    if (!s) { msg += `\n*${sym}*: no data yet`; continue; }
    msg += `\n\n*${sym}* — ${s.signal}\nPrice: $${Number(s.price).toFixed(2)}`;
    if (s.poc) msg += ` | POC: $${Number(s.poc).toFixed(2)} | VAH: $${Number(s.vah).toFixed(2)} | VAL: $${Number(s.val).toFixed(2)}`;
    if (s.entryPrice) {
      msg += `\nEntry: $${Number(s.entryPrice).toFixed(2)} | SL: $${Number(s.slPrice).toFixed(2)}`;
      msg += `\nTP1: $${Number(s.tp1Price).toFixed(2)} (R:R ${s.rr1}) | TP2: $${Number(s.tp2Price).toFixed(2)} (R:R ${s.rr2}) | TP3: $${Number(s.tp3Price).toFixed(2)} (R:R ${s.rr3})`;
    }
    msg += `\nUpdated: ${s.updatedAt}`;
  }
  await send(msg);
};

// ── /health ──────────────────────────────────────────────────────────────
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
  let msg = `📌 *MVS Positions*\n_Note: MVS is signal-only — it does not place or track live trades. Below is the last active signal per symbol, not a live position._\n`;
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

// ── Command map ──────────────────────────────────────────────────────────
const COMMANDS = {
  '/scan':      cmdScan,
  '/status':    cmdStatus,
  '/health':    cmdHealth,
  '/positions': cmdPositions,
  '/help':      cmdHelp,
  '/start':     cmdHelp,
};

// ─────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────
(async () => {

  // ── STEP 1: clear any active webhook ──────────────────────────────────
  // A webhook and getUpdates cannot coexist — Telegram returns 409 Conflict
  // if both are attempted. deleteWebhook is a no-op when no webhook is set,
  // so it is always safe to call.
  const dwRes = await tgCall('deleteWebhook', { drop_pending_updates: false });
  if (dwRes && dwRes.ok) {
    console.log('✅ deleteWebhook OK (safe to call getUpdates)');
  } else {
    console.warn('⚠️  deleteWebhook returned unexpected result — continuing anyway');
  }

  // ── STEP 2: load saved offset ─────────────────────────────────────────
  const offsetData = loadJSON(OFFSET_FILE, { offset: 0 });
  console.log(`📌 Starting from offset: ${offsetData.offset}`);

  // ── STEP 3: fetch updates ─────────────────────────────────────────────
  const updRes = await tgCall('getUpdates', { offset: offsetData.offset, timeout: 0, limit: 100 }, 15000);

  if (!updRes || !updRes.ok) {
    console.error('❌ getUpdates failed:', JSON.stringify(updRes));
    process.exit(1);
  }

  const updates = updRes.result;

  if (!updates.length) {
    console.log('No new Telegram messages.');
    process.exit(0);
  }

  // ── STEP 4: bootstrap fast-forward ───────────────────────────────────
  // If tg-offset.json was never committed, offset=0 and getUpdates returns
  // the oldest 100 pending messages. New commands are buried after them.
  // Skip the backlog on the first run — new commands arrive on the next tick.
  if (offsetData.offset === 0 && updates.length > 0) {
    const fastForwardOffset = updates[updates.length - 1].update_id + 1;
    saveJSON(OFFSET_FILE, { offset: fastForwardOffset });
    console.log(`🚀 Bootstrap: skipped ${updates.length} old update(s), offset now ${fastForwardOffset}.`);
    console.log('   Send a command — it will be processed on the next 5-min run.');
    process.exit(0);
  }

  // ── STEP 5: process commands ─────────────────────────────────────────
  let newOffset = offsetData.offset;

  for (const update of updates) {
    newOffset = update.update_id + 1;

    const msg     = update.message || update.edited_message;
    const rawText = (msg && msg.text || '').trim();
    const chatId  = msg && msg.chat && msg.chat.id;

    // Security: only respond to the configured chat
    if (String(chatId) !== String(config.TELEGRAM_CHAT_ID)) {
      console.log(`  Ignored update from chat ${chatId} (not our chat)`);
      continue;
    }

    // Strip /command@BotUsername → /command (Telegram appends bot name in groups)
    const cmd = rawText.toLowerCase().split(' ')[0].split('@')[0];

    if (COMMANDS[cmd]) {
      console.log(`▶️  Executing: ${cmd}`);
      await COMMANDS[cmd]();
    } else if (rawText) {
      console.log(`  Unknown command/text: "${rawText}"`);
    }
  }

  // ── STEP 6: persist new offset ────────────────────────────────────────
  saveJSON(OFFSET_FILE, { offset: newOffset });
  console.log(`✅ Done. Processed ${updates.length} update(s). Offset now ${newOffset}.`);

})();
