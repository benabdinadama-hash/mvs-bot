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
  await call('setMyShortDescription', {
    short_description: '🎯 Institutional-structure crypto signals across 13 liquid KuCoin pairs. POC/VAH/VAL/Fib, 4H+1H+15m 2-of-3 vote. Built for Ghana.'
  });

  // 4. Set full description (shown when user first opens bot)
  await call('setMyDescription', {
    description:
`🏆 Monthly Value Sniper (MVS)
By Abdin — KuCoin Edition for Ghana

An institutional-grade signal bot using Volume Profile (POC/VAH/VAL) + Fibonacci confluence across three timeframes — 4H macro bias, 1H structure, 15m trigger — requiring 2-of-3 to agree before anything fires.

No hardcoded win-rate claim here on purpose: an earlier version quoted a
90.7% figure that turned out to be tuned against the same backtest it was
"verified" on — the textbook definition of overfitting, and misleading to
show new users. Run \`node backtest.js\` in the repo yourself for current,
honest numbers over a window you haven't tuned against.

🎯 Pairs: ETH, SOL, BTC, XRP, ADA, DOGE, AVAX, LINK, BNB, DOT, LTC, TRX, POL (USDT)
📡 Exchange: KuCoin (works in Ghana — no VPN)
⚡ Signals fire automatically to this chat

Source: github.com/benabdinadama-hash/mvs-bot`
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
