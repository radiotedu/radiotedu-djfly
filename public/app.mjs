import { WebAudioMixer } from '../mixer/audio.mjs';
import { MusicVisualizer } from './visualizer.mjs';
import { istanbulTime } from '../events/domain.mjs';

const $ = id => document.getElementById(id);
const text = (id, value) => { const element = $(id); if (element.textContent !== value) element.textContent = value; };
const clock = seconds => { const n = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
const strategyNames = { 'clean-blend': 'Temiz geçiş', 'long-eq-blend': 'EQ geçişi', 'bass-swap': 'Bas değişimi', 'filter-sweep': 'Filtre geçişi',
  'echo-transition': 'Eko çıkışı', 'short-loop': 'Kısa döngü', 'controlled-cut': 'Kontrollü kesme' };
let state = null, stream, polling = false, disposed = false, lastThought = null, devBuilt = false;
const sessionId = crypto.randomUUID();
const events = [];
function emit(type, data = {}) {
  events.push({ type, ...data, at: Date.now() }); if (events.length > 100) events.shift();
  void fetch('./api/client-events', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, sessionId, ...data }), keepalive: true }).catch(() => {});
}
const mixer = new WebAudioMixer({ emit });
const visualFailure = () => {
  $('visualizer-fallback').hidden = false; $('visual-toggle').setAttribute('aria-pressed', 'false');
  text('visual-toggle', 'Görsel kapalı'); emit('visualizer-disabled', { reason: 'rendering-unavailable' });
};
let visualizer;
try { visualizer = new MusicVisualizer($('visualizer'), { mixer, onFailure: visualFailure }); }
catch {
  visualizer = { enabled: false, setEnabled() {}, close() {}, fail: visualFailure, stats: () => ({ unavailable: true }) };
  visualFailure();
}

function notice(message) { $('notice').hidden = !message; text('notice', message ?? ''); }

async function applyState(next) {
  state = next;
  $('demo-notice').hidden = !next.developmentAudio;
  text('source-label', next.graph.mode === 'REAL_MALECNS' ? 'MaleCNS v1.0 / RadioTEDU deneyi' : 'Sinir ağı kullanılamıyor / Güvenli müzik modu');
  if (next.development && !devBuilt) buildDevelopment();
  if (next.thought !== lastThought) {
    lastThought = next.thought;
    visualizer.telemetry = next.thought?.source === 'REAL_MALECNS' ? next.thought.telemetry : null;
    renderThought();
  }
  await mixer.accept(next);
  render();
}

async function refresh() {
  if (polling || disposed) return;
  polling = true;
  try {
    const before = Date.now();
    const response = await fetch('./api/state', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Snapshot unavailable');
    const next = await response.json(); next.serverNow += Math.max(0, (Date.now() - before) / 2);
    await applyState(next);
    if (!mixer.error) notice('');
  } catch {
    notice(mixer.enabled ? 'Yayın bağlantısı kesildi. Hazırlanan ses çalmaya devam ediyor; bağlantı yeniden deneniyor.' : 'Yayın bilgisi alınamadı. Bağlantı yeniden deneniyor.');
  } finally { polling = false; }
}

function subscribe() {
  stream = new EventSource('./api/events');
  stream.addEventListener('state', event => {
    try { void applyState(JSON.parse(event.data)).catch(() => notice('Ses durumu yenileniyor.')); } catch { void refresh(); }
  });
  stream.onerror = () => { void refresh(); };
}

function renderThought() {
  const thought = state?.thought, readouts = thought?.telemetry?.readouts;
  $('readouts').replaceChildren();
  for (const [key, label] of [['energyDirection', 'ENERJİ YÖNÜ'], ['risk', 'RİSK'], ['transitionAggressiveness', 'GEÇİŞ HAREKETİ'], ['showOff', 'GÖSTERİ EĞİLİMİ']]) {
    if (!Number.isFinite(readouts?.[key])) continue;
    const row = document.createElement('div'); row.className = 'readout';
    const name = document.createElement('dt'); name.textContent = label;
    const value = document.createElement('dd'); value.textContent = String(Math.round(readouts[key] * 100));
    const meter = document.createElement('meter'); meter.min = 0; meter.max = 1; meter.value = readouts[key]; meter.setAttribute('aria-label', label);
    row.append(name, value, meter); $('readouts').append(row);
  }
  $('score-note').hidden = !readouts;
  const alternatives = thought?.candidates.filter(c => c.track.id !== thought.decision.selectedTrackId) ?? [];
  for (const [index, id] of ['deck-c', 'deck-d'].entries()) {
    const element = $(id), candidate = alternatives[index];
    element.querySelector('h3').textContent = candidate?.track.title ?? 'Aday bekleniyor';
    element.querySelector('.artist').textContent = candidate ? `${candidate.track.artist} · ${candidate.track.bpm} BPM` : 'Ses çalmaz. Sineğin seçeneklerini gösterir.';
    element.querySelector('.deck-state').textContent = candidate ? 'DEĞERLENDİRİLDİ' : 'DÜŞÜNCE ÇALARI';
    const score = element.querySelector('.candidate-score'); score.replaceChildren();
    if (Number.isFinite(candidate?.preference)) {
      score.append(document.createTextNode(String(Math.round(candidate.preference * 100))));
      const caption = document.createElement('small'); caption.textContent = 'göreli tercih / 100'; score.append(caption);
    }
  }
}

function renderDeck(id, deck) {
  const element = $(id), track = deck?.track;
  element.dataset.active = String(Boolean(deck?.hasAudio && ['PLAYING', 'TRANSITIONING'].includes(deck.phase)));
  element.querySelector('.deck-state').textContent = deck?.phase ?? 'EMPTY';
  element.querySelector('h3').textContent = track?.title ?? (id === 'deck-a' ? 'Dinlemeyi başlat' : 'Sıradaki kayıt');
  element.querySelector('.artist').textContent = track?.artist ?? 'Kayıt, dinlemeye katıldığında yüklenir.';
  element.querySelector('.tempo').textContent = track ? `${track.playbackBpm} BPM · ${track.camelotKey}` : 'Hazır bekliyor';
  element.querySelector('.position').textContent = track ? `${clock(deck.position)} / ${clock(track.duration)}` : '00:00';
  const waveform = element.querySelector('.waveform');
  if (waveform.dataset.track !== track?.id) {
    waveform.dataset.track = track?.id ?? ''; waveform.replaceChildren();
    const values = track?.waveform ?? [];
    for (let i = 0; i < values.length; i += 3) {
      const bar = document.createElement('span'); bar.style.setProperty('--height', `${Math.max(2, Math.max(...values.slice(i, i + 3)) * 42)}px`); waveform.append(bar);
    }
  }
  for (const [index, bar] of [...waveform.children].entries()) bar.classList.toggle('played', Boolean(deck?.hasAudio && index / waveform.children.length < deck.position / track.duration));
}

function render() {
  if (!state) return;
  const view = mixer.snapshot(), event = state.event.event, phase = state.event.phase, now = mixer.serverNow();
  const live = phase === 'LIVE';
  text('event-title', event?.title ?? 'Sıradaki uçuş hazırlanıyor.');
  text('event-time', event ? `${istanbulTime(event.startAt)} · İstanbul saati` : 'RadioTEDU özel yayınları');
  text('event-phase', ({ IDLE: 'ÖZEL YAYIN', UPCOMING: 'YAKLAŞAN UÇUŞ', LIVE: 'CANLI YAYIN', ENDED: 'UÇUŞ TAMAMLANDI' })[phase]);
  $('event-phase').classList.toggle('live', live);
  text('event-description', event?.description ?? 'Bir sonraki DJ Fly yayınının tarihi burada duyurulacak.');
  $('listen').disabled = !live || Boolean(mixer.starting);
  const label = !live ? phase === 'ENDED' ? 'Yayın sona erdi' : 'Yayın bekleniyor' : mixer.starting ? 'Ses hazırlanıyor' : view.enabled && view.contextState === 'running' ? 'Dinlemeyi duraklat' : view.contextState === 'suspended' || view.contextState === 'interrupted' ? 'Sese geri dön' : 'Dinlemeye başla';
  $('listen span').textContent = label;
  $('listen svg path').setAttribute('d', view.enabled && view.contextState === 'running' ? 'M6 4h4v16H6Zm8 0h4v16h-4Z' : 'm8 4 12 8-12 8Z');
  const playing = view.decks.filter(d => d.hasAudio && ['PLAYING', 'TRANSITIONING'].includes(d.phase)).toSorted((a, b) => b.gain - a.gain)[0];
  if (playing) {
    text('now-title', playing.track.title); text('now-artist', playing.track.artist);
    text('now-label', view.phase === 'RECOVERING' ? 'GÜVENLİ SES DEVAM EDİYOR' : `ŞİMDİ ÇALIYOR / DECK ${playing.id}`);
  } else {
    text('now-title', phase === 'ENDED' ? 'Bir sonraki uçuşta buluşalım.' : live ? 'Uçuşa katıl.' : 'Frekans burada.');
    text('now-artist', phase === 'ENDED' ? 'Tekrar kaydı henüz yayımlanmadı.' : live ? 'Sesi aç. Akışa bırak.' : 'Yayın başladığında bu alandan dinleyebilirsin.');
    text('now-label', mixer.starting ? 'SES YÜKLENİYOR' : 'DİNLEME ODASI');
  }
  $('entry-copy').hidden = Boolean(playing);
  text('entry-caption', phase === 'ENDED' ? 'Bu uçuş bitti.' : live ? 'Bir sonraki parça.\nBaşka bir bağlantı.' : 'Bir sonraki uçuşa\nhazır bekliyoruz.');
  $('countdown').hidden = phase !== 'UPCOMING';
  if (phase === 'UPCOMING') text('countdown', clock((Date.parse(event.startAt) - now) / 1000));
  text('stage-status', view.phase === 'TRANSITIONING' ? 'GEÇİŞ DEVAM EDİYOR' : playing ? 'MİKS ÇIKIŞI' : live ? 'DİNLEMEYE KATIL' : 'BİR SONRAKİ UÇUŞ');
  text('stage-clock', live ? `YAYINDA ${clock((now - Date.parse(event.startAt)) / 1000)}` : 'RadioTEDU / Ankara');
  text('analyser-label', playing ? 'GERÇEK SES / CANLI SPEKTRUM' : 'SESİ AÇ, İZİNİ GÖR.');
  const thought = state.thought, next = state.program.find(p => p.startAt > now), actualTransition = view.decks.find(d => d.phase === 'TRANSITIONING')?.transition;
  const plan = actualTransition ?? next?.transition;
  $('transition-note').hidden = !plan || !live;
  if (plan) {
    text('transition-label', `${plan.bars ? `${plan.bars} ÖLÇÜ / ` : ''}${strategyNames[plan.strategyId] ?? plan.strategyId}`);
    const seconds = actualTransition ? actualTransition.contextEnd - mixer.context.currentTime : (plan.startAt - now) / 1000;
    text('transition-countdown', actualTransition ? `${clock(seconds)} sonra çalar değişiyor` : `${Math.max(0, Math.ceil(seconds / (240 / plan.bpm)))} ölçü sonra · ${view.enabled ? 'hazırlanan geçiş' : 'yayın planı'}`);
  }
  const status = !live ? 'WAITING' : view.phase === 'RECOVERING' ? 'RECOVERING' : state.dj.phase;
  const titles = { WAITING: 'SİNEK BEKLİYOR.', SEARCHING: 'SIRADAKİ PARÇA?', DECIDING: 'SİNEK DÜŞÜNÜYOR.', PREPARING: 'SİNEK SEÇTİ.', PLAYING: 'AKIŞ DEVAM EDİYOR.', TRANSITIONING: 'BAĞLANTI KURULDU.', RECOVERING: 'MÜZİK DEVAM ETSİN.' };
  text('fly-state', thought?.source === 'SAFETY_FALLBACK' && live ? 'GÜVENLİ GEÇİŞ.' : titles[status] ?? titles.WAITING);
  text('fly-message', thought?.source === 'SAFETY_FALLBACK' && live ? 'Sinir ağı kararına ulaşılamadı. Müzik kuralları güvenli seçeneği belirledi.' : !live ? 'Yayın başlayınca seçenekler burada görünür.' : thought ? `${thought.candidates.length} güvenli aday değerlendirildi. ${thought.candidates.find(c => c.state === 'SELECTED')?.track.title ?? 'Sıradaki kayıt'} seçildi.` : 'Parça akarken bir sonraki geçiş penceresi bekleniyor.');
  for (const [index, id] of ['deck-a', 'deck-b'].entries()) renderDeck(id, view.decks[index]);
  if (view.error) notice(view.error);
  if (devBuilt && $('debug-output')?.open) text('debug-json', JSON.stringify({ audio: view, program: state, clientEvents: events, visualizer: visualizer.stats() }, null, 2));
}

$('listen').addEventListener('click', async () => {
  try {
    if (mixer.enabled && mixer.context?.state === 'running') await mixer.pause();
    else { notice(''); await mixer.start(state); }
  } catch { notice('Ses başlatılamadı. Bağlantıyı kontrol edip dinlemeyi yeniden başlat.'); }
  render();
});
$('volume').addEventListener('input', event => mixer.setVolume(Number(event.target.value)));
$('preset').addEventListener('change', event => { visualizer.preset = event.target.value; });
$('visual-toggle').addEventListener('click', () => {
  visualizer.setEnabled(!visualizer.enabled);
  $('visualizer-fallback').hidden = visualizer.enabled;
  $('visual-toggle').setAttribute('aria-pressed', String(visualizer.enabled));
  text('visual-toggle', visualizer.enabled ? 'Görseli kapat' : 'Görseli aç');
  if (!visualizer.enabled) emit('visualizer-disabled', { reason: 'listener-choice' });
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { void refresh(); if (mixer.enabled && mixer.context?.state !== 'running') notice('Ses tarayıcı tarafından duraklatıldı. “Sese geri dön” ile devam et.'); } });

function buildDevelopment() {
  devBuilt = true;
  const panel = document.createElement('details'); panel.className = 'development';
  panel.innerHTML = '<summary>Geliştirici kontrolleri / yalnızca yerel deneme</summary><div class="development-controls"><label>Etkinlik <select id="dev-phase"><option>LIVE</option><option>UPCOMING</option><option>ENDED</option></select></label><button data-command="decide">Karar döngüsü</button><button data-command="seek-transition">Geçişe 6 saniye kalaya git</button><button data-command="decision-failure">Sonraki sinir ağı kararını hata ile sına</button><button id="dev-load-failure">Sonraki ses yüklemesini hata ile sına</button><button id="dev-visual-failure">Görsel arızasını sına</button></div><details id="debug-output"><summary>DJ durumu, adaylar ve gerçek karar kaydı</summary><pre id="debug-json"></pre></details>';
  $('development-root').append(panel);
  const command = async data => {
    try {
      const response = await fetch('./api/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!response.ok) throw new Error('Development command unavailable.'); await applyState(await response.json()); notice('');
    } catch { notice('Geliştirme komutu bu durumda uygulanamadı. Hazır geçişi veya olay kaydını kontrol et.'); }
  };
  $('dev-phase').addEventListener('change', e => { void command({ type: 'phase', value: e.target.value }); });
  panel.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => { void command({ type: button.dataset.command }); }));
  $('dev-load-failure').addEventListener('click', () => { mixer.failNextLoad = true; notice('Sonraki gerçek ses yüklemesinde hata sınanacak.'); });
  $('dev-visual-failure').addEventListener('click', () => visualizer.fail());
  window.djflyDevelopment = { mixer, visualizer, getState: () => state, events, command };
}

await refresh(); subscribe();
const renderTimer = setInterval(render, 250), refreshTimer = setInterval(() => { void refresh(); }, 10000);
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  disposed = true; clearInterval(renderTimer); clearInterval(refreshTimer); stream.close(); visualizer.close(); void mixer.close();
});
