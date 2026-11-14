#!/data/data/com.termux/files/usr/bin/bash
#
# OPTIONAL. Starts the two READ-ONLY journals (gwp-shadow, mvs-skips) after the phone boots.
# It is a SEPARATE Termux:Boot script: it does not touch, replace or depend on your watcher boot script.
# Copy it to ~/.termux/boot/start-journals.sh   (see README-mvs-skips.md). To undo: delete that one file.

REPO_PATH="$HOME/mvs-bot"

termux-wake-lock
sleep 90                       # let the network and the watcher come up first
cd "$REPO_PATH" || exit 0      # if the folder is missing, do nothing
bash execution/shadow/start-gwp-shadow.sh
bash execution/shadow/start-mvs-skips.sh
