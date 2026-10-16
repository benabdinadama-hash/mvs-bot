/**
 * check-api-key.js — v10.42 addition.
 *
 * Answers "is the Bybit API key close to expiring, or otherwise broken?"
 * using Bybit's own key-introspection endpoint, instead of only relying on
 * a human remembering the 90-day policy documented in the README.
 *
 * Endpoint: GET /v5/user/query-api (Bybit v5 — confirmed against Bybit's
 * own official docs at bybit-exchange.github.io/docs/v5/user/apikey-info,
 * not just a third-party source). Any permission can call it; it reports
 * on the key making the call. No request parameters.
 *
 * Response includes (among other fields):
 *   - expiredAt / deadlineDay — the key's expiry timestamp and days
 *     remaining. Per Bybit's docs, these are only meaningful for a key
 *     with NO IP restriction (or one whose password changed) — which is
 *     exactly this bot's key (see README "90-day key expiry" section: no
 *     IP restriction is a deliberate choice, since the phone's mobile IP
 *     isn't stable enough to whitelist).
 *   - ips — the IP allowlist bound to the key (expected empty here).
 *   - readOnly — 0 = read/write (trade-capable), 1 = read-only.
 *   - apiKey / secret — THE CREDENTIALS THEMSELVES, echoed back by Bybit.
 *
 * SECURITY: this module reads ONLY expiredAt, deadlineDay, ips, readOnly
 * off the response below. It never reads, logs, stores, or transmits
 * (Telegram or otherwise) the apiKey/secret fields or any other field not
 * explicitly listed here. Keep it that way in any future edit.
 *
 * Usage:
 *   node execution/check-api-key.js            — manual, human-readable
 *   require('./check-api-key').checkApiKeyHealth()
 *     — used by watcher.js for an automatic once-a-day check + Telegram
 *       warning when the key is close to expiring or has gone read-only.
 */

const bybitClient = require('./bybit-client');

const WARN_WITHIN_DAYS = 7; // give enough lead time for the user to renew by hand before it actually lapses

const checkApiKeyHealth = async () => {
  const res = await bybitClient.get('/v5/user/query-api');
  if (!res || res.retCode !== 0) {
    throw new Error(`Bybit query-api failed: retCode ${res && res.retCode} — ${res && res.retMsg}`);
  }
  const r = res.result || {};

  // Deliberately destructure ONLY the non-sensitive fields this module is
  // allowed to touch. r.apiKey / r.secret exist on the real response and
  // must never be referenced below — see the file header.
  const { expiredAt, deadlineDay, ips, readOnly } = r;

  const hasIpRestriction = Array.isArray(ips) && ips.length > 0 && !(ips.length === 1 && ips[0] === '*');
  const deadlineIsNumber = typeof deadlineDay === 'number' && Number.isFinite(deadlineDay);
  // A negative/absent deadlineDay (Bybit's own example response shows -2
  // for a key the field doesn't apply to) means "not meaningful" — only
  // treat 0..WARN_WITHIN_DAYS as a real warning, not every non-positive number.
  const expiringSoon = !hasIpRestriction && deadlineIsNumber && deadlineDay >= 0 && deadlineDay <= WARN_WITHIN_DAYS;

  return {
    expiredAt: expiredAt || null,
    deadlineDay: deadlineIsNumber ? deadlineDay : null,
    hasIpRestriction,
    readOnly: readOnly === 1,
    expiringSoon,
  };
};

if (require.main === module) {
  (async () => {
    try {
      const h = await checkApiKeyHealth();
      console.log('--- Bybit API key health ---');
      console.log(`IP restriction: ${h.hasIpRestriction ? 'YES (unexpected for this bot)' : 'none (expected)'}`);
      console.log(`Read-only: ${h.readOnly ? 'YES — trading would fail with this key!' : 'no (trade-capable)'}`);
      console.log(`Expires at: ${h.expiredAt || 'n/a (not reported for this key state)'}`);
      console.log(`Days remaining: ${h.deadlineDay === null ? 'n/a' : h.deadlineDay}`);
      if (h.expiringSoon) {
        console.log(`\n⚠️  Renew soon: Bybit app → API → your key → Edit → re-select "No IP restriction" → Submit. Same key/secret — no GitHub Secrets or code changes needed.`);
      } else if (h.deadlineDay !== null) {
        console.log(`\nNo action needed yet.`);
      }
    } catch (err) {
      console.error('Could not check API key health:', err.message);
      process.exitCode = 1;
    }
  })();
}

module.exports = { checkApiKeyHealth, WARN_WITHIN_DAYS };
