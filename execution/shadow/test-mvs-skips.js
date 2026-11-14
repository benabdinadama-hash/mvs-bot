const assert = require('assert'), fs = require('fs'), path = require('path');
const m = require('./mvs-skips.js');
const K = (t, o, h, l, c) => ({ t: t * 300000, o, h, l, c });
const buy = { direction: 'BUY', slPrice: 98, tp1Price: 102, tp2Price: 104 };
// BUY: entry 100, risk 2 -> TP1 +1R, TP2 +2R
let r = m.simulate(buy, [K(1, 100, 100.5, 99.5, 100), K(2, 100, 102.5, 100, 102), K(3, 102, 104.5, 101, 104)]);
assert.strictEqual(r.result, 'TP1+TP2'); assert(Math.abs(r.grossR - 1.5) < 1e-9);
r = m.simulate(buy, [K(1, 100, 100.5, 99.5, 100), K(2, 100, 102.5, 100, 102), K(3, 102, 103, 99.9, 100)]);
assert.strictEqual(r.result, 'TP1+BE'); assert(Math.abs(r.grossR - 0.5) < 1e-9);
r = m.simulate(buy, [K(1, 100, 102.5, 97.5, 100)]);                 // same candle SL+TP1 -> SL first
assert.strictEqual(r.result, 'SL');
r = m.simulate(buy, [K(1, 103, 104, 102, 103)]);                    // opens beyond TP1 -> no edge
assert.strictEqual(r.result, 'ALREADY_PAST_TP1');
const sell = { direction: 'SELL', slPrice: 102, tp1Price: 98, tp2Price: 96 };
r = m.simulate(sell, [K(1, 100, 100.2, 99.8, 100), K(2, 100, 100, 97.5, 98), K(3, 98, 98.5, 95.5, 96)]);
assert.strictEqual(r.result, 'TP1+TP2'); assert(Math.abs(r.grossR - 1.5) < 1e-9);
assert.strictEqual(m.simulate(sell, [K(1, 100, 100.2, 99.8, 100), K(2, 100, 100, 97.5, 98)]).status, 'PENDING');
assert.strictEqual(m.simulate(buy, []).status, 'NO_DATA');
assert.strictEqual(m.toBybit('POL-USDT'), 'POLUSDT');
const src = fs.readFileSync(path.join(__dirname, 'mvs-skips.js'), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
for (const bad of ['apiKey', 'secret', 'BYBIT_API', '/v5/order', '/v5/position', '/v5/account', 'bybit-client', 'execute-signal', 'keys.sh']) assert(!src.includes(bad), 'forbidden: ' + bad);
// every write must target the OUT_* files (outside the repo)
src.split('\n').filter((l) => /(writeFileSync|appendFileSync|renameSync|mkdirSync)/.test(l)).forEach((l) => assert(/OUT_|\bt\b|tmp/.test(l), 'write outside OUT_: ' + l.trim()));
console.log('mvs-skips tests passed');
