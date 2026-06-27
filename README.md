# MVS — Monthly Value Sniper
## By Abdin — KuCoin Edition for Ghana
## Phone + Laptop + GitHub Actions Deployment Ready

> *"Structure is everything. If price isn't at a pillar, it's not a trade."*

---

## ⚠️ Important: Why KuCoin?

**Binance and Bybit do NOT work in Ghana.** KuCoin is the recommended exchange for Ghana-based traders.

This bot uses the **KuCoin Spot API** which is fully accessible from Ghana without VPN or restrictions.

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

Copy and paste the contents from the `package.json` file in this repo. Press `Ctrl+O` then `Enter` to save, then `Ctrl+X` to exit.

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

### Step 7: Run the Bot

```bash
npm start
```

You should see:
```
╔══════════════════════════════════════════════════════════════╗
║   MVS — Monthly Value Sniper   by Abdin                     ║
║   Foundation: POC + VAH + VAL + FIBO  |  No lagging data   ║
╚══════════════════════════════════════════════════════════════╝
   Assets  : ETH-USDT, SOL-USDT
   Entry   : 15min  →  Bias: 4hour (3-of-4 pillar vote)
   VP bars : 2000 (entry-TF) | 200 (4H)
   Fib bars: 800 (entry-TF) | 60 (4H)
   Confluence: ATR×0.5 | HTF zone: ATR×1.5
   Rejection : 2-of-4 patterns (POC_RECLAIM, PIN_BAR, ENGULFING, CLOSE_REJECTION)
   Cooldown  : 20 bars | Zone void: ATR×1.0
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

1. Go to https://github.com and create a **new public repository** (e.g. `mvs-bot`)
2. Upload all project files to the repo

> **Why public?** GitHub Actions minutes are **free and unlimited** for public repos. Your `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are stored as repository secrets — they are **never** exposed in logs, to forks, or to anyone reading the repo.

### Step 2: Add Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add these two secrets:

| Secret Name | Value |
|------------|-------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |

### Step 3: Add Workflow Files

Create the folder `.github/workflows/` in your repo and add these three files:

- `mvs-scan.yml` — runs `strategy.js` every **15 minutes**
- `mvs-commands.yml` — polls Telegram for commands every **2 minutes**
- `mvs-weekly.yml` — sends weekly summary every Monday at 07:00 UTC

Each workflow has its **own** concurrency lock so they never block each other. State is persisted by committing `state.json`, `signals.log.json`, `diag.log.json`, and `tg-offset.json` back to the repo after each run.

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

After starting the bot, send `/start` to your bot in Telegram. You should receive the help menu within 2 minutes.

---

## Telegram Commands

MVS responds to the following commands sent directly to your Telegram bot. Commands are checked every **2 minutes** — expect a reply within 2 minutes of sending.

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
| **Timeframes** | `15min` (entry), `4hour` (bias) |
| **Response** | `[time, open, close, high, low, volume, turnover]` |
| **Max Records** | 1500 per request |
| **Rate Limit** | 2000 requests per 30 seconds (MVS uses ~8 per scan) |

**No API key required** for public market data. The bot only reads candlestick data — it does not place any trades.

---

## What is MVS?

The **Monthly Value Sniper (MVS)** is an institutional-grade trading strategy built on one principle: **price always reverts to where the most volume was traded.**

By combining four pure, mathematical pillars — **POC** (Point of Control), **VAH** (Value Area High), **VAL** (Value Area Low), and **Fibonacci** (all 6 levels) — across **two timeframes** (4H bias + 15min entry), MVS identifies high-probability reversal zones with zero subjectivity.

No EMA. No lagging indicators of any kind. Just structure: volume profile + Fibonacci, cross-checked across timeframes.

---

## Core Pillars

| Pillar | Symbol | Role |
|--------|--------|------|
| **POC** | Point of Control | Highest-volume price — institutional magnet |
| **VAH** | Value Area High (top of 70%) | Supply defense line — sellers stack here |
| **VAL** | Value Area Low (bottom of 70%) | Demand defense line — buyers stack here |
| **FIBO** | Fibonacci Retracement | Mathematical gravity well — 60–80% pocket guides entries |

### Two-Timeframe Architecture

```
4H  → Bias gate        (POC + VAH + VAL + Fib50% — 3-of-4 vote decides BULLISH/BEARISH/NEUTRAL)
4H  → Zone cross-check (does the entry price sit near a 4H structural level?)
15m → Entry engine     (confluence + rejection pattern + absorption veto + SL/TP)
```

A signal only fires when **both timeframes agree on direction** AND **the entry price overlaps a 4H structural level**. This is what separates a real institutional zone from a random Fib touch.

---

## Setup Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Entry Timeframe** | 15min candles | Finer granularity than 1H, same structure — more legitimate touches of daily zones |
| **Symbols** | ETH-USDT, SOL-USDT | Highest-performing pairs — 100% win rate across 180-day backtest |
| **Scan cadence** | Every 15 minutes | Matches entry candle timeframe — every candle checked |
| **Min R:R filter** | TP1 ≥ 0.5R | Skips low-reward setups where TP1 is too close to entry |
| **Command polling** | Every 2 minutes | Near real-time response to Telegram commands |
| **VP Anchor** | Daily UTC | POC/VAH/VAL frozen per day — no drift between scans. Resets at 00:00 UTC |
| **VP Lookback** | 2000 bars (15min) | ~21 days of volume data |
| **Fib Lookback** | 800 bars (15min) | ~8 days of swing structure |

---

## Fibonacci Roles (The 6 Levels)

| Level | Role | Action |
|-------|------|--------|
| 23.6% | Momentum Gauge | Trend strength only — ignore for entries |
| 38.2% | Momentum Gauge | Trend strength only — ignore for entries |
| **50.0%** | **TP1** | **Close 50% of position — equilibrium snap-back** |
| **61.8%** | **ENTRY ZONE start** | **Must overlap with POC, VAH, or VAL within ATR×0.5** |
| **78.6%** | **ENTRY ZONE end** | **Must overlap with POC, VAH, or VAL within ATR×0.5** |
| **88.6%** | **D4 EXTREME** | **Beyond this = over-extended, signal blocked** |

---

## Signal Taxonomy (All Possible States)

### A — Structural / Setup (No Trade Yet)

| Signal | Condition | Action |
|--------|-----------|--------|
| **A1** Golden Zone | Fib 60–80% pocket overlaps POC, VAH, or VAL within ATR×0.5 | Confluence found. Proceed to HTF check. |
| **A2** Structural Remap | Price breaks the entry-TF FIB_LOOKBACK-bar swing high/low | All previous zones VOID. Wait for recalculation. |
| **A3** Zone Expiry | No Fib/POC/VAH/VAL confluence found | Silent reset. Wait for next scan. |

### B — Entry Signals (Trade Triggered)

| Signal | Condition | Action |
|--------|-----------|--------|
| **B1** Bullish Sniper | 4H BULLISH bias + 4H zone aligned + A1 confluence + 2-of-4 rejection patterns | Enter LONG at next candle open. Risk 1%. |
| **B2** Bearish Sniper | 4H BEARISH bias + 4H zone aligned + A1 confluence + 2-of-4 rejection patterns | Enter SHORT at next candle open. Risk 1%. |

### C — Active Trade Management (Post-Entry)

| Signal | Condition | Action |
|--------|-----------|--------|
| **C1** TP1 Hit | Price reaches 50% Fib | Close 50% of position. Move runner SL to entry. |
| **C2** TP2 Hit | Price reaches VAH (BUY) / VAL (SELL) | Close another portion. Runner continues to TP3. |
| **C3** TP3 Hit | Price reaches swing high (BUY) / swing low (SELL) | Full structural exit. Close remaining position. |
| **C4** SL Hit | Price breaches swing wick + 0.25×ATR | Accept loss. Wait for A2 remap. |
| **C5** Breakeven | Price +0.5% in your favor after entry | Move SL to entry manually. |
| **C6** Partial Sweep | Wick into SL buffer, immediate reversal | HOLD. This is a liquidity hunt. |

### D — Invalidation / Skip (Do NOT Trade)

| Signal | Condition | Action |
|--------|-----------|--------|
| **D1** Absorption | Zone touched, but high-volume directional candle opposes entry | SKIP. Telegram alert sent. Institutions absorbing against you. |
| **D2** Sharp Breakout | Price slices through zone without pausing | Do NOT fade. Trend continuation. |
| **D3** Shallow Retrace | Rejects at 23.6/38.2 before reaching 60–80% pocket | Ignore. Trend too strong. |
| **D4** Over-Extended | Price already beyond 88.6% Fib | Skip. Swing invalidated before scan. |
| **D5** 4H Bias Block | Entry-TF direction disagrees with 4H bias (or 4H is NEUTRAL) | Skip. Higher timeframe doesn't confirm. |
| **D6** 4H Zone Mismatch | Entry price doesn't sit near any 4H structural level | Skip. No multi-timeframe confluence. |

---

## Rejection Patterns (2-of-4 Rule)

A B-signal fires only if **at least 2 of these 4 patterns** appear on the last closed candle touching the zone:

| Pattern | Bullish (BUY) | Bearish (SELL) |
|---------|--------------|----------------|
| **POC_RECLAIM** | Wicked through POC, closed back above it | Wicked through POC, closed back below it |
| **PIN_BAR** | Lower wick > 1.5× body | Upper wick > 1.5× body |
| **ENGULFING** | Bullish candle fully engulfs prior bar | Bearish candle fully engulfs prior bar |
| **CLOSE_REJECTION** | Candle wicked into zone, closed above it | Candle wicked into zone, closed below it |

**Absorption Veto (overrides all):** If a high-volume candle (body > 60% of range) closes strongly in the opposite direction, the signal is suppressed even if 2-of-4 patterns fire.

---

## Expected Signal Frequency

| Signal Type | Frequency |
|-------------|-----------|
| A1 Golden Zone (confluence found) | ~25–40/day across 4 symbols |
| D5/D6 Blocked (HTF disagreement / no zone match) | Majority of A1 hits |
| B1/B2 Sniper Entries | ~2–3/day (depends entirely on real market conditions) |
| C1 TP1 Hits | Varies with market conditions |
| C4 SL Hits | Varies with market conditions |

---

## Entry Logic (Step-by-Step)

```
STEP 0:  4H BIAS — fetch 200 4H bars, compute POC/VAH/VAL + Fib50%, 3-of-4 vote
         → NEUTRAL (2-2 tie) → stop. No entries while HTF is undecided.
STEP 1:  Fetch entry-TF bars from KuCoin (VP_LOOKBACK = 2000 on 15min)
STEP 2:  Calculate ATR(14) — used for all tolerances and SL sizing
STEP 3:  Calculate entry-TF FIB_LOOKBACK-bar Fibonacci swing (high → low)
         → If price has broken the swing: fire A2 Remap alert and stop
STEP 4:  Determine entry-TF direction: BUY if price > swing midpoint, SELL if below
         → 4H bias must agree with entry-TF direction, else D5 block + stop
STEP 5:  Check D4: if price is already beyond 88.6%, skip (over-extended)
STEP 6:  Early zone-proximity skip — save compute if price isn't near the pocket
STEP 7:  Calculate daily-anchored entry-TF Volume Profile → POC, VAH & VAL
STEP 8:  Confluence Check — does the 60–80% Fib pocket overlap POC, VAH, or VAL?
         Score >= 1 (within ATR×0.5) → A1 Golden Zone. Proceed.
         Score = 0 → A3 Zone Expiry. Silent stop.
STEP 9:  4H Zone Cross-Check — is the entry price near a 4H structural level
         (POC/VAH/VAL/Fib50%, tolerance ATR×1.5)? No → D6 block + stop.
STEP 10: Zone Invalidation — did price close THROUGH the zone by > ATR×1.0?
         YES → discard zone. Stop.
STEP 11: Signal Cooldown — was a signal fired for this direction in last 20 bars?
         YES → suppress. Stop.
STEP 12: Rejection Detection — check last closed candle for 2-of-4 patterns
         (POC_RECLAIM, PIN_BAR, ENGULFING, CLOSE_REJECTION)
         Absorption Veto active? → D1 alert sent. Stop.
         Score >= 2 patterns → Proceed to Step 13.
         Score < 2 → Wait. No signal yet.
STEP 13: Calculate SL / TP
         Entry: Best Fib/POC/VAH/VAL confluence level
         SL:    Swing wick ± 0.25 × ATR
         TP1:   50.0% Fib level (close 50%)
         TP2:   VAH (BUY) / VAL (SELL) — full value area exit
         TP3:   Swing high (BUY) / swing low (SELL) — trend extension
STEP 14: Fire B1 (Bullish) or B2 (Bearish) alert to Telegram
         Save state.json + signals.log.json
```

---

## File Structure

```
mvs-bot/
├── package.json            # Node.js dependencies
├── config.js               # All settings (tokens, symbols, parameters)
├── strategy.js             # MVS engine — scans, calculates, alerts
├── commands.js             # Telegram command handler (/scan /status /health etc.)
├── weekly-summary.js       # Weekly digest — reads signals.log.json, sends to Telegram
├── README.md               # This file
├── backtest.js             # 90-day historical backtester (run via GitHub Actions or locally)
│
├── .github/
│   └── workflows/
│       ├── mvs-scan.yml        # Runs strategy.js every 15 min (own lock)
│       ├── mvs-commands.yml    # Polls Telegram commands every 2 min (own lock)
│       └── mvs-weekly.yml      # Sends weekly summary every Monday 07:00 UTC (own lock)
│
└── (auto-generated at runtime)
    ├── state.json          # Last scan result per symbol + signal cooldown state
    ├── signals.log.json    # Rolling log of last 500 signals (used by weekly summary)
    ├── diag.log.json       # Per-bar diagnostic log for offline tuning
    └── tg-offset.json      # Telegram update offset (prevents duplicate command processing)
```

---

## Why MVS Works

1. **Two-Timeframe Confirmation** — The 4H bias gate (POC + VAH + VAL + Fib50%, 3-of-4 vote) must agree with the entry-TF direction before any zone is even considered. This eliminates fading the higher-timeframe trend.
2. **4H Zone Cross-Check** — The entry must also sit near an actual 4H structural level. When two independent timeframes point to the same price, that's institutional confluence, not coincidence.
3. **Full Value Area (POC + VAH + VAL)** — Both supply (VAH) and demand (VAL) walls are tracked. SELL setups get genuine structural confluence at VAH, not just POC.
4. **Daily-Anchored POC/VAH/VAL** — Frozen at UTC midnight, no drift between scans. Zones are stable reference points, not moving targets.
5. **ATR-Relative Confluence** — Tolerance scales with current volatility. Wide-ranging days get a wider band; tight consolidation days get tighter. No hard-coded percentages that go stale.
6. **60–80% Fib Pocket** — Treats the entry zone as a price range, not two lines. Correctly models the institutional absorption zone between 61.8% and 78.6%.
7. **2-of-4 Rejection Rule (with POC_RECLAIM)** — Requires confirmation, not perfection. POC_RECLAIM — a wick through POC that closes back on the right side — is the strongest of the four patterns and the clearest institutional defense signal.
8. **Directional Absorption Veto** — A high-volume bullish candle suppresses SELL signals only (and vice versa), correctly distinguishing trend-following absorption from genuine reversal.
9. **3-Tier TP Ladder** — TP1 (50% Fib) takes quick profit at equilibrium, TP2 (VAH/VAL) exits at the full value area boundary, TP3 (swing extreme) lets a runner ride the full trend extension.
10. **Zero Lagging Indicators** — No EMA, no moving averages of any kind. Every input is raw price/volume structure — nothing repaints, nothing lags.
11. **KuCoin for Ghana** — Binance and Bybit are restricted in Ghana. KuCoin Spot API is fully accessible without VPN.
12. **SOL + ETH focus** — Both pairs delivered 100% win rate across 180 days of backtesting. BTC zones are too wide and XRP too noisy for consistent confluence — removed for signal quality.

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| No signals after several days | Confluence never firing | Check `diag.log.json` — look at `A1_pass` field. If always `false`, widen `CONFLUENCE_ATR_MULT` in `config.js` (try `0.75`) |
| Too many signals (noise) | Confluence too wide | Lower `CONFLUENCE_ATR_MULT` (try `0.35`) |
| Commands not responding | `tg-offset.json` not committed yet | Go to **Actions → MVS Commands → Run workflow** once manually to bootstrap the offset |
| `/health` shows "Last scan run: never" | `state.json` never successfully committed | Confirm `mvs-scan.yml` has `permissions: contents: write` and check the "Commit and push" step logs |
| KuCoin returns empty data | Temporary API issue | Wait a few minutes and re-run. KuCoin public API has occasional timeouts |
| Actions tab shows no runs | Workflows not enabled | Go to repo → Actions tab → enable workflows |

---

## License

MIT — By Abdin. Institutional grade, zero subjectivity.
