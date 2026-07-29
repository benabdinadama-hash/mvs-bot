/**
 * set-position-mode.js — ONE-TIME setup script. Run this once to switch
 * your Bybit account's USDT perpetual position mode to One-Way (Merged
 * Single). Fixes the "position idx not match position mode" (code 10001)
 * error MVS was hitting on every real order attempt.
 *
 * Safe to run again later if unsure whether it already worked — Bybit
 * just confirms the mode is already set if nothing changed.
 *
 * Usage: node execution/set-position-mode.js
 */

const bybit = require('./bybit-client');

(async () => {
  console.log('--- Switching Bybit account to One-Way Mode (USDT perpetuals) ---\n');
  try {
    const res = await bybit.setPositionMode({ coin: 'USDT', mode: 0 });
    if (res.retCode !== 0) {
      throw new Error(`${res.retMsg} (code ${res.retCode})`);
    }
    console.log('✅ Success — account is now in One-Way Mode for all USDT perpetuals.');
    console.log('You can now restart the watcher and real orders should stop failing with code 10001.');
  } catch (err) {
    console.error('❌ FAILED:', err.message);
    console.error('\nIf this mentions an existing position or active order: close/cancel it first,');
    console.error('then re-run this script. Bybit won\'t let you switch modes with something open.');
  }
})();
