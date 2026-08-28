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
  if (ledger.isSymbolOpen(bybitSymbol)) {
    console.log(`${tag} Already have an open position on ${bybitSymbol} in our ledger — skipping to avoid a duplicate order.`);
    return { executed: false, reason: 'SYMBOL_ALREADY_OPEN' };
  }

  // 3. Leverage — capped down from the 20x ceiling if this trade's
  //    technical SL is wider than what 20x's liquidation buffer allows.
  const { leverage, slDistancePct, capped } = computeSafeLeverage(entryPrice, slPrice, MAX_LEVERAGE);
  if (capped) {
    console.log(`${tag} SL distance ${slDistancePct}% is wide — leverage auto-capped to ${leverage}x (ceiling is ${MAX_LEVERAGE}x).`);
  }

  // 4. Quantity — respecting the exchange's real lot-size rules for this
  //    symbol (this is the step that prevents "wrong decimal" mistakes).
  let instrument;
  try {
    instrument = await getInstrumentInfo(bybitSymbol);
  } catch (err) {
    console.error(`${tag} Failed to fetch instrument info: ${err.message}`);
    return { executed: false, reason: 'INSTRUMENT_INFO_FAILED', error: err.message };
  }

  const notional = MARGIN_PER_TRADE_USDT * leverage;
  const rawQty = notional / entryPrice;
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
    entryPrice, slPrice: roundedSl, slDistancePct,
    ...(canSplit
      ? { split: true, qty1, tp1Price: roundedTp1, qty2, tp2Price: roundedTp2 }
      : { split: false, tp1Price: roundedTp1, note: roundedTp2 ? 'position too small to split into two legal partial exits — full qty exits at TP1' : 'no tp2Price on this signal — single-TP behavior' }),
  };

  // 5. DRY RUN — compute and log everything above, touch nothing real.
  if (DRY_RUN) {
    console.log(`${tag} [DRY RUN] Would place order:`, JSON.stringify(plan, null, 2));
    return { executed: false, reason: 'DRY_RUN', plan };
  }

  // 6. LIVE — set leverage, place the entry (SL always attached — Bybit's
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
