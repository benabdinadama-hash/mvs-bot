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

// v10.24 FIX — root cause of the "watcher needs 2x pkill before it's
// clear" symptom. axios has NO default timeout. On a phone hopping
// between 4G towers / Doze-throttled background data, a request can
// hang on an open TCP socket indefinitely — never resolving, never
// rejecting. Since watcher.js's setInterval keeps firing every 60s
// regardless of whether the previous cycle finished, a single hung
// request here didn't just delay one cycle — it let every subsequent
// cycle pile up behind it (new pullLatest() calls, new git processes,
// new Bybit calls), which is what actually wedges the process. A
// wedged process is still alive (pgrep still matches it) but stops
// doing useful work, which is exactly what forced a manual restart —
// and sometimes twice, because a fresh watcher started while the old
// hung request/child processes were still unwinding. Fixed at the
// root: every request now fails fast instead of hanging forever.
const REQUEST_TIMEOUT_MS = 15000;

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

  // v10.24 FIX — one retry on genuine network-level failures only
  // (timeout / connection reset / DNS blip) — the exact class of
  // transient error a mobile connection produces routinely. Does NOT
  // retry on a real Bybit error response (4xx/5xx with a retCode) —
  // that's a genuine rejection, not a network hiccup, and retrying it
  // blindly could double-submit an order. Only ever retries once, and
  // only for GET-safe idempotent reads plus the specific write calls
  // below that are themselves idempotent by design (setLeverage,
  // switch-mode) — placeOrder is deliberately excluded, see below.
  const attempt = async () => {
    const response = await axios({ method, url, headers, data, timeout: REQUEST_TIMEOUT_MS });
    return response.data;
  };

  try {
    return await attempt();
  } catch (err) {
    const isNetworkError = !err.response && (
      err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' ||
      err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' ||
      err.message?.includes('timeout')
    );
    // Never blind-retry a real order placement on a network error — if
    // the first attempt's request actually reached Bybit and only the
    // RESPONSE got lost to the network blip, a retry could place the
    // same order twice. Every other call here (reads, setLeverage,
    // switch-mode, closed-pnl lookups) is safe to retry because
    // repeating them changes nothing or is a no-op if already applied.
    const isSafeToRetry = isNetworkError && path !== '/v5/order/create';
    if (isSafeToRetry) {
      console.error(`[bybit-client] ${method} ${path} — network error (${err.code || err.message}), retrying once after 2s...`);
      await new Promise(r => setTimeout(r, 2000));
      try {
        return await attempt();
      } catch (err2) {
        const bybitError2 = err2.response?.data;
        throw new Error(
          `Bybit API request failed after retry: ${method} ${path} — ` +
          (bybitError2 ? JSON.stringify(bybitError2) : err2.message)
        );
      }
    }
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

  // v10.26: one leg of a genuine partial exit (TP1 or TP2) — a resting
  // Limit order at a specific target price, reduceOnly so it can only
  // ever shrink the existing position, never open a new one or flip
  // direction (Bybit enforces this server-side too, but setting it
  // explicitly is the whole point of using this over placeOrder's
  // single Market+TP shape). GTC because this needs to sit and wait to
  // be triggered, unlike the entry order's IOC. See execute-signal.js
  // for why this exists — the short version: the entry order's own
  // stopLoss (Full mode, the default) keeps protecting whatever
  // quantity remains after this fills, per Bybit's own docs ("Once the
  // order is fully or partially filled, the TP/SL order will be placed
  // for the entire position") — confirmed before relying on it here.
  placeReduceOnlyLimit: ({ symbol, side, qty, price }) => request('POST', '/v5/order/create', {
    category: 'linear', symbol, side, orderType: 'Limit', qty: String(qty), price: String(price),
    reduceOnly: true, timeInForce: 'GTC', positionIdx: 0,
  }),

  // v10.27: fresh live price, fetched right before executing a signal —
  // see execute-signal.js for why. Public endpoint (no auth strictly
  // required) but reused through the same signed request() helper for
  // consistency (retry/timeout handling all just works the same way).
  getTicker: (symbol) => request('GET', '/v5/market/tickers', { category: 'linear', symbol }),
};
