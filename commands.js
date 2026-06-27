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
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');

const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });

// Same fix as strategy.js: bot.sendMessage() has no timeout of its own,
// so a stalled/throttled call can hang the whole job. Race it against a timer.
const sendSafe = (chatId, text, opts, ms = 10000) =>
  Promise.race([
    bot.sendMessage(chatId, text, opts),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Telegram send timed out')), ms)),
  ]).catch((e) => {
    console.error(`⚠️ Telegram send failed/timed out: ${e.message}`);
    return null;
  });

const STATE_FILE = path.join(__dirname, 'state.json');
const LOG_FILE = path.join(__dirname, 'signals.log.json');
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

const send = (text) => sendSafe(config.TELEGRAM_CHAT_ID, text, { parse_mode: 'Markdown' });

// ── /help ──
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

// ── /status ──
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

// ── /health ──
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

// ── /positions ──
const cmdPositions = async () => {
  const state = loadJSON(STATE_FILE, {});
  let msg = `📌 *MVS Positions*\n_Note: MVS is signal-only — it does not place or track live trades. Below is the last active signal per symbol, not a live position._\n`;
  for (const sym of config.SYMBOLS) {
    const s = state[sym];
    msg += `\n*${sym}*: ${s ? s.signal : 'no data'}${s && s.entryPrice ? ` @ $${Number(s.entryPrice).toFixed(2)}` : ''}`;
  }
  await send(msg);
};

// ── /scan — run strategy.js fresh and reply with a summary ──
const cmdScan = async () => {
  await send('🔍 Running a fresh scan now, one moment...');
  // Re-use strategy.js's own scan logic by spawning it as a child process
  // so this file doesn't need to duplicate the whole engine.
  const { execSync } = require('child_process');
  try {
    execSync('node strategy.js', { cwd: __dirname, stdio: 'inherit', timeout: 5 * 60 * 1000 });
  } catch (e) {
    await send(`⚠️ Scan finished with an error: ${e.message}`);
  }
  // strategy.js already sends its own Telegram alerts and updates state.json.
  // Just confirm + show the fresh state.
  await cmdStatus();
};

const COMMANDS = {
  '/scan': cmdScan,
  '/status': cmdStatus,
  '/health': cmdHealth,
  '/positions': cmdPositions,
  '/help': cmdHelp,
  '/start': cmdHelp,
};

(async () => {
  const offsetData = loadJSON(OFFSET_FILE, { offset: 0 });
  let updates;
  try {
    updates = await Promise.race([
      bot.getUpdates({ offset: offsetData.offset, timeout: 0 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('getUpdates timed out')), 10000)),
    ]);
  } catch (e) {
    console.error('❌ Telegram getUpdates failed:', e.message);
    console.error('   This usually means TELEGRAM_BOT_TOKEN is wrong, expired, or missing.');
    process.exit(1);
  }

  if (!updates.length) {
    console.log('No new Telegram messages.');
    process.exit(0);
  }

  // ── BOOTSTRAP: fast-forward past backlog ─────────────────────────────────
  // If tg-offset.json was never committed (e.g. first deploy or after a repo
  // reset), offsetData.offset is 0 and getUpdates returns the oldest 100
  // pending messages — your NEW commands are buried after them and never seen.
  // Fix: skip the whole backlog on the first run and start fresh. Commands
  // sent AFTER this run will be processed normally on the next 5-min tick.
  if (offsetData.offset === 0 && updates.length > 0) {
    const fastForwardOffset = updates[updates.length - 1].update_id + 1;
    saveJSON(OFFSET_FILE, { offset: fastForwardOffset });
    console.log(`🚀 Bootstrap: skipped ${updates.length} old update(s), offset now ${fastForwardOffset}. Send a command now — it will be processed on the next run.`);
    process.exit(0);
  }

  let newOffset = offsetData.offset;
  for (const update of updates) {
    newOffset = update.update_id + 1;
    const rawText = (update.message && update.message.text || '').trim();
    const chatId = update.message && update.message.chat && update.message.chat.id;

    // Security: only respond to the configured chat — ignore everyone else
    if (String(chatId) !== String(config.TELEGRAM_CHAT_ID)) continue;

    // ── FIX: strip @BotUsername suffix before matching ───────────────────
    // Telegram appends @BotName to commands sent from the command menu
    // (e.g. "/health@MVSBot"). Without this strip, no command ever matches.
    const cmd = rawText.toLowerCase().split(' ')[0].split('@')[0];

    if (COMMANDS[cmd]) {
      console.log(`▶️ Executing command: ${cmd}`);
      await COMMANDS[cmd]();
    }
  }

  saveJSON(OFFSET_FILE, { offset: newOffset });
  console.log(`✅ Processed ${updates.length} update(s). Offset now ${newOffset}.`);
})();
