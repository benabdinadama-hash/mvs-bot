/**
 * MVS — BOT SETUP  (setup-bot.js)
 *
 * Run ONCE to configure the Telegram bot's profile, description,
 * and command menu. After this runs, any user who opens the bot
 * sees the correct description and commands instantly — no polling needed.
 *
 * Usage: node setup-bot.js
 * Or:    GitHub Actions → MVS Bot Setup → Run workflow
 */

const axios  = require('axios');
const config = require('./config');

const TG = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;

const call = async (method, params = {}) => {
  try {
    const res = await axios.post(`${TG}/${method}`, params, { timeout: 10000 });
    if (res.data.ok) {
      console.log(`✅ ${method} — OK`);
    } else {
      console.error(`❌ ${method} — ${JSON.stringify(res.data)}`);
    }
    return res.data;
  } catch (e) {
    console.error(`❌ ${method} failed: ${e.message}`);
  }
};

(async () => {
  console.log('\n🤖 MVS Bot Setup\n');

  // 1. Delete any existing webhook (ensures getUpdates can still work if needed)
  await call('deleteWebhook', { drop_pending_updates: true });

  // 2. Set bot name shown in chat list
  await call('setMyName', {
    name: 'Monthly Value Sniper BOT'
  });

  // 3. Set short description (shown on bot profile page)
  // v10.6 FIX: this was 129 characters — Telegram's setMyShortDescription
  // limit is 120. The API call has likely been silently failing (check
  // the Action log for this step: a non-ok response logs "❌ setMyShort-
  // Description — {...}"). Trimmed with real margin this time.
  await call('setMyShortDescription', {
    short_description: '🎯 Crypto signals, 13 KuCoin pairs. POC/VAH/VAL + Fib, 4H/1H/15m 2-of-3 vote. Built for Ghana.'
  });

  // 4. Set full description (shown when user first opens bot)
  // v10.6 FIX: the PREVIOUS version of this description was 844
  // characters — Telegram's setMyDescription limit is 512. This call has
  // likely been silently failing since that content was added (check the
  // Action log: a non-ok response logs "❌ setMyDescription — {...}").
  // Rewritten to fit with margin (450 chars / 454 UTF-8 bytes) while
  // still including a real, dated performance snapshot as requested —
  // both backtest windows shown together (not one cherry-picked figure)
  // with a date and version tied to it, and an explicit "not a live
  // guarantee" + "these numbers age" caveat, which is the actual fix for
  // what made the old 90.7% badge misleading (a single undated number
  // presented with no caveat, tuned against the same window it reported
  // on). Update this snapshot whenever config.js changes meaningfully —
  // see README.md's "Reference snapshot" section for the source numbers.
  await call('setMyDescription', {
    description:
`Monthly Value Sniper (MVS) by Abdin — KuCoin, Ghana

Volume Profile (POC/VAH/VAL) + Fibonacci, 4H/1H/15m, 2-of-3 vote to fire.

v10.6 backtest, 2026-07-04 (not a live guarantee):
720d: 62% WR, PF 8.47, +305% return, 2.3% max DD
360d: 60% WR, PF 7.03, +96% return, 1.9% max DD
Losses cluster in one segment already sized down. Run backtest.js
yourself — these numbers age fast.

13 KuCoin pairs. Auto-alerts here.
github.com/benabdinadama-hash/mvs-bot`
  });

  // 5. Set command menu (shown when user taps the / button)
  await call('setMyCommands', {
    commands: [
      { command: 'start',     description: '🤖 Welcome — what is MVS?' },
      { command: 'about',     description: '📊 Strategy overview + backtest results' },
      { command: 'pairs',     description: '💱 Which pairs are tracked and why' },
      { command: 'signal',    description: '📡 How to read a signal when it fires' },
      { command: 'positions', description: '📌 Last active signal per symbol' },
      { command: 'source',    description: '🔗 GitHub repo link' },
      { command: 'health',    description: '🩺 KuCoin API status + last scan time' },
      { command: 'status',    description: '📈 Last saved scan result' },
    ]
  });

  // 6. Send a test message to your chat confirming setup
  await call('sendMessage', {
    chat_id: config.TELEGRAM_CHAT_ID,
    text:
`✅ *MVS Bot Setup Complete*

Bot profile, description and command menu have been configured.

Tap the */* button in this chat to see the command menu. Any visitor who opens this bot will now see the full MVS description and performance stats instantly — no polling required.

Signal alerts will continue firing automatically whenever any of the 13 tracked pairs hits a valid confluence zone.`,
    parse_mode: 'Markdown'
  });

  console.log('\n✅ Setup complete.\n');
  process.exit(0);
})();
