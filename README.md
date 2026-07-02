# MVS — Monthly Value Sniper
## By Abdin — KuCoin Edition for Ghana

![Pairs](https://img.shields.io/badge/Pairs-13%20Liquid%20Pairs-orange?style=for-the-badge)
![Platform](https://img.shields.io/badge/Exchange-KuCoin%20Ghana-red?style=for-the-badge)
![Version](https://img.shields.io/badge/Version-v10.0-purple?style=for-the-badge)

> *"Structure is everything. If price isn't at a pillar, it's not a trade."*

---

## ⚠️ On win rate — read this before you trust any number in this repo

Earlier versions of this README displayed a "90.7% real-money win rate"
badge. It's been removed deliberately. That number came from tuning several
filter knobs (per-symbol RR floors, a direction-restricted solo-trigger
rule, an asymmetric HTF tolerance boost) against the *same* 85-trade
backtest they were then used to evaluate — which inflates a backtest's own
score without telling you anything reliable about future trades. That's
overfitting, and a README badge presenting it as a verified live statistic
was misleading.

**No trading system, including this one, can predict or guarantee a
near-100% win rate.** Every backtest number in this repo (win rate, profit
factor, R:R) describes how the rules behaved on *past* data already used to
build the rules — it is not a promise about the *next* trade. Treat every
signal this bot sends as a probability-favored setup with a defined
stop-loss, not a certainty. Size positions so that 3-4 consecutive losses —
normal, expected variance even in a genuinely good system — don't
meaningfully damage your account. Never risk money you can't afford to lose
on a single position, no matter how confident the alert message sounds.

If you want to know how the current build actually performs, run
`node backtest.js` yourself on a lookback window and read the whole report
— including the funnel diagnostics and the "no-real-loss rate" caveat in
the summary — not just the win-rate line.

---

## ⚠️ Important: Why KuCoin?

**Binance and Bybit do NOT work in Ghana.** KuCoin is the recommended exchange for Ghana-based traders.

This bot uses the **KuCoin Spot API** which is fully accessible from Ghana without VPN or restrictions.

---

## Table of Contents

1. [What is MVS?](#what-is-mvs)
2. [Core Pillars](#core-pillars)
3. [Setup Parameters](#setup-parameters)
4. [Fibonacci Roles](#fibonacci-roles-the-6-levels)
5. [Signal Taxonomy](#signal-taxonomy-all-possible-states)
6. [Rejection Patterns](#rejection-patterns-2-of-5-rule-on-the-15m-trigger-candle)
7. [Expected Signal Frequency](#expected-signal-frequency)
8. [Entry Logic](#entry-logic-step-by-step)
9. [Backtest Results](#backtest-results)
10. [Why MVS Works](#why-mvs-works)
11. [Deployment](#deployment)
12. [File Structure](#file-structure)
13. [Troubleshooting](#troubleshooting)

---

## What is MVS?

The **Monthly Value Sniper (MVS)** is a trading strategy built on one
principle: **price tends to revisit where the most volume was traded.**
That's a real, well-documented market tendency — not a guarantee about any
single trade.

By combining four structural pillars — **POC** (Point of Control), **VAH**
(Value Area High), **VAL** (Value Area Low), and **Fibonacci** (all 6
levels) — across **three timeframes** (4H macro bias, 1H structure, 15m
trigger), MVS identifies zones where volume, retracement math, and
short-term price action line up, and requires at least two of the three
timeframes to agree on direction before anything fires.

No EMA. No lagging indicators of any kind. Just structure: volume profile +
Fibonacci, cross-checked across three timeframes.

---

## Core Pillars

| Pillar | Symbol | Role |
|--------|--------|------|
| **POC** | Point of Control | Highest-volume price — institutional magnet |
| **VAH** | Value Area High (top of 70%) | Supply defense line — sellers stack here |
| **VAL** | Value Area Low (bottom of 70%) | Demand defense line — buyers stack here |
| **FIBO** | Fibonacci Retracement | Mathematical gravity well — 60–80% pocket guides entries |

### Three-Timeframe Architecture (v10.0)

```
4H  → Macro bias vote   (POC + VAH + VAL + Fib50% — 3-of-4 vote: BULLISH/BEARISH/NEUTRAL)
1H  → Structure         (same 4-pillar vote + the actual zone: swing, Fib 60–80% pocket, POC/VAH/VAL)
15m → Trigger           (same 4-pillar vote + the rejection candle that fires entry)

Direction requires 2-of-3 timeframes to agree (see core.js: resolveDirection()).
The 1H zone still has to align with a 4H structural level (HTF zone cross-check),
and the 15m candle still has to show a real rejection pattern in that 1H zone —
the vote is an added agreement gate, not a replacement for the structural checks.
```

This is the mechanical form of "1H + 15m, confirmed by 4H": no single
timeframe can force a trade on its own, and the 1H zone is where the trade
actually happens — 15m only sharpens *when* inside that zone.

> **v10.0 architecture note:** all of the logic above now lives in one file,
> `core.js`, imported by both `strategy.js` (live) and `backtest.js`
> (simulation). Previous versions kept two independent copies of this logic
> that drifted out of sync repeatedly — including a live-only bug where the
> 4H zone cross-check threw on every call because a `direction` variable
> was referenced but never passed in, which is the most likely reason live
> signals stayed at zero while backtests fired normally. A shared module
> makes that specific class of bug impossible going forward.

---

## Setup Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Bias timeframe** | 4H, 200 bars | Macro direction vote |
| **Structure timeframe** | 1H, 500 bars (VP) / 200 bars (Fib swing) | Matches the TradingView A-ICT/SMC PRO_v5 indicator settings (Lookback Bars 500, Swing Lookback 200) so the bot's levels match your chart |
| **Trigger timeframe** | 15m, 500 bars (VP) / 200 bars (Fib swing) | Entry timing precision inside the 1H zone |
| **Symbols** | ETH, SOL, BTC, XRP, ADA, DOGE, AVAX, LINK, BNB, DOT, LTC, TRX, POL (USDT) | 13 liquid pairs — repo is public, Actions minutes are free |
| **Scan cadence** | Every 15 minutes | Matches the 15m trigger timeframe |
| **VP rows** | 100 | Matches TradingView "Profile Rows: 100" |
| **Command polling** | Every 2 minutes | Near real-time response to Telegram commands |

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
| **A2** Structural Remap | Price breaks the 1H STRUCT_FIB_LOOKBACK-bar swing high/low | All previous zones VOID. Wait for recalculation. |
| **A3** Zone Expiry | No Fib/POC/VAH/VAL confluence found | Silent reset. Wait for next scan. |

### B — Entry Signals (Trade Triggered)

| Signal | Condition | Action |
|--------|-----------|--------|
| **BUY** | 2-of-3 TF vote BULLISH + 4H zone aligned + 1H confluence + 2-of-5 15m rejection patterns | Signal alert sent with entry/SL/TP. You decide position size. |
| **SELL** | 2-of-3 TF vote BEARISH + 4H zone aligned + 1H confluence + 2-of-5 15m rejection patterns | Signal alert sent with entry/SL/TP. You decide position size. |

> There is no built-in risk-per-trade percentage baked into a live order —
> this bot does not place trades for you, it alerts. Decide your own
> position size before you need it, not in the moment an alert arrives.

### C — Active Trade Management (Post-Entry)

| Signal | Condition | Action |
|--------|-----------|--------|
| **C1** TP1 Hit | Price reaches 50% Fib | Close 50% of position. Move runner SL to entry. |
| **C2** TP2 Hit | Price reaches VAH (BUY) / VAL (SELL) | Close another portion. Runner continues to TP3. |
| **C3** TP3 Hit | Price reaches swing high (BUY) / swing low (SELL) | Full structural exit. Close remaining position. |
| **C4** SL Hit | Price breaches swing wick + 0.25×ATR | Surgical filter minimises this — POC entries require POC_RECLAIM. |
| **C5** Breakeven | Price +0.5% in your favour after entry | Move SL to entry manually. |
| **C6** Partial Sweep | Wick into SL buffer, immediate reversal | HOLD. This is a liquidity hunt. |

### D — Invalidation / Skip (Do NOT Trade)

| Signal | Condition | Action |
|--------|-----------|--------|
| **D1** Absorption | Zone touched, but high-volume directional candle opposes entry | SKIP. Telegram alert sent. |
| **D2** Sharp Breakout | Price slices through zone without pausing | Do NOT fade. Trend continuation. |
| **D3** Shallow Retrace | Rejects at 23.6/38.2 before reaching 60–80% pocket | Ignore. Trend too strong. |
| **D4** Over-Extended | Price already beyond 88.6% Fib | Skip. Swing invalidated. |
| **D5** No 2-of-3 Vote | Fewer than 2 of {4H, 1H, 15m} agree on direction | Skip. Timeframes disagree. |
| **D6** 4H Zone Mismatch | 1H entry price doesn't sit near any 4H structural level | Skip. No multi-timeframe confluence. |

---

## Rejection Patterns (2-of-5 Rule, on the 15m trigger candle)

A signal fires only if **at least 2 of these 5 patterns** appear on the last closed 15m candle touching the 1H zone:

| Pattern | Bullish (BUY) | Bearish (SELL) |
|---------|--------------|----------------|
| **POC_RECLAIM** | Wicked through 1H POC, closed back above it | Wicked through 1H POC, closed back below it |
| **VAH_VAL_RECLAIM** | Wicked below 1H VAL, closed back above it | Wicked above 1H VAH, closed back below it |
| **PIN_BAR** | Lower wick > 1.5× body | Upper wick > 1.5× body |
| **ENGULFING** | Bullish candle fully engulfs prior bar | Bearish candle fully engulfs prior bar |
| **CLOSE_REJECTION** | Candle wicked into zone, closed above it | Candle wicked into zone, closed below it |

**Absorption Veto (overrides all):** If a high-volume 15m candle (body > 60% of range) closes strongly in the opposite direction, the signal is suppressed even if 2-of-5 patterns fire.

**Solo trigger (off by default — `ALLOW_SOLO_TRIGGER` in config.js):** a single POC_RECLAIM or VAH_VAL_RECLAIM alone can qualify if every other gate still passes. Applies identically to BUY and SELL. Test it yourself via `backtest.js` before enabling live — it is not a preset the way it was in prior versions, because a direction-restricted version of this exact flag (SELL-only) was one of the overfit rules removed in v10.0.

---

## Expected Signal Frequency

There is no hardcoded frequency table here anymore. Earlier versions of
this README pinned specific hardcoded numbers (signals/week, per-pair win
rates) to the README text — which is exactly the kind of number that goes
stale or misleading the moment the underlying code changes, and v10.0
changed the underlying code substantially (new timeframe, new vote logic,
removed overfit filters).

**Generate a current, honest number yourself:**

```bash
node backtest.js                    # all 13 symbols, config.BACKTEST_DAYS
```

The report (`backtest-report.txt`) prints signals/week, win rate, no-loss
rate, profit factor, and a full gate-by-gate funnel — read the whole thing,
not just the top line. If a change to `config.js` makes the top-line
numbers look better, check the funnel diagnostics before trusting it: a
smaller sample size or a single lucky stretch can do that too.

---

## Entry Logic (Step-by-Step)

This mirrors `runStrategy()` in `strategy.js`, which calls the shared
functions in `core.js` — the backtest replays the identical sequence.

```
STEP 1:  Fetch 4H (200 bars), 1H (500 bars), and 15m (500 bars) klines from KuCoin.
STEP 2:  Three-way bias vote — each timeframe casts BULLISH/BEARISH/NEUTRAL
         via the same POC+VAH+VAL+Fib50 4-pillar vote (core.tfBiasVote).
         Resolve direction: need 2-of-3 timeframes to agree (core.resolveDirection).
         < 2 agree → D5 stop. No entry this scan.
STEP 3:  1H structure: get the swing/Fib pocket this vote's timeframes used.
         Price broke the 1H swing entirely → structural remap alert, stop.
STEP 4:  D4 check — price already beyond 1H Fib 88.6%? → over-extended, stop.
STEP 5:  Early zone-proximity skip — save compute if price isn't near the pocket.
STEP 6:  1H Confluence Check — does the 60–80% Fib pocket overlap 1H POC, VAH,
         or VAL? Score >= 1 (within ATR×0.65) required; POC entries need
         score >= 2 (tighter — POC is a single point, not a boundary line).
         No confluence → stop.
STEP 7:  4H Zone Cross-Check — is the 1H entry price near a 4H structural
         level (POC/VAH/VAL/Fib50%, tolerance ATR×3.0, same both directions)?
         No → D6 block, stop.
STEP 8:  Zone Invalidation — did the 1H close THROUGH the zone by > ATR×1.0?
         Yes → discard zone, stop.
STEP 9:  Signal Cooldown — signal fired this direction in the last 5 × 1H bars?
         Yes → suppress, stop.
STEP 10: 15m Trigger — check the last closed 15m candle inside the 1H zone
         for 2-of-5 patterns (POC_RECLAIM, VAH_VAL_RECLAIM, PIN_BAR,
         ENGULFING, CLOSE_REJECTION). Absorption veto active → stop.
         < 2 patterns (and no solo trigger) → wait, no signal yet.
STEP 11: Calculate SL / TP
         Entry: best 1H Fib/POC/VAH/VAL confluence level
         SL:    1H swing wick ± 0.25 × ATR
         TP1:   max(50% Fib, entry + 1.2R) — dynamic floor
         TP2:   midpoint between TP1 and TP3
         TP3:   1H VAH (BUY) / VAL (SELL) — full value area exit
STEP 12: Fire Telegram alert (shows which TFs agreed, entry/SL/TP, patterns).
         Save state.json + signals.log.json.
```

---

## Backtest Results

Run it yourself — numbers below are illustrative of *how to read the
report*, not a performance claim:

```bash
node backtest.js                    # all 13 symbols, config.BACKTEST_DAYS (360)
node backtest.js SOL-USDT 180       # single symbol, custom window
```

`backtest-report.txt` gives you, in order: total signals + signals/week,
win rate, no-real-loss rate (explicitly labeled as different from win
rate), profit factor, outcome breakdown (TP1/TP2/TP3/SL/BE/timeout counts),
a $ P&L simulation, a timeframe-vote-agreement breakdown (2/3 vs 3/3),
per-symbol and per-direction stats, and — most important — **funnel
diagnostics per symbol** showing exactly how many scan ticks survived each
gate. If a config change makes the headline win rate go up, check whether
the trade count also collapsed; a strategy that fires twice in 360 days at
100% WR has told you almost nothing about its real edge.

**Before you trust a number:** run the backtest over a window you have NOT
already used to tune `config.js`. Tuning filters until a specific window
looks good and then reporting that same window's stats is the exact
mechanism that produced the misleading "90.7%" badge this README used to
have.

---

## Why MVS Works (and where its limits are)

1. **Three-Timeframe Confirmation** — 4H macro bias, 1H structure, 15m trigger, each casting an independent POC+VAH+VAL+Fib50 vote. 2-of-3 must agree before anything is even considered.
2. **4H Zone Cross-Check** — The 1H entry must also sit near an actual 4H structural level. Two independent timeframes pointing to the same price is real confluence, not coincidence — but it is still not certainty.
3. **Full Value Area (POC + VAH + VAL)** — Both supply (VAH) and demand (VAL) walls are tracked, symmetrically for BUY and SELL.
4. **ATR-Relative Confluence** — Tolerance scales with current volatility instead of a fixed percentage that goes stale as volatility regimes change.
5. **60–80% Fib Pocket** — Treats the entry zone as a price range, not two lines — models the retracement zone between 61.8% and 78.6% rather than a single trigger price.
6. **2-of-5 Rejection Rule on the 15m trigger** — Requires multiple forms of confirmation on the timeframe closest to the actual entry, not a single pattern match.
7. **Symmetric rules, every symbol and direction** — No per-symbol or per-direction filter overrides. This very likely means the backtest numbers are somewhat *less* flattering than prior versions' — that's the honest tradeoff for a ruleset less likely to be curve-fit to one historical window.
8. **Zero lagging indicators** — no EMA, no moving averages. Every input is raw price/volume structure.

**What this strategy does NOT do:** predict the future, eliminate variance, or protect you from a string of losses. Volume-profile mean-reversion is a real, studied tendency in liquid markets — it is also, like every trading approach, wrong often enough that risk management (position sizing, stop-losses you actually honor, not risking capital you need) matters more to your outcome than any single filter tweak in this repo.

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
| `/pairs` | All tracked pairs + backtest stats |
| `/about` | Strategy overview + how to run your own backtest |
| `/signal` | How to read a signal |
| `/source` | GitHub link |
| `/help` | List all commands |

---

## File Structure

```
mvs-bot/
├── package.json            # Node.js dependencies
├── config.js               # All settings (tokens, symbols, parameters) — single source of truth
├── core.js                 # Shared decision logic — used by BOTH strategy.js and backtest.js
├── strategy.js             # Live runner — fetches KuCoin data, calls core.js, sends Telegram alerts
├── commands.js             # Telegram command handler (/scan /status /health etc.)
├── weekly-summary.js       # Weekly digest — reads signals.log.json, sends to Telegram
├── README.md               # This file
├── backtest.js             # Historical simulator — same core.js logic, configurable days (default 360)
│
├── .github/
│   └── workflows/
│       ├── mvs-scan.yml        # Runs strategy.js every 15 min (own lock)
│       ├── mvs-commands.yml    # Polls Telegram commands every 2 min (own lock)
│       ├── mvs-backtest.yml    # On-demand backtester workflow
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
| No signals after several days | Confluence or 2-of-3 vote never firing | Check `diag.log.json` — look at the `reason` field distribution. `NO_2OF3_AGREEMENT` dominating means timeframes rarely agree (expected — that's the gate working); `NO_CONFLUENCE` dominating means widen `CONFLUENCE_ATR_MULT` in `config.js` (try `0.75`) |
| Too many signals (noise) | Confluence/rejection too loose | Lower `CONFLUENCE_ATR_MULT` (try `0.5`) or raise `REJECTION_MIN_PATTERNS` to `3` |
| Commands not responding | `tg-offset.json` not committed yet | Go to **Actions → MVS Commands → Run workflow** once manually to bootstrap the offset |
| `/health` shows "Last scan run: never" | `state.json` not yet committed | Go to Actions → MVS Scan → Run workflow manually once to bootstrap |
| KuCoin returns empty data | Temporary API issue | Wait a few minutes and re-run. KuCoin public API has occasional timeouts |
| Actions tab shows no runs | Workflows not enabled | Go to repo → Actions tab → enable workflows |
| Want to test the solo-trigger rule | `ALLOW_SOLO_TRIGGER` defaults to `false` in `config.js` | Set to `true`, or run `ALLOW_SOLO_TRIGGER=true node backtest.js`, and compare the funnel/win-rate against the default before enabling live |
| Backtest feels slow | 360+ day backtest across 13 symbols fetches and replays a lot of 15m data | Normal — expect low tens of seconds per symbol depending on connection. Run a single symbol (`node backtest.js SOL-USDT`) while iterating on config changes |

---

## License

MIT — By Abdin. Institutional grade, zero subjectivity.
