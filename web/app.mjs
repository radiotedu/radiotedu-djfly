const byId = id => document.getElementById(id);
const labels = { preference: 'Aday tercihi', risk: 'Risk eğilimi', energyDirection: 'Enerji yönü',
  transitionAggressiveness: 'Geçiş yoğunluğu', blend: 'Uzun karışım eğilimi', showOff: 'Gösteriş eğilimi' };
let telemetry = null;

function draw() {
  const canvas = byId('network');
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  const context = canvas.getContext('2d'); context.scale(ratio, ratio);
  if (!telemetry?.nodes?.length) {
    context.fillStyle = '#c6c7cc'; context.font = '15px system-ui';
    context.fillText('Hesaplanmış ağ etkinliği bekleniyor.', 20, rect.height / 2); return;
  }
  const point = node => ({ x: node.x * rect.width, y: 12 + node.y * (rect.height - 24) });
  const nodes = new Map(telemetry.nodes.map(node => [node.id, { ...node, ...point(node) }]));
  const paths = new Set((telemetry.paths ?? []).flatMap(path => path.slice(1).map((id, i) => `${path[i]}|${id}`)));
  for (const edge of telemetry.edges) {
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    if (!source || !target || edge.activity <= 0) continue;
    context.strokeStyle = paths.has(`${edge.source}|${edge.target}`)
      ? `rgba(227,30,38,${0.15 + edge.activity * 0.7})` : `rgba(198,199,204,${edge.activity * 0.18})`;
    context.lineWidth = paths.has(`${edge.source}|${edge.target}`) ? 1.3 : 0.7;
    context.beginPath(); context.moveTo(source.x, source.y);
    context.bezierCurveTo((source.x + target.x) / 2, source.y, (source.x + target.x) / 2, target.y, target.x, target.y);
    context.stroke();
  }
  for (const node of nodes.values()) {
    context.fillStyle = node.stimulus > 0 ? '#ff7075' : `rgba(244,244,244,${0.2 + node.activity * 0.8})`;
    context.beginPath(); context.arc(node.x, node.y, 1.3 + node.activity * 2.5, 0, Math.PI * 2); context.fill();
  }
}

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
  const filtered = telemetry.nodes
    .filter(n => (role === 'all' || n.role === role))
    .filter(n => !q || String(n.id).toLowerCase().includes(q) || String(n.type ?? '').toLowerCase().includes(q))
    .sort((a, b) => b.activity - a.activity || b.stimulus - a.stimulus);
  count.textContent = `${filtered.length} nöron eşleşti (görünür örneklem ${telemetry.nodes.length}). İlk 100 satır listelenir.`;
  rows.replaceChildren(...filtered.slice(0, 100).map(n => {
    const tr = document.createElement('tr');
    for (const value of [String(n.id), String(n.type ?? '—'), String(n.role), Number(n.activity).toFixed(4), Number(n.stimulus).toFixed(4)]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    return tr;
  }));
}

export function renderTelemetry(next) {
  telemetry = next;
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
new ResizeObserver(draw).observe(byId('network'));
// Event hosts may deliver their local engine telemetry without exposing the graph artifact.
window.addEventListener('djfly:telemetry', event => renderTelemetry(event.detail));
await refresh();
