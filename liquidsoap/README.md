# DJ Fly -> Liquidsoap entegrasyonu (gercek next-song)

Amac: `meyve sinegi noronlari bir sonraki sarkiyi secsin`, Liquidsoap calsin, Icecast'e versin.

## Mimari

```text
MUZIK_DIR/*.mp3
  -> local/pools/canli.json (operator incelemeli manifest)
  -> liquidsoap/djfly-next.mjs (createDJFly + decide, stdout'a tek satir yol)
  -> liquidsoap/djfly.liq (request.dynamic.list -> fallback playlist -> jingle)
  -> Icecast (ICECAST_HOST:PORT/MOUNT)
  -> on_track.sh (sadece log)
```

Kopru basarisizsa yayin susmaz: once `DJFLY_FALLBACK_M3U`, o da yoksa `DJFLY_FALLBACK_JINGLE` calar.
`decide()` bos donerse (`no-safe-candidates`) kopru bilerek hata kodu verir, fallback devreye girer.

## Kurulum (yayin PC, Ubuntu)

```bash
sudo apt-get install -y liquidsoap icecast2 nodejs
git clone <repo> /opt/djfly && cd /opt/djfly
npm ci  # veya npm install
# Gercek artifact sart (token sadece bu adimda, browser'a konmaz):
#   python -m venv .venv && .venv/bin/pip install -r connectome/preprocessing/requirements.txt
#   export NEUPRINT_TOKEN=...; python connectome/preprocessing/build.py build
node scripts/validate-real.mjs && node scripts/activate-artifact.mjs && npm test

sudo mkdir -p /opt/radiotedu/muzik /var/lib/djfly /var/log/radiotedu
sudo chown -R "$USER:$USER" /opt/radiotedu /var/lib/djfly /var/log/radiotedu
cp liquidsoap/djfly.liq liquidsoap/on_track.sh /opt/djfly/liquidsoap/
chmod +x /opt/djfly/liquidsoap/on_track.sh
```

## 1) Havuz

```bash
node liquidsoap/build-pool.mjs --music-dir /opt/radiotedu/muzik --out local/pools/canli.json --bpm 128
# SONRA: her parcayi dinle, TODO'lari doldur (bpm, camelotKey, enerji, loudness...),
# intro/outro/cueIn'i bar gridine oturt, rights.authorized=true + analysis.reviewed=true yap.
npm run demo  # havuz gecerliyse karar motoru calisir
```

Incelemesiz havuzla `djfly-next.mjs` calismayi reddeder. Olcum uydurma.

## 2) ENV (secret'lar yayin PC'de kalir, repoya yazma)

`liquidsoap/.env.example`'i kopyala, degerleri doldur:

| Degisken | Ornek |
|---|---|
| `MUZIK_DIR` | `/opt/radiotedu/muzik` |
| `DJFLY_POOL_PATH` | `/opt/djfly/local/pools/canli.json` |
| `DJFLY_STATE_PATH` | `/var/lib/djfly/state.json` |
| `DJFLY_LAST_PATH` | `/var/lib/djfly/last.txt` |
| `DJFLY_TELEMETRY_PATH` | `/var/lib/djfly/last-telemetry.json` (sidecar, otomatik) |
| `DJFLY_WEB_URL` | `https://ornek.com/djfly/api/broadcast-telemetry` (bos = poster atlanir) |
| `DJFLY_BROADCAST_TOKEN` | web server'daki `DJFLY_BROADCAST_TOKEN` ile ayni (repoya yazma) |
| `ICECAST_HOST/PORT/PASS/MOUNT` | `localhost/8000/***//sinek.mp3` |

## 3) Kontrol + calistir

```bash
liquidsoap --check /opt/djfly/liquidsoap/djfly.liq
node liquidsoap/djfly-next.mjs --pool local/pools/canli.json --state /var/lib/djfly/state.json --last /var/lib/djfly/last.txt --music-dir /opt/radiotedu/muzik
liquidsoap /opt/djfly/liquidsoap/djfly.liq
```

## 4) Beyin snapshot'i web'e (opsiyonel)

`djfly-next.mjs` her kararda `last-telemetry.json` sidecar yazar (stdout protokolu degismez).
`on_track.sh` parca basinda `post-telemetry.mjs` ile web'e POST'lar:

```bash
node liquidsoap/post-telemetry.mjs --file /var/lib/djfly/last-telemetry.json \
  --url https://ornek.com/djfly/api/broadcast-telemetry --token "$DJFLY_BROADCAST_TOKEN"
```

Web server'da `DJFLY_BROADCAST_TOKEN` yoksa endpoint 404 doner (ozellik kapali).
Token yanlissa 401, limit asiminda 429. Poster hata alsa bile exit 0, yayin dusmez.
Web, taze snapshot varsa (<15 dk) `thought` yerine yayin kararini gosterir, eskiyse
`son bilinen` bandi cikar.

## Durust anons

"Siradaki parcayi MaleCNS mantar-cisim devresiyle calisan modelimiz guvenli adaylar arasindan siraladi" denir; "sinek secti/begendi" denmez.
