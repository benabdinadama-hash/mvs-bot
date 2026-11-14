# MVS skipped-signals journal (read-only)

Answers one question: would the signals the live bot SKIPPED have won, if entered the way the bot really enters
(market order, at the moment it checked the signal)?

* Places NO orders, uses NO API keys, changes NO MVS file. Reads `execution/executed-signals.json` and
  `signals.log.json`; uses public Bybit candles; writes only to `~/mvs-skips/`.
* Skip reasons analysed: SIGNAL_STALE_PRICE_MOVED, NET_RR_TOO_LOW_AFTER_FEES, SYMBOL_ALREADY_OPEN,
  SYMBOL_ALREADY_OPEN_ON_EXCHANGE, BELOW_MIN_ORDER_QTY.
* Simulation: entry = open of the first 5-min candle after the bot looked; the signal's own SL / TP1 / TP2;
  50% closed at TP1, then stop moves to entry (as MVS does); SL wins a same-candle tie; 72 h timeout;
  fees 0.11% round trip deducted. Result in R (multiples of planned risk).

Run:   node execution/shadow/mvs-skips.js --once     (evaluates all history, prints the report)
Loop:  bash execution/shadow/start-mvs-skips.sh      (checks new skips every 10 min)
Stop:  bash execution/shadow/stop-mvs-skips.sh
Show:  node execution/shadow/mvs-skips.js --report
Remove: stop it, delete ~/mvs-skips and the three mvs-skips files.

Reading it: a reason with clearly positive net R over many resolved skips means that filter may be too strict.
Samples are small (tens, not hundreds) - treat as a hint, not proof, and never change a filter from this alone.

## Start the journals after a phone reboot (optional, separate from the watcher)
    mkdir -p ~/.termux/boot
    cp ~/mvs-bot/execution/shadow/termux-boot-journals.sh ~/.termux/boot/start-journals.sh
    chmod +x ~/.termux/boot/start-journals.sh
Needs the Termux:Boot app (the same one your watcher boot script uses). Undo: `rm ~/.termux/boot/start-journals.sh`.
