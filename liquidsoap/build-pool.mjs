#!/usr/bin/env node
// build-pool.mjs - MUZIK_DIR'i tarar, DJ Fly pool TASLAGI uretir.
// Cikti BILEREK yayina uygun degildir: rights.authorized=false,
// analysis.reviewed=false. Operator her parcayi dinleyip olcumleri
// doldurmadan `djfly-next.mjs` calismayi reddeder (guvenlik sarti).
// Kullanim:
//   node liquidsoap/build-pool.mjs --music-dir "D:\muzik" --out local/pools/canli.json --bpm 128
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, dirname, basename } from 'node:path';

const arg = (n, f = '') => {
  const i = process.argv.indexOf(n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f;
};
const musicDir = arg('--music-dir', process.env.MUZIK_DIR ?? '');
const out = arg('--out', 'local/pools/canli.json');
const poolBpm = Number(arg('--bpm', '128'));
if (!musicDir) { console.error('Kullanim: --music-dir <klasor> --out <json>'); process.exit(2); }

const OK = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac']);
const files = readdirSync(musicDir).filter(f => OK.has(extname(f).toLowerCase())).sort();
if (!files.length) { console.error(`Ses dosyasi yok: ${musicDir}`); process.exit(2); }

const slug = s => basename(s, extname(s)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'parca';
const tracks = files.map((f, i) => {
  const st = statSync(join(musicDir, f));
  return {
    id: `${slug(f)}-${String(i + 1).padStart(3, '0')}`,
    title: 'TODO-BASLIK',
    artist: 'TODO-SANATCI',
    audioFile: f,
    bpm: 128,
    playbackBpm: poolBpm,
    camelotKey: '8A', // TODO: gercek olcum
    energy: 0.5, bassEnergy: 0.5, midEnergy: 0.5, highEnergy: 0.5,
    rhythmicDensity: 0.5, spectralFlatness: 0.2,
    loudnessLufs: -12, spectralCentroidHz: 2400, beatGridConfidence: 0.9,
    playable: false, prepared: false, availableBlendBars: 16,
    duration: 180, decodedBytes: Math.max(1, Math.min(st.size, 50 * 1024 * 1024)),
    tags: [], weight: 1,
    rights: { authorized: false },
    analysis: { reviewed: false },
    grid: { firstDownbeat: 0.0, beatsPerBar: 4, phraseBars: 8 },
    cueIn: 0.0,
    intro: { start: 0.0, end: 32 * (240 / poolBpm) },
    outro: { start: 180 - 16 * (240 / poolBpm), end: 180 },
    waveform: [0.5]
  };
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ schemaVersion: 1, id: 'canli', bpm: poolBpm, tracks }, null, 2));
console.log(`TASLAK yazildi: ${tracks.length} parca -> ${out}`);
console.log('SONRAKI: her parcada TODO alanlari + bpm/key/enerji olcumlerini doldur,');
console.log('dinleyip rights.authorized=true + analysis.reviewed=true yap, playable+prepared=true yap.');
