/**
 * test-auth.js — PHASE 1 smoke test.
 *
 * Calls two READ-ONLY Bybit v5 endpoints to prove the API key, secret,
 * and HMAC signing are all correct. Places NO orders, touches NO funds.
 * Run this before ever moving on to Phase 2.
 *
 * Usage (local machine, NOT this sandbox — it has no network access to
 * Bybit):
 *   BYBIT_API_KEY=xxx BYBIT_API_SECRET=yyy node execution/test-auth.js
 *
 * Or with a .env file (see .env.example) and a loader like dotenv:
 *   node -r dotenv/config execution/test-auth.js
 */

const bybit = require('./bybit-client');

(async () => {
  console.log('--- MVS Phase 1: Bybit auth smoke test ---\n');

  try {
    console.log('1. Fetching wallet balance (UNIFIED account)...');
    const wallet = await bybit.get('/v5/account/wallet-balance', { accountType: 'UNIFIED' });
    if (wallet.retCode !== 0) {
      throw new Error(`Bybit returned an error: ${wallet.retMsg} (code ${wallet.retCode})`);
    }
    const usdt = wallet.result?.list?.[0]?.coin?.find(c => c.coin === 'USDT');
    console.log(`   ✅ Auth works. USDT balance visible: ${usdt ? usdt.walletBalance : '(none found)'}\n`);

    console.log('2. Fetching open positions (linear/USDT)...');
    const positions = await bybit.get('/v5/position/list', { category: 'linear', settleCoin: 'USDT' });
    if (positions.retCode !== 0) {
      throw new Error(`Bybit returned an error: ${positions.retMsg} (code ${positions.retCode})`);
    }
    const openCount = positions.result?.list?.filter(p => parseFloat(p.size) > 0).length || 0;
    console.log(`   ✅ Positions endpoint works. Open positions right now: ${openCount}\n`);

    console.log('--- PASSED: signing is correct, key has the right permissions, no orders were touched. ---');
  } catch (err) {
    console.error('--- FAILED ---');
    console.error(err.message);
    console.error('\nCommon causes: wrong key/secret, IP restriction mismatch, clock skew ' +
      '(recv_window), or BYBIT_TESTNET=true set while using a live-account key (or vice versa).');
    process.exit(1);
  }
})();
