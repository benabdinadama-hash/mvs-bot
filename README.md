# MVS — Monthly Value Sniper v7.0
## By Abdin — KuCoin Edition for Ghana
## Phone + Laptop + GitHub Actions Deployment Ready

> *"If it doesn't reject the monthly anchor, it's not a trade."*

---

## ⚠️ Important: Why KuCoin?

**Binance and Bybit do NOT work in Ghana.** KuCoin is the recommended exchange for Ghana-based traders.

This bot uses the **KuCoin Spot API** which is fully accessible from Ghana without VPN or restrictions.

---

## What's New in v7.0

| v6 | v7 |
|----|-----|
| Fixed 0.5% confluence tolerance | ATR-relative tolerance (scales with volatility) |
| Discrete 61.8% / 78.6% entry levels | 60–80% Fib pocket (entry zone, not a line) |
| All-or-nothing rejection gate | 2-of-3 pattern rule (PIN_BAR, ENGULFING, CLOSE_REJECTION) |
| Rolling 500-bar VP window | Daily-anchored POC/VAL (frozen until UTC midnight) |
| Fixed SL at 88.6%+0.2% | ATR-based SL from swing wick (0.25×ATR buffer) |
| Monolithic absorption veto | Directional absorption veto (bullish bars veto SELL only) |
| No zone expiry logic | Zone invalidation after ATR×0.5 close-through |
| No cooldown | Per-signal cooldown: 1 signal per zone per direction per 3H |
| No diagnostics | Per-bar diag.log.json for offline tuning |

---

## Table of Contents

1. [Phone Deployment (Termux)](#phone-deployment-termux)
2. [Laptop Deployment](#laptop-deployment)
3. [GitHub Actions Deployment (Recommended)](#github-actions-deployment-recommended)
4. [Telegram Bot Setup](#telegram-bot-setup)
5. [Telegram Commands](#telegram-commands)
6. [KuCoin API Details](#kucoin-api-details)
7. [What is MVS?](#what-is-mvs)
8. [Core Pillars](#core-pillars)
9. [Signal Taxonomy](#signal-taxonomy)
10. [Expected Signal Frequency](#expected-signal-frequency)
11. [Entry Logic](#entry-logic)
12. [File Structure](#file-structure)
13. [Why MVS Works](#why-mvs-works)
14. [Troubleshooting](#troubleshooting)

---

## Phone Deployment (Termux)

### Step 1: Install Termux

1. Open **Google Play Store** or **F-Droid** on your Android phone
2. Search for **"Termux"** and install it
3. Open Termux

### Step 2: Update Termux Packages

```bash
pkg update && pkg upgrade -y
```

### Step 3: Install Required Packages

```bash
pkg install nodejs git -y
```

### Step 4: Create Project Directory

```bash
mkdir mvs-bot && cd mvs-bot
```

### Step 5: Create the Files

You need to create these files: `package.json`, `config.js`, `strategy.js`, `commands.js`, `weekly-summary.js`.

#### Create package.json:

```bash
nano package.json
```

Copy and paste the contents from the `package.json` file in this package. Press `Ctrl+O` then `Enter` to save, then `Ctrl+X` to exit.

#### Create config.js:

```bash
nano config.js
```

Copy and paste the contents from the `config.js` file. **IMPORTANT:** Edit these lines:

```javascript
TELEGRAM_BOT_TOKEN: 'YOUR_BOT_TOKEN_HERE',
TELEGRAM_CHAT_ID: 'YOUR_CHAT_ID_HERE',
```

See [Telegram Bot Setup](#telegram-bot-setup) below for how to get these values.

Press `Ctrl+O` then `Enter` to save, then `Ctrl+X` to exit.

#### Create strategy.js, commands.js, weekly-summary.js:

```bash
nano strategy.js
```

Copy and paste each file's contents. Press `Ctrl+O` then `Enter` to save, then `Ctrl+X` to exit.

### Step 6: Install Dependencies

```bash
npm install
```

This will install axios, node-telegram-bot-api, and cron.

### Step 7: Run the Bot

```bash
npm start
```

You should see:
```
✅ MVS — Monthly Value Sniper v7.0 Started
   KuCoin API — Ghana-compatible
   Pillars: POC (daily-anchored) + VAL + FIBO (all 6 levels)
   Assets: BTC-USDT, SOL-USDT
   Timeframe: 1hour | VP: 500 bars | Fib: 200 bars
   Confluence: ATR-relative (0.5×ATR14)
   Rejection: 2-of-3 pattern rule
   By Abdin
```

### Step 8: Keep Bot Running (Background)

To keep the bot running when you close Termux:

```bash
npm install -g pm2
pm2 start strategy.js --name "mvs-bot"
pm2 save
pm2 startup
```

To check if it's running:
```bash
pm2 status
```

To view logs:
```bash
pm2 logs mvs-bot
```

To stop:
```bash
pm2 stop mvs-bot
```

---

## Laptop Deployment

### Windows

#### Step 1: Install Node.js

1. Go to https://nodejs.org
2. Download the **LTS** version
3. Run the installer and follow the prompts
4. Open **Command Prompt** or **PowerShell** and verify:

```cmd
node --version
npm --version
```

#### Step 2: Create Project Folder

```cmd
mkdir C:\mvs-bot
cd C:\mvs-bot
```

#### Step 3: Create the Files

Create all files in this folder: `package.json`, `config.js`, `strategy.js`, `commands.js`, `weekly-summary.js`.

**For config.js:** Edit these lines with your Telegram details:
```javascript
TELEGRAM_BOT_TOKEN: 'YOUR_BOT_TOKEN_HERE',
TELEGRAM_CHAT_ID: 'YOUR_CHAT_ID_HERE',
```

#### Step 4: Install Dependencies

```cmd
npm install
```

#### Step 5: Run the Bot

```cmd
npm start
```

#### Step 6: Keep Running (Windows)

Use **PM2**:
```cmd
npm install -g pm2
pm2 start strategy.js --name "mvs-bot"
pm2 save
pm2 startup
```

---

### Mac

#### Step 1: Install Node.js

Open Terminal and install Homebrew if you don't have it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install Node.js:

```bash
brew install node
```

Verify:
```bash
node --version
npm --version
```

#### Step 2–6: Same as Windows

Follow the same steps as Windows above, but use Terminal commands.

---

### Linux (Ubuntu/Debian)

#### Step 1: Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### Step 2–6: Same as Windows

Follow the same steps as Windows above, but use bash commands.

---

## GitHub Actions Deployment (Recommended)

GitHub Actions is the **best way to run MVS** — it's free, requires no always-on machine, and restarts automatically.

### Step 1: Create a GitHub Repository

1. Go to https://github.com and create a **new private repository** (e.g. `mvs-bot`)
2. Upload all project files to the repo

### Step 2: Add Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add these two secrets:

| Secret Name | Value |
|------------|-------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |

### Step 3: Add Workflow Files

Create the folder `.github/workflows/` in your repo and add these three files:

- `mvs-scan.yml` — runs `strategy.js` every 30 minutes
- `mvs-commands.yml` — polls Telegram for commands every 5 minutes
- `mvs-weekly.yml` — sends weekly summary every Monday at 07:00 UTC

The workflows handle all state persistence by committing `state.json`, `signals.log.json`, and `tg-offset.json` back to the repo after each run.

### Step 4: Enable Actions

Go to your repo → **Actions tab** → click **"I understand my workflows, go ahead and enable them"**

### Step 5: Trigger a Manual Run

Go to **Actions → MVS Scan → Run workflow** to test immediately.

---

## Telegram Bot Setup

### Step 1: Create a Telegram Bot

1. Open Telegram on your phone or laptop
2. Search for **"@BotFather"**
3. Start a chat and type: `/newbot`
4. Follow the prompts to name your bot (e.g. `MVS_Sniper_Bot`)
5. BotFather will give you a **token** like:
   ```
   123456789:ABCdefGHIjklMNOpqrSTUvwxyz
   ```
6. Paste this into `config.js` as `TELEGRAM_BOT_TOKEN`

### Step 2: Get Your Chat ID

1. Search for **"@userinfobot"** in Telegram
2. Start the bot — it will reply with your **Chat ID** (a number like `123456789`)
3. Paste this into `config.js` as `TELEGRAM_CHAT_ID`

Alternatively:
1. Send a message to your new bot
2. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Look for `"chat":{"id":123456789` — that number is your Chat ID

### Step 3: Test the Bot

After starting the bot, send `/start` to your bot in Telegram. You should receive the help menu.

---

## Telegram Commands

MVS responds to the following commands sent directly to your Telegram bot.

> **Note:** Because the bot runs on GitHub Actions (not as a live process), commands are polled every 5 minutes. Expect up to a 5-minute delay between sending a command and receiving a reply.

| Command | Description |
|---------|-------------|
| `/scan` | Run a fresh scan immediately and return zone + bias per symbol |
| `/status` | Show the last saved scan result (no new scan triggered) |
| `/health` | Check KuCoin API connectivity and last successful run time |
| `/positions` | Show last active signal per symbol (MVS is signal-only — no live trades) |
| `/help` | List all commands |

---

## KuCoin API Details

| Parameter | Value |
|-----------|-------|
| **Base URL** | `https://api.kucoin.com/api/v1` |
| **Endpoint** | `GET /market/candles` |
| **Symbol Format** | `BTC-USDT`, `SOL-USDT` (hyphen-separated) |
| **Timeframe** | `1hour` (KuCoin format) |
| **Response** | `[time, open, close, high, low, volume, turnover]` |
| **Max Records** | 1500 per request (covers our 500-bar need easily) |
| **Rate Limit** | 2000 requests per 30 seconds (MVS uses ~2 per scan) |

**No API key required** for public market data. The bot only reads candlestick data — it does not place any trades.

---

## What is MVS?

The **Monthly Value Sniper (MVS)** is an institutional-grade trading strategy built on one principle: **price always reverts to where the most volume was traded.**

By combining three pure, mathematical pillars — **POC** (Point of Control), **VAL** (Value Area Low), and **Fibonacci** (all 6 levels) — MVS identifies high-probability reversal zones on the 1-hour timeframe with zero subjectivity.

No OB. No VWAP. No LVN. No VAH. No multi-timeframe confusion. Just math + volume.

---

## Core Pillars

| Pillar | Symbol | Role |
|--------|--------|------|
| **POC** | Point of Control | Daily volume magnet — price is drawn here |
| **VAL** | Value Area Low (70%) | Institutional defender line — limit orders stack here |
| **FIBO** | Fibonacci Retracement | Mathematical gravity well — 60–80% pocket guides price |

---

## Why 1H Only + 500-Bar VP?

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Timeframe** | 1H ONLY | Eliminates multi-TF repaint lag. Matches HFT hourly rebalancing cycles. |
| **VP Anchor** | Daily UTC | POC/VAL frozen per day — no drift between scans. Resets at 00:00 UTC. |
| **VP Lookback** | 500 bars | ~21 days of data. Captures genuine institutional footprint without stale volume. |
| **Fib Lookback** | 200 bars | ~8+ days of swing structure. Enough to define meaningful highs/lows. |
| **Scan Frequency** | 30 minutes | Catches hourly structure shifts without over-trading. |

---

## Fibonacci Roles (The 6 Levels)

| Level | Role | Action |
|-------|------|--------|
| 23.6% | Momentum Gauge | Trend strength only — ignore for entries |
| 38.2% | Momentum Gauge | Trend strength only — ignore for entries |
| **50.0%** | **PRIMARY TP1** | **50% position close — rubber band snap-back to fair value** |
| **61.8%** | **ENTRY ZONE start** | **Must overlap with POC or VAL within ATR×0.5** |
| **78.6%** | **ENTRY ZONE end** | **Must overlap with POC or VAL within ATR×0.5** |
| **88.6%** | **SL ANCHOR** | **Structural invalidation — swing wick + 0.25×ATR buffer** |

> **v7 change:** Entry zone is treated as a **60–80% pocket** (a price range), not two discrete lines. This catches setups that print between 61.8% and 78.6% without requiring an exact hit.

---

## Signal Taxonomy (All Possible States)

### A — Structural / Setup (No Trade Yet)

| Signal | Condition | Action |
|--------|-----------|--------|
| **A1** Golden Zone | Fib 60–80% pocket overlaps POC or VAL within ATR×0.5 | Set price alert. Do NOT enter. |
| **A2** Structural Remap | Price breaks the 200-bar swing high/low | All previous zones VOID. Wait for recalculation. |
| **A3** Zone Expiry | No Fib/POC/VAL confluence found | Silent reset. Wait for next scan. |

### B — Entry Signals (Trade Triggered)

| Signal | Condition | Action |
|--------|-----------|--------|
| **B1** Bullish Sniper | A1 confluence + 2-of-3 rejection patterns + BUY bias | Enter LONG at next candle open. Risk 1%. |
| **B2** Bearish Sniper | A1 confluence + 2-of-3 rejection patterns + SELL bias | Enter SHORT at next candle open. Risk 1%. |

### C — Active Trade Management (Post-Entry)

| Signal | Condition | Action |
|--------|-----------|--------|
| **C1** TP1 Hit | Price reaches 50% Fib | Close 50% of position. Move runner SL to entry. |
| **C2** TP2 Hit | Price reaches POC | Close runner (remaining 50%). Full exit. |
| **C3** SL Hit | Price breaches swing wick + 0.25×ATR | Accept loss. Wait for A2 remap. |
| **C4** Breakeven | Price +0.5% in your favor after entry | Move SL to entry manually. |
| **C5** Partial Sweep | Wick into SL buffer, immediate reversal | HOLD. This is a liquidity hunt. |

### D — Invalidation / Skip (Do NOT Trade)

| Signal | Condition | Action |
|--------|-----------|--------|
| **D1** Absorption | Zone touched, but high-volume directional candle opposes entry | SKIP. Telegram alert sent. Institutions absorbing against you. |
| **D2** Sharp Breakout | Price slices through zone without pausing | Do NOT fade. Trend continuation. |
| **D3** Shallow Retrace | Rejects at 23.6/38.2 before reaching 60–80% pocket | Ignore. Trend too strong. |
| **D4** Over-Extended | Price already beyond 88.6% Fib | Skip. Swing invalidated before scan. |

---

## Rejection Patterns (2-of-3 Rule)

A B-signal fires only if **at least 2 of these 3 patterns** appear on the last closed candle touching the zone:

| Pattern | Bullish (BUY) | Bearish (SELL) |
|---------|--------------|----------------|
| **PIN_BAR** | Lower wick > 1.5× body | Upper wick > 1.5× body |
| **ENGULFING** | Bullish candle fully engulfs prior bar | Bearish candle fully engulfs prior bar |
| **CLOSE_REJECTION** | Candle wicked into zone, closed above it | Candle wicked into zone, closed below it |

**Absorption Veto (overrides all):** If a high-volume candle (body > 60% of range) closes strongly in the opposite direction, the signal is suppressed even if 2-of-3 patterns fire.

---

## Expected Signal Frequency (Weekly)

| Signal Type | BTC-USDT | SOL-USDT | Total |
|-------------|----------|----------|-------|
| A1 Golden Zone Alerts | ~5–7 | ~5–7 | 10–14 |
| B1/B2 Sniper Entries | 2–3 | 2–3 | 4–6 |
| C1 TP1 Hits | ~1–2 | ~1–2 | 2–4 |
| C3 SL Hits | ~0–1 | ~0–1 | 0–2 |

---

## Entry Logic (Step-by-Step)

```
STEP 1:  Fetch 500 bars of 1H data from KuCoin
STEP 2:  Calculate ATR(14) — used for all tolerances and SL sizing
STEP 3:  Calculate 200-bar Fibonacci swing (high → low)
         → If price has broken the 200-bar swing: fire A2 Remap alert and stop
STEP 4:  Determine direction: BUY if price > swing midpoint, SELL if below
STEP 5:  Check D4: if price is already beyond 88.6%, skip (over-extended)
STEP 6:  Calculate daily-anchored Volume Profile → POC & VAL
STEP 7:  Confluence Check — does the 60–80% Fib pocket overlap POC or VAL?
         Score >= 1 (within ATR×0.5) → A1 Golden Zone. Proceed.
         Score = 0 → A3 Zone Expiry. Silent stop.
STEP 8:  Zone Invalidation — did price close THROUGH the zone by > ATR×0.5?
         YES → discard zone. Stop.
STEP 9:  Signal Cooldown — was a signal fired for this direction in last 3H?
         YES → suppress. Stop.
STEP 10: Rejection Detection — check last closed candle for 2-of-3 patterns
         Absorption Veto active? → D1 alert sent. Stop.
         Score >= 2 patterns → Proceed to Step 11.
         Score < 2 → Wait. No signal yet.
STEP 11: Calculate SL / TP
         Entry:  Best Fib/POC/VAL confluence level
         SL:     Swing wick ± 0.25 × ATR
         TP1:    50.0% Fib level (close 50% of position)
         TP2:    POC level (close runner)
STEP 12: Fire B1 (Bullish) or B2 (Bearish) alert to Telegram
         Save state.json + signals.log.json
```

---

## File Structure

```
mvs-bot/
├── package.json            # Node.js dependencies
├── config.js               # All settings (tokens, symbols, parameters)
├── strategy.js             # MVS v7.0 engine — scans, calculates, alerts
├── commands.js             # Telegram command handler (/scan /status /health etc.)
├── weekly-summary.js       # Weekly digest — reads signals.log.json, sends to Telegram
├── README.md               # This file
│
├── .github/
│   └── workflows/
│       ├── mvs-scan.yml        # Runs strategy.js every 30 minutes
│       ├── mvs-commands.yml    # Polls Telegram for commands every 5 minutes
│       └── mvs-weekly.yml      # Sends weekly summary every Monday 07:00 UTC
│
└── (auto-generated at runtime)
    ├── state.json          # Last scan result per symbol + signal cooldown state
    ├── signals.log.json    # Rolling log of last 500 signals (used by weekly summary)
    ├── diag.log.json       # Per-bar diagnostic log for offline tuning (last 2000 bars)
    └── tg-offset.json      # Telegram update offset (prevents duplicate command processing)
```

---

## Why MVS Works

1. **Daily-Anchored POC** — POC/VAL freezes at UTC midnight and doesn't drift between scans. Zones are stable reference points, not moving targets.
2. **ATR-Relative Confluence** — Tolerance scales with current volatility. BTC wide-ranging days get a wider band; tight consolidation days get tighter. No hard-coded percentages that go stale.
3. **60–80% Fib Pocket** — Treats the entry zone as a price range, not two lines. This correctly models the institutional absorption zone between 61.8% and 78.6%.
4. **2-of-3 Rejection Rule** — Requires confirmation, but not perfection. Real rejections often show 2 of the 3 patterns. All-or-nothing gates miss valid setups; 1-of-3 gates produce noise.
5. **Directional Absorption Veto** — A high-volume bullish candle suppresses SELL signals only (and vice versa). This correctly identifies when institutions are absorbing in the direction of the trend rather than reversing.
6. **50% TP = Mean Reversion** — Price snapping back to the midpoint of the swing is statistically near-inevitable after a validated confluence rejection. This is the "rubber band" effect.
7. **1H Only** — No multi-timeframe lag. No conflicting narratives. Every signal is generated from the same candle close.
8. **KuCoin for Ghana** — Binance and Bybit are restricted in Ghana. KuCoin Spot API is fully accessible without VPN.

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| No signals after several days | Confluence never firing | Check `diag.log.json` — look at `A1_pass` field. If always `false`, widen `CONFLUENCE_ATR_MULT` in config.js (try `0.75`) |
| Too many signals (noise) | Confluence too wide | Lower `CONFLUENCE_ATR_MULT` (try `0.35`) |
| Bot not responding to Telegram commands | `mvs-commands.yml` not running | Check Actions tab in GitHub — ensure the workflow is enabled and not failing |
| `/health` shows "never" | `state.json` not committed | Check the commit step in `mvs-scan.yml` — ensure `contents: write` permission is set |
| KuCoin returns empty data | Temporary API issue | Wait 5 minutes and re-run. KuCoin public API has occasional timeouts. |

---

## License

MIT — By Abdin. Institutional grade, zero subjectivity.
