#!/data/data/com.termux/files/usr/bin/bash
#
# COPY THIS FILE to ~/.termux/boot/start-mvs-watcher.sh on your phone
# (not just clone it as part of the repo — Termux:Boot only looks in
# ~/.termux/boot/, which is outside any git repo).
#
# Requires the separate "Termux:Boot" app installed from F-Droid (NOT
# available on Play Store). Once installed, any script placed in
# ~/.termux/boot/ runs automatically every time your phone finishes
# booting — this is what makes the watcher survive a phone restart
# without you having to remember to relaunch it.
#
# Adjust REPO_PATH below to wherever you cloned the repo on your phone.

REPO_PATH="$HOME/mvs-bot"   # <-- change if your repo folder is named/located differently

termux-wake-lock
cd "$REPO_PATH" || exit 1
bash execution/start-watcher.sh
