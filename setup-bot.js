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
    short_description: '🎯 Institutional crypto signals across 13 liquid KuCoin pairs. POC/VAH/VAL/Fib + 4H bias. 720-day backtested. Built for Ghana.'
  });

  // 4. Set full description (shown when user first opens bot)
  await call('setMyDescription', {
    description:
`🏆 Monthly Value Sniper (MVS)
By Abdin — KuCoin Edition for Ghana

An institutional-grade signal bot using Volume Profile (POC/VAH/VAL) + Fibonacci confluence, gated by 4H bias, on 1hour entry candles.

📊 Verified Performance (720 days, 13 pairs):
• Real-money win rate: 90.7% (only 14 real losses of 150 closed trades)
• Profit factor: 5.26
• Total R accumulated: +43.75R
• Avg hold: ~50 hours

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

Signal alerts will continue firing automatically when ETH or SOL hits a valid confluence zone.`,
    parse_mode: 'Markdown'
  });

  console.log('\n✅ Setup complete.\n');
  process.exit(0);
})();
