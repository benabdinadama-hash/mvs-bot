/**
 * MVS — Weekly Summary  (v8.3 — pure axios, no node-telegram-bot-api)
 *
 * Reads signals.log.json, summarises the last 7 days, sends to Telegram.
 * Triggered every Monday 07:00 UTC by mvs-weekly.yml.
 *
 * CHANGE vs v8.2: removed node-telegram-bot-api dependency entirely.
 * Using TelegramBot (even with polling:false) while commands.js calls
 * deleteWebhook can produce a 409 Conflict that crashes this job.
 * Pure axios is used everywhere in v8.3 for consistency.
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
  const log    = loadJSON(LOG_FILE, []);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent  = log.filter(e => new Date(e.time).getTime() >= weekAgo);

  if (!recent.length) {
    await send('📅 *MVS Weekly Summary*\n\nNo signals logged in the last 7 days.');
    console.log('✅ Weekly summary sent (no signals).');
    return;
  }

  const counts = {};
  for (const e of recent) counts[e.signal] = (counts[e.signal] || 0) + 1;

  let msg = `📅 *MVS Weekly Summary*\n${recent.length} total events across ${config.SYMBOLS.join(', ')}\n`;
  for (const [signal, count] of Object.entries(counts)) {
    msg += `\n• ${signal}: ${count}`;
  }

  const entries = recent.filter(e =>
    e.signal && (e.signal.startsWith('B1') || e.signal.startsWith('B2'))
  );
  if (entries.length) {
    msg += `\n\n🎯 *Entries (${entries.length}):*`;
    for (const e of entries.slice(-10)) {
      msg += `\n${e.symbol} ${e.direction} @ $${Number(e.entryPrice).toFixed(2)} (TP1 RR ${e.rr1} | TP2 RR ${e.rr2} | TP3 RR ${e.rr3})`;
    }
  }

  await send(msg);
  console.log('✅ Weekly summary sent.');
})();
