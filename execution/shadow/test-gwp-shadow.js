const assert = require('assert'); const fs = require('fs'); const path = require('path');
const m = require('./gwp-shadow.js'); const c = m.DEFAULT_CFG;
assert.strictEqual(m.toBybitSymbol('EUR/USD'), 'EURUSDUSDT'); assert.strictEqual(m.toBybitSymbol('DOT-USDT'), 'DOTUSDT');
assert.strictEqual(m.gradeSignal({ voteTally: '5/6', agreeing: ['M15'] }, c).grade, 'A');
assert.strictEqual(m.gradeSignal({ voteTally: '4/6', agreeing: ['M15', 'H2'] }, c).grade, 'A');
assert.strictEqual(m.gradeSignal({ voteTally: '4/6', agreeing: ['M15', 'H1'] }, c).grade, 'B');
const p = m.planTrade({ direction: 'BUY', entryPrice: 1.1, slPrice: 1.098, tp1Price: 1.105 }, 1.1, c); assert(p.ok && p.netRR > 0.6);
assert.strictEqual(m.planTrade({ direction: 'BUY', entryPrice: 1.1, slPrice: 1.098, tp1Price: 1.105 }, 1.2, c).reason, 'PRICE_BASIS_MISMATCH');
const now = Date.now();
assert.strictEqual(m.resolveOutcome(p, [{ t: now, h: 1.106, l: 1.099, c: 1.1 }], now, 72).result, 'TP1');
assert.strictEqual(m.resolveOutcome(p, [{ t: now, h: 1.106, l: 1.097, c: 1.1 }], now, 72).result, 'SL'); // same candle: SL first
const src = fs.readFileSync(path.join(__dirname, 'gwp-shadow.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
for (const bad of ['apiKey', 'secret', 'BYBIT_API', '/v5/order', '/v5/position', '/v5/account', 'bybit-client', 'execute-signal', 'require(\'../'])
  assert(!src.includes(bad), 'forbidden term: ' + bad);
console.log('gwp-shadow tests passed');
