/**
 * instrument-info.js — Bybit enforces exact quantity/price rounding per
 * symbol (qtyStep, minOrderQty, tickSize). Sending a raw computed quantity
 * without rounding to these is one of the most common real-world causes of
 * order rejections. This fetches and caches that info per symbol so we
 * only hit the endpoint once per symbol per process run.
 */

const bybit = require('./bybit-client');

const cache = new Map();

const getInstrumentInfo = async (symbol) => {
  if (cache.has(symbol)) return cache.get(symbol);

  const res = await bybit.get('/v5/market/instruments-info', { category: 'linear', symbol });
  if (res.retCode !== 0) throw new Error(`instruments-info failed for ${symbol}: ${res.retMsg}`);

  const info = res.result?.list?.[0];
  if (!info) throw new Error(`No instrument info returned for ${symbol} — check symbol spelling/format.`);

  const parsed = {
    qtyStep: parseFloat(info.lotSizeFilter.qtyStep),
    minOrderQty: parseFloat(info.lotSizeFilter.minOrderQty),
    tickSize: parseFloat(info.priceFilter.tickSize),
  };
  cache.set(symbol, parsed);
  return parsed;
};

// Rounds a raw quantity DOWN to the symbol's legal step size — rounding up
// would risk exceeding the intended margin; rounding down is the safe
// direction when the exact fit isn't a whole multiple of qtyStep.
const roundQtyDown = (rawQty, qtyStep) => {
  const steps = Math.floor(rawQty / qtyStep);
  return parseFloat((steps * qtyStep).toFixed(10));
};

const roundPriceToTick = (rawPrice, tickSize) => {
  const ticks = Math.round(rawPrice / tickSize);
  return parseFloat((ticks * tickSize).toFixed(10));
};

module.exports = { getInstrumentInfo, roundQtyDown, roundPriceToTick };
