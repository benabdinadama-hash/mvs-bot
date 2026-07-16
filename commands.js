/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MVS — TELEGRAM COMMAND HANDLER  (v10.15.9)
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
 *    /positions  → open positions (now tracked, not just last signal — v10.14)
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
// v10.14: single source of truth for the version string — see backtest.js's
// identical comment for why this exists (recurring stale-version-string bug).
const MVS_VERSION = require('./package.json').version;

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

// v10.10 FIX: Telegram's real hard limit is 4096 chars; a long /status
// message (14 symbols × full 5-TF bias breakdown) can exceed that and
// either get silently rejected or truncated by Telegram. send() now
// splits on blank-line (paragraph) boundaries so a message is never cut
// mid-symbol, and sends each chunk as its own message in order.
// v10.15.2 CRITICAL FIX — see strategy.js's identical helper for the full
// story: Telegram's legacy Markdown has no escape mechanism, so any
// internal identifier with an underscore (state.json's `signal` values
// like `NO_AGREEMENT`, `CLOSED_EARLY_TIMEOUT`, etc.) silently breaks the
// ENTIRE message it's embedded in — no error surfaces anywhere, the
// GitHub Actions run still shows green. This is the confirmed root cause
// of "/status not responding": state.json commonly has several symbols
// sitting at `NO_AGREEMENT`, and depending on how many (odd vs. even
// count across all symbols in one status message) the whole reply would
// either render with garbled formatting or fail to send at all.
const mdSafe = (s) => String(s ?? '').replace(/_/g, ' ');

const TELEGRAM_SAFE_LEN = 3800; // margin under the real 4096 limit

const splitIntoChunks = (text, maxLen = TELEGRAM_SAFE_LEN) => {
  if (text.length <= maxLen) return [text];
  const paragraphs = text.split('\n\n');
  const chunks = [];
  let current = '';
  for (const p of paragraphs) {
    const candidate = current ? `${current}\n\n${p}` : p;
    if (candidate.length > maxLen && current) {
      chunks.push(current);
      current = p;
    } else {
      current = candidate;
    }
    // A single paragraph longer than maxLen on its own (rare) — hard-split it.
    while (current.length > maxLen) {
      chunks.push(current.slice(0, maxLen));
      current = current.slice(maxLen);
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

const send = async (text) => {
  const chunks = splitIntoChunks(text);
  let lastRes = null;
  for (let i = 0; i < chunks.length; i++) {
    const prefix = chunks.length > 1 ? `_(${i + 1}/${chunks.length})_\n` : '';
    lastRes = await tgCall('sendMessage', { chat_id: config.TELEGRAM_CHAT_ID, text: prefix + chunks[i], parse_mode: 'Markdown' });
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300)); // avoid Telegram rate-limit on rapid multi-send
  }
  return lastRes;
};

// ── State helpers ──────────────────────────────────────────────────────────
const STATE_FILE  = path.join(__dirname, 'state.json');
const LOG_FILE    = path.join(__dirname, 'signals.log.json');
// v10.14: for /positions to show real tracked positions — see
// position-tracker.js header for what this file is and isn't.
const OPEN_POSITIONS_FILE = path.join(__dirname, 'open-positions.json');
const OFFSET_FILE = path.join(__dirname, 'tg-offset.json');

const loadJSON = (file, fallback) => {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
};
// v10.15.6 FIX: same atomic-write pattern applied across every file that
// touches these shared JSON files this version — see strategy.js's
// atomicWriteJSON comment for the full root-cause story. Lower risk here
// specifically (this only ever writes tg-offset.json, which nothing else
// touches, and the workflow's own concurrency group already prevents two
// instances of this file running at once) but there's no reason to leave
// one write path on the old pattern once every other one is fixed.
const saveJSON = (file, data) => {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
};

// ── /help ──────────────────────────────────────────────────────────────────
const cmdHelp = async () => {
  await send(
`🤖 *MVS Command Menu*

/scan — run a fresh scan now
/status — last saved scan result
/health — KuCoin connectivity + last run time
/positions — open positions, tracked automatically until close (v10.14)
/pairs — tracked pairs + backtest stats
/about — strategy overview
/signal — how to read a signal
/source — GitHub link
/help — this menu`
  );
};

// ── /status ───────────────────────────────────────────────────────────────
// v10.10 REWRITE: previously showed price/POC/VAH/VAL only — no direction,
// no bias, no vote tally — even though diag.log.json had all of it. Root
// cause was upstream (state.json never carried those fields; fixed in
// strategy.js saveState() calls), not just a display gap. Also rewritten
// for readability per direct feedback ("the screenshot shows the data
// without order, I can't even read well") — each symbol is now a clearly
// separated block with a fixed field order instead of one run-on line.
const BIAS_ICON = { BULLISH: '🟢', BEARISH: '🔴', NEUTRAL: '⚪' };
const biasStr = (b) => b ? `${BIAS_ICON[b] || ''}${b}` : '—';

const cmdStatus = async () => {
  const state = loadJSON(STATE_FILE, null);
  if (!state) {
    return send('⚠️ No saved state yet. Run /scan or wait for the next scheduled scan.');
  }

  let msg = `📊 *MVS Status*\nLast run: ${state._lastRunAt || 'unknown'}`;

  for (const sym of config.SYMBOLS) {
    const s = state[sym];
    msg += `\n\n━━━━━━━━━━━━━━━━━━━━\n*${sym}*`;
    if (!s) { msg += `\nno data yet`; continue; }

    msg += ` — ${mdSafe(s.signal || 'unknown')}`;
    if (s.direction) msg += ` (${s.direction})`;
    msg += `\nPrice: $${Number(s.price).toFixed(4)}`;

    if (s.poc) {
      msg += `\nPOC $${Number(s.poc).toFixed(4)} · VAH $${Number(s.vah).toFixed(4)} · VAL $${Number(s.val).toFixed(4)}`;
    }

    // v10.10: full 5-TF bias breakdown + vote tally, the actual ask.
    if (s.bias1d || s.bias4h || s.bias1h || s.bias30m || s.bias15m) {
      msg += `\nBias — 1D:${biasStr(s.bias1d)} 4H:${biasStr(s.bias4h)} 1H:${biasStr(s.bias1h)} 30m:${biasStr(s.bias30m)} 15m:${biasStr(s.bias15m)}`;
    }
    if (s.voteTally) {
      msg += `\nVote: ${s.voteTally}${s.agreeing ? ` (${s.agreeing.join('+')} agree)` : ''}`;
    }

    if (s.entryPrice) {
      msg += `\nEntry: $${Number(s.entryPrice).toFixed(4)} · SL: $${Number(s.slPrice).toFixed(4)}`;
      msg += `\nTP1 (${Math.round((config.PARTIAL_EXIT_PCT || 0.5) * 100)}% exit): $${Number(s.tp1Price).toFixed(4)} (R:R ${s.rr1}) · TP2 (runner): $${Number(s.tp2Price).toFixed(4)} (R:R ${s.rr2})`;
    }

    // v10.10: surface a fire whose Telegram alert failed to deliver — see
    // strategy.js sendSafe/flushPendingAlerts. Without this, a signal could
    // be sitting here as FIRED with no indication you never actually got
    // the alert for it.
    if (s.signal === 'FIRED' && s.alertDelivered === false) {
      msg += `\n⚠️ *Alert was NOT delivered when this fired — queued for retry next scan.*`;
    }
    msg += `\nUpdated: ${s.updatedAt}`;
    // v10.15.4 NEW: surfaces exactly the class of problem that prompted
    // this fix — a symbol quietly falling behind (e.g. from a scan run
    // that got killed by the job timeout before reaching it) used to
    // look identical to a normal, healthy entry in /status. Flag it
    // directly instead of making someone notice a suspiciously old
    // timestamp themselves.
    if (s.updatedAt) {
      const ageMin = (Date.now() - new Date(s.updatedAt).getTime()) / 60000;
      if (ageMin > 45) {
        msg += `\n⚠️ *Stale — last updated ${Math.round(ageMin / 60)}h ago* (expected every ~15min)`;
      }
    }
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
  const openPositions = loadJSON(OPEN_POSITIONS_FILE, {});
  // v10.14: this note used to say "MVS does not track live trades" — that
  // was true through v10.13 but is no longer accurate. position-tracker.js
  // now checks every open position against real candle history on every
  // scan (see its file header) — still no dedicated server, still riding
  // the existing 15-min cron, but it IS tracking now, not just alerting.
  let msg = `📌 *MVS Positions*\n_Signals fire as alerts; open positions are then tracked automatically (SL/TP1/TP2) on every scan until they close — see /status for exit details once closed._\n`;
  for (const sym of config.SYMBOLS) {
    const s = state[sym];
    const open = openPositions[sym];
    if (open) {
      msg += `\n*${sym}*: 🟢 OPEN — ${open.direction} @ $${Number(open.entryPrice).toFixed(4)} (since ${new Date(open.entryTime * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC)`;
    } else if (s && s.signal && s.signal.startsWith('CLOSED_')) {
      const rrStr = s.rr !== undefined ? `${s.rr > 0 ? '+' : ''}${s.rr}R` : '';
      msg += `\n*${sym}*: ${mdSafe(s.signal.replace('CLOSED_', ''))} ${rrStr}`.trimEnd();
    } else {
      msg += `\n*${sym}*: ${s ? mdSafe(s.signal) : 'no data'}${s && s.entryPrice ? ` @ $${Number(s.entryPrice).toFixed(2)}` : ''}`;
    }
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
`📊 *MVS — Monthly Value Sniper* (v${MVS_VERSION})

Crypto signal bot built on one tendency: *price tends to revisit where the most volume was traded.* That's a real market pattern, not a guarantee about any single trade.

*Strategy:* Volume Profile (POC + VAH + VAL) + Fibonacci (61.8–78.6% pocket) across five timeframes — 1D + 4H macro bias, 1H structure, 30m mid-rung bias, 15m trigger. Needs 3-of-5 timeframes to agree on direction before anything fires (1H still supplies the structural zone, 15m still supplies the trigger candle).

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
• *TF Vote:* which of 1D/4H/1H/30m/15m agreed, and the tally (e.g. 3/5, 4/5, 5/5)
• *Entry:* the 1H Fib/POC/VAH/VAL confluence level
• *SL:* stop loss — 1H swing wick ± 0.25×ATR
• *TP1 / TP2:* a 2-stage exit — TP1 closes ${Math.round((config.PARTIAL_EXIT_PCT||0.5)*100)}% and moves the rest to breakeven; TP2 (the value-area edge) is the runner's target for the remaining ${Math.round((1-(config.PARTIAL_EXIT_PCT||0.5))*100)}%
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
