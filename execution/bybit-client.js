/**
 * bybit-client.js — v5 API authenticated request helper.
 *
 * PHASE 1 (current): read-only wiring. This file is generic — it can sign
 * ANY v5 request, read or write — but nothing in the codebase calls a
 * write endpoint (order placement, leverage changes, etc.) yet. That
 * comes in later phases, deliberately, after this signing layer is
 * proven correct against read-only endpoints first.
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

if (!API_KEY || !API_SECRET) {
  throw new Error(
    'BYBIT_API_KEY / BYBIT_API_SECRET not set. Set them as environment ' +
    'variables (local .env for testing, GitHub Actions secrets for ' +
    'deployment) — never hardcode them in a file.'
  );
}

// Bybit v5 signing: HMAC-SHA256(timestamp + apiKey + recvWindow + payload)
// For GET: payload = sorted query string. For POST: payload = raw JSON body string.
const sign = (timestamp, payload) => {
  const raw = timestamp + API_KEY + RECV_WINDOW + payload;
  return crypto.createHmac('sha256', API_SECRET).update(raw).digest('hex');
};

const request = async (method, path, params = {}) => {
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
};
