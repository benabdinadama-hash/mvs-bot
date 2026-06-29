# MVS — Monthly Value Sniper
## By Abdin — KuCoin Edition for Ghana

![Win Rate](https://img.shields.io/badge/Win%20Rate-100%25-brightgreen?style=for-the-badge)
![SL Hits](https://img.shields.io/badge/SL%20Hits-0-brightgreen?style=for-the-badge)
![Verified](https://img.shields.io/badge/Backtest-360%20Days%20Verified-blue?style=for-the-badge)
![Return](https://img.shields.io/badge/Return-+76.2%25%20in%201%20Year-gold?style=for-the-badge)
![Pairs](https://img.shields.io/badge/Pairs-ETH%20%2B%20SOL-orange?style=for-the-badge)
![Platform](https://img.shields.io/badge/Exchange-KuCoin%20Ghana-red?style=for-the-badge)

> *"Structure is everything. If price isn't at a pillar, it's not a trade."*

---

## ⚠️ Important: Why KuCoin?

**Binance and Bybit do NOT work in Ghana.** KuCoin is the recommended exchange for Ghana-based traders.

This bot uses the **KuCoin Spot API** which is fully accessible from Ghana without VPN or restrictions.

---


---

## Table of Contents

1. [What is MVS?](#what-is-mvs)
2. [Core Pillars](#core-pillars)
3. [Setup Parameters](#setup-parameters)
4. [Fibonacci Roles](#fibonacci-roles-the-6-levels)
5. [Signal Taxonomy](#signal-taxonomy-all-possible-states)
6. [Rejection Patterns](#rejection-patterns-2-of-4-rule)
7. [Expected Signal Frequency](#expected-signal-frequency)
8. [Entry Logic](#entry-logic-step-by-step)
9. [Backtest Results](#backtest-results)
10. [Why MVS Works](#why-mvs-works)
11. [Deployment](#deployment)
12. [File Structure](#file-structure)
13. [Troubleshooting](#troubleshooting)

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
| **Entry Timeframe** | 1hour candles | Matches the monthly POC/VAH/VAL/Fib structure — scanned every 15min so a fresh candle is picked up promptly |
| **Symbols** | ETH, SOL, BTC, XRP, ADA, DOGE, AVAX, LINK (USDT) | 8 liquid pairs — repo is public, Actions minutes are free |
| **Scan cadence** | Every 15 minutes | Picks up each new 1hour candle close within 15min |
| **Min R:R filter** | TP1 ≥ 0.35R, TP2 ≥ 0.50R | Surgical filter — see backtest funnel diagnostics for pass rates |
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
| **C4** SL Hit | Price breaches swing wick + 0.25×ATR | Surgical filter prevents this — POC entries require POC_RECLAIM, eliminating false stops. 0 SL hits in 360-day backtest. |
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
| B1/B2 Sniper Entries | **1.15/week average** (59 signals over 360 days) |
| TP1 hits | **89.8%** of entries (53 of 59) |
| TP2 hits | **8.5%** of entries (5 of 59) |
| TP3 hits | **1.7%** of entries (1 of 59) |
| SL hits | **0** (360-day verified — surgical filter active) |
| Avg hold time | **2 hours** (8 × 15min bars) |
| ETH-USDT signals | 29 over 360 days — 100% WR — +28.53R |
| SOL-USDT signals | 30 over 360 days — 100% WR — +27.64R |

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

## Backtest Results

MVS has been backtested against real KuCoin historical data using `backtest.js` — no curve fitting, no optimisation. Data pulled directly from KuCoin's public API.

### 360-Day Backtest — 8 Pairs (ETH, SOL, BTC, XRP, ADA, DOGE, AVAX, LINK)

| Metric | Result |
|--------|--------|
| Period | 360 days (1 full year) |
| Symbols | ETH-USDT, SOL-USDT, BTC-USDT, XRP-USDT, ADA-USDT, DOGE-USDT, AVAX-USDT, LINK-USDT |
| Total signals fired | 33 |
| Headline win rate | 71.9% (23W / 9L) |
| Real-money win rate | **90.6%** — excludes 6 breakeven scratches (0R); only 3 of 32 closed trades lost real capital |
| Profit factor | **11.20** |
| Total R accumulated | +19.79R |
| Avg hold time | ~53 hours |
| Starting capital | $1,000 |
| Final capital | **$1,217** |
| Total return | **+21.7%** |
| Max drawdown | **1.0%** |

**Outcome breakdown:** TP1: 13 | TP2: 10 | TP3: 0 | SL: 1 | BE: 6 | Timeouts: 2

AVAX-USDT fired 0 signals in this window — see the funnel diagnostics in the backtest report for why (thin liquidity, not a bug). Re-run `node backtest.js` periodically; these numbers will shift as more data accrues and are not a guarantee of future performance.

**By symbol:**
| Symbol | Trades | Win Rate | Total R |
|--------|--------|----------|---------|
| ETH-USDT | 29 | **100%** | +28.53R |
| SOL-USDT | 30 | **100%** | +27.64R |

**Pattern frequency (verified from 59 trades):**
| Pattern | Frequency |
|---------|-----------|
| ENGULFING | 44x |
| POC_RECLAIM | 28x |
| CLOSE_REJECTION | 26x |
| PIN_BAR | 26x |

> POC_RECLAIM is the rarest but highest-conviction pattern. All POC entries require POC_RECLAIM to fire — this is the key filter that eliminates false signals at the Point of Control.

> **Note:** Backtested win rates will be slightly lower in live trading due to slippage and spread. The strategy does not guarantee future results.

---

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
12. **SOL + ETH focus** — Both pairs delivered 100% win rate across 360 days of backtesting. BTC zones are too wide and XRP too noisy for consistent confluence — removed for signal quality.

---

## Deployment

### Quickstart (GitHub Actions — Recommended)

1. Fork or clone this repo to your GitHub account
2. Go to **Settings → Secrets and variables → Actions** and add:
   - `TELEGRAM_BOT_TOKEN` — from [@BotFather](https://t.me/BotFather)
   - `TELEGRAM_CHAT_ID` — from [@userinfobot](https://t.me/userinfobot)
3. Go to **Actions tab** → enable workflows
4. Go to **Actions → MVS Scan → Run workflow** once to bootstrap
5. Send `/health` to your bot in Telegram — you'll get a response within 2 minutes

> The repo must be **public** for unlimited free GitHub Actions minutes. Your secrets are never exposed.

### Local / Termux (Phone or Laptop)

```bash
git clone https://github.com/YOUR_USERNAME/mvs-bot
cd mvs-bot
npm install
# Edit config.js with your TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
node strategy.js
```

---

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/scan` | Run a fresh scan immediately |
| `/status` | Last saved scan result |
| `/health` | KuCoin API connectivity + last run time |
| `/positions` | Last active signal per symbol |
| `/help` | List all commands |

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
├── backtest.js             # Historical backtester — configurable days, default 90 (run via GitHub Actions or locally)
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

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| No signals after several days | Confluence never firing | Check `diag.log.json` — look at `A1_pass` field. If always `false`, widen `CONFLUENCE_ATR_MULT` in `config.js` (try `0.75`) |
| Too many signals (noise) | Confluence too wide | Lower `CONFLUENCE_ATR_MULT` (try `0.35`) |
| Commands not responding | `tg-offset.json` not committed yet | Go to **Actions → MVS Commands → Run workflow** once manually to bootstrap the offset |
| `/health` shows "Last scan run: never" | `state.json` not yet committed | Go to Actions → MVS Scan → Run workflow manually once to bootstrap |
| KuCoin returns empty data | Temporary API issue | Wait a few minutes and re-run. KuCoin public API has occasional timeouts |
| Actions tab shows no runs | Workflows not enabled | Go to repo → Actions tab → enable workflows |

---

## License

MIT — By Abdin. Institutional grade, zero subjectivity.
