import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGraph, mapping, runtimeManifestPath } from '../connectome/load.mjs';

const artifactPath = resolve(process.argv[2] ?? fileURLToPath(new URL('../generated/malecns-v1.graph.json.gz', import.meta.url)));
assert.equal(dirname(artifactPath), dirname(runtimeManifestPath), 'Place the reviewed runtime artifact in generated/.');
const { graph, artifactSha256 } = await loadGraph(artifactPath);
const selection = JSON.parse(await readFile(resolve(dirname(artifactPath), 'selection-report.json'), 'utf8'));
const validation = JSON.parse(await readFile(resolve(dirname(artifactPath), 'real-validation.json'), 'utf8'));
assert.equal(selection.chosen?.graphId, graph.graphId, 'Selection report must match the artifact.');
assert.equal(selection.chosen?.eligible, true);
assert.equal(validation.artifactSha256, artifactSha256, 'Run real validation on the selected artifact first.');
assert.equal(validation.dataKind, 'malecns');
assert(validation.cases.length >= 5 && validation.cases.every(item => item.deterministic));
assert.equal(validation.checks.meaningfulVariation, true, 'Real readouts failed the variation check.');
assert.equal(validation.checks.noDominantInput, true, 'A single input feature dominates the ablation check.');
assert.equal(validation.candidateFeatureSwap.passed, true);
const manifest = { sourceMode: 'REAL_MALECNS', dataset: 'male-cns:v1.0', artifact: basename(artifactPath),
  sha256: artifactSha256, graphId: graph.graphId, serverIdentity: graph.provenance.serverIdentity,
  mappingVersion: mapping.version, model: mapping.model };
await writeFile(runtimeManifestPath + '.tmp', JSON.stringify(manifest, null, 2) + '\n');
await rename(runtimeManifestPath + '.tmp', runtimeManifestPath);
console.log(runtimeManifestPath);
