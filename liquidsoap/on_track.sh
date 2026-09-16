#!/usr/bin/env bash
# on_track.sh - Liquidsoap parca-degisim kancasi.
# 1) Her zaman: parcayi logla (dry-run guvenli).
# 2) Opsiyonel: son beyin snapshot'ini web server'a gonder.
#    DJFLY_WEB_URL + DJFLY_BROADCAST_TOKEN yoksa adim 2 sessizce atlanir.
#    Poster basarisiz olsa bile cikis 0'dır, yayin etkilenmez.
LOG_DIR="${DJFLY_LOG_DIR:-/var/log/radiotedu}"
mkdir -p "$LOG_DIR"
echo "$(date -Is) TRACK: $1" >> "$LOG_DIR/tracks.log"

POSTER="${DJFLY_POSTER:-/opt/djfly/liquidsoap/post-telemetry.mjs}"
if [ -n "${DJFLY_WEB_URL:-}" ] && [ -n "${DJFLY_BROADCAST_TOKEN:-}" ] && [ -f "$POSTER" ]; then
  node "$POSTER" >> "$LOG_DIR/post-telemetry.log" 2>&1 || true
fi
exit 0
