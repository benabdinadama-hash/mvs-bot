// TEMPORARY DIAGNOSTIC — not part of the live strategy. Delete after use.
//
// Purpose: confirm, from inside GitHub Actions (the actual environment
// strategy.js runs in — a cloud/datacenter IP, NOT the phone), whether
// Bybit's public kline endpoint is reachable and returns real data for
// every symbol MVS scans. This is the deciding test for whether MVS
// could switch its market-data source from KuCoin to Bybit (eliminating
// the KuCoin/Bybit basis gap that's been tripping SIGNAL_STALE_PRICE_MOVED
// and part of the fee-filter math) — WITHOUT changing anything else.
//
// No API key needed — this is Bybit's public market-data endpoint.
// Docs: https://bybit-exchange.github.io/docs/v5/market/kline

const axios = require('axios');

// Same 20 symbols as config.js SYMBOLS, converted from KuCoin's
// 'ETH-USDT' format to Bybit's 'ETHUSDT' format (no hyphen).
const SYMBOLS = [
  'ETH-USDT', 'SOL-USDT', 'BTC-USDT', 'XRP-USDT',
  'ADA-USDT', 'DOGE-USDT', 'AVAX-USDT', 'LINK-USDT',
  'BNB-USDT', 'DOT-USDT', 'LTC-USDT', 'TRX-USDT', 'POL-USDT',
  'MNT-USDT',
  'ATOM-USDT', 'NEAR-USDT', 'APT-USDT', 'ARB-USDT', 'OP-USDT', 'SUI-USDT',
];

const toBybitSymbol = (kucoinSymbol) => kucoinSymbol.replace('-', '');

const fetchOne = async (symbol) => {
  const bybitSymbol = toBybitSymbol(symbol);
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${bybitSymbol}&interval=15&limit=3`;
  const started = Date.now();
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const elapsedMs = Date.now() - started;
    if (res.data.retCode !== 0) {
      return { symbol, ok: false, elapsedMs, error: `retCode ${res.data.retCode}: ${res.data.retMsg}` };
    }
    const rows = res.data.result?.list || [];
    if (rows.length === 0) {
      return { symbol, ok: false, elapsedMs, error: 'empty candle list' };
    }
    // list[0] is the newest candle: [startTime, open, high, low, close, volume, turnover]
    const [startTime, open, high, low, close] = rows[0];
    return {
      symbol, ok: true, elapsedMs,
      lastCandle: { startTime: new Date(parseInt(startTime)).toISOString(), open, high, low, close },
    };
  } catch (e) {
    const elapsedMs = Date.now() - started;
    return { symbol, ok: false, elapsedMs, error: e.message };
  }
};

(async () => {
  console.log(`Testing Bybit public kline endpoint for ${SYMBOLS.length} symbols from this environment...\n`);
  const results = [];
  for (const symbol of SYMBOLS) {
    const r = await fetchOne(symbol);
    results.push(r);
    if (r.ok) {
      console.log(`✅ ${symbol.padEnd(10)} ${r.elapsedMs}ms — last 15m candle @ ${r.lastCandle.startTime}: close $${r.lastCandle.close}`);
    } else {
      console.log(`❌ ${symbol.padEnd(10)} ${r.elapsedMs}ms — FAILED: ${r.error}`);
    }
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} symbols succeeded.`);

  if (failed.length > 0) {
    console.log('\nFailed symbols:', failed.map(f => f.symbol).join(', '));
    process.exitCode = 1; // makes the Actions run show red/failed
  } else {
    console.log('\nAll symbols reachable — Bybit public kline endpoint works from this environment.');
  }
})();
