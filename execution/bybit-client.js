/**
 * bybit-client.js — v5 API authenticated request helper.
 *
 * Now includes write endpoints (setLeverage, placeOrder) used by
 * execution/execute-signal.js. Every call — read or write — goes through
 * the same signing logic below, which was validated in Phase 1.
 *
 * Credentials come from environment variables ONLY. Never hardcode a key
 * or secret in this file, never commit a .env file (see .gitignore).
 *   BYBIT_API_KEY
 *   BYBIT_API_SECRET
 *   BYBIT_TESTNET=true   (optional — routes to testnet instead of live)
 */

const axios = require('axios');
const crypto = require('crypto');

const API_KEY = process.env.BYBIT_API_KEY || '';
const API_SECRET = process.env.BYBIT_API_SECRET || '';
const BASE_URL = process.env.BYBIT_TESTNET === 'true'
  ? 'https://api-testnet.bybit.com'
  : 'https://api.bybit.com';

const RECV_WINDOW = '20000'; // widened from 5000 — tolerates clock skew on machines
                             // (e.g. office PCs) whose system clock isn't tightly
                             // synced. Still well within Bybit's accepted range.

// v10.16 FIX: credential check moved from module-load time to request time.
// strategy.js now requires this module unconditionally (via execute-signal.js)
// so it can fire live signals. If this threw at require() time, ANY run
// missing BYBIT_API_KEY/SECRET (e.g. the existing mvs-scan.yml workflow,
// before those secrets are added to it) would crash the entire scan —
// killing signal generation and Telegram alerts too, not just execution.
// Checking lazily means: no credentials, no execution capability, but
// signals/alerts keep working exactly as before.
const assertCredentials = () => {
  if (!API_KEY || !API_SECRET) {
    throw new Error(
      'BYBIT_API_KEY / BYBIT_API_SECRET not set. Set them as environment ' +
      'variables (GitHub Actions secrets for deployment) before any Bybit ' +
      'request — read or write — can be made.'
    );
  }
};

// Bybit v5 signing: HMAC-SHA256(timestamp + apiKey + recvWindow + payload)
// For GET: payload = sorted query string. For POST: payload = raw JSON body string.
const sign = (timestamp, payload) => {
  const raw = timestamp + API_KEY + RECV_WINDOW + payload;
  return crypto.createHmac('sha256', API_SECRET).update(raw).digest('hex');
};

const request = async (method, path, params = {}) => {
  assertCredentials();
  const timestamp = Date.now().toString();
  let url = BASE_URL + path;
  let payload = '';
  let data;

  if (method === 'GET') {
    const qs = new URLSearchParams(params).toString();
    payload = qs;
    if (qs) url += '?' + qs;
  } else {
    payload = JSON.stringify(params);
    data = params;
  }

  const signature = sign(timestamp, payload);

  const headers = {
    'X-BAPI-API-KEY': API_KEY,
    'X-BAPI-TIMESTAMP': timestamp,
    'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    'X-BAPI-SIGN': signature,
    'Content-Type': 'application/json',
  };

  try {
    const response = await axios({ method, url, headers, data });
    return response.data;
  } catch (err) {
    // Deliberately do NOT log err.config.headers here — that would print
    // the API key and signature to console/CI logs. Only surface the
    // exchange's own error payload, which never contains credentials.
    const bybitError = err.response?.data;
    throw new Error(
      `Bybit API request failed: ${method} ${path} — ` +
      (bybitError ? JSON.stringify(bybitError) : err.message)
    );
  }
};

module.exports = {
  get: (path, params) => request('GET', path, params),
  post: (path, params) => request('POST', path, params),

  // --- Write endpoints (Phase 3 — real order placement) ---

  setLeverage: (symbol, leverage) => request('POST', '/v5/position/set-leverage', {
    category: 'linear', symbol,
    buyLeverage: String(leverage), sellLeverage: String(leverage),
  }),

  // mode: 0 = One-Way (Merged Single), 3 = Hedge Mode (Both Side).
  // MVS uses One-Way. Pass { coin: 'USDT' } to switch ALL USDT perpetuals
  // at once (recommended, one call), or { symbol: 'BTCUSDT' } for just one.
  // See execution/set-position-mode.js for the one-time setup script.
  setPositionMode: ({ symbol, coin, mode }) => request('POST', '/v5/position/switch-mode', {
    category: 'linear', ...(symbol ? { symbol } : { coin }), mode,
  }),

  placeOrder: ({ symbol, side, qty, slPrice, tpPrice }) => request('POST', '/v5/order/create', {
    category: 'linear', symbol, side, orderType: 'Market', qty: String(qty),
    stopLoss: slPrice ? String(slPrice) : undefined,
    takeProfit: tpPrice ? String(tpPrice) : undefined,
    timeInForce: 'IOC',
    positionIdx: 0, // One-Way Mode — MVS only ever holds one direction per
                     // symbol at a time, never a simultaneous long+short
                     // hedge. Requires the account itself to also be set
                     // to One-Way Mode — see execution/set-position-mode.js.
  }),
};
