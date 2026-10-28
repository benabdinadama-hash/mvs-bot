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
// v10.43: version string now comes from package.json, not a hand-typed
// literal — same fix strategy.js/backtest.js/commands.js already apply,
// for the exact same recurring "stale version string" bug class.
const MVS_VERSION = require('./package.json').version;

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
  //
  // v10.43 FIX: the pair count here was a hardcoded "14" — stale since
  // v10.18/v10.19 added MNT/ATOM/NEAR/APT/ARB/OP/SUI, bringing the real
  // count to 20 (config.SYMBOLS.length). This is the exact staleness bug
  // commands.js's /about and /pairs were rewritten to stop having (see
  // that file's v10.0 header note) — it just hadn't been applied here
  // yet, in the public bot-profile text any visitor sees immediately.
  // Built from config.SYMBOLS.length now so it can never go stale again.
  await call('setMyShortDescription', {
    short_description: `🎯 Crypto signals, ${config.SYMBOLS.length} KuCoin pairs. POC/VAH/VAL + Fib, 1D/4H/1H/30m/15m 3-of-5 vote. Built for Ghana.`
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
  //
  // v10.10 HONESTY NOTE: the vote architecture changed from 3-timeframe
  // (4H/1H/15m, 2-of-3) to 5-timeframe (1D/4H/1H/30m/15m, 3-of-5) in this
  // pass. The v10.6 backtest numbers below were measured against the OLD
  // 3-TF ruleset — they do NOT describe the current bot and are left here
  // only until a fresh backtest can be run (this sandbox has no network
  // access to api.kucoin.com). Run `node backtest.js` yourself after
  // deploying and replace this snapshot with the new numbers before
  // trusting or publishing them anywhere.
  //
  // v10.13 UPDATE (2026-07-07): fresh backtest now in hand — 360-day
  // window, run AFTER the v10.11/v10.12/v10.13 changes (MIN_CONFLUENCE_POC
  // revert, POC_RECLAIM solo-trigger removal, POC/no-1H-confirm gate,
  // POC prominence gate, POC migration fix). Real numbers below, dated,
  // replacing the stale v10.6 placeholder. Same standing rule applies:
  // update this snapshot again the next time config.js changes
  // meaningfully — see README.md's "Reference snapshot" section.
  //
  // v10.43 FIX: that "same standing rule" was never actually followed —
  // this was STILL showing the v10.13 (2026-07-07) snapshot on a bot now
  // at v10.43, over 20 more versions and several real config/gate changes
  // later (POC_PROMINENCE_REQUIRE_DECISIVE, EXCLUDE_FIB_61_8, MID_POCKET_
  // EXCLUDE going live, the leverage/liquidation-safety fix, etc.) — the
  // exact hardcoded-number staleness this codebase's commands.js was
  // rewritten specifically to stop doing (see its v10.0 header). A
  // first-time visitor to this bot was being shown a specific win-rate/
  // profit-factor claim that hadn't described the bot's actual behavior
  // in dozens of versions. Fixed the same way commands.js's /about and
  // /pairs already were: no hardcoded figure here at all — point to
  // running backtest.js for current numbers instead of a number that can
  // only ever go stale again. Pair count now comes from config.SYMBOLS.length.
  await call('setMyDescription', {
    description:
`Monthly Value Sniper (MVS) by Abdin — KuCoin, Ghana (v${MVS_VERSION})

Volume Profile (POC/VAH/VAL) + Fibonacci, 1D/4H/1H/30m/15m, 3-of-5 vote to fire.

No hardcoded win-rate claim here — it would only go stale again the next
time the strategy changes. Run \`node backtest.js\` in the repo for
current, honest numbers. Not a live-performance guarantee.

${config.SYMBOLS.length} KuCoin pairs. Auto-alerts here.
github.com/benabdinadama-hash/mvs-bot`
  });

  // 5. Set command menu (shown when user taps the / button)
  // v10.43 FIX: /scan, /pause, /resume existed in commands.js's COMMANDS
  // table (added v10.16, for the real-money kill switch) but were never
  // added here — so they worked if typed, but never appeared in Telegram's
  // own "/" menu, meaning the owner could easily forget the kill switch
  // even exists. Added below so the native menu matches what commands.js
  // actually handles.
  await call('setMyCommands', {
    commands: [
      { command: 'start',     description: '🤖 Welcome — what is MVS?' },
      { command: 'about',     description: '📊 Strategy overview + backtest results' },
      { command: 'pairs',     description: '💱 Which pairs are tracked and why' },
      { command: 'signal',    description: '📡 How to read a signal when it fires' },
      { command: 'positions', description: '📌 Open positions, tracked until close' },
      { command: 'scan',      description: '🔍 Run a fresh scan right now' },
      { command: 'source',    description: '🔗 GitHub repo link' },
      { command: 'health',    description: '🩺 KuCoin API status + last scan time' },
      { command: 'status',    description: '📈 Last saved scan result' },
      { command: 'pause',     description: '⏸️ Stop new live orders (kill switch)' },
      { command: 'resume',    description: '▶️ Resume live order execution' },
    ]
  });

  // 6. Send a test message to your chat confirming setup
  await call('sendMessage', {
    chat_id: config.TELEGRAM_CHAT_ID,
    text:
`✅ *MVS Bot Setup Complete*

Bot profile, description and command menu have been configured.

Tap the */* button in this chat to see the command menu. Any visitor who opens this bot will now see the full MVS description instantly — no polling required.

Signal alerts will continue firing automatically whenever any of the ${config.SYMBOLS.length} tracked pairs hits a valid confluence zone.`,
    parse_mode: 'Markdown'
  });

  console.log('\n✅ Setup complete.\n');
  process.exit(0);
})();
