/**
 * execute-signal.js — called once from strategy.js, right after a signal
 * fires and saveOpenPosition() records it. Turns that signal into a real
 * (or dry-run) Bybit order.
 *
 * DRY_RUN default is TRUE. See the flag below for exactly where to change
 * it. Recommendation stands regardless of that default: watch at least
 * one real dry-run log line before flipping it — it costs one signal
 * cycle and catches sizing mistakes before they cost money.
 */

const bybit = require('./bybit-client');
const { getInstrumentInfo, roundQtyDown, roundPriceToTick } = require('./instrument-info');
const { computeSafeLeverage } = require('./leverage');
const ledger = require('./position-ledger');
const killSwitch = require('./kill-switch');

// ─── Config — the numbers agreed on in this conversation ───────────────────
// v10.16: DRY_RUN set to false per explicit user instruction, after being
// told plainly that untested code carries real risk of a sizing/precision
// mistake. User's stated rationale: the $3 balance is deliberately
// earmarked as disposable test capital, and time-sensitive signals don't
// wait. Risk accepted knowingly — logged here for the record, not as a
// lecture, just so future-you remembers this was a deliberate call.
const DRY_RUN = false;
const MARGIN_PER_TRADE_USDT = 1.5;
const MAX_LEVERAGE = 20;
const MAX_CONCURRENT_TRADES = 3;
// v10.26 FIX — the Telegram alert has always promised "TP1 (exit 50%,
// move SL to entry)... TP2 (runner, remaining 50%)", and config.js's
// PARTIAL_EXIT_PCT=0.5 is exactly what core.js's backtest engine has
// always assumed when computing this strategy's advertised win-rate/R:R
// — but this file never actually implemented it: it read only tp1Price,
// placed ONE order for the FULL quantity, with a single TP at TP1. Every
// live trade closed 100% at TP1 (≈1.2R), never touching the TP2 leg
// (≈3.26R) the backtested numbers depend on. Confirmed live: a real
// NEAR-USDT trade closed in full the instant TP1 was touched while price
// kept climbing well past TP1 toward a TP2 that was never targeted.
// MUST match config.js's PARTIAL_EXIT_PCT — this file intentionally
// keeps its own local constants (see MARGIN_PER_TRADE_USDT etc. above)
// rather than importing config.js, so if you ever change one, change
// both.
const PARTIAL_EXIT_PCT = 0.5;
// ─────────────────────────────────────────────────────────────────────────────

const toBybitSymbol = (mvsSymbol) => mvsSymbol.replace('/', '').replace('-', ''); // e.g. BTC/USDT -> BTCUSDT — adjust if your symbol format differs

const executeSignal = async (signal) => {
  const { symbol, direction, entryPrice, slPrice, tp1Price, tp2Price } = signal;
  const bybitSymbol = toBybitSymbol(symbol);
  const tag = `[execute-signal ${symbol}]`;

  // 1. Kill switch — checked first, before any other work.
  if (killSwitch.isPaused()) {
    console.log(`${tag} Kill switch is ON (paused). Skipping execution for this signal.`);
    return { executed: false, reason: 'KILL_SWITCH_PAUSED' };
  }

  // 2. Max concurrent trades — counts ONLY our own ledger, never the
  //    account's raw position list (which includes the user's 2 manual
  //    positions and must never be touched or counted by this bot).
  const openCount = ledger.countOpen();
  if (openCount >= MAX_CONCURRENT_TRADES) {
    console.log(`${tag} Already at max concurrent trades (${openCount}/${MAX_CONCURRENT_TRADES}). Skipping.`);
    return { executed: false, reason: 'MAX_CONCURRENT_TRADES_REACHED' };
  }

  // 2b. v10.25: symbol-specific duplicate check — a backstop against
  //     double-execution regardless of cause. The count check above
  //     only limits the TOTAL number of open trades; it does nothing to
  //     stop two independent execution attempts for the SAME signal
  //     (e.g. strategy.js's inline call and watcher.js's poll loop, if
  //     they were ever to race) from both passing it and both placing a
  //     real order on the same symbol. This closes that gap directly,
  //     independent of whatever process/path called executeSignal().
  const ledgerSaysOpen = ledger.isSymbolOpen(bybitSymbol);
  if (ledgerSaysOpen) {
    console.log(`${tag} Already have an open position on ${bybitSymbol} in our ledger — skipping to avoid a duplicate order.`);
    return { executed: false, reason: 'SYMBOL_ALREADY_OPEN' };
  }

  // 2c. v10.28 FIX — defense-in-depth: don't just trust the local ledger
  // file, confirm against Bybit's own live position list directly.
  // Confirmed real: our-positions.json went from correctly showing an
  // open TRXUSDT entry to a fully empty array between two check-status.js
  // runs, while the REAL Bybit position was (and still is) genuinely
  // open the entire time. Traced through both reconcileLedger() and
  // watcher.js's pull-conflict recovery in detail — neither one actually
  // deletes an entry from the ledger array (they only ever change its
  // status field), so the exact mechanism that produced a fully empty
  // array isn't pinned down with certainty. Rather than guess at one
  // specific cause and patch only that, this closes the CONSEQUENCE
  // directly: isSymbolOpen() saying "no" is no longer trusted alone —
  // the exchange itself is asked too, as the one source of truth that
  // can't be out of sync with itself. Logs loudly if the two ever
  // disagree, so a recurrence is visible in the log even before it
  // matters for a new trade.
  try {
    const livePositions = await bybit.get('/v5/position/list', { category: 'linear', symbol: bybitSymbol });
    const realOpenPosition = (livePositions.result?.list || []).find(p => parseFloat(p.size) > 0);
    if (realOpenPosition) {
      if (!ledgerSaysOpen) {
        console.error(`${tag} ⚠️ LEDGER MISMATCH: our-positions.json says ${bybitSymbol} is not open, but Bybit shows a real ` +
          `open position (size=${realOpenPosition.size}, side=${realOpenPosition.side}). Trusting Bybit — refusing to enter. ` +
          `The local ledger is out of sync with reality and should be checked manually.`);
      }
      console.log(`${tag} Bybit's own position list shows ${bybitSymbol} already has a real open position — skipping to avoid a duplicate order.`);
      return { executed: false, reason: 'SYMBOL_ALREADY_OPEN_ON_EXCHANGE' };
    }
  } catch (err) {
    // Can't confirm either way — refuse to enter rather than risk a
    // duplicate. This is a stricter gate than the ledger check above,
    // never a looser one.
    console.error(`${tag} Failed to verify live position state on Bybit: ${err.message} — refusing to execute rather than risk a duplicate.`);
    return { executed: false, reason: 'POSITION_CHECK_FAILED', error: err.message };
  }

  // 3. v10.27 FIX — fetch a live price and validate the signal's target
  //    levels are still ahead of it before ever entering. Confirmed root
  //    cause of a real bad fill: TRX-USDT fired at 10:45 (theoretical
  //    entry 0.3365606, TP1 0.34025) but didn't actually execute until
  //    11:52 — 67 minutes later, almost certainly the git-pull/DNS
  //    failures visible in the watcher log around that time. By then the
  //    REAL market price had already climbed to 0.3405 — past where TP1
  //    was calculated. The TP1 reduce-only limit order was placed BELOW
  //    the live price and filled INSTANTLY the moment it was submitted,
  //    capturing essentially zero profit (44 TRX exited at ~breakeven)
  //    instead of ever being a genuine resting target. This check catches
  //    that before entry ever happens, not after.
  let lastPrice;
  try {
    const tickerRes = await bybit.getTicker(bybitSymbol);
    const rawPrice = tickerRes?.result?.list?.[0]?.lastPrice;
    if (tickerRes.retCode !== 0 || !rawPrice) {
      throw new Error(`getTicker failed or returned no price: ${tickerRes.retMsg || 'empty result'} (code ${tickerRes.retCode})`);
    }
    lastPrice = parseFloat(rawPrice);
  } catch (err) {
    console.error(`${tag} Failed to fetch live price for staleness check: ${err.message}`);
    return { executed: false, reason: 'TICKER_FETCH_FAILED', error: err.message };
  }

  // Reject if price has already blown through the stop-loss level —
  // entering now would mean starting the trade already invalidated
  // relative to its own risk boundary.
  const pastSl = direction === 'BUY' ? lastPrice <= slPrice : lastPrice >= slPrice;
  if (pastSl) {
    console.error(`${tag} Live price ${lastPrice} is already at/through the stop-loss ${slPrice} — thesis invalidated. Skipping.`);
    return { executed: false, reason: 'SIGNAL_STALE_PAST_SL', lastPrice, slPrice };
  }

  // Reject if price has already consumed most/all of the intended move
  // to TP1 — requires at least MIN_REMAINING_PCT of the ORIGINAL
  // theoretical distance (from the signal's stale entryPrice to TP1)
  // still ahead of the live price. This is the exact check that would
  // have caught the TRX case: remainingToTp1 was negative (price had
  // already passed TP1 entirely).
  const MIN_REMAINING_PCT = 0.15;
  if (tp1Price) {
    const originalToTp1 = direction === 'BUY' ? (tp1Price - entryPrice) : (entryPrice - tp1Price);
    const remainingToTp1 = direction === 'BUY' ? (tp1Price - lastPrice) : (lastPrice - tp1Price);
    if (originalToTp1 > 0 && remainingToTp1 < originalToTp1 * MIN_REMAINING_PCT) {
      const pctLeft = Math.round((remainingToTp1 / originalToTp1) * 100);
      console.error(`${tag} Signal is stale — live price ${lastPrice} has already consumed most/all of the move to TP1 ${tp1Price} ` +
        `(theoretical entry was ${entryPrice}, only ~${pctLeft}% of the original TP1 distance remains, need ≥${MIN_REMAINING_PCT * 100}%). Skipping — market has moved past this setup.`);
      return { executed: false, reason: 'SIGNAL_STALE_PRICE_MOVED', lastPrice, tp1Price, entryPrice, pctOfMoveRemaining: pctLeft };
    }
  }

  // 4. Leverage — capped down from the 20x ceiling if this trade's
  //    technical SL is wider than what 20x's liquidation buffer allows.
  //    Uses the LIVE price, not the signal's stale theoretical entryPrice
  //    — this is what the real entry (a Market order) will actually fill
  //    near, so sizing math should be based on it too.
  const { leverage, slDistancePct, capped } = computeSafeLeverage(lastPrice, slPrice, MAX_LEVERAGE);
  if (capped) {
    console.log(`${tag} SL distance ${slDistancePct}% is wide — leverage auto-capped to ${leverage}x (ceiling is ${MAX_LEVERAGE}x).`);
  }

  // 5. Quantity — respecting the exchange's real lot-size rules for this
  //    symbol (this is the step that prevents "wrong decimal" mistakes).
  let instrument;
  try {
    instrument = await getInstrumentInfo(bybitSymbol);
  } catch (err) {
    console.error(`${tag} Failed to fetch instrument info: ${err.message}`);
    return { executed: false, reason: 'INSTRUMENT_INFO_FAILED', error: err.message };
  }

  const notional = MARGIN_PER_TRADE_USDT * leverage;
  const rawQty = notional / lastPrice;
  const qty = roundQtyDown(rawQty, instrument.qtyStep);

  if (qty < instrument.minOrderQty) {
    console.error(`${tag} Computed qty ${qty} is below ${bybitSymbol}'s minimum order qty (${instrument.minOrderQty}). ` +
      `$${MARGIN_PER_TRADE_USDT} margin at ${leverage}x isn't enough for this symbol right now. Skipping.`);
    return { executed: false, reason: 'BELOW_MIN_ORDER_QTY' };
  }

  const roundedSl = roundPriceToTick(slPrice, instrument.tickSize);
  const roundedTp1 = tp1Price ? roundPriceToTick(tp1Price, instrument.tickSize) : undefined;
  const roundedTp2 = tp2Price ? roundPriceToTick(tp2Price, instrument.tickSize) : undefined;
  const side = direction === 'BUY' ? 'Buy' : 'Sell';
  const exitSide = side === 'Buy' ? 'Sell' : 'Buy'; // reduce-only TP legs trade the OPPOSITE side to close

  // Split into TP1/TP2 legs — only when we actually have a tp2Price AND
  // both halves clear the exchange's minimum order size at this qty.
  // At this account's $1.5 margin, a coarse-lot-size symbol (BTC, ETH)
  // often can't legally split — that's expected and handled, not an
  // error; it just falls back to the old single-TP-at-TP1 behavior for
  // that trade rather than attempting an order Bybit would reject.
  let qty1 = null, qty2 = null, canSplit = false;
  if (roundedTp2) {
    const rawQty1 = roundQtyDown(qty * PARTIAL_EXIT_PCT, instrument.qtyStep);
    const rawQty2 = roundQtyDown(qty - rawQty1, instrument.qtyStep); // remainder, not qty*(1-PCT) recomputed — avoids losing a sliver to double rounding
    if (rawQty1 >= instrument.minOrderQty && rawQty2 >= instrument.minOrderQty) {
      qty1 = rawQty1;
      qty2 = rawQty2;
      canSplit = true;
    }
  }

  const plan = {
    symbol: bybitSymbol, side, qty, leverage,
    marginUsdt: MARGIN_PER_TRADE_USDT, notionalUsdt: parseFloat(notional.toFixed(2)),
    theoreticalEntryPrice: entryPrice, lastPrice, slPrice: roundedSl, slDistancePct,
    ...(canSplit
      ? { split: true, qty1, tp1Price: roundedTp1, qty2, tp2Price: roundedTp2 }
      : { split: false, tp1Price: roundedTp1, note: roundedTp2 ? 'position too small to split into two legal partial exits — full qty exits at TP1' : 'no tp2Price on this signal — single-TP behavior' }),
  };

  // 6. DRY RUN — compute and log everything above, touch nothing real.
  if (DRY_RUN) {
    console.log(`${tag} [DRY RUN] Would place order:`, JSON.stringify(plan, null, 2));
    return { executed: false, reason: 'DRY_RUN', plan };
  }

  // 7. LIVE — set leverage, place the entry (SL always attached — Bybit's
  //    default "Full" mode SL automatically keeps protecting whatever
  //    quantity remains after a partial TP fill, confirmed against
  //    Bybit's own docs before relying on this: "Once the order is fully
  //    or partially filled, the TP/SL order will be placed for the
  //    entire position." No extra SL-resizing code needed for safety).
  //    Then, if splitting, place TP1 and TP2 as two separate reduce-only
  //    limit legs instead of a single TP on the entry order itself.
  try {
    const leverageRes = await bybit.setLeverage(bybitSymbol, leverage);
    // retCode 110043 = "leverage not modified" — harmless, means it was
    // already set to this value from a prior run. Anything else nonzero is real.
    if (leverageRes.retCode !== 0 && leverageRes.retCode !== 110043) {
      throw new Error(`setLeverage failed: ${leverageRes.retMsg} (code ${leverageRes.retCode})`);
    }

    const orderRes = await bybit.placeOrder({
      symbol: bybitSymbol, side, qty, slPrice: roundedSl,
      tpPrice: canSplit ? undefined : roundedTp1, // non-split fallback keeps the old single-TP-on-entry behavior
    });
    if (orderRes.retCode !== 0) {
      throw new Error(`placeOrder failed: ${orderRes.retMsg} (code ${orderRes.retCode})`);
    }

    const orderId = orderRes.result.orderId;
    let tp1OrderId = null, tp2OrderId = null, tpLegWarnings = [];

    if (canSplit) {
      try {
        const tp1Res = await bybit.placeReduceOnlyLimit({ symbol: bybitSymbol, side: exitSide, qty: qty1, price: roundedTp1 });
        if (tp1Res.retCode !== 0) throw new Error(`${tp1Res.retMsg} (code ${tp1Res.retCode})`);
        tp1OrderId = tp1Res.result.orderId;
      } catch (err) {
        const msg = `TP1 leg failed to place: ${err.message}`;
        tpLegWarnings.push(msg);
        console.error(`${tag} ⚠️ ${msg} — position is OPEN and SL-protected, but has no take-profit order on this leg. Check manually.`);
      }
      try {
        const tp2Res = await bybit.placeReduceOnlyLimit({ symbol: bybitSymbol, side: exitSide, qty: qty2, price: roundedTp2 });
        if (tp2Res.retCode !== 0) throw new Error(`${tp2Res.retMsg} (code ${tp2Res.retCode})`);
        tp2OrderId = tp2Res.result.orderId;
      } catch (err) {
        const msg = `TP2 leg failed to place: ${err.message}`;
        tpLegWarnings.push(msg);
        console.error(`${tag} ⚠️ ${msg} — position is OPEN and SL-protected, but has no take-profit order on this leg. Check manually.`);
      }
    }

    ledger.recordOpened({
      symbol: bybitSymbol, side, orderId,
      entryTime: Date.now(), margin: MARGIN_PER_TRADE_USDT, leverage,
      ...(canSplit ? { split: true, qty1, tp1OrderId, qty2, tp2OrderId } : { split: false }),
    });

    console.log(`${tag} ✅ LIVE order placed. orderId=${orderId} qty=${qty} leverage=${leverage}x` +
      (canSplit ? ` [split: ${qty1}@TP1 $${roundedTp1}, ${qty2}@TP2 $${roundedTp2}]` : ` [single TP $${roundedTp1 ?? 'none'}]`));
    return { executed: true, orderId, tp1OrderId, tp2OrderId, tpLegWarnings: tpLegWarnings.length ? tpLegWarnings : undefined, plan };
  } catch (err) {
    console.error(`${tag} ❌ Execution failed: ${err.message}`);
    return { executed: false, reason: 'EXECUTION_ERROR', error: err.message };
  }
};

module.exports = { executeSignal, DRY_RUN, MARGIN_PER_TRADE_USDT, MAX_LEVERAGE, MAX_CONCURRENT_TRADES, PARTIAL_EXIT_PCT };
