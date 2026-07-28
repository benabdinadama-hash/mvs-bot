/**
 * leverage.js — computes the leverage to actually use for a given trade,
 * capping it DOWN from the account ceiling whenever the technical SL
 * (from core.js) is wider than what that ceiling's liquidation buffer
 * would tolerate. This is the design confirmed earlier: 20x is a ceiling,
 * never a floor — MVS's own stop-loss is what should close a trade, not
 * Bybit's forced liquidation.
 */

// Approximate maintenance margin rate + fee buffer for Bybit USDT perps at
// low-to-mid leverage tiers. This is intentionally conservative (slightly
// larger than the real MMR) so the computed "safe" leverage leaves real
// headroom rather than sitting right at the liquidation edge.
const MMR_AND_FEE_BUFFER_PCT = 0.6; // percentage points

const computeSafeLeverage = (entryPrice, slPrice, maxLeverage) => {
  const slDistancePct = (Math.abs(entryPrice - slPrice) / entryPrice) * 100;

  // Liquidation move at leverage L is approximately (100/L)% minus the
  // maintenance margin + fee buffer. We want: liquidation move > slDistance.
  // Solve for the largest L such that (100/L - buffer) > slDistance:
  //   L < 100 / (slDistance + buffer)
  const maxSafeLeverage = 100 / (slDistancePct + MMR_AND_FEE_BUFFER_PCT);

  const chosen = Math.max(1, Math.min(maxLeverage, Math.floor(maxSafeLeverage)));

  return {
    leverage: chosen,
    slDistancePct: parseFloat(slDistancePct.toFixed(3)),
    capped: chosen < maxLeverage,
  };
};

module.exports = { computeSafeLeverage, MMR_AND_FEE_BUFFER_PCT };
