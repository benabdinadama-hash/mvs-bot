# MVS — Monthly Value Sniper
## By Abdin — KuCoin Edition for Ghana

![Pairs](https://img.shields.io/badge/Pairs-13%20Liquid%20Pairs-orange?style=for-the-badge)
![Platform](https://img.shields.io/badge/Exchange-KuCoin%20Ghana-red?style=for-the-badge)
![Version](https://img.shields.io/badge/Version-v10.6-purple?style=for-the-badge)

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

## What changed since v10.0 (v10.3 → v10.6)

Kept here so this stays a living record instead of scattered commit
messages. Full technical detail lives in the header comments of `core.js`
and `config.js` if you want the exact numbers behind each change.

- **v10.3 — Risk tiering.** Position-size scaling (not a new entry gate —
  nothing that used to fire got blocked) for the one segment the trade log
  actually flagged: POC-pivot entries where 1H doesn't confirm direction.
- **v10.4 — Three fixes.** LINK-USDT and AVAX-USDT were silently getting
  truncated trade history in backtests (a pagination bug, not a real data
  gap — fixed). A second, independent risk factor (the `POC_RECLAIM`
  pattern) got its own position-size discount. Telegram send and KuCoin
  fetch both gained retries so a transient network blip can't silently
  drop a real signal.
- **v10.5 — TP3 retired.** Confirmed by four separate backtests (30/360/
  720/1800 days) that TP3 was hit exactly 0 times, ever. Root cause: TP1
  used to be a full, instant close, which (due to check ordering) meant
  the further targets could basically never be reached in ordinary price
  action. Fixed properly: TP1 is now a genuine 50% partial exit with a
  hard breakeven stop for the rest, and TP2 (the old TP3 formula — 1H
  VAH/VAL) is the only further target. Two real targets instead of three
  where the third was structurally unreachable. Also fixed: backtest
  requests for short windows (e.g. 30 days) used to silently return zero
  signals for every symbol, because warming up the 4H volume profile
  alone needs ~34 days — that warmup buffer is now fetched separately
  from the days you actually asked to evaluate.
- **v10.6 — Evaluated a third-party strategy spec on request, adopted
  what held up, declined the rest with reasons on record.** Adopted: TD
  Sequential "9" (Tom DeMark) as an independent, size-only confirmation
  signal — genuinely non-lagging, bounded so it can only restore size
  toward normal, never exceed it or block a signal. Declined: swapping
  the TP2 target formula to an `entry ± VA_Range × π` "Pi target" (the
  actual TP problem was the v10.5 sequencing bug, already fixed — π
  itself has no evidence behind it in this system); 4H-based Value Area/
  Fibonacci (would discard everything the four backtests validated);
  ADX/volume/news filters (would cut signal frequency, the opposite of
  what was asked).

---

## ⚠️ Important: Why KuCoin?

**Binance and Bybit do NOT work in Ghana.** KuCoin is the recommended exchange for Ghana-based traders.

This bot uses the **KuCoin Spot API** which is fully accessible from Ghana without VPN or restrictions.

---

## Table of Contents

1. [What is MVS?](#what-is-mvs)
2. [What changed since v10.0](#what-changed-since-v100-v103--v106)
3. [Core Pillars](#core-pillars)
4. [Setup Parameters](#setup-parameters)
5. [Fibonacci Roles](#fibonacci-roles-the-6-levels)
6. [Signal Taxonomy](#signal-taxonomy-all-possible-states)
7. [Rejection Patterns](#rejection-patterns-2-of-5-rule-on-the-15m-trigger-candle)
8. [Expected Signal Frequency](#expected-signal-frequency)
9. [Entry Logic](#entry-logic-step-by-step)
10. [Backtest Results](#backtest-results)
11. [Why MVS Works](#why-mvs-works)
12. [Deployment](#deployment)
13. [Keeping the Bot Alive](#keeping-the-bot-alive)
14. [File Structure](#file-structure)
15. [Troubleshooting](#troubleshooting)

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
| **Command polling** | Every 5 minutes | Near real-time response to Telegram commands |

---

## Fibonacci Roles (The 6 Levels)

| Level | Role | Action |
|-------|------|--------|
| 23.6% | Momentum Gauge | Trend strength only — ignore for entries |
| 38.2% | Momentum Gauge | Trend strength only — ignore for entries |
| **50.0%** | **TP1 floor** | **One of two inputs to TP1 (see TP structure below) — closes 50% of position when hit** |
| **61.8%** | **ENTRY ZONE start** | **Must overlap with POC, VAH, or VAL within ATR×0.85** |
| **78.6%** | **ENTRY ZONE end** | **Must overlap with POC, VAH, or VAL within ATR×0.85** |
| **88.6%** | **D4 EXTREME** | **Beyond this = over-extended, signal blocked** |

---

## Signal Taxonomy (All Possible States)

### A — Structural / Setup (No Trade Yet)

| Signal | Condition | Action |
|--------|-----------|--------|
| **A1** Golden Zone | Fib 60–80% pocket overlaps POC, VAH, or VAL within ATR×0.85 | Confluence found. Proceed to HTF check. |
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
| **C1** Halfway-to-TP1 | Price reaches the midpoint between entry and TP1 | SL auto-moves to entry (breakeven) — automatic, not manual. |
| **C2** TP1 Hit | Price reaches TP1 (max of 50% Fib / entry+1.2R) | 50% of position closes, locking in real profit. Remaining 50%'s SL moves to entry (hard breakeven) and now targets TP2. |
| **C3** TP2 Hit | Runner half reaches TP2 (1H VAH for BUY / VAL for SELL — the value-area edge) | Full exit. Both halves realized. |
| **C4** SL Hit | Price breaches swing wick ± 0.25×ATR (before TP1) | Full loss on the position. Position-size tiering (see below) already discounts the segments most likely to end here. |
| **C5** TP1+BE | TP1 already banked, then runner half stops out at breakeven | Net result: still a real win (≈half of TP1's R), not a scratch — the 50% banked at TP1 doesn't go away. |

> **v10.5 note:** TP1 used to be a full, instant close — the code checked
> "did the far target get hit" *before* checking "did TP1 get hit," so in
> ordinary gradual price movement TP1 always closed the whole trade first.
> A third target (TP3) existed on paper but was reachable only when a
> single candle jumped through two levels at once — confirmed by four
> separate backtests (30/360/720/1800 days) all showing **TP3 hits: 0**.
> Fixed: TP1 is now a genuine partial exit, TP3 was retired, and its
> VAH/VAL formula became the new TP2 (the only further target). Two real
> targets, not three targets where the third was structurally unreachable.

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

**Absorption Veto (overrides all):** If a high-volume 15m candle (body > 70% of range) closes strongly in the opposite direction, the signal is suppressed even if 2-of-5 patterns fire.

**Solo trigger (ON by default — `ALLOW_SOLO_TRIGGER` in config.js):** a single pattern in `SOLO_ELIGIBLE_PATTERNS` (currently `POC_RECLAIM`, `VAH_VAL_RECLAIM`, `CLOSE_REJECTION`) can qualify alone if every other gate still passes. Applies identically to BUY and SELL. `PIN_BAR` and `ENGULFING` are deliberately excluded from solo eligibility — backtest data shows they're weakest exactly when they co-occur with each other, so letting either fire completely alone isn't supported by the data. Change the list in `config.js` (not here) if you want to test a different set — re-run `node backtest.js` before trusting live results against any change.

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
         or VAL? Score >= 1 (within ATR×0.85) required; POC entries need
         score >= 1 too as of v10.2 (was 2 — tightened POC alignment was
         loosened deliberately for signal frequency; see config.js history).
         No confluence → stop.
STEP 7:  4H Zone Cross-Check — is the 1H entry price near a 4H structural
         level (POC/VAH/VAL/Fib50%, tolerance ATR×4.0, same both directions)?
         No → D6 block, stop.
STEP 8:  Zone Invalidation — did the 1H close THROUGH the zone by > ATR×1.0?
         Yes → discard zone, stop.
STEP 9:  Signal Cooldown — signal fired this direction in the last 3 × 1H bars?
         Yes → suppress, stop.
STEP 10: 15m Trigger — check the last closed 15m candle inside the 1H zone
         for 2-of-5 patterns (POC_RECLAIM, VAH_VAL_RECLAIM, PIN_BAR,
         ENGULFING, CLOSE_REJECTION). Absorption veto active → stop.
         < 2 patterns AND no solo-eligible pattern alone → wait, no signal yet.
STEP 11: TD Sequential "9" check (v10.6, informational/sizing only) — does
         a fresh 9-count exhaustion signal (Tom DeMark, pure price
         comparison, non-lagging) agree with this direction on 1H? If yes,
         suggested position size gets a bounded upward adjustment (never
         above 100%, never a gate — see config.js TD9_BOOST_MULT).
STEP 12: Calculate SL / TP (v10.5: two real targets, not three — see below)
         Entry: best 1H Fib/POC/VAH/VAL confluence level
         SL:    1H swing wick ± 0.25 × ATR
         TP1:   max(50% Fib, entry + 1.2R) — closes 50% of position, moves
                remaining SL to entry (breakeven)
         TP2:   1H VAH (BUY) / VAL (SELL) — the runner's target for the
                other 50%, must clear TP1 by ≥ 0.25R or the setup is
                skipped (this floor is why TP2 is actually reachable now —
                see the v10.5 note under Signal Taxonomy above)
STEP 13: Fire Telegram alert (shows which TFs agreed, entry/SL/TP1/TP2,
         suggested size, patterns, TD9 status if it fired).
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
rate), profit factor, outcome breakdown (TP1-reached/TP2-reached/SL/BE/
timeout counts — see the "Active Trade Management" table above for what
each means), a $ P&L simulation, a timeframe-vote-agreement breakdown (2/3
vs 3/3), per-symbol and per-direction stats, and — most important —
**funnel diagnostics per symbol** showing exactly how many scan ticks
survived each gate. If a config change makes the headline win rate go up,
check whether the trade count also collapsed; a strategy that fires twice
in 360 days at 100% WR has told you almost nothing about its real edge.

**Before you trust a number:** run the backtest over a window you have NOT
already used to tune `config.js`. Tuning filters until a specific window
looks good and then reporting that same window's stats is the exact
mechanism that produced the misleading "90.7%" badge this README used to
have.

### Reference snapshot (v10.6, 2026-07-04 — a dated historical record, not a live performance guarantee)

Two overlapping windows, run back to back on the same ruleset. Kept here
because consistency *between* windows is more informative than either
number alone — if a future config change makes one window look great and
the other looks worse, that's the tuning-to-one-window trap this repo has
been actively avoiding since v10.0.

| Metric | 360 days | 720 days |
|---|---|---|
| Signals fired | 96 (~1.85/wk) | 188 (~1.82/wk) |
| Closed trades | 95 | 187 |
| Win rate | 60.0% (57W/38L) | 62.0% (116W/71L) |
| No-real-loss rate | 88.4% | 89.8% |
| Profit factor | 7.03 | 8.47 |
| Total R | 61.55R | 128.54R |
| Avg win / avg loss | +1.26R / -0.27R | +1.26R / -0.24R |
| Avg hold time | 33h | 33h |
| SL hits | 9 (100% POC pivot) | 15 (100% POC pivot) |
| $1,000 → | $1,964.52 (+96.5%) | $4,055.63 (+305.6%) |
| Max drawdown | 1.9% | 2.3% |
| 2-of-3 vs 3-of-3 vote split | 92 / 4 | 176 / 12 |

Every single SL in both windows is **POC pivot** — that part holds
exactly. Most also lack 1H confirmation (9 of 9 in the 360-day window,
12 of 15 in the 720-day window) — the segment `RISK_TIER_MATRIX` already
sizes down (see `core.js` `computeRiskMultiplier()`). The 720-day window
also shows 3 SLs where 1H *did* confirm — a reminder that even the
strongest segment (76.1% WR overall in the 720-day confidence-tier
breakdown) has a real, nonzero loss rate, not a guarantee. VAH and VAL
pivots carried zero SLs in either window (n=4 and n=8 in the 360-day
run — small samples, watch this rather than assume it holds forever).
Top 6 by total R differs somewhat between windows (360-day: AVAX, DOGE,
ETH, LINK, DOT, BTC — 720-day: ETH, AVAX, BTC, DOGE, POL, LTC); only
**AVAX, BTC, DOGE, ETH** appear in the top 6 of both. This is a snapshot
of one point in time on one ruleset — it will go
stale the moment `config.js` changes again. Re-run `node backtest.js` and
replace this table rather than trust it past its date.

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
5. Send `/health` to your bot in Telegram — you'll get a response within 5 minutes

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

## Keeping the Bot Alive

GitHub automatically disables **all** scheduled workflows in a repo after
60 days with no repository activity (commits) —
[docs](https://docs.github.com/actions/using-workflows/disabling-and-enabling-a-workflow).
`mvs-scan.yml` already commits a fresh `.ping.json` timestamp on every run
(every 15 minutes), which normally keeps the whole repo "active" on its
own — any commit from any workflow resets the 60-day clock for every
scheduled workflow in the repo, not just the one that made it.

`keepalive.yml` is a second, fully independent safety net: it commits a
tiny heartbeat file once a day on its own separate schedule, regardless of
whether the scan workflows are healthy. If `mvs-scan.yml`'s two triggers
(cron-job.org's external ping and GitHub's own native schedule) ever
somehow both stopped firing for an extended stretch, this keeps the repo
active anyway, so the underlying workflows never get caught in the
auto-disable trap in the first place. You don't need to open the repo or
do anything for this to work.

If you ever DO see a workflow show as disabled (Actions tab → workflow
name → banner saying it's disabled), a manual **Run workflow** click
re-enables it immediately — this only happens after a genuine 60-day gap
with all triggers failing, which `keepalive.yml` is specifically here to
prevent.

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
│       ├── mvs-setup.yml       # Manual-only — configures Telegram bot profile/commands
│       ├── mvs-weekly.yml      # Sends weekly summary every Monday 07:00 UTC (own lock)
│       └── keepalive.yml       # Daily heartbeat commit — prevents GitHub's 60-day
│                                #   scheduled-workflow auto-disable (see "Keeping the
│                                #   Bot Alive" above)
│
└── (auto-generated at runtime)
    ├── state.json          # Last scan result per symbol + signal cooldown state
    ├── signals.log.json    # Rolling log of last 500 signals (used by weekly summary)
    ├── diag.log.json       # Per-bar diagnostic log for offline tuning
    ├── tg-offset.json      # Telegram update offset (prevents duplicate command processing)
    ├── .ping.json          # Timestamp touched every scan (keeps repo "active")
    └── .github/keepalive/  # Heartbeat file touched daily by keepalive.yml
```

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| No signals after several days | Confluence or 2-of-3 vote never firing | Check `diag.log.json` — look at the `reason` field distribution. `NO_2OF3_AGREEMENT` dominating means timeframes rarely agree (expected — that's the gate working); `NO_CONFLUENCE` dominating means widen `CONFLUENCE_ATR_MULT` in `config.js` (current default is `0.85`; try `1.0`) |
| Too many signals (noise) | Confluence/rejection too loose | Lower `CONFLUENCE_ATR_MULT` (current default `0.85`; try `0.65`) or raise `REJECTION_MIN_PATTERNS` to `3` |
| Commands not responding | `tg-offset.json` not committed yet | Go to **Actions → MVS Commands → Run workflow** once manually to bootstrap the offset |
| `/health` shows "Last scan run: never" | `state.json` not yet committed | Go to Actions → MVS Scan → Run workflow manually once to bootstrap |
| KuCoin returns empty data | Temporary API issue | Wait a few minutes and re-run. KuCoin public API has occasional timeouts |
| Actions tab shows no runs | Workflows not enabled | Go to repo → Actions tab → enable workflows |
| Want to test WITHOUT the solo-trigger rule | `ALLOW_SOLO_TRIGGER` defaults to `true` in `config.js` (it's a net-positive rule for the reclaim/close-rejection patterns per backtest data, so it's on by default — see `config.js` for the exact patterns and reasoning) | Set to `false`, or run `ALLOW_SOLO_TRIGGER=false node backtest.js`, and compare the funnel/win-rate against the default before disabling live |
| Backtest feels slow | 360+ day backtest across 13 symbols fetches and replays a lot of 15m data | Normal — expect low tens of seconds per symbol depending on connection. Run a single symbol (`node backtest.js SOL-USDT`) while iterating on config changes |
| A workflow shows as "disabled" in the Actions tab | Genuine 60-day gap where all of a workflow's triggers failed (rare — `keepalive.yml` exists specifically to prevent this) | Click into the workflow → **Enable workflow**, or just push any commit to the repo, which re-enables all previously auto-disabled scheduled workflows |

---

## License

MIT — By Abdin. Institutional grade, zero subjectivity.
