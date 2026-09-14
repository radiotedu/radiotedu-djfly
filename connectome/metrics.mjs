const quantiles = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return Object.fromEntries([0, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1].map(q =>
    [String(q), sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null]));
};
const histogram = values => Object.fromEntries([...values.reduce((counts, value) =>
  counts.set(value, (counts.get(value) ?? 0) + 1), new Map())].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

export function graphMetrics(graph) {
  const n = graph.nodes.length, { indptr, indices, synapses } = graph.edges;
  const outgoing = Array.from({ length: n }, () => []), incoming = Array.from({ length: n }, () => []);
  let selfEdges = 0;
  for (let target = 0; target < n; target++) {
    for (let e = indptr[target]; e < indptr[target + 1]; e++) {
      outgoing[indices[e]].push(target); incoming[target].push(indices[e]);
      if (target === indices[e]) selfEdges++;
    }
  }
  const distances = (starts, adjacency) => {
    const distance = new Int32Array(n).fill(-1), queue = [...starts];
    for (const start of starts) distance[start] = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const node = queue[cursor];
      for (const other of adjacency[node]) if (distance[other] === -1) {
        distance[other] = distance[node] + 1; queue.push(other);
      }
    }
    return distance;
  };
  const weakSizes = [], seen = new Uint8Array(n);
  for (let root = 0; root < n; root++) {
    if (seen[root]) continue;
    const queue = [root]; seen[root] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const node = queue[cursor];
      for (const other of [...outgoing[node], ...incoming[node]]) if (!seen[other]) {
        seen[other] = 1; queue.push(other);
      }
    }
    weakSizes.push(queue.length);
  }
  seen.fill(0);
  const order = [];
  for (let root = 0; root < n; root++) {
    if (seen[root]) continue;
    const stack = [[root, false]];
    while (stack.length) {
      const [node, finished] = stack.pop();
      if (finished) { order.push(node); continue; }
      if (seen[node]) continue;
      seen[node] = 1; stack.push([node, true]);
      for (const other of outgoing[node]) if (!seen[other]) stack.push([other, false]);
    }
  }
  seen.fill(0);
  const strongSizes = [];
  for (const root of order.reverse()) {
    if (seen[root]) continue;
    const stack = [root]; seen[root] = 1; let size = 0;
    while (stack.length) {
      const node = stack.pop(); size++;
      for (const other of incoming[node]) if (!seen[other]) { seen[other] = 1; stack.push(other); }
    }
    strongSizes.push(size);
  }
  const inputs = graph.nodes.flatMap((node, i) => node.role === 'input' ? [i] : []);
  const outputs = graph.nodes.flatMap((node, i) => node.role === 'output' ? [i] : []);
  const toOutputs = distances(outputs, incoming), fromInputs = distances(inputs, outgoing);
  const channelReachability = Object.fromEntries(Object.entries(graph.inputs).map(([feature, starts]) => {
    const distance = distances(starts, outgoing);
    return [feature, Object.fromEntries(Object.entries(graph.outputs).map(([channel, members]) =>
      [channel, { reachableNeurons: members.filter(i => distance[i] >= 0).length, totalNeurons: members.length,
        shortestPath: Math.min(...members.filter(i => distance[i] >= 0).map(i => distance[i])) }]))];
  }));
  const pairCounts = {};
  for (let target = 0; target < n; target++) for (const source of incoming[target]) {
    const key = `${graph.nodes[source].role}->${graph.nodes[target].role}`;
    pairCounts[key] = (pairCounts[key] ?? 0) + 1;
  }
  return {
    nodes: n, edges: indices.length, selfEdges, directedDensityExcludingSelf: (indices.length - selfEdges) / (n * (n - 1)),
    roles: histogram(graph.nodes.map(node => node.role)), types: histogram(graph.nodes.map(node => node.type ?? 'untyped')),
    isolatedNeurons: outgoing.filter((neighbors, i) => neighbors.length + incoming[i].length === 0).length,
    weakComponents: weakSizes.length, largestWeakComponent: Math.max(...weakSizes),
    strongComponents: strongSizes.length, largestStrongComponent: Math.max(...strongSizes),
    synapses: synapses.reduce((total, count) => total + count, 0), synapseCountQuantiles: quantiles(synapses),
    inputToOutputPathQuantiles: quantiles(inputs.filter(i => toOutputs[i] >= 0).map(i => toOutputs[i])),
    inputsReachingAnyOutput: inputs.filter(i => toOutputs[i] >= 0).length,
    outputsReachedFromAnyInput: outputs.filter(i => fromInputs[i] >= 0).length,
    channelReachability, edgeRolePairs: pairCounts,
    inputGroups: Object.fromEntries(Object.entries(graph.inputs).map(([name, members]) => [name, { count: members.length,
      types: histogram(members.map(i => graph.nodes[i].type)) }])),
    outputGroups: Object.fromEntries(Object.entries(graph.outputs).map(([name, members]) => [name, { count: members.length,
      types: histogram(members.map(i => graph.nodes[i].type)) }]))
  };
}
