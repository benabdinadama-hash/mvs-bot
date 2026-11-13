#!/usr/bin/env node
/** * gwp-shadow.js — GWP shadow-mode logger (v1.0) * * READ-ONLY. Places NO orders. Uses NO API keys. Touches NO MVS file. * It reads GWP's published signals.log.json (public GitHub raw URL), * checks the public Bybit market data, and writes a "would have traded" * journal to $HOME/gwp-shadow/ (outside the MVS repo, so git pulls and * the MVS watcher are never affected). * * Usage: * node execution/shadow/gwp-shadow.js # loop forever (60 s poll) * node execution/shadow/gwp-shadow.js --once # one pass, then exit * node execution/shadow/gwp-shadow.js --report # print results so far * * Config: $HOME/gwp-shadow/config.json (created on first run). Edit "gwpRepo". */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

const HOME_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || ".",
  "gwp-shadow"
);
const CFG_FILE = path.join(HOME_DIR, "config.json");
const STATE_FILE = path.join(HOME_DIR, "state.json");
const JOURNAL = path.join(HOME_DIR, "shadow.jsonl");
const BYBIT = "https://api.bybit.com";
const DEFAULT_CFG = {
  gwpRepo: "OWNER/REPO", // <-- your GWP GitHub repo, e.g. "yourname/gwp-bots"
  branch: "main",
  bots: ["forex", "stocks"], // add "crypto" to shadow crypto too
  pollSeconds: 60,
  marginUsdt: 1.5, // same as MVS, hypothetical only
  maxLeverage: 20,
  takerFeePct: 0.055,
  minNetRR: 0.6, // same as MVS NET_RR_TOO_LOW_AFTER_FEES
  gradeAMinVotes: 5, // 5+ votes ...
  gradeAOrH2: true, // ... or H2 among agreeing TFs
  maxSignalAgeHours: 6, // ignore stale signals
  maxPriceBasisPct: 0.5, // skip if Bybit price differs from GWP price by more
  timeoutHours: 72,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return d;
  }
};
const writeJSON = (f, v) => {
  const t = f + ".tmp";
  fs.writeFileSync(t, JSON.stringify(v, null, 1));
  fs.renameSync(t, f);
};
const journal = (o) =>
  fs.appendFileSync(
    JOURNAL,
    JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n"
  );

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "gwp-shadow/1.0" }, timeout: 20000 },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (res.statusCode !== 200)
            return reject(new Error(`HTTP ${res.statusCode} ${url}`));
          try {
            resolve(JSON.parse(b));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout " + url)));
    req.on("error", reject);
  });
}

// ---------- pure helpers (unit-tested) ----------
function toBybitSymbol(sym) {
  const s = String(sym).toUpperCase();
  if (s.includes("/")) return s.replace("/", "") + "USDT"; // EUR/USD -> EURUSDUSDT
  if (s.includes("-")) return s.replace("-", ""); // DOT-USDT -> DOTUSDT
  return s;
}
function parseVotes(tally) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(tally || ""));
  return m ? { n: +m[1], of: +m[2] } : { n: 0, of: 0 };
}
function gradeSignal(sig, cfg) {
  const v = parseVotes(sig.voteTally);
  const ag = (sig.agreeing || []).map((x) => String(x).toUpperCase());
  const h2 = ag.includes("H2") || ag.includes("2H");
  const hi = v.of >= 6 ? v.n >= cfg.gradeAMinVotes : v.n >= v.of && v.of > 0; // legacy 4/4 counts as unanimous
  return {
    grade: hi || (cfg.gradeAOrH2 && h2) ? "A" : "B",
    votes: v.n,
    of: v.of,
    h2,
  };
}
function planTrade(sig, bybitPrice, cfg) {
  const entry = +sig.entryPrice,
    sl = +sig.slPrice,
    tp1 = +sig.tp1Price;
  if (!(entry > 0 && sl > 0 && tp1 > 0))
    return { ok: false, reason: "BAD_LEVELS" };
  const basisPct = (Math.abs(bybitPrice - entry) / entry) * 100;
  if (basisPct > cfg.maxPriceBasisPct)
    return { ok: false, reason: "PRICE_BASIS_MISMATCH", basisPct };
  const k = bybitPrice / entry; // rescale GWP levels to Bybit price basis
  const E = bybitPrice,
    SL = sl * k,
    TP1 = tp1 * k;
  const slPct = (Math.abs(E - SL) / E) * 100,
    tpPct = (Math.abs(TP1 - E) / E) * 100;
  if (!(slPct > 0)) return { ok: false, reason: "BAD_LEVELS" };
  const lev = Math.max(1, Math.min(cfg.maxLeverage, Math.floor(60 / slPct))); // approximate; keeps liq well beyond SL
  const notional = cfg.marginUsdt * lev;
  const fee = notional * (cfg.takerFeePct / 100) * 2;
  const risk$ = (notional * slPct) / 100 + fee,
    reward$ = (notional * tpPct) / 100 - fee;
  const netRR = reward$ / risk$;
  if (netRR < cfg.minNetRR)
    return { ok: false, reason: "NET_RR_TOO_LOW_AFTER_FEES", netRR, basisPct };
  return {
    ok: true,
    entry: E,
    sl: SL,
    tp1: TP1,
    lev,
    notional,
    fee,
    risk$,
    reward$,
    netRR,
    basisPct,
    long: sig.direction === "BUY",
  };
}
/** candles: [{t(ms), h, l, c}] ascending, from entry onward. SL checked first on same-candle conflict (conservative). */
function resolveOutcome(plan, candles, startMs, timeoutH) {
  for (const k of candles) {
    if (k.t < startMs) continue;
    const slHit = plan.long ? k.l <= plan.sl : k.h >= plan.sl;
    const tpHit = plan.long ? k.h >= plan.tp1 : k.l <= plan.tp1;
    if (slHit) return { done: true, result: "SL", pnl: -plan.risk$, at: k.t };
    if (tpHit) return { done: true, result: "TP1", pnl: plan.reward$, at: k.t };
    if (k.t - startMs > timeoutH * 3600e3) {
      const mv = (plan.long ? k.c - plan.entry : plan.entry - k.c) / plan.entry;
      return {
        done: true,
        result: "TIMEOUT",
        pnl: plan.notional * mv - plan.fee,
        at: k.t,
      };
    }
  }
  return { done: false };
}

// ---------- Bybit public data ----------
async function bybitPrice(sym) {
  const j = await getJSON(
    `${BYBIT}/v5/market/tickers?category=linear&symbol=${sym}`
  );
  const it = j && j.result && j.result.list && j.result.list[0];
  return it ? +it.lastPrice : null;
}
async function bybitCandles(sym, startMs) {
  const j = await getJSON(
    `${BYBIT}/v5/market/kline?category=linear&symbol=${sym}&interval=5&start=${startMs}&limit=1000`
  );
  const l = (j && j.result && j.result.list) || [];
  return l
    .map((x) => ({ t: +x[0], h: +x[2], l: +x[3], c: +x[4] }))
    .sort((a, b) => a.t - b.t);
}

// ---------- main pass ----------
function ensureCfg() {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  if (!fs.existsSync(CFG_FILE)) writeJSON(CFG_FILE, DEFAULT_CFG);
  return { ...DEFAULT_CFG, ...readJSON(CFG_FILE, {}) };
}
async function pass(cfg) {
  const st = readJSON(STATE_FILE, { seen: {}, open: [], baselined: {} });
  if (!st.baselined) st.baselined = st.first === false ? { forex: 1 } : {}; // migrate v1 state
  if (/OWNER\/REPO/.test(cfg.gwpRepo)) {
    console.log(`[shadow] Edit ${CFG_FILE} and set "gwpRepo". Nothing done.`);
    return;
  }
  for (const bot of cfg.bots) {
    let sigs;
    try {
      sigs = await getJSON(
        `https://raw.githubusercontent.com/${cfg.gwpRepo}/${cfg.branch}/bots/${bot}/signals.log.json`
      );
    } catch (e) {
      console.log(`[shadow] ${bot}: fetch failed: ${e.message}`);
      continue;
    }
    if (!Array.isArray(sigs)) continue;
    const firstForBot = !st.baselined[bot]; // per-bot baseline: a bot added later never replays history
    for (const s of sigs) {
      if (s.signal !== "FIRED") continue;
      const key = `${bot}|${s.symbol}|${s.entryTime}|${s.direction}`;
      if (st.seen[key]) continue;
      st.seen[key] = 1;
      if (firstForBot) continue; // first time seeing this bot: baseline old history, don't replay it
      if (Date.now() / 1000 - s.entryTime > cfg.maxSignalAgeHours * 3600)
        continue;
      const g = gradeSignal(s, cfg);
      const sym = toBybitSymbol(s.symbol);
      let px = null;
      try {
        px = await bybitPrice(sym);
      } catch {}
      if (!px) {
        journal({
          bot,
          key,
          grade: g.grade,
          decision: "SKIP",
          reason: "NOT_LISTED_ON_BYBIT",
          sym,
        });
        continue;
      }
      const p = planTrade(s, px, cfg);
      if (!p.ok) {
        journal({
          bot,
          key,
          grade: g.grade,
          decision: "SKIP",
          reason: p.reason,
          netRR: p.netRR,
          basisPct: p.basisPct,
          sym,
        });
        continue;
      }
      journal({
        bot,
        key,
        grade: g.grade,
        votes: `${g.votes}/${g.of}`,
        h2: g.h2,
        decision: "WOULD_TRADE",
        sym,
        ...p,
      });
      st.open.push({
        bot,
        key,
        grade: g.grade,
        sym,
        plan: p,
        startMs: Date.now(),
      });
      console.log(
        `[shadow] WOULD TRADE (grade ${g.grade}) ${s.direction} ${sym} lev~${ p.lev }x netRR ${p.netRR.toFixed(2)}`
      );
    }
    st.baselined[bot] = 1;
  }
  const still = [];
  for (const o of st.open) {
    let c = [];
    try {
      c = await bybitCandles(o.sym, o.startMs);
    } catch {}
    const r = resolveOutcome(o.plan, c, o.startMs, cfg.timeoutHours);
    if (r.done) {
      journal({
        bot: o.bot,
        key: o.key,
        grade: o.grade,
        decision: "RESOLVED",
        result: r.result,
        pnl: +r.pnl.toFixed(4),
      });
      console.log(
        `[shadow] RESOLVED ${o.sym} ${r.result} ${r.pnl.toFixed(3)}$`
      );
    } else still.push(o);
  }
  st.open = still;
  writeJSON(STATE_FILE, st);
}
function report() {
  const rows = fs.existsSync(JOURNAL)
    ? fs
        .readFileSync(JOURNAL, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
  const res = rows.filter((r) => r.decision === "RESOLVED");
  const would = rows.filter((r) => r.decision === "WOULD_TRADE").length;
  const skips = {};
  rows
    .filter((r) => r.decision === "SKIP")
    .forEach((r) => (skips[r.reason] = (skips[r.reason] || 0) + 1));
  console.log(
    `Would-trade: ${would} | resolved: ${res.length} | skipped:`,
    skips
  );
  for (const b of [...new Set(rows.map((r) => r.bot).filter(Boolean))]) {
    const x = res.filter((r) => r.bot === b),
      w = x.filter((r) => r.pnl > 0).length;
    console.log(
      `[${b}] would-trade ${ rows.filter((r) => r.bot === b && r.decision === "WOULD_TRADE").length }, resolved ${x.length}, wins ${w}, net ${x .reduce((a, r) => a + r.pnl, 0) .toFixed(3)} USDT`
    );
  }
  for (const gr of ["A", "B"]) {
    const x = res.filter((r) => r.grade === gr),
      w = x.filter((r) => r.pnl > 0).length;
    console.log(
      `Grade ${gr}: ${x.length} resolved, ${w} wins (${ x.length ? ((100 * w) / x.length).toFixed(0) : 0 }%), net ${x .reduce((a, r) => a + r.pnl, 0) .toFixed(3)} USDT (hypothetical, after fees)`
    );
  }
}

async function main() {
  const a = process.argv.slice(2);
  const cfg = ensureCfg();
  if (a.includes("--report")) return report();
  if (a.includes("--once")) return pass(cfg);
  console.log("[shadow] gwp-shadow started (read-only, no orders, no keys).");
  for (;;) {
    try {
      await pass(cfg);
    } catch (e) {
      console.log("[shadow] pass error:", e.message);
    }
    await sleep(cfg.pollSeconds * 1000);
  }
}
if (require.main === module) main();
module.exports = {
  toBybitSymbol,
  parseVotes,
  gradeSignal,
  planTrade,
  resolveOutcome,
  DEFAULT_CFG,
};