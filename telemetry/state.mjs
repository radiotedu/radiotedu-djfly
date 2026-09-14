const round = value => Math.round(value * 10000) / 10000;

export function publicSource(graph) {
  const fixture = graph.provenance.kind === 'development-fixture';
  return {
    kind: graph.provenance.kind,
    mode: fixture ? 'DEVELOPMENT_FIXTURE' : 'REAL_MALECNS',
    dataset: graph.provenance.dataset,
    label: fixture ? 'Geliştirme örneği: gerçek MaleCNS bağlantıları yüklenmedi.' : 'HHMI Janelia MaleCNS v1.0',
    projectUrl: 'https://male-cns.janelia.org/',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    explanation: fixture
      ? 'Bu görünüm, yazılımı sınamak için hazırlanmış deterministik bir ağ kullanıyor. Biyolojik veri içermez.'
      : 'DJ Fly, MaleCNS Drosophila konektomundan türetilmiş bağlantıları kullanır. Müzik ve DJ durumu özellikleri yapay sinir girdilerine dönüştürülür; basitleştirilmiş etkinlik modeli parça ve geçiş tercihlerini etkiler. Bu, canlı bir sineğin eksiksiz beyin simülasyonu değildir.',
    attribution: 'MaleCNS: HHMI Janelia FlyEM ve proje ortakları. Veri lisansı: CC BY 4.0. Alt ağ seçimi, yapay müzik eşlemeleri ve etkinlik modeli: RadioTEDU.'
  };
}

export function visualizationState(graph, state, stimulus, channels) {
  const ranked = graph.nodes.map((node, index) => ({ ...node, index, activity: state[index] }));
  const visible = ['input', 'intermediate', 'output'].flatMap(role => ranked.filter(n => n.role === role)
    .sort((a, b) => b.activity - a.activity || a.index - b.index).slice(0, 64));
  const selected = new Set(visible.map(n => n.index));
  const nodes = [];
  for (const [lane, role] of ['input', 'intermediate', 'output'].entries()) {
    const allRole = ranked.filter(n => n.role === role);
    const positions = new Map(allRole.map((n, order) => [n.index, (order + 0.5) / allRole.length]));
    for (const node of visible.filter(n => n.role === role)) {
      nodes.push({ id: node.bodyId, type: node.type, role, activity: round(node.activity),
        stimulus: round(stimulus[node.index]), x: round(0.12 + lane * 0.38), y: round(positions.get(node.index)) });
    }
  }
  const edges = [];
  const { indptr, indices, synapses } = graph.edges;
  for (const node of visible) {
    for (let e = indptr[node.index]; e < indptr[node.index + 1]; e++) {
      const source = indices[e];
      if (!selected.has(source)) continue;
      edges.push({ source: graph.nodes[source].bodyId, target: node.bodyId,
        activity: round(Math.min(state[source], node.activity)), synapses: synapses[e] });
    }
  }
  edges.sort((a, b) => b.activity - a.activity || b.synapses - a.synapses);
  const sampledEdges = edges.slice(0, 192);
  const next = new Map();
  for (const edge of sampledEdges) {
    if (!next.has(edge.source)) next.set(edge.source, []);
    next.get(edge.source).push(edge.target);
  }
  const outputs = new Set(nodes.filter(n => n.role === 'output').map(n => n.id));
  const paths = [];
  for (const node of nodes.filter(n => n.stimulus > 0).sort((a, b) => b.stimulus - a.stimulus)) {
    const queue = [[node.id]], visited = new Set([node.id]);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const path = queue[cursor];
      if (outputs.has(path.at(-1))) { paths.push(path); break; }
      if (path.length >= 5) continue;
      for (const other of next.get(path.at(-1)) ?? []) {
        if (!visited.has(other)) { visited.add(other); queue.push([...path, other]); }
      }
    }
    if (paths.length >= 6) break;
  }
  const groups = Object.entries({ ...graph.inputs, ...graph.outputs }).map(([name, members]) => ({
    name, count: members.length, activity: round(members.reduce((sum, index) => sum + state[index], 0) / members.length),
    stimulus: round(members.reduce((sum, index) => sum + stimulus[index], 0) / members.length)
  }));
  return { schemaVersion: 1, graphId: graph.graphId, source: publicSource(graph),
    layout: 'stylized-role-lanes-not-anatomical-coordinates', nodes, edges: sampledEdges, paths, groups,
    readouts: Object.fromEntries(Object.entries(channels).map(([key, value]) => [key, round(value)])) };
}
