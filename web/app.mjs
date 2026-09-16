const byId = id => document.getElementById(id);
const labels = { preference: 'Aday tercihi', risk: 'Risk eğilimi', energyDirection: 'Enerji yönü',
  transitionAggressiveness: 'Geçiş yoğunluğu', blend: 'Uzun karışım eğilimi', showOff: 'Gösteriş eğilimi' };
const featureLabels = { currentBpm: 'BPM', candidateBpmDifference: 'BPM farkı', energy: 'Enerji',
  loudness: 'Yükseklik', bassEnergy: 'Bas', midEnergy: 'Mid', highEnergy: 'Tiz',
  rhythmicDensity: 'Ritim', spectralCentroid: 'Centroid', harmonicCompatibility: 'Uyum',
  setEnergy: 'Set enerjisi', requestedEnergyDirection: 'Enerji yönü', transitionOpportunity: 'Geçiş fırsatı',
  spectralFlatness: 'Düzlük' };
let telemetry = null;
let frozen = false;
let sortKey = 'activity';
let sortDir = -1;
let selectedId = null;
let hoverId = null;
let layout = [];

function draw() {
  const canvas = byId('network');
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  const context = canvas.getContext('2d'); context.scale(ratio, ratio);
  layout = [];
  if (!telemetry?.nodes?.length) {
    context.fillStyle = '#c6c7cc'; context.font = '15px system-ui';
    context.fillText('Hesaplanmış ağ etkinliği bekleniyor.', 20, rect.height / 2); return;
  }
  const laneName = { input: 'GİRDİ · KC', intermediate: 'ARA · APL/DPM', output: 'ÇIKTI · MBON' };
  const lanes = ['input', 'intermediate', 'output'];
  context.font = '11px system-ui'; context.fillStyle = '#696a70';
  lanes.forEach((role, i) => context.fillText(laneName[role], 0.12 * rect.width + i * 0.38 * rect.width - 30, 14));
  const point = node => ({ x: node.x * rect.width, y: 26 + node.y * (rect.height - 40) });
  const nodes = new Map(telemetry.nodes.map(node => [node.id, { ...node, ...point(node) }]));
  const paths = new Set((telemetry.paths ?? []).flatMap(path => path.slice(1).map((id, i) => `${path[i]}|${id}`)));
  const selected = selectedId != null ? nodes.get(selectedId) : null;
  const neighbours = new Set();
  if (selected) {
    for (const edge of telemetry.edges) {
      if (edge.source === selectedId) neighbours.add(edge.target);
      if (edge.target === selectedId) neighbours.add(edge.source);
    }
  }
  for (const edge of telemetry.edges) {
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    if (!source || !target || edge.activity <= 0) continue;
    const hot = selected && (edge.source === selectedId || edge.target === selectedId);
    if (selected && !hot) continue;
    context.strokeStyle = hot || paths.has(`${edge.source}|${edge.target}`)
      ? `rgba(227,30,38,${0.2 + edge.activity * 0.75})` : `rgba(198,199,204,${edge.activity * 0.18})`;
    context.lineWidth = hot ? 2 : paths.has(`${edge.source}|${edge.target}`) ? 1.3 : 0.7;
    context.beginPath(); context.moveTo(source.x, source.y);
    context.bezierCurveTo((source.x + target.x) / 2, source.y, (source.x + target.x) / 2, target.y, target.x, target.y);
    context.stroke();
  }
  for (const node of nodes.values()) {
    const r = 2 + node.activity * 4;
    const dim = selected && node.id !== selectedId && !neighbours.has(node.id);
    context.globalAlpha = dim ? 0.25 : 1;
    context.fillStyle = node.stimulus > 0 ? '#ff7075' : `rgba(244,244,244,${0.2 + node.activity * 0.8})`;
    context.beginPath(); context.arc(node.x, node.y, r, 0, Math.PI * 2); context.fill();
    if (node.id === hoverId || node.id === selectedId) {
      context.strokeStyle = '#fff'; context.lineWidth = 1.5;
      context.beginPath(); context.arc(node.x, node.y, r + 3, 0, Math.PI * 2); context.stroke();
    }
    context.globalAlpha = 1;
    layout.push({ id: node.id, x: node.x, y: node.y, r: r + 4, node });
  }
  const top = [...nodes.values()].filter(n => n.activity > 0.5).sort((a, b) => b.activity - a.activity).slice(0, 8);
  context.font = '10px system-ui'; context.fillStyle = '#c6c7cc';
  for (const node of top) {
    if (node.id === hoverId || node.id === selectedId) continue;
    context.fillText(`${node.type ?? node.id}`, node.x + 7, node.y - 6);
  }
}

function pickAt(mx, my) {
  let best = null, bestDist = 14;
  for (const item of layout) {
    const d = Math.hypot(item.x - mx, item.y - my);
    if (d <= Math.max(bestDist, item.r) && d < bestDist + item.r) { best = item; bestDist = d - item.r; }
  }
  return best;
}

function showTip(item, mx, my) {
  const tip = byId('node-tip');
  if (!tip) return;
  if (!item) { tip.hidden = true; return; }
  const n = item.node;
  tip.hidden = false;
  tip.textContent = `${n.id} · ${n.type ?? '—'} · ${n.role} · etkinlik ${Number(n.activity).toFixed(3)} · uyaran ${Number(n.stimulus).toFixed(3)}`;
  const fig = tip.parentElement.getBoundingClientRect();
  tip.style.left = `${Math.min(Math.max(mx + 12, 0), fig.width - 240)}px`;
  tip.style.top = `${Math.max(my - 10, 0)}px`;
}

function bindCanvas() {
  const canvas = byId('network');
  canvas.addEventListener('mousemove', event => {
    const rect = canvas.getBoundingClientRect();
    const item = pickAt(event.clientX - rect.left, event.clientY - rect.top);
    const id = item?.id ?? null;
    if (id !== hoverId) { hoverId = id; canvas.style.cursor = id ? 'pointer' : 'default'; draw(); }
    showTip(item, event.clientX - rect.left, event.clientY - rect.top);
  });
  canvas.addEventListener('mouseleave', () => { hoverId = null; showTip(null); draw(); });
  canvas.addEventListener('click', event => {
    const rect = canvas.getBoundingClientRect();
    const item = pickAt(event.clientX - rect.left, event.clientY - rect.top);
    selectedId = item && item.id !== selectedId ? item.id : null;
    draw();
    if (selectedId) showTip(item, event.clientX - rect.left, event.clientY - rect.top);
  });
}

function renderInputs() {
  const box = byId('feature-bars');
  if (!box) return;
  const groups = (telemetry?.groups ?? []).filter(g => g.name in featureLabels);
  if (!groups.length) { box.textContent = 'Henüz veri yok.'; return; }
  box.replaceChildren(...groups
    .sort((a, b) => b.stimulus - a.stimulus)
    .map(g => {
      const row = document.createElement('div'); row.className = 'frow';
      const name = document.createElement('span'); name.className = 'fname'; name.textContent = featureLabels[g.name] ?? g.name;
      const bars = document.createElement('span'); bars.className = 'fbars';
      const stim = document.createElement('i'); stim.className = 'stim'; stim.style.width = `${Math.round(g.stimulus * 100)}%`;
      const act = document.createElement('i'); act.className = 'act'; act.style.width = `${Math.round(g.activity * 100)}%`;
      bars.append(stim, act);
      const val = document.createElement('span'); val.className = 'fval';
      val.textContent = `${g.stimulus.toFixed(2)} / ${g.activity.toFixed(2)}`;
      row.append(name, bars, val);
      return row;
    }));
}

const comparators = {
  id: (a, b) => String(a.id).localeCompare(String(b.id)),
  type: (a, b) => String(a.type ?? '').localeCompare(String(b.type ?? '')),
  role: (a, b) => String(a.role).localeCompare(String(b.role)),
  activity: (a, b) => a.activity - b.activity,
  stimulus: (a, b) => a.stimulus - b.stimulus
};

function renderNeurons() {
  const rows = byId('neuron-rows');
  const count = byId('neuron-count');
  if (!rows || !count) return;
  if (!telemetry?.nodes?.length) {
    rows.replaceChildren();
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5; td.textContent = 'Henüz veri yok.';
    tr.append(td); rows.append(tr);
    count.textContent = 'Nöron verisi bekleniyor.';
    return;
  }
  const q = (byId('neuron-search')?.value ?? '').trim().toLowerCase();
  const role = byId('role-filter')?.value ?? 'all';
  const cmp = comparators[sortKey] ?? comparators.activity;
  const filtered = telemetry.nodes
    .filter(n => (role === 'all' || n.role === role))
    .filter(n => !q || String(n.id).toLowerCase().includes(q) || String(n.type ?? '').toLowerCase().includes(q))
    .sort((a, b) => cmp(a, b) * sortDir || comparators.activity(a, b) * -1);
  count.textContent = `${filtered.length} nöron eşleşti (görünür örneklem ${telemetry.nodes.length}). İlk 100 satır.${frozen ? ' Görünüm donuk.' : ''}`;
  rows.replaceChildren(...filtered.slice(0, 100).map(n => {
    const tr = document.createElement('tr');
    const id = document.createElement('td'); id.textContent = String(n.id);
    const type = document.createElement('td'); type.textContent = String(n.type ?? '—');
    const rl = document.createElement('td'); rl.textContent = String(n.role);
    const act = document.createElement('td'); act.className = 'bar-cell';
    const bar = document.createElement('span'); bar.className = 'bar';
    const fill = document.createElement('i'); fill.style.width = `${Math.round(n.activity * 100)}%`;
    if (n.stimulus > 0) fill.className = 'stimmed';
    bar.append(fill);
    const num = document.createElement('b'); num.textContent = Number(n.activity).toFixed(4);
    act.append(bar, num);
    const stim = document.createElement('td'); stim.textContent = Number(n.stimulus).toFixed(4);
    tr.append(id, type, rl, act, stim);
    return tr;
  }));
  document.querySelectorAll('#neuron-table th button').forEach(btn => {
    const active = btn.dataset.sort === sortKey;
    btn.textContent = btn.textContent.replace(/ [↑↓]$/, '') + (active ? (sortDir === 1 ? ' ↑' : ' ↓') : '');
  });
}

export function renderTelemetry(next) {
  if (frozen) return;
  telemetry = next;
  selectedId = null; hoverId = null;
  byId('source').textContent = next.source.label;
  byId('explanation').textContent = next.source.explanation;
  byId('attribution').textContent = next.source.attribution;
  const decision = next.decision;
  byId('decision').textContent = decision
    ? `${decision.selectedTrackId} · ${decision.selectedStrategyId} · ${decision.preferredBlendBars} ölçü`
    : 'Güvenli bir parça ve geçiş bulunamadı. Yeni karar bekleniyor.';
  byId('readouts').replaceChildren(...Object.entries(next.readouts ?? {}).map(([name, value]) => {
    const item = document.createElement('div'), term = document.createElement('dt'), amount = document.createElement('dd');
    term.textContent = labels[name] ?? name;
    amount.textContent = `${Math.round(value * 100)} / 100`;
    item.append(term, amount); return item;
  }));
  draw();
  renderInputs();
  renderNeurons();
  const banner = byId('broadcast-banner');
  if (banner) {
    if (next.broadcast) {
      banner.hidden = false;
      banner.textContent = next.broadcast.stale
        ? `Son bilinen yayın kararı: ${next.broadcast.trackId} (bağlantı eski, ${Math.round((next.broadcast.ageMs ?? 0) / 60000)} dk).`
        : `Canlı yayın kararı: ${next.broadcast.trackId}.`;
    } else banner.hidden = true;
  }
}

async function get(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`İstek tamamlanamadı (${response.status}).`);
  return response.json();
}

async function refresh() {
  try {
    const result = await get('./api/telemetry');
    renderTelemetry(result.telemetry);
    byId('development').hidden = !result.debugEnabled;
    if (result.debugEnabled) byId('debug').textContent = JSON.stringify(await get('./api/debug'), null, 2);
    byId('error').hidden = true;
  } catch (error) {
    byId('source').textContent = 'Yerel ağ verisi alınamadı.';
    byId('error').textContent = error.message; byId('error').hidden = false;
  }
}

byId('rerun').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try {
    await get('./api/rerun', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed: Number(byId('seed').value) }) });
    await refresh();
  } catch (error) { byId('error').textContent = error.message; byId('error').hidden = false; }
  finally { button.disabled = false; }
});
byId('neuron-search')?.addEventListener('input', renderNeurons);
byId('role-filter')?.addEventListener('change', renderNeurons);
byId('neuron-filter')?.addEventListener('submit', event => event.preventDefault());
document.querySelectorAll('#neuron-table th button').forEach(btn => btn.addEventListener('click', () => {
  const key = btn.dataset.sort;
  if (key === sortKey) sortDir *= -1;
  else { sortKey = key; sortDir = key === 'activity' ? -1 : 1; }
  renderNeurons();
}));
byId('freeze')?.addEventListener('click', () => {
  frozen = !frozen;
  const btn = byId('freeze');
  btn.textContent = frozen ? 'Canlıya dön' : 'Görünümü dondur';
  btn.setAttribute('aria-pressed', String(frozen));
  if (!frozen) refresh();
  else renderNeurons();
});
new ResizeObserver(draw).observe(byId('network'));
bindCanvas();
// Event hosts may deliver their local engine telemetry without exposing the graph artifact.
window.addEventListener('djfly:telemetry', event => renderTelemetry(event.detail));
await refresh();
