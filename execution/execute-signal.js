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
// ─────────────────────────────────────────────────────────────────────────────

const toBybitSymbol = (mvsSymbol) => mvsSymbol.replace('/', '').replace('-', ''); // e.g. BTC/USDT -> BTCUSDT — adjust if your symbol format differs

const executeSignal = async (signal) => {
  const { symbol, direction, entryPrice, slPrice, tp1Price } = signal;
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
  const roundedTp = tp1Price ? roundPriceToTick(tp1Price, instrument.tickSize) : undefined;
  const side = direction === 'BUY' ? 'Buy' : 'Sell';

  const plan = {
    symbol: bybitSymbol, side, qty, leverage,
    marginUsdt: MARGIN_PER_TRADE_USDT, notionalUsdt: parseFloat(notional.toFixed(2)),
    entryPrice, slPrice: roundedSl, tp1Price: roundedTp, slDistancePct,
  };

  // 5. DRY RUN — compute and log everything above, touch nothing real.
  if (DRY_RUN) {
    console.log(`${tag} [DRY RUN] Would place order:`, JSON.stringify(plan, null, 2));
    return { executed: false, reason: 'DRY_RUN', plan };
  }

  // 6. LIVE — set leverage, then place the order with SL/TP attached.
  try {
    const leverageRes = await bybit.setLeverage(bybitSymbol, leverage);
    // retCode 110043 = "leverage not modified" — harmless, means it was
    // already set to this value from a prior run. Anything else nonzero is real.
    if (leverageRes.retCode !== 0 && leverageRes.retCode !== 110043) {
      throw new Error(`setLeverage failed: ${leverageRes.retMsg} (code ${leverageRes.retCode})`);
    }

    const orderRes = await bybit.placeOrder({
      symbol: bybitSymbol, side, qty, slPrice: roundedSl, tpPrice: roundedTp,
    });
    if (orderRes.retCode !== 0) {
      throw new Error(`placeOrder failed: ${orderRes.retMsg} (code ${orderRes.retCode})`);
    }

    const orderId = orderRes.result.orderId;
    ledger.recordOpened({
      symbol: bybitSymbol, side, orderId,
      entryTime: Date.now(), margin: MARGIN_PER_TRADE_USDT, leverage,
    });

    console.log(`${tag} ✅ LIVE order placed. orderId=${orderId} qty=${qty} leverage=${leverage}x`);
    return { executed: true, orderId, plan };
  } catch (err) {
    console.error(`${tag} ❌ Execution failed: ${err.message}`);
    return { executed: false, reason: 'EXECUTION_ERROR', error: err.message };
  }
};

module.exports = { executeSignal, DRY_RUN, MARGIN_PER_TRADE_USDT, MAX_LEVERAGE, MAX_CONCURRENT_TRADES };
