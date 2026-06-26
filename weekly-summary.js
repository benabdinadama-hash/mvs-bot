/**
 * MVS — Weekly Summary
 * Reads signals.log.json, summarizes the last 7 days, sends to Telegram.
 * Run once a week by its own GitHub Actions workflow.
 */
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');

const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });

// Same fix as strategy.js/commands.js: bot.sendMessage() has no timeout of
// its own, so a stalled/throttled call can hang the whole job.
const sendSafe = (chatId, text, opts, ms = 10000) =>
  Promise.race([
    bot.sendMessage(chatId, text, opts),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Telegram send timed out')), ms)),
  ]).catch((e) => {
    console.error(`⚠️ Telegram send failed/timed out: ${e.message}`);
    return null;
  });
const LOG_FILE = path.join(__dirname, 'signals.log.json');

const loadJSON = (file, fallback) => {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
};

(async () => {
  const log = loadJSON(LOG_FILE, []);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = log.filter(e => new Date(e.time).getTime() >= weekAgo);

  if (!recent.length) {
    await sendSafe(config.TELEGRAM_CHAT_ID, '📅 *MVS Weekly Summary*\n\nNo signals logged in the last 7 days.', { parse_mode: 'Markdown' });
    return;
  }

  const counts = {};
  for (const e of recent) counts[e.signal] = (counts[e.signal] || 0) + 1;

  let msg = `📅 *MVS Weekly Summary*\n${recent.length} total events across ${config.SYMBOLS.join(', ')}\n`;
  for (const [signal, count] of Object.entries(counts)) {
    msg += `\n• ${signal}: ${count}`;
  }

  const entries = recent.filter(e => e.signal.startsWith('B1') || e.signal.startsWith('B2'));
  if (entries.length) {
    msg += `\n\n🎯 *Entries (${entries.length}):*`;
    for (const e of entries.slice(-10)) {
      msg += `\n${e.symbol} ${e.direction} @ $${Number(e.entryPrice).toFixed(2)} (TP1 RR ${e.rr1} | TP2 RR ${e.rr2} | TP3 RR ${e.rr3})`;
    }
  }

  await sendSafe(config.TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
  console.log('✅ Weekly summary sent.');
})();
