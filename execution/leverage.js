/**
 * leverage.js — computes the leverage to actually use for a given trade,
 * capping it DOWN from the account ceiling whenever the technical SL
 * (from core.js) is wider than what that ceiling's liquidation buffer
 * would tolerate. This is the design confirmed earlier: 20x is a ceiling,
 * never a floor — MVS's own stop-loss is what should close a trade, not
 * Bybit's forced liquidation.
 */

// v10.39 CORRECTION — 0.6 was proven insufficient by a real trade
// (ARB-USDT, 2026-09-24): SL was calculated at 5.553% from entry, this
// formula chose 16x expecting a liquidation buffer of (100/16 - 0.6) =
// 5.65% — comfortably past the SL. Bybit's REAL liquidation price came
// back at only 5.301% from entry — meaning the true maintenance-margin-
// plus-fee cost on this account/symbol was actually ~0.95 percentage
// points, not 0.6. That's not a rounding error — it left the SL on the
// wrong side of the liquidation price entirely, confirmed by Bybit's own
// on-screen warning. On a ~$5 account, a liquidation (not a clean SL
// fill) is a materially worse outcome — raised to 2.0pp, which models
// out to ~1.2 percentage points of real margin even against the actual
// (not assumed) buffer this trade revealed. This is deliberately
// generous rather than the tightest value that would have "just" worked
// — Bybit's real MMR can vary by symbol and tier, and this account
// cannot absorb being wrong about it a second time.
const MMR_AND_FEE_BUFFER_PCT = 2.0; // percentage points — was 0.6, see v10.39 correction above

const computeSafeLeverage = (entryPrice, slPrice, maxLeverage) => {
  const slDistancePct = (Math.abs(entryPrice - slPrice) / entryPrice) * 100;

  // Liquidation move at leverage L is approximately (100/L)% minus the
  // maintenance margin + fee buffer. We want: liquidation move > slDistance.
  // Solve for the largest L such that (100/L - buffer) > slDistance:
  //   L < 100 / (slDistance + buffer)
  const maxSafeLeverage = 100 / (slDistancePct + MMR_AND_FEE_BUFFER_PCT);

  const chosen = Math.max(1, Math.min(maxLeverage, Math.floor(maxSafeLeverage)));

  // v10.39 addition — "measure it, don't guess" for the exact thing that
  // just went wrong: the estimated liquidation move and safety margin
  // this leverage choice implies, so it's visible in the watcher log for
  // every future trade instead of silently trusted.
  const estimatedLiqMovePct = parseFloat((100 / chosen - MMR_AND_FEE_BUFFER_PCT).toFixed(3));
  const safetyMarginPct = parseFloat((estimatedLiqMovePct - slDistancePct).toFixed(3));

  return {
    leverage: chosen,
    slDistancePct: parseFloat(slDistancePct.toFixed(3)),
    capped: chosen < maxLeverage,
    estimatedLiqMovePct,
    safetyMarginPct,
  };
};

module.exports = { computeSafeLeverage, MMR_AND_FEE_BUFFER_PCT };
