# MVS — Monthly Value Sniper
## By Abdin — KuCoin Edition for Ghana

![Pairs](https://img.shields.io/badge/Pairs-14%20Liquid%20Pairs-orange?style=for-the-badge)
![Platform](https://img.shields.io/badge/Exchange-KuCoin%20Ghana-red?style=for-the-badge)
![Version](https://img.shields.io/badge/Version-v10.15.8-purple?style=for-the-badge)

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
- **v10.13.1 — (2026-07-07) CONFIRMED: fresh 360-day backtest run against
  the deployed v10.13 code — 48 signals (~0.89/wk), 82.6% WR, PF 48.97,
  only 1 SL in 46 closed trades, +87.2% return at 0.9% max DD. This is
  the first backtest run since the v10.11-v10.13 changes and confirms
  the gates did what they were meant to do. Requested a full audit
  ("every bug, error, mismatch") on top, explicitly to be run WITHOUT
  touching any strategy threshold — nothing in this entry changes what
  fires or how it's sized, only correctness/consistency of the code and
  docs around it:**
  - **Real bug: new funnel counter was invisible.** v10.13's
    `funnel.prominenceOk` counter (backtest.js) was incremented via
    `funnel.prominenceOk = (funnel.prominenceOk || 0) + 1` without ever
    being declared in the funnel object's initializer, and was never
    added to the printed funnel-diagnostics line — so the new POC-
    prominence gate had zero visibility in every backtest report,
    including the confirmation run above. Fixed: properly initialized
    and now printed between `triggerOk` and `tp2RangeOk`.
  - **Stale default parameter.** `core.js` `detectRejection()`'s
    `soloPatterns` default was still the pre-v10.11 value
    (`['POC_RECLAIM', 'VAH_VAL_RECLAIM']`) — inert today since both real
    call sites explicitly pass `config.SOLO_ELIGIBLE_PATTERNS`, but a
    landmine for any future call site that omits the argument. Updated
    to match the current config.
  - **Stale version labels, several files.** Every top-of-file "current
    version" header (`core.js` still said v10.9, `config.js` v10.9,
    `strategy.js`/`backtest.js` v10.10, `commands.js`/`weekly-summary.js`
    v10.10) had been left behind through three full version bumps even
    though each file's own changelog entries inside stayed current.
    `package.json`'s version field and description string were also
    still on v10.10. All bumped to v10.13.
  - **User-facing stale version string.** The `/about` Telegram command
    (`commands.js`) hardcoded "(v10.10)" in text actually sent to users —
    fixed to v10.13.
  - **Stale backtest numbers in the live bot's Telegram profile.**
    `setup-bot.js`'s `setMyDescription` call still carried a "STALE v10.6
    backtest (pre-5TF, needs re-run)" placeholder. Replaced with the real,
    dated v10.13 360-day numbers from the confirmation run above.
  - **Minor/cosmetic:** added a clarifying comment in `strategy.js` where
    the "contested POC" quality-note text is now conditionally
    unreachable for POC-pivot trades specifically (the v10.13 gate
    already returns before that line runs, for that one pivot type) —
    not deleted, since it's still correct and reachable for VAH/VAL
    trades and for the `POC_PROMINENCE_REQUIRE_DECISIVE=false` fallback.
  - **Known limitation, not a bug (left as-is):** `weekly-summary.js`'s
    equity-curve section has been self-documented since v10.6 as
    permanently empty — it depends on live exit-tracking (polling price
    against open SL/TP between scans) that doesn't exist yet; this bot
    alerts, it doesn't monitor open positions. Correctly fails silent
    rather than fabricating numbers. Flagging again here since a full
    audit should surface it, but building real exit-tracking is a new
    feature, not a fix, and wasn't asked for in this pass.
  - Full audit scope: every `.js` file syntax-checked and require-tested,
    every cross-file function-call signature checked for drift (`core.js`
    exports vs. every call site in `strategy.js`/`backtest.js`), every
    `config.*` key referenced in `strategy.js` cross-checked against
    `backtest.js` for anything read by one and not the other,
    `state.json`'s actual saved fields cross-checked against everything
    `commands.js`'s `/status` reads, `config.js` scanned for duplicate
    top-level keys (none found). Everything not listed above checked out
    clean.
- **v10.14 — (2026-07-07) live position tracking, MNT-USDT added, a full
  second audit pass, and a direct answer on "close to 100% win rate."**
  - **On the 100% win rate goal, directly:** no real trading system runs
    at or near 100% WR — not this one, not any other, on any market. A
    win rate that high on live/backtest data almost always means one of:
    the sample is too small to have hit a loss yet (this bot's own
    82.6%-WR run above is 46 closed trades — encouraging, not proof),
    the backtest is curve-fit to its own history and will underperform on
    new data, or the stop-loss is so wide that "wins" are actually just
    small losses relabeled. This pass did NOT chase that number — every
    change below is either a genuine bug/mismatch fix or a
    change explicitly requested (position tracking, MNT-USDT), not a new
    threshold tightened purely to inflate a backtest win rate. If a future
    change trades real frequency for a shinier win-rate number without
    replicated evidence behind it, that's the pattern to be suspicious of,
    including from a future version of this bot.
  - **Live position tracking, built.** New `position-tracker.js` — see
    the dedicated "Live Position Tracking" section above for the full
    mechanism. No dedicated server: it rides the existing 15-min scan
    cron. `core.js` gained a new shared `evaluateOpenTrade()` function,
    extracted from `backtest.js`'s inline trade-management loop so live
    tracking and backtest simulation share one implementation instead of
    two that could drift. New `MAX_HOLD_1H_BARS` config constant replaces
    a bare `200` that was hardcoded in that loop. New file:
    `open-positions.json`.
  - **MNT-USDT (Mantle) added** to `config.js SYMBOLS` — 14 tracked pairs
    now, up from 13. Every hardcoded "13" reference across
    `commands.js`, `config.js` comments, `setup-bot.js`, `package.json`,
    and this README updated to 14.
  - **Two direct questions answered, and the docs fixed to match:**
    - *"There are only 2 patterns?"* — no: 5 rejection patterns exist
      (POC_RECLAIM, VAH_VAL_RECLAIM, PIN_BAR, ENGULFING,
      CLOSE_REJECTION). `REJECTION_MIN_PATTERNS: 2` means 2-of-those-5
      must show up on the trigger candle, not that only 2 patterns are
      checked. The `PATTERNS_N_OF_2` diag-log reason was genuinely easy
      to misread this way — N is how many of the 5 fired, not a total
      count. Clarified in the walkthrough and Rejection Patterns section.
    - *"Which TF does 'HTF' mean in the diag log?"* — 4H, specifically
      (the STEP 5 zone cross-check). Fair question given the field name
      alone didn't say — renamed `htfAligned` → `htf4hAligned`
      (`strategy.js`, `diag.log.json` going forward) and the funnel
      counter/reason string in `backtest.js`/`strategy.js` to match
      (`HTF_ZONE_MISMATCH` → `HTF_4H_ZONE_MISMATCH`), instead of just
      documenting the ambiguity and leaving the confusing name in place.
  - **Real bug, found and fixed: dead code in `strategy.js`'s Telegram
    send helper.** `sendSafe()` had `return null;` sitting immediately
    after an unconditional `return { success: false, ... }` one line
    above it — unreachable, harmless, but genuine leftover cruft from an
    earlier edit. Removed.
  - **Real bug, found and fixed: `/positions` told users the opposite of
    what's now true.** It said "MVS is signal-only — it does not place or
    track live trades," which was accurate through v10.13 but is
    contradicted by the position-tracker.js this version ships. Rewritten
    to show real tracked-position state and describe what tracking does
    and doesn't mean (still no order placement — see "Live Position
    Tracking" above for the exact boundary). Same fix applied to the
    `/help` menu text and the command-list header comment, which had the
    same stale claim.
  - **Architecture fix: the STEP 4 / STEP 6b gate split was itself a
    mismatch.** Auditing this pass surfaced that the v10.13 POC-prominence
    gate had been sitting deep inside the Telegram-alert-building step
    (after SL/TP calculation) in `strategy.js`, while its sibling gate
    (POC_REQUIRE_1H_CONFIRM, v10.12) correctly sat right in the confluence
    check step — meaning a contested-POC setup still paid for a full SL/TP
    calculation before being thrown away, AND the two gates the docs
    described as a matched pair actually lived in different parts of the
    pipeline. Relocated the prominence gate to sit immediately next to its
    sibling gate in both `strategy.js` AND `backtest.js` (which needed the
    identical relocation to stay in sync) — pure reordering, no threshold
    changed, so this does not affect which signals fire, only how early
    a rejected one gets rejected. Funnel diagnostics reordered to match.
  - **Full walkthrough rewrite.** The "Entry Logic (Step-by-Step)" section
    below had drifted since roughly v10.10 — STEP 1 still described
    fetching only 4H/1H/15m (pre-5TF), and by v10.12/v10.13 the STEP
    numbers no longer matched `strategy.js`'s actual `STEP N` code
    comments at all (a "STEP 6a/6b" existed against a "STEP 6" that
    wasn't the code's real step 6). Rewritten to match the code exactly,
    with a note on how to re-verify it (`grep -n "STEP [0-9]"
    strategy.js`) the next time a gate moves.
  - Not touched, on purpose: every backtest threshold, gate condition, and
    config default from v10.11-v10.13 — this pass was fixes, tracking,
    and documentation, not a strategy change, so the confirmed 82.6% WR /
    360-day backtest from the previous entry should still be reproducible.
- **v10.14.1 — (2026-07-08) two follow-ups from live use: Actions still
  showing "13 pairs," and Telegram commands going unanswered.**
  - **Real bug, found and fixed: `mvs-commands.yml` had no schedule
    fallback.** It relied entirely on `workflow_dispatch: {}`, triggered
    externally by cron-job.org every 5 min, with no native GitHub
    `schedule:` backup. `mvs-scan.yml` has carried exactly that kind of
    backup from the start, with its own comment explaining why: "if
    cron-job.org has an outage, its token expires, or its ping silently
    stops." The identical failure mode applied here, just unprotected —
    if cron-job.org's ping to THIS workflow ever stopped, `/status`,
    `/positions`, and every other command would simply go unanswered,
    with nothing anywhere logging an error, indistinguishable from "the
    bot is broken." Verified `commands.js` itself end-to-end first
    (every command handler executed clean against both synthetic and the
    actual production `state.json`/`open-positions.json`/
    `signals.log.json` — zero errors) before concluding the workflow
    trigger, not the code, was the gap. Added a `*/10 * * * *` native
    schedule as a backup, mirroring `mvs-scan.yml`'s pattern exactly.
  - **The "13 pairs in Actions" report was from before the v10.14 fix
    had actually run yet.** Confirmed via a fresh backtest report
    generated after deployment: 14 symbols, MNT-USDT included with real
    trade data, `v10.14.0` correctly shown in the report header (proving
    the dynamic-version fix from the previous entry works). No further
    code change needed here — the earlier fix was already correct and
    live; the report that raised the question predated it.
  - `package.json` bumped to `10.14.1` — the only version-string change
    in this patch; every dynamic display (`strategy.js`, `backtest.js`,
    `commands.js`) picks it up automatically, nothing else to edit.
- **v10.15 — (2026-07-08) four requested improvements: multi-timeframe POC
  alignment, a Fib-level split (finally answerable), vote-strength
  sizing, and a volatility/regime filter. Session filter explicitly
  declined per instruction — not built.**
  - **Multi-TF POC alignment (size-only, POC pivot only).** Does 1H POC
    line up with 4H and/or 1D POC? Two independently-computed volume
    profiles agreeing is stronger evidence than one — same logic
    NAKED_POC already uses across time windows, applied here across
    timeframes instead. `bias4h.poc`/`bias1d.poc` were already being
    computed by the 5-TF vote for the HTF zone check, so this costs
    nothing extra to fetch. **Genuinely untested** — wired as a bounded
    boost multiplier (`MULTI_TF_POC_BOOST_MULT: 1.15`), not a gate,
    exactly how NAKED_POC itself was introduced in v10.8. New "BY
    MULTI-TF POC ALIGNMENT" backtest report section to check it against
    real trades once enough accumulate.
  - **Important discovery made while adding this: "boost" multipliers
    above 1.0 have been silently inert this entire time.** The final
    risk multiplier is clamped `Math.max(0.1, Math.min(1.0, riskMult))`
    in both `strategy.js` and `backtest.js` — meaning `NAKED_POC_BOOST_MULT`
    (1.15, live since v10.8) and the pre-v10.13 `POC_MIGRATION_BOOST_MULT`
    never actually did anything for a trade with no OTHER active discount,
    since there was nothing below 1.0 for the boost to pull back up
    toward. Not changed here — raising the 1.0 ceiling itself is a real
    risk-management decision (it would let position size legitimately
    exceed your configured `RISK_PER_TRADE_PCT` in the best case), and
    that deserves its own explicit choice, not a side effect of an
    unrelated feature request. Flagged clearly in `config.js` next to
    every affected constant.
  - **Vote-strength sizing.** 3-of-5/4-of-5/5-of-5 timeframe agreement now
    sizes at 0.70x/0.85x/1.0x respectively (`config.VOTE_STRENGTH_MULT`)
    instead of identically at every tally. Built as a discount from full
    at the strongest tally rather than a boost above it — directly because
    of the clamp finding above; this way it actually has an effect on
    every trade, not just ones that happen to have some other discount
    active. New "BY VOTE TALLY" report section — these starting values
    (0.70/0.85/1.0) are a reasoned starting point, not a backtested
    optimum; compare against a run with `VOTE_STRENGTH_SIZE_ENABLED=false`
    before trusting them.
  - **Volatility/regime filter — new gate, not just sizing.** Skips a
    setup if the current 1H ATR sits in the outer 5% of that SYMBOL'S OWN
    trailing 200-bar ATR history (`config.VOLATILITY_LOOKBACK_BARS`,
    `VOLATILITY_MIN_PCTL`/`MAX_PCTL`) — percentile against its own
    history, not a fixed number, since a quiet day for BTC and a quiet day
    for a small-cap alt aren't the same absolute ATR. New `core.js`
    functions `calcATRSeries()`/`calcATRPercentile()`. Placed as early as
    possible in the pipeline (right after ATR is computed, before any
    structure/confluence/pattern work) since it's the cheapest check and
    independent of direction/pivot/pattern. **Genuinely untested** —
    bounds deliberately conservative (only the outer 5% each side) since
    the goal was a light-touch filter, not an aggressive new gate stacked
    on everything else added this session. New `volatilityOk` funnel
    counter, new `VOLATILITY_REGIME_GATED` diag-log reason.
  - **Fibonacci 61.8% vs 78.6% split — answerable for the first time.**
    `backtest.js`'s trade records never tracked which end of the Fib
    pocket was used for entry (`strategy.js` computes this for the alert
    message, but nothing wrote it to a trade record before now). Added
    `fibPct` to the trade object and a new "BY FIB LEVEL" report section.
    **No opinion offered here on purpose** — the previous two backtest
    reports reviewed this session predate this field entirely, so there
    is no existing data to draw a conclusion from. Run `node backtest.js`
    to get the first real answer.
  - **Session filter (London/NY open restriction) — explicitly declined,
    not built.** Was on the shortlist from the prior discussion; instructed
    to skip it this round. Noted here only so a future reader doesn't
    wonder why it's absent from an otherwise-complete pass.
  - All four features wired identically into `strategy.js` (live) and
    `backtest.js` (simulation) — funnel diagnostics, gate order, and
    report sections kept in lockstep, same discipline as every prior
    version. **Not yet re-backtested on this box** (no network access to
    api.kucoin.com here) — run `node backtest.js` and compare the new
    report sections against your last confirmed run (82.6% WR, 360-day)
    before trusting any of this live. Expect the volatility filter and
    vote-strength discount to both reduce frequency somewhat further, on
    top of where v10.11-v10.14 already left it.
- **v10.15.1 — (2026-07-09) CONFIRMED REGRESSION, REVERTED. A fresh
  360-day backtest run against live v10.15 came back at +43.0% return
  (vs. the previous confirmed +100.2% on the same window) — a real,
  serious drop, not a misread. Root-caused precisely before touching
  anything, by replaying the SAME 47 closed trades from that exact report
  through the sizing math with each new factor isolated:**
  - **Vote-strength sizing was nearly the whole story.** $1,430 final
    capital with it on vs. $1,655 with it off — on the identical trade
    set. Why it hit so much harder than expected: 41 of the 47 signals
    (87%) were 3-of-5 tallies. `VOTE_STRENGTH_MULT` had been treating
    3-of-5 as the weak/rare case worth a 30% size cut — it's actually the
    NORMAL case. The default was quietly discounting almost every trade,
    not an occasional weak one. **Defaulted back to OFF**
    (`VOTE_STRENGTH_SIZE_ENABLED`). Code untouched and still fully
    functional if you want to re-test it — just not live by default
    anymore, and if you do, less aggressive starting values than
    0.70/0.85/1.0 are probably warranted given what this run showed.
  - **The volatility filter cost real signal count for unproven benefit.**
    Funnel diagnostics on the same run showed it removing 15-20% of
    vote-passing candidates on every single symbol — signal count went
    53 → 47. Win rate moved only within normal sample noise (84.0% →
    76.2% is a couple of trades either way on a ~50-trade sample, not
    evidence the filter improved quality). Cost was real and measured;
    benefit was not established. **Defaulted back to OFF**
    (`VOLATILITY_REGIME_ENABLED`), same reasoning — code stays, just not
    on by default.
  - **Multi-TF POC alignment: confirmed zero effect, left ON.** Isolated
    test on the same 47 trades: identical $1,430.30 final capital with it
    enabled or disabled. It's a boost-only mechanism gated by the same
    1.0 risk-multiplier ceiling noted in v10.15 — structurally can't hurt
    a backtest, so no reason to revert it. Still genuinely untested for
    upside; that hasn't changed.
  - **`fibPct` tracking: unaffected, left in.** Pure instrumentation, no
    trading-logic impact either way — keeps the "BY FIB LEVEL" report
    section working for whenever there's enough data to read something
    into it.
  - Net effect of this revert: sizing and gating are back to v10.14
    behavior. The only durable additions from v10.15 are the (currently
    inert-or-neutral) multi-TF POC boost and the Fib-level report
    instrumentation — both harmless by construction, kept for when there's
    real trade data to evaluate them against, per the standing philosophy
    in this repo: measure before gating, and revert fast and honestly when
    a measurement doesn't hold up. **Not yet re-backtested live on this
    box** (no network access here) — run `node backtest.js` and confirm
    the numbers land back near the v10.14 baseline before considering this
    closed.
- **v10.15.2 — (2026-07-09) CRITICAL FIX: silent Telegram message failures
  across the whole bot, root-caused from a live "commands not responding"
  report.** Telegram's legacy Markdown parse mode (used everywhere in this
  bot) has NO escape mechanism — a single unpaired `_`, `*`, or `` ` ``
  anywhere in a message causes Telegram to reject the ENTIRE message with
  a 400 "can't parse entities" error. `tgCall`/`sendSafe` catch that error
  internally and just log it, so the failure is completely silent: no
  exception surfaces, the GitHub Actions run still shows green/success,
  and the message simply never arrives — indistinguishable from "the bot
  is broken" with nothing to point at.
  - **Confirmed, not guessed.** Built the real `/status` message from
    live production `state.json` and counted underscores: 9 (odd —
    guaranteed parse failure). Traced to state values like `NO_AGREEMENT`
    (any symbol without 3-of-5 vote agreement — a routine, common state
    across 14 symbols) each carrying exactly one underscore. Whether the
    total across all symbols comes out odd or even depends purely on how
    many symbols happen to be in that state at the moment `/status` runs
    — explaining both the garbled-but-delivered reply seen earlier and
    the complete silence seen on the next three attempts, as the SAME bug,
    just landing on different sides of odd/even by chance.
  - **Far bigger than `/status`.** The same pattern exists in this bot's
    actual trade alerts: pattern names like `POC_RECLAIM` (1 underscore),
    `PIN_BAR` (1), `CLOSE_REJECTION` (1), `VAH_VAL_RECLAIM` (2) get
    embedded directly into the live signal message's pattern list. A
    signal firing on `POC_RECLAIM` alone, or `POC_RECLAIM` + `ENGULFING`,
    would have an odd total and silently fail to deliver — a REAL trade
    alert, not a status check, gone with zero indication anywhere. Also
    found in `weekly-summary.js` (patterns list) and `position-tracker.js`
    (`EARLY_TIMEOUT` close notifications).
  - **Fix: new `mdSafe()` helper, one copy per file** (same
    don't-cross-require-live-scripts discipline as every other shared
    utility in this repo), replacing underscores with spaces for DISPLAY
    only — the underlying values used for comparisons/logic/storage are
    completely untouched, only what gets rendered into a Telegram message
    changes. Applied everywhere a pattern name or a `signal`/`result`
    string reaches a message: `strategy.js` (`patternStr`, the
    `POC_RECLAIM` weak-reason note — the two that matter most, since
    they're in the actual trade alert), `commands.js` (`/status`,
    `/positions`), `weekly-summary.js` (patterns list), `position-tracker.js`
    (close notifications).
  - **Verified against real data, not just logic review**: rebuilt the
    exact `/status` message from live `state.json` with the fix applied —
    underscore count now 0 (was 9), guaranteed valid Markdown regardless
    of which symbols are in `NO_AGREEMENT` at any given moment.
  - This explains real, already-occurred failures — not just a
    theoretical risk. If any past trade alert ever silently failed to
    arrive, this is almost certainly why.
- **v10.15.3 — (2026-07-10) investigated a "TRX-USDT gets 0 trades"
  report, found no bug in TRX's handling, but found and fixed two real
  observability gaps along the way.**
  - **TRX-USDT itself: not a bug.** The 360-day funnel showed TRX reaching
    the final trigger-pattern check 24 times (comparable to LTC's 67 and
    POL's 61) but failing the TP2-extension-floor check (`TP2_MIN_EXTENSION_RR`)
    all 24 times — every other symbol passes that check at least
    occasionally. Confirmed zero TRX-specific code exists anywhere in the
    repo (`grep` for the symbol turns up nothing but its entry in the
    `SYMBOLS` list) — the identical formula runs for every symbol. A gate
    that's consistently failing on the same specific check for one symbol,
    while passing everything before it, points to that symbol's own price
    structure during this window (a narrow value area relative to its
    swing distances) rather than a bug. Not something a code change should
    "fix" — forcing weak TP2 structures through would undermine the exact
    check that's protecting trade quality.
  - **Real gap #1: the TP2-extension rejection was never logged.**
    Every other gate in the pipeline calls `logDiag()` so it shows up in
    `diag.log.json`; this one was console-log only, since v10.5. This is
    exactly why confirming the TRX finding required reading backtest
    funnel counters instead of just checking the live diag log directly —
    the live bot had no record of this specific rejection ever happening.
    Fixed: new `TP2_EXTENSION_TOO_SHORT` diag reason.
  - **Real gap #2, found while auditing for more of the same: the cooldown
    gate was never logged either**, since it was first added. Confirmed
    via the live diag log's own reason distribution before fixing — across
    1800+ real scans, zero cooldown-related entries had ever appeared.
    Fixed: new `SIGNAL_COOLDOWN` diag reason.
  - Both fixes are purely additive logging — no gate condition, threshold,
    or trading behavior changed. `diag.log.json` will simply be a more
    complete record of *why* going forward.
- **v10.15.4 — (2026-07-10) root-caused why TRX-USDT (and other symbols)
  were going stale in `/status` — not a per-symbol issue at all.**
  - **Found: `mvs-scan.yml`'s job timeout (6 minutes) was measurably too
    tight.** Worst case for `node strategy.js` alone — 14 symbols x 5
    parallel timeframe fetches each, up to 2 attempts at a 15s client
    timeout + 800ms retry wait, plus a 2s courtesy delay between symbols —
    comes to ~7.6 minutes, BEFORE counting checkout/npm-install overhead
    or the commit/push step. Confirmed via `diag.log.json`: TRX-USDT's
    entries simply stopped for a long stretch (~24h in the reported
    screenshot), no `EXCEPTION` or error reason logged anywhere — not
    consistent with a per-symbol bug, consistent with the whole job
    being killed mid-run.
  - **Why this matters more than "one missed scan":** "Commit and push
    state files" is a separate, LATER step in the workflow. If the job is
    killed while `node strategy.js` is still running, NOTHING from that
    run is committed — not even symbols already successfully processed
    earlier in the same run. This explains the shifting, seemingly-random
    pattern of which symbols looked stale: it depends on which runs
    happened to be slow (KuCoin latency, a few retries) and got killed,
    and which symbols hadn't yet been re-saved locally when that happened.
    TRX (12th of 14 in `config.SYMBOLS`) being consistently among the
    worst-affected fits — later symbols are more likely to still be
    pending when a slow run hits the ceiling.
  - **Fixed: `mvs-scan.yml` timeout raised 6 → 12 minutes** — comfortable
    margin above the ~7.6-minute worst case, still safely under the
    15-minute scan interval so a slow run finishes before the next is due.
  - **Same class of risk found and fixed in `mvs-commands.yml`**: its
    `/scan` command runs `execSync('node strategy.js', { timeout: 5*60*1000
    })` — a 5-minute inner cap — inside a job with only 7 minutes total,
    leaving almost no margin for checkout/npm-install/offset-commit
    combined. Raised 7 → 10 minutes.
  - **Defense in depth: `/status` now flags staleness directly.** Any
    symbol whose `state.json` entry is more than 45 minutes old (3x the
    normal ~15-min cadence) now shows `⚠️ Stale — last updated Xh ago`
    instead of silently looking identical to a healthy entry. This is
    what should have made the original report obvious at a glance, rather
    than requiring a manual timestamp comparison across 14 symbols.
  - Nothing about trading logic, gates, or thresholds changed in this
    version — purely a workflow-reliability and observability fix.
- **v10.15.5 — (2026-07-11) the REAL root cause of scattered per-symbol
  staleness — v10.15.4's timeout fix helped but wasn't the whole story.**
  A follow-up report showed the exact same symptom persisting even after
  the timeout fix: specific symbols (ETH, BTC, XRP, DOGE, AVAX, LINK, BNB,
  LTC, TRX) stuck stale anywhere from 3 to 37 hours, in a scattered,
  non-contiguous pattern, while others (SOL, ADA, DOT, POL, MNT) stayed
  perfectly fresh. Checked `diag.log.json` for the affected symbols
  directly: entries stopped completely, at the same moment as their
  `state.json` timestamp — no `EXCEPTION`, no gate-rejection reason,
  nothing. That rules out a per-symbol data or API problem (which would
  still leave SOME diag trail) and points at the scan loop itself simply
  never reaching them in whichever runs happened during those stretches.
  - **Found: `git pull --rebase --autostash origin main` in `mvs-scan.yml`
    (and identically in `mvs-commands.yml` and `keepalive.yml`) is
    fundamentally the wrong merge strategy for files that get FULLY
    REWRITTEN by every single run.** `state.json` has every symbol's
    `updatedAt` change on every run — if two runs' commits ever land close
    enough together (the 5-minute `isDuplicateRun()` guard in
    `strategy.js` reduces this but doesn't eliminate it — cron-job.org's
    ping and the native GitHub schedule backup can still land within
    minutes of each other), a plain rebase tries to line-by-line
    text-merge two versions of a JSON blob where nearly every line
    differs. Best case: a full conflict that fails the rebase outright —
    `git push` never runs after that, silently discarding that entire
    run's freshly-scanned data for ALL 14 symbols, not just some. Worse
    case: hunks that don't textually collide merge "successfully," but
    the result is a byte-level blend of TWO DIFFERENT RUNS' per-symbol
    data in one file — some symbols reflecting one run's timestamp,
    others reflecting a different, older run's — exactly the scattered
    pattern observed.
  - **Fix: replaced `git pull --rebase --autostash` with `git fetch` +
    `git merge -X ours` in all three workflows** (`mvs-scan.yml`,
    `mvs-commands.yml`, `keepalive.yml`). `state.json`/`diag.log.json`/
    `signals.log.json`/`open-positions.json`/`.ping.json`/`tg-offset.json`
    are self-contained, fully-regenerated outputs of whichever run
    produces them — they were never meant to be incrementally text-merged
    with a different run's version. `-X ours` guarantees that on any real
    conflict, THIS run's complete, internally-consistent version wins
    wholesale, rather than risking a partial blend — and guarantees the
    merge always succeeds (no more silently-failed pushes). Non-conflicting
    changes elsewhere in the repo still merge in normally; `-X ours` only
    decides what happens for hunks that actually collide.
  - This is a genuine, structural fix, not a tuning change — it doesn't
    touch trading logic, gates, timeouts, or thresholds at all.
- **v10.15.6 — (2026-07-11) THE ACTUAL root cause of scattered staleness,
  found and empirically proven, not just theorized. v10.15.4 (timeout)
  and v10.15.5 (git merge strategy) were both real, legitimate fixes for
  real risks — but a follow-up report showed the exact same symptom
  persisting after both had deployed: the SAME 9 symbols frozen at the
  SAME timestamps, across multiple full scan cycles, while a small,
  slowly-shrinking set of others stayed reliably fresh.**
  - **Traced it precisely this time.** Printed every `diag.log.json` entry
    in exact chronological order across several recent scan cycles. Found
    that scans run reliably on schedule (every ~15 min, confirmed), but
    each one only ever produces log entries for 2-5 symbols — with large,
    otherwise-unexplained time gaps between them that match several
    symbols' worth of the inter-symbol delay, as if those symbols were
    being reached but never logging anything at all, not even a rejection
    reason. That ruled out slow API calls or per-symbol gate rejections
    (both would leave a diag trail) and pointed at something crashing the
    whole process silently, symbol by symbol, run by run.
  - **Found it: `fs.writeFileSync()` on `state.json` is not atomic against
    a concurrent reader.** `state.json` gets read-modified-written at the
    top of every symbol's processing (a per-symbol `_lastRunAt` stamp)
    AND at several other points — 14+ times per scan. If a second workflow
    run ever overlaps even slightly (the 5-min `isDuplicateRun()` guard
    reduces this but a stacked cron-job.org ping and the native GitHub
    schedule backup can still land close together), one process's
    `readFileSync` can catch another's `writeFileSync` mid-write, producing
    a truncated/malformed JSON string. `JSON.parse` on that throws — and
    that specific read happened OUTSIDE any try/catch in `runStrategy`,
    so it crashed the entire Node process instantly, silently, with zero
    trace — killing every symbol from that point in the array onward for
    that run, while whatever ran before the crash (and whatever the NEXT
    run's luck was) explains the shifting little pool of "reliably fresh"
    symbols.
  - **Proved it, not just argued it.** Built a real test: two separate OS
    processes (not just two functions in one process — Node's single
    thread can't race with itself) hammering the same JSON file with the
    old raw-`writeFileSync` pattern while a third process read it in a
    tight loop. Result: **336 JSON parse failures out of 15,892 reads**
    (~2.1%) — a real, reproducible, measurable corruption rate. Same test
    with the fix applied (write to a temp file, then `rename()` over the
    target — atomic at the OS level on Linux, which is what GitHub Actions
    runners use): **0 failures out of 7,122 reads.**
  - **Fix: new `atomicWriteJSON()` helper, applied everywhere any shared
    JSON file gets written** — `strategy.js` (`state.json`,
    `open-positions.json`, `signals.log.json`, `diag.log.json`),
    `position-tracker.js`, `commands.js` (`tg-offset.json`), and
    `weekly-summary.js` (`equity-curve.json`) for full consistency, even
    where the risk was already low.
  - **Also removed the redundant per-symbol `_lastRunAt` write** at the
    top of `runStrategy()` — it was pure overhead (the end-of-run write
    and every `saveState()` call's own `updatedAt` already cover this),
    and it was 14 extra full-file read-write cycles per run that did
    nothing but widen the exact race window this version closes. Fewer
    writes to the same shared file per run means less exposure, not just
    less work.
  - v10.15.4 and v10.15.5 were not wasted effort — the timeout was
    genuinely too tight and the git merge strategy was genuinely risky;
    both are still correct fixes for the risks they addressed. This
    version fixes the mechanism that was actually causing the specific
    symptom reported. All three together are the complete picture.
- **v10.15.7 — (2026-07-11) one gap missed in the v10.15.6 sweep, found by
  re-checking rather than assuming the previous pass was complete.** After
  delivering v10.15.6, ran a fresh `grep -rn "writeFileSync"` across the
  entire repo one more time instead of taking the earlier fix's coverage
  on faith — found `pending-alerts.json` (the failed-Telegram-delivery
  retry queue, `queuePendingAlert()`/`flushPendingAlerts()` in
  `strategy.js`) still used the old raw `writeFileSync`, missed because it
  wasn't part of the original stale-symbol investigation's file list.
  Same exposure as everything else fixed in v10.15.6 — this file is also
  read and rewritten near the start of every single scan. Fixed with the
  same `atomicWriteJSON()` helper. Also explicitly verified `.ping.json`
  (written via shell `echo` in `mvs-scan.yml`, not Node) is safe as-is —
  confirmed nothing anywhere in the codebase ever calls `JSON.parse` on
  it, so a torn read there has no code path that could crash from it.
- **v10.15.8 — (2026-07-12) THE FINAL root cause of the "stale symbols in
  /status" saga. v10.15.4, v10.15.5, and v10.15.6/7 were all real,
  legitimate fixes for real risks — and the exact same symptom still came
  back after all of them had deployed, which is what made this one worth
  finding properly instead of assuming it was already fixed.**
  - **What ruled out every previous theory:** the same handful of symbols
    were silent in every single run, every time, for hours — not a
    shifting, probabilistic pattern the way a race condition or a killed
    job would produce. And there were zero `EXCEPTION` entries, zero
    `INSUFFICIENT_*_DATA` entries, zero `NO_3OF5_AGREEMENT` entries for
    them either. The timing also didn't fit a hang: a full 14-symbol scan
    was completing in ~26 seconds total, which is barely more than the
    13 mandatory 2-second inter-symbol delays alone — meaning every
    symbol, including the silent ones, was resolving almost instantly,
    not timing out.
  - **Found it: the vote WAS resolving for these symbols.** They kept
    landing in the one gate in the entire pipeline that was silent by
    design since it was first written — the "price isn't near the 1H Fib
    zone yet" check. That gate never called `logDiag()` or `saveState()`,
    only `console.log()` (which only exists in a GitHub Actions run log
    nobody was checking in real time). A symbol trending for hours without
    retracing into its Fib pocket — a completely normal, common market
    condition — would hit this exact branch every single scan, and
    NOTHING would ever update. That makes a perfectly healthy,
    actively-scanned symbol look byte-for-byte identical in `/status` to
    one that's genuinely broken, which is exactly what kept getting
    reported as "stale" across multiple rounds, even after three rounds
    of real infrastructure fixes.
  - **Why this one was harder to find than the others:** it isn't a
    crash, a race, or a timeout — it's a working-as-originally-designed
    silent path that turned out to be the wrong design once `/status`
    staleness detection existed to notice it (that detector was added in
    v10.15.4, after this silent gate had already existed for many
    versions). The gate itself was never broken; the assumption that
    silence here was harmless was.
  - **Fix: this gate now behaves like every other gate in the pipeline** —
    logs `NOT_NEAR_ZONE` to `diag.log.json` and calls `saveState()` with
    a new `WAITING_FOR_ZONE` signal plus the current price/bias/
    `updatedAt`, mirroring the structure of the genuine `NO_AGREEMENT`
    path just above it in the code. **Deliberately a distinct label, not
    reused `NO_AGREEMENT`** — caught before shipping, by re-checking how
    `commands.js` actually renders `signal` + `direction` together: at
    this point in the pipeline the vote HAS already resolved (`direction`
    is BUY/SELL, 3+ of 5 timeframes agreed — that's how execution reached
    this line at all), so labeling it `NO_AGREEMENT` would have shown
    contradictory text like "NO AGREEMENT (BUY)" in `/status`. First pass
    of this exact fix used `NO_AGREEMENT` and would have shipped that
    contradiction; fixed before delivery. `NO_3OF5_AGREEMENT` already
    logs at this same "most common outcome" frequency without any
    problem, so the original concern about log spam doesn't hold up in
    practice.
  - **What to expect after this deploys:** `/status`'s `⚠️ Stale` warning
    (added in v10.15.4) should now only ever fire for a genuine problem —
    every actively-scanned symbol will show a fresh `updatedAt` every ~15
    min regardless of whether it's near its zone or not, because now
    every outcome updates state, not just the interesting ones.


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
(HTF — Higher TimeFrame, meaning 4H specifically — zone cross-check), and the 15m candle still has to show a real rejection
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
| **Symbols** | ETH, SOL, BTC, XRP, ADA, DOGE, AVAX, LINK, BNB, DOT, LTC, TRX, POL, MNT (USDT) | 14 liquid pairs — repo is public, Actions minutes are free |
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
| **A1** Golden Zone | Fib 60–80% pocket overlaps POC, VAH, or VAL within ATR×0.85 | Confluence found. Proceed to HTF (4H) check. |
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

> **v10.14 note:** table C1-C5 above describes the RULES this bot uses to
> decide what "closed" means — as of v10.14 those rules are also
> **checked automatically, live**, by `position-tracker.js`, which runs
> at the start of every scan and replays real KuCoin candle history since
> each signal's entry through the same logic backtest.js uses (see that
> file's header). This closes the loop that used to only exist in
> backtest simulation. It does NOT place, modify, or close anything on
> an exchange — it only determines, after the fact, whether your
> declared SL/TP1/TP2 would have been hit, and logs that outcome so
> `/positions`, `/status`, and the weekly equity curve reflect real
> results instead of staying silent. You still place and manage the
> actual order yourself.

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
| **D9** Volatility Regime (v10.15, **OFF by default since v10.15.1**) | Current 1H ATR is in the outer 5% of this symbol's own trailing 200-bar history (either extreme) | Skip (`VOLATILITY_REGIME_GATED`) if enabled. Reverted to off by default after a confirmed backtest regression — see changelog. Toggle: `config.VOLATILITY_REGIME_ENABLED`. |
| **D10** Signal Cooldown (v10.15.3 — now logged) | Same direction fired within the last `config.SIGNAL_COOLDOWN_BARS` 1H bars | Skip (`SIGNAL_COOLDOWN`). Existed since early versions but was never written to `diag.log.json` until this fix — see changelog. |
| **D11** TP2 Extension Too Short (v10.15.3 — now logged) | TP2 (1H VAH/VAL) doesn't clear TP1 by ≥ `config.TP2_MIN_EXTENSION_RR` | Skip (`TP2_EXTENSION_TOO_SHORT`). Existed since v10.5 but was console-log-only until this fix — see changelog. |
| **D12** Not Near Zone (v10.15.8 — now logged) | Price isn't within `ATR×config.NEAR_ZONE_ATR_MULT` of the 1H Fib pocket | Skip (`NOT_NEAR_ZONE`) AND updates `state.json` with current price/bias. The single most common outcome on any scan — was completely silent through v10.15.7 (no diag entry, no state update at all), which is the actual reason behind the multi-round "symbols look stale in /status" reports — see changelog. |

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
node backtest.js                    # all 14 symbols, config.BACKTEST_DAYS
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

> **v10.14 note:** this walkthrough's STEP numbers used to drift out of
> sync with the actual code every time a gate got added or moved —
> STEP 1 was still describing the pre-v10.10 3-timeframe fetch, and by
> v10.12/v10.13 the POC gates were labeled "STEP 6a/6b" against a "STEP 6"
> that didn't exist in the code (the real confluence check was STEP 4).
> Rewritten below to match `strategy.js`'s actual `STEP N` comments
> exactly, line for line — if this ever drifts again, the `grep -n
> "STEP [0-9]" strategy.js` command is the fastest way to check.

```
STEP 1:  Fetch all FIVE timeframes — 1D (config.DAILY_VP_LOOKBACK bars),
         4H, 1H, 30m, and 15m — from KuCoin in parallel.
STEP 2:  Five-timeframe bias vote — each timeframe casts BULLISH/BEARISH/
         NEUTRAL via the same POC+VAH+VAL+Fib50 4-pillar vote
         (core.tfBiasVote). 1D and 4H are optional (null if too little
         history — doesn't crash the scan, just removes a possible vote).
         Resolve direction: need config.MIN_TF_AGREE (3) of these 5 to
         agree (core.resolveDirection). Fewer than 3 agree → D5 stop, no
         entry this scan — state.json still updates with the current bias
         breakdown either way (v10.10 fix, so /status is never more than
         one scan stale).
STEP 3:  1H structure — get the swing/Fib pocket from the 1H bias vote.
           • Volatility/regime check (v10.15, **OFF by default since
             v10.15.1** — a confirmed backtest regression, see changelog):
             when enabled, current 1H ATR ranked against this symbol's own
             trailing config.VOLATILITY_LOOKBACK_BARS (200) — below
             config.VOLATILITY_MIN_PCTL (5) or above
             config.VOLATILITY_MAX_PCTL (95) → skip
             (`VOLATILITY_REGIME_GATED`). Per-symbol percentile, not a
             fixed number — a quiet day for BTC and a quiet day for a
             small-cap alt aren't the same absolute ATR.
           • Price broke the 1H swing entirely → structural remap alert, stop.
           • Price already beyond 1H Fib 88.6% → D4 over-extended, stop.
           • Price not within ATR×config.NEAR_ZONE_ATR_MULT of the zone
             → skip (`NOT_NEAR_ZONE`, v10.15.8 — see changelog). This is
             the single most common "nothing happened" case on any given
             scan (a symbol can legitimately trend for hours without
             retracing into its Fib pocket) — through v10.15.7 this was
             silent (no diag entry, no state.json update at all), which
             made a perfectly healthy, actively-scanned symbol look
             identical to a genuinely broken one in `/status`. Now logs
             and updates state like every other gate.
STEP 4:  1H Confluence Check — does the 60–80% Fib pocket overlap 1H POC,
         VAH, or VAL? Score >= 1 (within ATR×config.CONFLUENCE_ATR_MULT)
         required for VAH/VAL; POC entries need score >= 2 (tight
         alignment — reverted back from score >= 1 in v10.11 once the
         720-day backtest confirmed POC's win rate had degraded at the
         looser threshold; see changelog). No confluence → stop.
           • POC / 1H-confirm gate (v10.12): if the pivot is POC AND 1H
             is NOT one of the 3+ agreeing timeframes, stop
             (`POC_NO1H_GATED`). Toggle: `config.POC_REQUIRE_1H_CONFIRM`.
           • POC prominence gate (v10.13, relocated here in v10.14 — see
             note below): if the pivot is POC and its volume peak doesn't
             clearly beat neighboring price rows (prominenceRatio < 1.5),
             stop (`POC_PROMINENCE_GATED`). Toggle:
             `config.POC_PROMINENCE_REQUIRE_DECISIVE`.
STEP 5:  4H Zone Cross-Check ("HTF" in the diag log / field names means
         4H specifically, not "any higher timeframe" — renamed the field
         itself to `htf4hAligned` in v10.14 since this was a fair point of
         confusion) — is the 1H entry price near a 4H structural level
         (POC/VAH/VAL/Fib50%, tolerance ATR×config.HTFZONE_ATR_MULT, same
         both directions)? No → D6 block, stop.
STEP 6:  Zone Invalidation — did the 1H close THROUGH the zone by more
         than ATR×config.ZONE_INVALIDATION_ATR_MULT? Yes → discard zone, stop.
STEP 7:  Signal Cooldown — signal fired this direction in the last
         config.SIGNAL_COOLDOWN_BARS × 1H bars? Yes → suppress, stop.
STEP 8:  15m Trigger — check the last closed 15m candle inside the 1H
         zone for config.REJECTION_MIN_PATTERNS (2) of the 5 available
         patterns (POC_RECLAIM, VAH_VAL_RECLAIM, PIN_BAR, ENGULFING,
         CLOSE_REJECTION) — **there are 5 patterns checked, not 2; "2" is
         how many of those 5 must show up on the trigger candle** (or one
         solo-eligible pattern alone — currently VAH_VAL_RECLAIM or
         CLOSE_REJECTION; see config.SOLO_ELIGIBLE_PATTERNS). Absorption
         veto active → stop. Fewer than required AND no solo-eligible
         pattern alone → wait, no signal yet (`PATTERNS_N_OF_2` in the
         diag log — N is how many of the 5 actually fired, not a total
         pattern count).
STEP 9:  Calculate SL / TP (v10.5: two real targets, not three — see below)
         Entry: best 1H Fib/POC/VAH/VAL confluence level
         SL:    1H swing wick ± config.SL_ATR_MULT × ATR (or ±
                SL_ATR_MULT_MATRIX's per-pivot override — v10.7, off by
                default, untested)
         TP1:   max(50% Fib, entry + config.TP1_RR_FLOOR R) — closes 50%
                of position, moves remaining SL to entry (breakeven)
         TP2:   1H VAH (BUY) / VAL (SELL) — the runner's target for the
                other 50%, must clear TP1 by ≥ config.TP2_MIN_EXTENSION_RR
                or the setup is skipped (this floor is why TP2 is actually
                reachable now — see the v10.5 note under Signal Taxonomy above)
STEP 10: Build and fire the Telegram alert (which TFs agreed, entry/SL/
         TP1/TP2, suggested size). Along the way (not gates, sizing/info
         only):
           • TD Sequential "9" (v10.6) — 1H exhaustion signal agrees with
             direction? Bounded upward size adjustment only, never a gate.
           • POC quality notes (v10.8/v10.9, POC pivot only) — migration
             (as of v10.13: PENALTY when it confirms trade direction — the
             original v10.8 theory had this backwards, see changelog),
             naked-POC alignment (unconfirmed either way — no trades with
             this factor present in either backtest window reviewed so
             far), and multi-timeframe POC alignment (v10.15 NEW — does
             1H POC also line up with 4H and/or 1D POC? Also genuinely
             untested — see changelog). All three size-only, not gates.
             Prominence is NOT re-checked here — it's already a gate back
             in STEP 4.
           • Vote-strength sizing (v10.15, **OFF by default since
             v10.15.1**) — when enabled, 3-of-5/4-of-5/5-of-5 tallies size
             at 0.70x/0.85x/1.0x respectively (config.VOTE_STRENGTH_MULT).
             Reverted to off after a confirmed backtest regression: 87% of
             real signals turned out to be 3-of-5, so this was discounting
             almost every trade by 30%, not an occasional weak one — see
             changelog for the exact isolated-test numbers.
         Save state.json + signals.log.json (newest-first as of v10.9)
         + open-positions.json (v10.14 — see below).

Separately, at the very START of every scan (before STEP 1 for any
symbol), position-tracker.js checks every currently-open position against
real KuCoin candle history and logs an exit if one closed — see
"Live Position Tracking" below for the full mechanism.
```

---

## Live Position Tracking (v10.14)

Through v10.13, this bot was alert-only: it told you a signal fired, and
that was the end of its involvement. Nothing ever checked what happened
next, so the equity curve in the weekly summary was always empty — a
known, documented gap, not a silent bug (see the v10.13.1 changelog entry
if you want the exact history of that gap being flagged).

**`position-tracker.js` closes that gap, with one hard constraint kept
throughout: no dedicated server, no new hosting cost.** It doesn't poll
continuously — it runs once at the very start of every existing 15-min
scan (`mvs-scan.yml` already invokes `strategy.js` on that cadence;
`checkOpenPositions()` is just called first, before any new-signal
scanning). Zero new infrastructure, zero new GitHub Actions workflow.

How it stays accurate on a 15-minute cadence instead of continuous
polling: for every open position, it re-fetches **all** 15m candles from
that position's entry time up to now (KuCoin's per-request limit is 1500
candles — comfortably more than the ~800 a full `MAX_HOLD_1H_BARS` hold
needs) and replays them one-by-one through `core.js`'s
`evaluateOpenTrade()` — the exact same function `backtest.js` uses for
simulation. So even on a 15-minute check-in, it isn't just looking at the
current price; it's replaying the full candle-by-candle history since
entry, so a SL/TP1/TP2 touch on any candle between two scans is still
caught, in the correct order, using the same high/low-based hit logic the
backtest already trusts. This is also why `evaluateOpenTrade()` was
extracted out of `backtest.js` and into `core.js` in this same pass —
one function, shared, instead of two copies that could quietly drift
apart the way other logic in this repo has before.

**Stateless by design.** `open-positions.json` stores only the ORIGINAL,
unmutated trade parameters (entry/SL/TP1/TP2/direction/entry time) — it
never persists which candles have already been checked, or whether TP1
has already banked. Every run clones a fresh copy of those original
parameters and replays from entry time forward. This costs a bit of
redundant computation each cycle (re-checking candles that were already
checked last run) but buys real robustness: there's no "the tracker's own
persisted state quietly drifted from what the candles actually say"
failure mode, because there is no persisted intermediate state to drift.

**What it does and doesn't do:**
- Does: determine whether your declared SL/TP1/TP2 would have been hit,
  log the outcome (result, exit price, R, hours held) back onto the
  *original* `signals.log.json` entry for that signal (matched by symbol
  + entry time — not a new row, the same row the alert used), update
  `state.json`, and send a Telegram notification when a position closes.
- Does NOT place, modify, or cancel any order on KuCoin or any exchange.
  It has no execution capability at all — it only tells you, after the
  fact, what would have happened if you took the trade at the alerted
  levels. You still decide your own entry and manage your own order.
- One open position per symbol is the model tracked (matches
  `state.json`'s existing one-entry-per-symbol shape). If a fresh signal
  would otherwise fire for a symbol that already has a tracked position
  open, it's skipped (`POSITION_ALREADY_OPEN` in the diag log) rather
  than silently overwritten — rare in practice given
  `SIGNAL_COOLDOWN_BARS`, but possible with an opposite-direction signal.

**Commands:** `/positions` now shows real tracked state (🟢 OPEN with
entry time, or the last closed result) instead of just "last active
signal." `/status` is unaffected for still-open positions; once a
position closes, its `state.json` entry gets `signal: 'CLOSED_<result>'`
plus the exit fields.

**New file:** `open-positions.json` — created automatically the first
time a signal fires after v10.14 is deployed; starts as `{}`.



Run it yourself — numbers below are illustrative of *how to read the
report*, not a performance claim:

```bash
node backtest.js                    # all 14 symbols, config.BACKTEST_DAYS (360)
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

### Reference snapshot (v10.13, 2026-07-07 — CONFIRMED, current code)

This is the first backtest run against the actual deployed v10.13 code
(`MIN_CONFLUENCE_POC` reverted to 2, `POC_RECLAIM` off solo-trigger,
POC/no-1H-confirm gate, POC-prominence gate, POC-migration direction
fixed) — not a projection, an actual run. 360-day window only (no fresh
90/720-day runs yet).

| Metric | 360 days |
|---|---|
| Signals fired | 48 (~0.89/wk) |
| Closed trades | 46 (2 still open) |
| Win rate | 82.6% (38W / 8L) |
| No-real-loss rate | 97.8% (45 no-loss / 1 real SL, excl. 7 BE scratches) |
| Profit factor | 48.97 |
| Total R | 47.97R |
| Avg win / avg loss | +1.29R / -0.13R |
| $1,000 → | $1,872.48 (+87.2%) |
| Max drawdown | 0.9% |
| POC pivot | 14 trades, 78.6% WR, 1 SL |
| VAH pivot | 21 trades, 90.5% WR, 0 SL |
| VAL pivot | 11 trades, 72.7% WR, 0 SL |

Frequency (~0.89/wk) sits below the original 2-3/week target — this is
the direct, expected cost of stacking four quality gates in one session
(v10.11's two changes plus v10.12's and v10.13's gates) on top of each
other without re-checking in between. Only 1 real SL across 46 closed
trades either means the gates are doing exactly their job, or that a
0.89/wk sample is still too thin to fully trust yet, or (most likely)
some of both — worth confirming against a fresh 90-day and 720-day run
before treating 82.6% WR as the new normal. If frequency needs to come
back up toward 2-3/week, the honest levers are the ones documented at
each gate above (`POC_REQUIRE_1H_CONFIRM`, `POC_PROMINENCE_REQUIRE_DECISIVE`,
`MIN_CONFLUENCE_POC`) — not a new gate, one of the existing ones dialed
back with a fresh backtest to confirm the trade-off.

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
| `/status` shows a symbol "stale" for hours while others update fine | Through v10.15.7: almost certainly `NOT_NEAR_ZONE` — the symbol's price has been legitimately trending away from its 1H Fib pocket, which was a completely silent code path (no diag entry, no state update) until v10.15.8 fixed it. As of v10.15.8 this now updates `state.json` every scan like every other gate, so a symbol actually stuck for hours post-upgrade means a REAL problem (check the GitHub Actions run history for the scan workflow directly — is it running at all, is it failing) rather than this specific, very common, entirely normal market condition |
| Too many signals (noise) | Confluence/rejection too loose | Lower `CONFLUENCE_ATR_MULT` (current default `0.85`; try `0.65`) or raise `REJECTION_MIN_PATTERNS` to `3` |
| Commands not responding | `tg-offset.json` not committed yet | Go to **Actions → MVS Commands → Run workflow** once manually to bootstrap the offset |
| `/health` shows "Last scan run: never" | `state.json` not yet committed | Go to Actions → MVS Scan → Run workflow manually once to bootstrap |
| KuCoin returns empty data | Temporary API issue | Wait a few minutes and re-run. KuCoin public API has occasional timeouts |
| Actions tab shows no runs | Workflows not enabled | Go to repo → Actions tab → enable workflows |
| Want to test WITHOUT the solo-trigger rule | `ALLOW_SOLO_TRIGGER` defaults to `true` in `config.js` (it's a net-positive rule for the reclaim/close-rejection patterns per backtest data, so it's on by default — see `config.js` for the exact patterns and reasoning) | Set to `false`, or run `ALLOW_SOLO_TRIGGER=false node backtest.js`, and compare the funnel/win-rate against the default before disabling live |
| Backtest feels slow | 360+ day backtest across 14 symbols fetches and replays a lot of 15m data | Normal — expect low tens of seconds per symbol depending on connection. Run a single symbol (`node backtest.js SOL-USDT`) while iterating on config changes |
| A workflow shows as "disabled" in the Actions tab | Genuine 60-day gap where all of a workflow's triggers failed (rare — `keepalive.yml` exists specifically to prevent this) | Click into the workflow → **Enable workflow**, or just push any commit to the repo, which re-enables all previously auto-disabled scheduled workflows |

---

## License

MIT — By Abdin. Institutional grade, zero subjectivity.
