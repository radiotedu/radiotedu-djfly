#!/usr/bin/env node
// post-telemetry.mjs - yayin PC'den web server'a beyin snapshot'i gonderir.
// Kullanim:
//   node liquidsoap/post-telemetry.mjs --file /var/lib/djfly/last-telemetry.json \
//     --url https://ornek.com/djfly/api/broadcast-telemetry --token "$DJFLY_BROADCAST_TOKEN"
// Davranis: basari/failure her durumda yayini dusurmez. Ag hatasi = stderr + exit 0.
// Sadece eksik arguman exit 2 (on_track.sh bunu da || true ile yutar).

import { readFileSync } from 'node:fs';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const err = m => process.stderr.write(`[post-telemetry] ${m}\n`);

const file = arg('--file', process.env.DJFLY_TELEMETRY_PATH ?? '');
const url = arg('--url', process.env.DJFLY_WEB_URL ?? '');
const token = arg('--token', process.env.DJFLY_BROADCAST_TOKEN ?? '');

if (!file || !url || !token) {
  err('eksik: --file --url --token (veya DJFLY_TELEMETRY_PATH / DJFLY_WEB_URL / DJFLY_BROADCAST_TOKEN). Atlaniyor.');
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  err(`sidecar okunamadi: ${e.message}`);
  process.exit(0);
}
if (!payload || typeof payload.trackId !== 'string' || !payload.trackId) {
  err('sidecar bos (ilk acilis olabilir). Atlaniyor.');
  process.exit(0);
}

try {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    signal: ctrl.signal
  });
  clearTimeout(timer);
  if (!res.ok) err(`web kabul etmedi: HTTP ${res.status}`);
  else err(`gonderildi: ${payload.trackId} (HTTP ${res.status})`);
} catch (e) {
  err(`gonderilemedi (web kapali olabilir): ${e.message}`);
}
process.exit(0);
