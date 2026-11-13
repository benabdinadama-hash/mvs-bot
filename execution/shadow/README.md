# GWP shadow logger (read-only)

Places NO orders, uses NO API keys, touches NO MVS file. Journal and state live in `~/gwp-shadow/`.

## Setup
1. `node execution/shadow/gwp-shadow.js --once`  (creates `~/gwp-shadow/config.json`)
2. `nano ~/gwp-shadow/config.json` -> set `"gwpRepo": "yourname/your-gwp-repo"`
3. `bots` is `["forex", "stocks"]` by default. Add `"crypto"` if you want it too.
   (If you already have a config.json from v1, change `bots` there; defaults do not overwrite it.)
4. Start: `bash execution/shadow/start-gwp-shadow.sh`
   Stop:  `bash execution/shadow/stop-gwp-shadow.sh`
   Results: `node execution/shadow/gwp-shadow.js --report`

## Changing the bots list later
Stop, edit `bots`, start. Each bot is baselined separately the first time it is seen, so a bot added later
never replays old signals.

## Stocks
Not confirmed that Bybit lists perpetuals for GWP's stock tickers.
- Not listed -> journal says `NOT_LISTED_ON_BYBIT` and moves on.
- Listed -> signals are skipped if Bybit's price differs from GWP's by more than 0.5% (covers market-closed
  hours when the Twelve Data price is stale). 
After a few days `--report` shows skip reasons. If most are `NOT_LISTED_ON_BYBIT`, stocks cannot be auto-traded on Bybit.

## Remove
Stop it, delete `~/gwp-shadow` and `execution/shadow`.
