/**
 * fee-estimate.js — v10.30 addition.
 *
 * WHY THIS EXISTS: every Telegram signal alert has always shown a GROSS
 * R:R (pure price-distance ratio: |tp - entry| / |entry - sl|), with zero
 * allowance for Bybit's own trading fees. On a full-size account that
 * rounding error doesn't matter. On this account's $1.5 margin per trade,
 * it does — round-trip taker fees can eat a large fraction of a 1.2R TP1
 * target, and in the worst cases flip a nominally-positive setup into a
 * real-money loser even when price does exactly what the alert said it
 * would. This module computes the real, fee-adjusted number and is the
 * single source of truth for it — used both by strategy.js (an ESTIMATE,
 * shown in the Telegram alert before any order exists) and by
 * execution/execute-signal.js (the real pre-trade GATE, computed from the
 * actual live price/leverage right before an order is placed). If the fee
 * rate or the minimum ever needs to change, change it here once — not in
 * two places that can drift apart (see PARTIAL_EXIT_PCT's header comment
 * in execute-signal.js for exactly that kind of drift bug, previously).
 */

// Bybit USDT-perpetual taker fee, standard (non-VIP) tier — confirmed
// current as of writing: 0.055% taker / 0.02% maker. The entry (a Market
// order) and an SL exit are always taker fills. TP legs are resting
// reduce-only LIMIT orders and would normally earn the lower maker rate
// — this deliberately assumes taker for every leg anyway, so the
// estimate stays conservative (slightly overestimates fee drag) rather
// than let a genuinely marginal trade through on an optimistic number.
const TAKER_FEE_PCT = 0.055; // percent, i.e. 0.00055 as a fraction

// Below this fee-adjusted TP1 R:R, execute-signal.js refuses the trade
// outright (see NET_RR_TOO_LOW_AFTER_FEES there) — fees are eating too
// much of the theoretical edge to be worth taking at this position size.
// Deliberately permissive: 0.6 only catches genuinely bad cases (fees
// eating well over half the edge), not just "less than the 1.2 R:R
// floor implies." Raise it if you want to be pickier about what fires
// for real; this is a single constant to tune, not a code change.
const MIN_NET_RR_AFTER_FEES = 0.6;

/**
 * Estimates the fee-adjusted R:R for the TP1 leg specifically — the leg
 * every single trade has (split or not), and the one most exposed to fee
 * drag since it's the smaller, faster target.
 *
 *   entryPrice, slPrice, tpPrice — price levels (tpPrice = TP1)
 *   marginUsdt — margin committed to this trade
 *   leverage   — leverage actually used (post-cap, see execution/leverage.js)
 *
 * Returns null if the inputs can't produce a valid risk distance (should
 * never happen for a signal that already passed core.js's own checks,
 * but this is defensive rather than assuming that).
 */
const computeNetRR = ({ entryPrice, slPrice, tpPrice, marginUsdt, leverage }) => {
  const risk = Math.abs(entryPrice - slPrice);
  if (!(risk > 0) || !(entryPrice > 0) || !(marginUsdt > 0) || !(leverage > 0)) return null;

  const notional = marginUsdt * leverage;
  const grossRiskUsdt = notional * (risk / entryPrice);
  const rewardDist = Math.abs(tpPrice - entryPrice);
  const grossRewardUsdt = notional * (rewardDist / entryPrice);

  // Round-trip fee: one taker fill to enter (full notional) + one taker
  // fill to exit (full notional, whether that exit is the SL or the TP
  // leg — either way the whole position's notional crosses the fee
  // schedule once more on the way out).
  const feeUsdt = notional * (TAKER_FEE_PCT / 100) * 2;

  const netRiskUsdt = grossRiskUsdt + feeUsdt;
  const netRewardUsdt = grossRewardUsdt - feeUsdt;
  const grossRR = grossRiskUsdt > 0 ? grossRewardUsdt / grossRiskUsdt : 0;
  const netRR = netRiskUsdt > 0 ? netRewardUsdt / netRiskUsdt : 0;

  return {
    notional,
    grossRiskUsdt: parseFloat(grossRiskUsdt.toFixed(4)),
    grossRewardUsdt: parseFloat(grossRewardUsdt.toFixed(4)),
    feeUsdt: parseFloat(feeUsdt.toFixed(4)),
    netRiskUsdt: parseFloat(netRiskUsdt.toFixed(4)),
    netRewardUsdt: parseFloat(netRewardUsdt.toFixed(4)),
    grossRR: parseFloat(grossRR.toFixed(3)),
    netRR: parseFloat(netRR.toFixed(3)),
  };
};

module.exports = { TAKER_FEE_PCT, MIN_NET_RR_AFTER_FEES, computeNetRR };
