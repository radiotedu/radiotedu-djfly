#!/usr/bin/env bash
# on_track.sh - Liquidsoap parca-degisim kancasi. Varsayilan: SADECE log (dry-run).
# Ag'a yazan islem yok. Sinek karari zaten djfly-next.mjs icinde verilir;
# bu script sadece gozlem icindir.
LOG_DIR="${DJFLY_LOG_DIR:-/var/log/radiotedu}"
mkdir -p "$LOG_DIR"
echo "$(date -Is) TRACK: $1" >> "$LOG_DIR/tracks.log"
