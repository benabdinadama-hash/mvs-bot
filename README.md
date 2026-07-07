# MVS — Monthly Value Sniper
## By Abdin — KuCoin Edition for Ghana

![Pairs](https://img.shields.io/badge/Pairs-13%20Liquid%20Pairs-orange?style=for-the-badge)
![Platform](https://img.shields.io/badge/Exchange-KuCoin%20Ghana-red?style=for-the-badge)
![Version](https://img.shields.io/badge/Version-v10.13-purple?style=for-the-badge)

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

## What changed since v10.0 (v10.3 → v10.9)

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
- **v10.7 — EXPERIMENTAL, off by default.** A fresh backtest found every
  single SL (9/9 in a 360-day window, 15/15 in a 720-day window) traced to
  POC pivot. Rather than cut POC volume (costs frequency), `SL_ATR_MULT_MATRIX`
  tests whether POC's SL rate is partly noise: POC is a single price point
  that can shift bar to bar, unlike VAH/VAL (stable range boundaries), so
  it may be more prone to brief overshoot-then-reverse. Widens POC's stop
  and shrinks position size to match, so $ risk per trade is unchanged.
  Genuinely untested — stays off by default (`SL_ATR_MULT_MATRIX_ENABLED`),
  needs a real backtest with wider stops before it should be trusted.
- **v10.8 — Three more theories for the same "every SL is POC" finding,
  chosen to be mechanistically different from v10.7 and from each other:**
  **POC prominence** (is POC's volume a clear peak, or does it barely edge
  out its neighbor price rows — a contested, ambiguous "winner" rather
  than a level the market clearly agreed on?); **POC migration** (has POC
  been drifting toward the trade direction across recent windows — real,
  forming consensus — or is it static/noisy?); **naked/untested POC**
  (does an earlier, now-closed window's POC — never revisited since — sit
  near the current POC? Two profiles agreeing is stronger evidence than
  one). All three: bounded, size-only multipliers, never gates, complete
  no-ops for VAH/VAL regardless of state.
- **v10.9 — Two changes.** (1) All three v10.8 POC-quality factors flipped
  from off-by-default to **live by default**, applied directly per explicit
  instruction rather than gated behind a backtest-first requirement.
  `SL_ATR_MULT_MATRIX` (v10.7) is a separate mechanism and was NOT included
  in that instruction — it stays off by default. (2) `signals.log.json`
  and `diag.log.json` now write **newest-first** (most recent entry at the
  top of the file) instead of oldest-first, so you don't have to scroll to
  the bottom to see what just happened. `equity-curve.json` follows the
  same convention. Every place that read these files with an
  oldest-first assumption baked in was found and fixed — see the
  `strategy.js` / `weekly-summary.js` v10.9 header notes for the three
  spots that needed updating (equity-curve math, "latest snapshot"
  lookup, displayed entry list).
- **v10.10 — FIVE-TIMEFRAME VOTE, 3-of-5** (explicitly requested: "FROM
  NOW WE ARE USING 5 TIMEFRAMES: 15MN, 30MN, 1H, 4H, 1D. VOTE OF 3 OVER
  5."). Added 1D and 30m as two new independent bias votes alongside the
  existing 4H/1H/15m — same POC/VAH/VAL/Fib50 4-pillar vote, cast by two
  more timeframes. `core.resolveDirection()` now takes an explicit
  `minAgree` count (`config.MIN_TF_AGREE = 3`) instead of a hardcoded 2.
  1H still supplies the structural zone and 15m still supplies the
  trigger candle — unchanged. Also fixed two separately-reported bugs:
  `/status` now shows direction + full per-TF bias breakdown + vote
  tally (state.json previously never carried those fields at all, only
  `diag.log.json` did — a display fix alone couldn't have solved it), and
  Telegram messages now chunk automatically instead of risking the
  4096-char hard limit. Weekly summary entries are now grouped (`×N`)
  instead of repeating near-identical blocks.
- **v10.11 — (2026-07-07) investigated a reported "bot won't fire despite
  3-of-5 agreement" bug, found none, and made two evidence-based changes
  to cut losses.** Checked all 541 `diag.log.json` entries
  programmatically: zero cases where 3+ of the 5 biases genuinely agreed
  and `NO_3OF5_AGREEMENT` still fired — the reported screenshot showed 2
  BULLISH votes plus NEUTRALs, correctly not fired (NEUTRAL doesn't count
  toward either side). Separately confirmed the `NO_2OF3_AGREEMENT`
  entries also visible in that log are stale history from the pre-v10.10
  code, not a second vote system running in parallel — timestamps show
  they stop the moment v10.10 deployed. Two real changes made:
  `MIN_CONFLUENCE_POC` reverted `1 → 2` (the v10.2 frequency-pass note had
  explicitly flagged this as the lever to revert once POC-pivot win rate
  degraded — the 720-day report confirmed it had: 206 trades, 56.3% WR,
  23 of 30 total SLs), and `POC_RECLAIM` removed from
  `SOLO_ELIGIBLE_PATTERNS` (61 trades with it firing solo: 39.3% WR, 10
  SL vs. 154 trades without it: 72.7% WR, 5 SL). It still counts toward
  the 2-of-5 pattern requirement, it just can't fire alone.
- **v10.12 — (2026-07-07) the POC/no-1H-confirm segment upgraded from a
  size cut to an actual entry gate.** `RISK_TIER_MATRIX`'s `POC_NO1H: 0.75`
  had been discounting this segment's position size since v10.3, but
  every one of those trades still fired and still lost, just smaller —
  and it's the single largest source of stop-losses in every backtest run
  to date (168 of 246 trades in the report that surfaced it, 15 of 18
  total SLs). New flag `POC_REQUIRE_1H_CONFIRM` (on by default) now skips
  the setup entirely — logged as `POC_NO1H_GATED` — instead of just
  sizing it down. Wired into both `strategy.js` (live) and `backtest.js`
  (simulation) identically, to avoid this repo's own documented history of
  live/backtest drift bugs. **This is the single biggest frequency-cutting
  change made across v10.10-v10.12** — POC_NO1H was 68% of trades in the
  report that flagged it, so expect a real hit to signals/week on top of
  v10.11's changes. **The backtest numbers throughout this README (and
  `setup-bot.js`'s bot description) predate v10.10, v10.11, AND v10.12 —
  they describe the OLD 3-TF/2-of-3 ruleset with looser POC gating and
  need a fresh `node backtest.js` run before being trusted or
  republished.**
- **v10.13 — (2026-07-07) requested: find a better way to use POC to
  avoid SLs and raise signal quality.** Instead of more theory, went back
  to the actual per-trade data already sitting in `backtest-report.json`
  (720-day: 207 POC trades, 360-day: 94 POC trades — the 360-day set is a
  subset of the 720-day one, so treat this as one replicated check, not
  two independent samples) and split POC trades by each v10.8 quality
  factor to see which ones actually predicted the outcome:
  - **POC_PROMINENCE confirmed correct, upgraded to a gate.** Decisive
    POC (prominenceRatio ≥ 1.5): 59.7%/60.3% WR. Contested POC (< 1.5):
    48.3%/50.0% WR. ~10pp gap, same direction both windows — comparable
    to the 1H-confirm gap that justified v10.12's gate. New flag
    `POC_PROMINENCE_REQUIRE_DECISIVE` (on by default) now skips contested
    POC entries entirely (`POC_PROMINENCE_GATED`) instead of just taking
    them at 80% size.
  - **POC_MIGRATION was backwards — fixed.** The v10.8 theory was
    "migrating WITH the trade direction = forming consensus = good," and
    rewarded it with a 1.2x size boost. The data says the opposite:
    migration-confirms-direction trades scored 53.3%/54.8% WR, while
    static-or-against-direction trades scored 62.5%/64.7% WR — both
    windows, same direction. Plausible read: a POC that's already
    migrated toward the trade direction is a level that's already been
    "spent" — chasing a re-rated level rather than catching a fresh one.
    The boost is removed; migration-confirms-direction now gets the
    PENALTY multiplier instead, against/static stays neutral.
  - **NAKED_POC left untouched — no data to check it against.** Both
    backtest windows showed `nakedPOC.aligned` as `false` on every single
    POC trade (the data-availability requirement — 2× the VP lookback in
    bars — wasn't met often enough in these windows to produce a single
    aligned case). Not confirmed, not refuted; flagged rather than
    guessed at.
  - Both fixes are wired identically into `strategy.js` (live) and
    `backtest.js` (simulation) — same drift-prevention discipline as
    every other gate in this repo. **Not yet re-backtested on this box**
    (no network access to api.kucoin.com here) — run `node backtest.js`
    and check the new `POC_PROMINENCE_GATED` count plus the POC-pivot WR
    in the BY PIVOT section against the numbers above.
  - **Combined signal, for context (not yet gated on, small sample):**
    POC trades where 1H confirms AND prominence is decisive scored
    87.5% WR (n=8) in the 360-day set vs 47.8% WR (n=23) where neither
    holds. Worth watching as a possible future "trusted POC" tier once
    more trades accumulate — 8 trades is too few to gate a whole tier on
    by itself.

---

## ⚠️ Important: Why KuCoin?

**Binance and Bybit do NOT work in Ghana.** KuCoin is the recommended exchange for Ghana-based traders.

This bot uses the **KuCoin Spot API** which is fully accessible from Ghana without VPN or restrictions.

---

## Table of Contents

1. [What is MVS?](#what-is-mvs)
2. [What changed since v10.0](#what-changed-since-v100-v103--v109)
3. [Core Pillars](#core-pillars)
4. [Setup Parameters](#setup-parameters)
5. [Fibonacci Roles](#fibonacci-roles-the-6-levels)
6. [Signal Taxonomy](#signal-taxonomy-all-possible-states)
7. [Rejection Patterns](#rejection-patterns-2-of-5-rule-on-the-15m-trigger-candle)
8. [Expected Signal Frequency](#expected-signal-frequency)
9. [Entry Logic](#entry-logic-step-by-step)
10. [Backtest Results](#backtest-results)
11. [Why MVS Works](#why-mvs-works-and-where-its-limits-are)
12. [Deployment](#deployment)
13. [Keeping the Bot Alive](#keeping-the-bot-alive)
14. [Log File Ordering](#log-file-ordering)
15. [File Structure](#file-structure)
16. [Troubleshooting](#troubleshooting)

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

### Five-Timeframe Architecture (v10.10, current — was Three-Timeframe/2-of-3 through v10.9)

```
1D  → Macro-macro bias  (POC + VAH + VAL + Fib50% — 3-of-4 vote: BULLISH/BEARISH/NEUTRAL) [NEW v10.10]
4H  → Macro bias vote   (same 4-pillar vote)
1H  → Structure         (same 4-pillar vote + the actual zone: swing, Fib 60–80% pocket, POC/VAH/VAL)
30m → Mid-rung bias     (same 4-pillar vote) [NEW v10.10]
15m → Trigger           (same 4-pillar vote + the rejection candle that fires entry)

Direction requires 3-of-5 timeframes to agree (see core.js: resolveDirection(),
config.MIN_TF_AGREE). The 1H zone still has to align with a 4H structural level
(HTF zone cross-check), and the 15m candle still has to show a real rejection
pattern in that 1H zone — the vote is an added agreement gate, not a
replacement for the structural checks. 1H still supplies the structural zone
and 15m still supplies the trigger candle, exactly as before — only the
direction-agreement vote gained two more independent timeframes.
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
| **BUY** | 3-of-5 TF vote BULLISH + 4H zone aligned + 1H confluence + 2-of-5 15m rejection patterns | Signal alert sent with entry/SL/TP. You decide position size. |
| **SELL** | 3-of-5 TF vote BEARISH + 4H zone aligned + 1H confluence + 2-of-5 15m rejection patterns | Signal alert sent with entry/SL/TP. You decide position size. |

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
| **D5** No 3-of-5 Vote | Fewer than 3 of {1D, 4H, 1H, 30m, 15m} agree on direction | Skip. Timeframes disagree. |
| **D6** 4H Zone Mismatch | 1H entry price doesn't sit near any 4H structural level | Skip. No multi-timeframe confluence. |
| **D7** POC / No-1H-Confirm (v10.12) | Pivot is POC AND 1H isn't one of the 3+ agreeing timeframes | Skip (`POC_NO1H_GATED`). Confirmed weakest segment in every backtest to date — see changelog. Toggle: `config.POC_REQUIRE_1H_CONFIRM`. |
| **D8** POC Contested / Prominence (v10.13) | Pivot is POC AND its volume peak doesn't clearly beat neighboring price rows (ratio < 1.5) | Skip (`POC_PROMINENCE_GATED`). ~10pp WR gap vs. decisive POC, replicated across two backtest windows — see changelog. Toggle: `config.POC_PROMINENCE_REQUIRE_DECISIVE`. |

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

**Solo trigger (ON by default — `ALLOW_SOLO_TRIGGER` in config.js):** a single pattern in `SOLO_ELIGIBLE_PATTERNS` (currently `VAH_VAL_RECLAIM`, `CLOSE_REJECTION` — `POC_RECLAIM` removed in v10.11, see changelog) can qualify alone if every other gate still passes. Applies identically to BUY and SELL. `PIN_BAR` and `ENGULFING` are deliberately excluded from solo eligibility — backtest data shows they're weakest exactly when they co-occur with each other, so letting either fire completely alone isn't supported by the data. `POC_RECLAIM` still counts toward the 2-of-5 pattern requirement below, it just can't fire alone anymore — trades where it fired solo ran 39.3% WR (10 SL / 61 trades) vs. 72.7% WR (5 SL / 154 trades) without it. Change the list in `config.js` (not here) if you want to test a different set — re-run `node backtest.js` before trusting live results against any change.

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
         Resolve direction: need 3-of-5 timeframes to agree (core.resolveDirection,
         config.MIN_TF_AGREE — v10.10: 1D/4H/1H/30m/15m, was 4H/1H/15m 2-of-3).
         < 2 agree → D5 stop. No entry this scan.
STEP 3:  1H structure: get the swing/Fib pocket this vote's timeframes used.
         Price broke the 1H swing entirely → structural remap alert, stop.
STEP 4:  D4 check — price already beyond 1H Fib 88.6%? → over-extended, stop.
STEP 5:  Early zone-proximity skip — save compute if price isn't near the pocket.
STEP 6:  1H Confluence Check — does the 60–80% Fib pocket overlap 1H POC, VAH,
         or VAL? Score >= 1 (within ATR×0.85) required for VAH/VAL; POC
         entries need score >= 2 (tight alignment — reverted back from
         score >= 1 in v10.11 once the 720-day backtest confirmed POC's
         win rate had degraded at the looser threshold; see changelog).
         No confluence → stop.
STEP 6a: POC / 1H-confirm gate (v10.12) — if the pivot is POC AND 1H is
         NOT one of the 3+ agreeing timeframes, stop here (`POC_NO1H_GATED`).
         This was previously just a 0.75x size cut (`RISK_TIER_MATRIX`);
         it's a hard skip now, since this segment owned 15 of 18 total
         SLs (83%) in the report that surfaced it. Toggle:
         `config.POC_REQUIRE_1H_CONFIRM`.
STEP 6b: POC prominence gate (v10.13) — if the pivot is POC AND its
         volume peak doesn't clearly beat its neighboring price rows
         (prominenceRatio < 1.5), stop here (`POC_PROMINENCE_GATED`).
         Was previously just an 0.8x size cut; per-trade analysis of two
         backtest windows showed a ~10pp win-rate gap (decisive ≈60% WR
         vs. contested ≈49% WR), so it's a hard skip now too. Toggle:
         `config.POC_PROMINENCE_REQUIRE_DECISIVE`.
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
STEP 11a: POC quality checks (v10.8, live by default as of v10.9, POC
         pivot only — VAH/VAL untouched):
           • Prominence: is POC's volume a clear peak vs its neighbor
             rows, or a barely-won, contested price? As of v10.13 this is
             a GATE (see STEP 6b above), not just sizing — already
             screened out by the time execution reaches here.
           • Migration: has POC drifted toward this trade's direction
             across recent windows, or is it static/noisy? As of v10.13
             this is now a PENALTY when it confirms direction (the v10.8
             theory had this backwards — see changelog) — still
             size-only, not a gate.
           • Naked POC: does an untested prior-window POC sit near the
             current one (two profiles agreeing)? Unchanged, still
             size-only — no data yet to confirm or refute this one (see
             v10.13 changelog note).
         See config.js POC_PROMINENCE_*/POC_MIGRATION_*/NAKED_POC_* and
         core.js computePOCQualityMultiplier() / isPOCProminenceTrusted()
         for the exact mechanism.
STEP 12: Calculate SL / TP (v10.5: two real targets, not three — see below)
         Entry: best 1H Fib/POC/VAH/VAL confluence level
         SL:    1H swing wick ± 0.25 × ATR (or ± SL_ATR_MULT_MATRIX's
                per-pivot override — v10.7, off by default, untested)
         TP1:   max(50% Fib, entry + 1.2R) — closes 50% of position, moves
                remaining SL to entry (breakeven)
         TP2:   1H VAH (BUY) / VAL (SELL) — the runner's target for the
                other 50%, must clear TP1 by ≥ 0.25R or the setup is
                skipped (this floor is why TP2 is actually reachable now —
                see the v10.5 note under Signal Taxonomy above)
STEP 13: Fire Telegram alert (shows which TFs agreed, entry/SL/TP1/TP2,
         suggested size — including which of the above factors moved it
         off 100%, TD9 status if it fired).
         Save state.json + signals.log.json (newest-first as of v10.9 —
         see "Log File Ordering" below).
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

> **⚠️ This snapshot predates v10.7 through v10.12.** It does not
> reflect `SL_ATR_MULT_MATRIX` (still off by default, untested), the
> three POC-quality factors from v10.8 (live by default as of v10.9),
> the 5-timeframe/3-of-5 vote from v10.10 (was 3-timeframe/2-of-3 here),
> the `MIN_CONFLUENCE_POC` revert and `POC_RECLAIM` solo-trigger removal
> from v10.11, or the POC/no-1H-confirm hard gate from v10.12 — the
> single biggest frequency-cutting change made so far, since that
> segment was 68% of trades in the report that flagged it. **Run
> `node backtest.js` and replace this table** — the numbers below are a
> dated historical record of a meaningfully looser ruleset, not a
> current performance claim.

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

### Reference snapshot (v10.10, 2026-07-07 — dated, and now itself superseded by v10.11/v10.12)

> **⚠️ Same caveat as above, one version later.** These three runs were
> on the 5-timeframe/3-of-5 vote (v10.10) but BEFORE the `MIN_CONFLUENCE_POC`
> revert, the `POC_RECLAIM` solo-trigger removal, and the POC/no-1H-confirm
> gate (all v10.11/v10.12). Kept here because the 720-day POC-pivot numbers
> in this exact run are the direct evidence those later changes were made
> from — not because these are today's numbers. Expect the next backtest to
> show materially fewer signals and a cleaner POC-pivot segment.

| Metric | 90 days | 360 days | 720 days |
|---|---|---|---|
| Signals fired | 9 (~0.47/wk) | 126 (~2.39/wk) | 291 (~2.80/wk) |
| Closed trades | 6 | 123 | 288 |
| Win rate | 16.7% (1W/5L) | 63.4% (78W/45L) | 61.1% (176W/112L) |
| No-real-loss rate | 50.0% | 91.1% | 85.8% |
| Profit factor | 0.10 | 9.05 | 6.44 |
| Total R | -2.70R | 86.41R | 188.38R |
| Avg win / avg loss | +0.30R / -0.60R | +1.25R / -0.24R | +1.27R / -0.31R |
| $1,000 → | $975.19 (-2.5%) | $2,553.11 (+155.3%) | $7,551.47 (+655.1%) |
| Max drawdown | 2.5% | 1.5% | 4.5% |
| POC pivot SLs (of total) | 3 of 3 | not broken out separately this run | 23 of 30 (77%) |

The 90-day window is 6 closed trades — not remotely enough to draw a
conclusion from on its own, but it's also not nothing: it's the most
recent quarter, and it's meaningfully worse than the two longer windows
that contain it. Could be regime (a choppier recent market genuinely
suits this system less), could be noise, could be some of both — worth
watching the next few weeks of live results rather than either dismissing
it or overreacting to it. The 720-day POC-pivot number (23 of 30 total
SLs) is the evidence behind the v10.11/v10.12 changes described above.

---

## Why MVS Works (and where its limits are)

1. **Five-Timeframe Confirmation (v10.10)** — 1D + 4H macro bias, 1H structure, 30m mid-rung bias, 15m trigger, each casting an independent POC+VAH+VAL+Fib50 vote. 3-of-5 must agree before anything is even considered.
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

## Log File Ordering

As of v10.9, `signals.log.json`, `diag.log.json`, and `equity-curve.json`
are all written **newest-first** — the most recent entry is at index 0 /
the top of the file, not the bottom. Requested so you don't have to
scroll through months of history to see what the bot just did.

If you're writing your own tooling against these files, don't assume
chronological (oldest-first) order — `weekly-summary.js`'s equity-curve
math explicitly re-sorts by timestamp internally for exactly this reason
rather than trusting the stored order, which is the safer pattern if you
add your own reader. `backtest-report.json` is **not** affected — it's a
complete, freshly-regenerated report each run (not an incrementally
growing log), and reads better as a chronological trade-by-trade replay,
so it stays oldest-first.

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
    ├── signals.log.json    # Rolling log of last 500 signals, NEWEST-FIRST (v10.9)
    ├── diag.log.json       # Per-bar diagnostic log, NEWEST-FIRST (v10.9)
    ├── equity-curve.json   # Weekly equity snapshots, NEWEST-FIRST (v10.9) — not yet
    │                        #   populated live; see weekly-summary.js HONESTY NOTE
    ├── tg-offset.json      # Telegram update offset (prevents duplicate command processing)
    ├── .ping.json          # Timestamp touched every scan (keeps repo "active")
    └── .github/keepalive/  # Heartbeat file touched daily by keepalive.yml
```

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| No signals after several days | Confluence or 3-of-5 vote never firing | Check `diag.log.json` — look at the `reason` field distribution. `NO_3OF5_AGREEMENT` dominating means timeframes rarely agree (expected — that's the gate working, and stricter with 5 TFs than the old 3); `NO_CONFLUENCE` dominating means widen `CONFLUENCE_ATR_MULT` in `config.js` (current default is `0.85`; try `1.0`); `POC_NO1H_GATED` dominating (v10.12) means most of your recent candidate setups were POC pivot without 1H confirmation — that's the gate working as designed (it's the confirmed weakest segment), not a bug, but if frequency drops too far below target, set `POC_REQUIRE_1H_CONFIRM: false` in `config.js` to fall back to the old size-only treatment and re-backtest to compare; `POC_PROMINENCE_GATED` dominating (v10.13) means POC pivot but a contested (non-decisive) volume peak — same idea, toggle `POC_PROMINENCE_REQUIRE_DECISIVE: false` to fall back to size-only if frequency needs it |
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
