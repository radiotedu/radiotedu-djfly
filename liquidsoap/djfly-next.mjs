#!/usr/bin/env node
// djfly-next.mjs - Liquidsoap `request.dynamic` koprusu.
// Her cagrida BIR sonraki sarkinin mutlak yolunu stdout'a basar.
// Kullanim (Liquidsoap cagirir, elle test de edilebilir):
//   node liquidsoap/djfly-next.mjs --pool local/pools/canli.json \
//     --state /var/lib/djfly/state.json --last /var/lib/djfly/last.txt \
//     --music-dir /opt/radiotedu/muzik
// Cikti protokolu: stdout'ta TEK satir dosya yolu, baska cikti yok.
// Hata durumunda stderr'e yazar ve sifir-disi kodla cikar (Liquidsoap fallback'a duser).
//
// Guvenlik: token/secret okumaz. Gercek MaleCNS artifact'i gerekir
// (generated/runtime-manifest.json). Fixture uretimde yasaktir.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { createDJFly } from '../index.mjs';

const DEFAULT_CAPABILITIES = [
  'clean-blend', 'long-eq-blend', 'filter-sweep',
  'bass-swap', 'echo-transition', 'short-loop', 'controlled-cut'
];

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const err = m => process.stderr.write(`[djfly-next] ${m}\n`);

const poolPath = arg('--pool', process.env.DJFLY_POOL_PATH ?? '');
const statePath = arg('--state', process.env.DJFLY_STATE_PATH ?? '');
const lastPath = arg('--last', process.env.DJFLY_LAST_PATH ?? '');
const musicDir = arg('--music-dir', process.env.MUZIK_DIR ?? '');

if (!poolPath || !statePath || !lastPath || !musicDir) {
  err('eksik arguman: --pool --state --last --music-dir sart (veya ENV).');
  process.exit(2);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

let manifest;
try {
  manifest = loadJson(poolPath);
} catch (e) {
  err(`pool okunamadi: ${poolPath} (${e.message})`);
  process.exit(2);
}
const tracks = manifest.tracks ?? manifest.pool ?? [];
if (!Array.isArray(tracks) || tracks.length === 0) {
  err('pool bosta: once liquidsoap/build-pool.mjs + operator incelemesi yapin.');
  process.exit(2);
}
// Operator incelemesi sarti: manifest'teki her parca authorized+reviewed olmali.
const unreviewed = tracks.filter(t => !t.rights?.authorized || !t.analysis?.reviewed);
if (unreviewed.length > 0) {
  err(`${unreviewed.length} parca incelemesiz (ornek: ${unreviewed[0].id}). README adim 2'yi bitirin.`);
  process.exit(3);
}

let state;
try {
  state = existsSync(statePath) ? loadJson(statePath) : {};
} catch (e) {
  err(`state okunamadi: ${e.message}`);
  process.exit(2);
}
state.dj ??= {};
const dj = {
  revision: String(state.dj.revision ?? state.revision ?? 'canli-1'),
  setEnergy: Number(state.dj.setEnergy ?? state.setEnergy ?? 0.55),
  requestedEnergyDirection: Number(state.dj.requestedEnergyDirection ?? 0),
  transitionOpportunity: Number(state.dj.transitionOpportunity ?? 0.7),
  phraseAligned: state.dj.phraseAligned ?? state.phraseAligned ?? true,
  headroomDb: Number(state.dj.headroomDb ?? 7),
  maxShowOff: Number(state.dj.maxShowOff ?? 0.6)
};
const capabilities = state.capabilities ?? DEFAULT_CAPABILITIES;
const seed = Number.isSafeInteger(state.seed) ? (state.seed + 1) % 4294967295 : 20260913;

let lastId = '';
try {
  lastId = existsSync(lastPath) ? readFileSync(lastPath, 'utf8').trim() : '';
} catch { lastId = ''; }

const byId = new Map(tracks.map(t => [t.id, t]));
let current = byId.get(lastId) ?? null;
if (!current) {
  // Ilk acilis: pool'un ilk hazir parcasi.
  current = tracks.find(t => t.playable && t.prepared) ?? tracks[0];
  const firstPath = isAbsolute(current.audioFile) ? current.audioFile : resolve(musicDir, current.audioFile);
  mkdirSync(dirname(statePath), { recursive: true });
  mkdirSync(dirname(lastPath), { recursive: true });
  writeFileSync(lastPath, current.id + '\n');
  writeFileSync(statePath, JSON.stringify({ dj, capabilities, seed, lastTrackId: current.id }, null, 2));
  process.stdout.write(firstPath + '\n');
  process.exit(0);
}

// Aday havuz: candidates.mjs bekledigi duz dizi formati.
const pool = tracks;
let fly;
try {
  fly = await createDJFly();
} catch (e) {
  err(`gercek graph yuklenemedi (artifact uretildimi?): ${e.message}`);
  process.exit(4);
}

let result;
try {
  result = fly.decide({ current, state: dj, pool, capabilities, seed });
} catch (e) {
  err(`decide hatasi: ${e.message}`);
  process.exit(4);
}
if (!result.decision) {
  err(`guvenli aday yok (${result.reason ?? 'no-safe-candidates'}), fallback calissin.`);
  process.exit(5);
}
const next = byId.get(result.decision.selectedTrackId);
if (!next) {
  err('secilen id pool disinda, fallback calissin.');
  process.exit(5);
}
const absPath = isAbsolute(next.audioFile) ? next.audioFile : resolve(musicDir, next.audioFile);
mkdirSync(dirname(lastPath), { recursive: true });
mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(lastPath, next.id + '\n');
writeFileSync(statePath, JSON.stringify({ dj, capabilities, seed, lastTrackId: next.id }, null, 2));
process.stdout.write(absPath + '\n');
