#!/usr/bin/env liquidsoap
# DJ Fly -> Liquidsoap: bir sonraki sarkiyi sinek noronlari secer.
# Repo: radiotedu-djfly / liquidsoap/
# Sirlari ICERMEZ. Tum degerler ENV'den okunur (liquidsoap/.env.example'a bak).
# Dogrulama: liquidsoap --check liquidsoap/djfly.liq
# Gerekli: Liquidsoap 2.x, Node.js >=20, generate edilmis MaleCNS artifact.

set("log.file", true)
set("log.file.path", "/var/log/radiotedu/djfly.log")
set("log.stdout", true)

# --- ENV ---
node_bin   = getenv(default="node", "DJFLY_NODE_BIN")
bridge     = getenv(default="/opt/djfly/liquidsoap/djfly-next.mjs", "DJFLY_BRIDGE")
pool_path  = getenv(default="/opt/djfly/local/pools/canli.json", "DJFLY_POOL_PATH")
state_path = getenv(default="/var/lib/djfly/state.json", "DJFLY_STATE_PATH")
last_path  = getenv(default="/var/lib/djfly/last.txt", "DJFLY_LAST_PATH")
muzik_dir  = getenv(default="/opt/radiotedu/muzik", "MUZIK_DIR")
fallback_playlist = getenv(default="/opt/radiotedu/muzik/playlist_gunluk.m3u", "DJFLY_FALLBACK_M3U")
fallback_jingle   = getenv(default="/opt/radiotedu/muzik/jingle_yedek.mp3", "DJFLY_FALLBACK_JINGLE")
notify_sh  = getenv(default="/opt/djfly/liquidsoap/on_track.sh", "DJFLY_NOTIFY_SH")

icecast_host  = getenv(default="localhost", "ICECAST_HOST")
icecast_port  = int_of_string(getenv(default="8000", "ICECAST_PORT"))
icecast_pass  = getenv(default="DEGISTIR-yayin-pc-env", "ICECAST_PASS")
icecast_mount = getenv(default="/sinek.mp3", "ICECAST_MOUNT")

# --- Sinek karari: her yeni parca icin Node bridge'i cagir ---
# Bridge stdout'a TEK SATIR mutlak ses yolu basar, baska cikti vermez.
# Ornek: /opt/radiotedu/muzik/abc.mp3
bridge_cmd =
  node_bin ^ " " ^ process.quote(bridge) ^
  " --pool " ^ process.quote(pool_path) ^
  " --state " ^ process.quote(state_path) ^
  " --last " ^ process.quote(last_path) ^
  " --music-dir " ^ process.quote(muzik_dir)

def djfly_next() =
  out = process.read.lines(bridge_cmd)
  path = list.hd(default="", out)
  if path == "" then
    fail("djfly-next bos dondu, fallback devreye girecek")
  end
  [request.create(path)]
end

dyn = request.dynamic.list(djfly_next, retry_delay=2.)

# --- Guvenlik agi: kopru basarisizsa gunluk liste, o da yoksa jingle ---
liste  = playlist(mode="normal", reload_mode="watch", reload=3600, fallback_playlist)
yedek  = single(fallback_jingle)
guvenli = fallback(track_sensitive=false, [dyn, liste, yedek])

# --- Parca kancasi: sadece log (dry-run). Ag'a yazma yok. ---
def parca_basladi(m) =
  baslik = m["title"]
  _ = process.read(notify_sh ^ " " ^ process.quote(baslik))
  ()
end
kaynak = on_metadata(parca_basladi, guvenli)

output.icecast(%mp3(bitrate=128),
  host=icecast_host, port=icecast_port, password=icecast_pass,
  mount=icecast_mount, name="DJ Fly @ RadioTEDU",
  description="MaleCNS devreli model secimi - canli",
  kaynak)
