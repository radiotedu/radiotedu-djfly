import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';

export const fixturePath = fileURLToPath(new URL('./fixtures/development.graph.json', import.meta.url));
export const mapping = JSON.parse(await readFile(new URL('../decision/mapping.json', import.meta.url), 'utf8'));
export const runtimeManifestPath = fileURLToPath(new URL('../generated/runtime-manifest.json', import.meta.url));

const fail = message => { throw new Error(`Invalid DJ Fly graph: ${message}`); };

export function validateGraph(graph, { allowFixture = false } = {}) {
  if (!graph || graph.schemaVersion !== 1 || graph.mappingVersion !== mapping.version) fail('schema or mapping version');
  const kind = graph.provenance?.kind;
  if (kind === 'development-fixture') {
    if (!allowFixture) fail('development fixture requires explicit opt-in');
    if (graph.provenance.dataset !== null) fail('fixture must not claim a dataset');
  } else if (kind !== 'malecns' || graph.provenance.dataset !== 'male-cns:v1.0'
    || graph.provenance.license !== 'CC-BY-4.0' || !graph.provenance.snapshotHash
    || !graph.provenance.attribution || !graph.provenance.changes) {
    fail('MaleCNS provenance or attribution is missing');
  }
  if (kind === 'malecns' && (graph.provenance.serverIdentity?.dataset !== 'male-cns'
    || graph.provenance.serverIdentity?.tag !== 'v1.0'
    || !/^[a-f0-9]{32}$/.test(graph.provenance.serverIdentity?.uuid ?? ''))) fail('server dataset identity');
  if (!/^[a-f0-9]{64}$/.test(graph.graphId ?? '')) fail('graph ID');
  if (graph.selection?.signMode !== 'unsigned-synapse-proxy') fail('unsupported neurotransmitter model');
  const nodes = graph.nodes;
  if (!Array.isArray(nodes) || nodes.length < 20 || nodes.length > 12000) fail('node budget');
  const ids = new Set();
  for (const node of nodes) {
    if (!node || typeof node.bodyId !== 'string' || ids.has(node.bodyId)) fail('duplicate or missing body ID');
    if (kind === 'malecns' ? !/^[1-9][0-9]*$/.test(node.bodyId) : !node.bodyId.startsWith('fixture:')) fail('body ID provenance');
    if (!['input', 'intermediate', 'output'].includes(node.role)) fail('node role');
    if (node.type !== null && typeof node.type !== 'string') fail('node type');
    if (!Array.isArray(node.rois) || node.rois.some(roi => typeof roi !== 'string')) fail('ROIs');
    ids.add(node.bodyId);
  }
  const { format, indptr, indices, synapses } = graph.edges ?? {};
  if (format !== 'csr-target-source' || !Array.isArray(indptr) || !Array.isArray(indices)
    || !Array.isArray(synapses) || indptr.length !== nodes.length + 1
    || indices.length !== synapses.length || indices.length > 150000 || !indices.length
    || indptr[0] !== 0 || indptr.at(-1) !== indices.length) fail('CSR structure');
  for (let row = 0; row < nodes.length; row++) {
    if (!Number.isSafeInteger(indptr[row + 1]) || indptr[row + 1] < indptr[row]) fail('CSR offsets');
    let last = -1;
    for (let e = indptr[row]; e < indptr[row + 1]; e++) {
      if (!Number.isSafeInteger(indices[e]) || indices[e] <= last || indices[e] >= nodes.length) fail('CSR column order/bounds');
      if (!Number.isSafeInteger(synapses[e]) || synapses[e] <= 0) fail('synapse count');
      last = indices[e];
    }
  }
  for (const [groups, names, role] of [[graph.inputs, mapping.features, 'input'], [graph.outputs, mapping.channels, 'output']]) {
    if (!groups || Object.keys(groups).length !== names.length) fail(`${role} mapping`);
    const membership = new Set();
    for (const name of names) {
      if (!Array.isArray(groups[name]) || !groups[name].length) fail(`empty ${name} population`);
      for (const index of groups[name]) {
        if (!Number.isInteger(index) || nodes[index]?.role !== role || membership.has(index)) fail(`${name} membership`);
        membership.add(index);
      }
    }
    if (membership.size !== nodes.filter(n => n.role === role).length) fail(`unmapped ${role} nodes`);
  }
  if (graph.metrics?.nodes !== nodes.length || graph.metrics?.edges !== indices.length) fail('graph metric counts');
  return graph;
}

export async function loadGraph(path = process.env.DJFLY_GRAPH_PATH, options = {}) {
  const sourceMode = options.allowFixture ? 'DEVELOPMENT_FIXTURE' : process.env.DJFLY_GRAPH_SOURCE ?? 'REAL_MALECNS';
  if (!['REAL_MALECNS', 'DEVELOPMENT_FIXTURE'].includes(sourceMode)) fail('unknown graph source mode');
  if (sourceMode === 'DEVELOPMENT_FIXTURE' && process.env.NODE_ENV === 'production') fail('fixture forbidden in production');
  let expectedSha256 = options.expectedSha256 ?? process.env.DJFLY_GRAPH_SHA256;
  if (!path && sourceMode === 'DEVELOPMENT_FIXTURE') path = fixturePath;
  if (!path) {
    let manifest;
    try { manifest = JSON.parse(await readFile(runtimeManifestPath, 'utf8')); }
    catch { throw new Error('REAL_MALECNS runtime manifest is missing or invalid. Generate and validate the local artifact; no fixture fallback is allowed.'); }
    if (manifest.sourceMode !== 'REAL_MALECNS' || manifest.dataset !== 'male-cns:v1.0'
      || typeof manifest.artifact !== 'string' || basename(manifest.artifact) !== manifest.artifact
      || !/^[a-f0-9]{64}$/.test(manifest.sha256 ?? '') || manifest.mappingVersion !== mapping.version
      || JSON.stringify(manifest.model) !== JSON.stringify(mapping.model)) fail('runtime manifest metadata');
    path = resolve(dirname(runtimeManifestPath), manifest.artifact);
    expectedSha256 = manifest.sha256;
  }
  const bytes = await readFile(path);
  if (bytes.length > 8 * 1024 * 1024) fail('file exceeds compressed budget');
  const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedSha256 && artifactSha256 !== expectedSha256) fail('artifact SHA-256 mismatch');
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }) : bytes;
  if (raw.length > 32 * 1024 * 1024) fail('expanded file budget');
  const graph = validateGraph(JSON.parse(raw.toString('utf8')), { ...options, allowFixture: sourceMode === 'DEVELOPMENT_FIXTURE' });
  if ((sourceMode === 'REAL_MALECNS') !== (graph.provenance.kind === 'malecns')) fail('configured source differs from artifact');
  return { graph, artifactSha256, sourceMode, resolvedPath: resolve(path) };
}
