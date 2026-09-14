# DJ Fly: MaleCNS connectivity and local DJ intent

DJ Fly uses connectivity from the HHMI Janelia MaleCNS Drosophila connectome. Music and DJ-state features become artificial inputs to selected Kenyon cells. A simplified activity model propagates those inputs through measured connections, and mushroom-body output neuron readouts influence track and transition choices within the music safety layer.

The normal runtime loads a verified `male-cns:v1.0` artifact with **3,584 neurons and 53,504 directed edges**. No neuPrint connection or token is needed for decisions. The five validation cases use synthetic music metadata and real connectome wiring. This phase does not include the final audio mixer integration.

See [REAL_MALECNS_REPORT.md](REAL_MALECNS_REPORT.md) for extraction results and five decisions, and [VALIDATION.md](VALIDATION.md) for checks and limitations.

## Source and attribution

The source is [HHMI Janelia MaleCNS](https://male-cns.janelia.org/), dataset `male-cns:v1.0`, accessed through [neuPrint](https://neuprint.janelia.org/) using `neuprint-python==0.6.3`. The server's `Meta` record was verified as `dataset=male-cns`, `tag=v1.0`, UUID `4b2087c0fbe046bfaf0d60bc970e3e5d`. The authenticated dataset contains 176,422 records labeled `Neuron`; only the selected mushroom-body circuit was extracted.

Data credit: **HHMI Janelia FlyEM and MaleCNS project collaborators**. The project documents a [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/). Preserve attribution, project and license links, dataset version, and the notice of changes when distributing the derived artifact. RadioTEDU's changes are subgraph selection, edge filtering, sparse serialization, artificial feature/readout mappings, and a simplified activity model. RadioTEDU did not create the connectome. These credits also appear in runtime telemetry and the existing About experience.

References studied:

- [Official download and programmatic access documentation](https://male-cns.janelia.org/download/).
- [neuprint-python source](https://github.com/connectome-neuprint/neuprint-python), [query documentation](https://connectome-neuprint.github.io/neuprint-python/docs/queries.html), and [authentication instructions](https://connectome-neuprint.github.io/neuprint-python/docs/quickstart.html#client-and-authorization-token).
- [natverse/malecns](https://github.com/natverse/malecns), used as a metadata/access reference, not a neural simulator.
- [MaleCNS cell-type explorer](https://reiserlab.github.io/celltype-explorer-drosophila-male-cns/types.html), including [APL](https://reiserlab.github.io/celltype-explorer-drosophila-male-cns/types/APL.html) and [DPM](https://reiserlab.github.io/celltype-explorer-drosophila-male-cns/types/DPM.html).

## Install and supply preprocessing credentials

Run commands from this `djfly/` directory. The runtime uses Node.js 20 or newer and built-in modules. Python 3.12 was used for extraction:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r connectome/preprocessing/requirements.txt
```

Sign in to neuPrint and obtain an API token through its account/authentication interface, following the client instructions above. Supply it as the **process environment variable `NEUPRINT_TOKEN`** for preprocessing. Do not put it in source, documentation, shell arguments, generated data, or browser configuration. This PowerShell prompt does not echo the entered value:

```powershell
$djflyCredential = Read-Host 'neuPrint API token' -AsSecureString
$env:NEUPRINT_TOKEN = [System.Net.NetworkCredential]::new('', $djflyCredential).Password
try {
    .\.venv\Scripts\python.exe connectome/preprocessing/probe.py
    .\.venv\Scripts\python.exe connectome/preprocessing/build.py explore --body-id 10013 --body-id 10079 --body-id 10267
} finally {
    Remove-Item Env:NEUPRINT_TOKEN -ErrorAction SilentlyContinue
    $djflyCredential.Dispose()
}
```

The optional development helper `node scripts/preprocess-session.mjs <private-credential-document> probe` or `explore` reads an already supplied private document into memory and passes its token through the child process environment. It redacts subprocess output and never creates a credential file. Prefer the environment workflow for routine regeneration. `.env.example` contains empty placeholders only; runtime does not need a token or load a credential file.

During extraction, the official `/api/dbmeta/datasets` discovery endpoint returned HTTP 500 while authenticated custom queries worked. `connect()` first verifies the exact dataset using `MATCH (m:Meta) RETURN m.dataset AS dataset, m.tag AS tag, m.uuid AS uuid` at the official custom-query endpoint. Only after success does it seed the pinned client's discovery cache and construct the normal `Client`. A wrong tag, missing UUID, failed authentication, or failed query stops preprocessing. This narrow workaround preserves authentication and TLS verification.

## Explore, build, validate, and activate

`build.py explore` queries annotated KC, APL, DPM, and MBON populations, ROI and neurotransmitter metadata, and directed adjacency. `fetch_adjacencies` returns neuron metadata followed by connections; `omit_rois=True` and `weight_props=["weight"]` obtain total synapse counts without summing overlapping ROI counts. Queries use batches of 100 and one worker. Optional `--body-id` values add incoming/outgoing exploration for reviewed neurons. Skeletons are not needed for the current visualization and are not fetched.

The ignored `connectome/cache/` contains `snapshot.json.gz` and `exploration.json`. After extraction, these steps are local and need no token:

```powershell
.\.venv\Scripts\python.exe connectome/preprocessing/build.py build
node scripts/validate-real.mjs generated/malecns-v1.graph.json.gz
node scripts/activate-artifact.mjs
node scripts/validate-real.mjs
npm test
.\.venv\Scripts\python.exe connectome/preprocessing/test_build.py
```

The first validation explicitly loads the candidate artifact. Activation requires matching, eligible selection and validation reports, deterministic cases, measurable variation, passing input ablations, and the candidate-feature swap check. It atomically writes `generated/runtime-manifest.json`. The last validation uses the **normal default runtime**, with no explicit artifact path, and records that in `generated/real-validation.json`.

Extraction inputs are hashed separately from model and selection settings, so local tuning can reuse the authenticated snapshot. Changing population queries or extraction settings requires a fresh snapshot. Preserve the exact artifact for replay: server annotation changes or machine-dependent benchmark eligibility may change a later rebuild even under the same dataset tag.

Generated files and caches are ignored by Git. Package the reviewed `malecns-v1.graph.json.gz` and `runtime-manifest.json` with matching code/configuration when installing on another server. Keep selection and validation reports with the release evidence. A clean checkout intentionally cannot run in real mode until an artifact is regenerated or supplied. Do not put the cache, candidates, or runtime graph under a public static directory.

## Population choice and size compromise

This mushroom-body projection/feedback model uses an annotated intrinsic population (Kenyon cells), local feedback neurons (APL/DPM), and output populations (MBONs). These anatomical roles motivate the wiring scaffold; they do not establish a biological mapping to music.

| Role | Annotation selection | Extracted | Runtime |
| --- | --- | ---: | ---: |
| Artificial input | `KC.*` | 4,064 | 3,483 |
| Intermediate feedback | `APL`, `DPM` | 4 | 4 |
| Readout | `MBON.*` | 97 | 97 |
| Total | 54 annotated types | 4,165 | 3,584 |

The original selected circuit has 730,592 edges and 2,208,721 synapses. KC-to-KC accounts for 642,933 edges and 1,153,845 synapses. Initial full-circuit trials missed the original retention/runtime budgets. Phase 1 therefore explicitly omits KC-to-KC edges to reduce unsigned recurrent drive and cost, leaving 87,659 eligible projection/feedback edges carrying 1,054,876 synapses. These omitted connections are real; their biological contribution is outside this model.

The builder compares minimum synapse counts 1, 3, and 5 at caps 1,024, 2,048, 3,072, and 3,584, plus the full-population baseline. It retains viable intermediate/output cells, allocates KCs round-robin across annotated types, ranks cells by retained circuit strength **within each type**, and prunes cells outside an input-to-output route. Type coverage comes before stronger-cell preference. It does not select globally by degree or use random body IDs.

The smallest measured eligible graph uses the 3,584 cap and at least 3 synapses per edge. It retains all 54 types and all 97 MBONs, with 53,504 edges and 868,371 synapses: **82.32% of eligible projection/feedback weight**, and **39.32% of the full original selected circuit weight**. Decision p95 was 91.30 ms for eight safe candidates, within the configured 100 ms budget. Budgets are explicit in `connectome/selection.json`; failure never relaxes them automatically.

## Sparse artifact and runtime source contract

The artifact is gzip-compressed JSON, 219,941 bytes in this extraction. `edges.indptr`, `edges.indices`, and `edges.synapses` store target-row CSR: each target row lists presynaptic source indices and original synapse counts. Nodes retain string body IDs, type, role, population, ROIs, pre/post totals, and available neurotransmitter/confidence annotations. Memberships, provenance, selection settings, metrics, mapping version, and graph identity travel with the graph.

`connectome/load.mjs` validates schema, identity, sparse ordering/bounds, weights, metadata, and memberships. Normal loading defaults to `REAL_MALECNS` and checks the manifest's filename, SHA-256, dataset, mapping version, and model parameters. Missing files, corruption, incompatible metadata, or a substituted fixture fail clearly; there is no fallback. `DJFLY_GRAPH_PATH` permits a reviewed override; use `DJFLY_GRAPH_SHA256` to pin it. `DEVELOPMENT_FIXTURE` must be explicitly selected and is forbidden when `NODE_ENV=production`.

## Artificial music feature mapping

`decision/stimulus.mjs` normalizes trusted measured features and DJ state. Unit-valued features must be finite and within range. Tempo, loudness, and centroid are normalized and clipped. Invalid or missing measurements do not receive invented values.

| Feature | Normalization | KC type assignment | Runtime cells |
| --- | --- | --- | ---: |
| Current BPM | 60–200 BPM → 0–1 | `KCab-m` | 268 |
| Candidate BPM difference | Absolute difference, 0–12 BPM → 0–1 | `KCa'b'-ap1` | 100 |
| Energy | Measured 0–1 | `KCg`, part of `KCg-m`/`KCg-s1`–`s4` | 259 |
| Loudness | −36 to −6 LUFS → 0–1 | `KCab-s` | 657 |
| Bass energy | Measured 0–1 | `KCab-c` | 488 |
| Mid energy | Measured 0–1 | `KCa'b'-m` | 205 |
| High-frequency energy | Measured 0–1 | Part of `KCg-d` | 103 |
| Rhythmic density | Measured 0–1 | `KCa'b'-ap2` | 291 |
| Spectral centroid | 0–12,000 Hz → 0–1 | `KCab-p` | 129 |
| Harmonic compatibility | Safety-layer score 1, 0.9, or 0.8 | Part of `KCab-m` | 268 |
| Current set energy | DJ state 0–1 | `KC`, part of `KCg-m` | 256 |
| Requested energy direction | DJ state −1–1 → 0–1 | Part of `KCa'b'-ap1` | 99 |
| Transition opportunity | DJ state 0–1 | Part of `KCg-m`/`KCg-s1`–`s4` | 257 |
| Spectral flatness | Measured 0–1 | Part of `KCg-d` | 103 |

The table in `connectome/selection.json` is a RadioTEDU design choice, not a biological feature preference. Within a type, SHA-256 ordering of the fixed mapping seed and body ID assigns cells round-robin to its listed features. Each input belongs to exactly one feature; unknown types fail. Each decision seed adds stable 0.9–1.1 gain per input cell, held fixed across candidates.

The earlier balanced all-KC assignment averaged away most differences. Type-specific assignment preserves projection differences and passed scenario variation and ablation checks. No single feature contributed more than 25.3% of the measured summed readout change in the five ablations. This is evidence about this model and test set, not biological auditory tuning.

## Activity and readouts

`LeakyPropagation` is replaceable through `activityFactory`. It square-roots synapse counts and normalizes each target's incoming row to L1 norm at most one. Each candidate starts from zero and runs 16 steps:

```text
x(next) = 0.25 * x + 0.75 * tanh(0.85 * W * x + 1.2 * stimulus)
```

Activity stays finite in [0,1]. The infinity-norm contraction bound is 0.8875. Sixteen steps differ from 32 by at most 0.000345 in tested readouts, with no changed track selections. There is no hidden persistent event state or learned behavior.

Neurotransmitter predictions, confidence, and consensus remain annotations. Predictions and consensus disagree substantially here, and receptor effects cannot be recovered from these fields alone. Propagation uses an **unsigned synapse proxy**. APL inhibition and DPM modulation are not physiologically simulated.

The 37 MBON types are sorted and assigned round-robin to six channels, keeping all cells of a type together. Each channel compares its group mean with the mean of all six group means:

```text
channel = 0.5 + 0.5 * tanh(8 * (groupMean - meanOfGroupMeans))
```

| Readout | Cells | MBON type suffixes |
| --- | ---: | --- |
| Candidate preference | 18 | 01, 07, 14, 18, 24, 29, 35 |
| Risk | 18 | 02, 09, 15, 19, 25, 30 |
| Energy direction | 23 | 03, 10, 15-like, 20, 25-like, 31 |
| Transition aggressiveness | 12 | 04, 11, 16, 21, 26, 32 |
| Blend duration | 14 | 05, 12, 17, 22, 27, 33 |
| Show-off tendency | 12 | 06, 13, 17-like, 23, 28, 34 |

These names are engineered semantics, not physiological labels. Preference ranks approved candidates. The blend channel targets 4–32 bars; `chooseStrategy` chooses the nearest allowed strategy/bar combination using risk, aggressiveness, show-off, and duration distance. Returned bars always belong to that safe strategy. High activity cannot enable unsupported effects or bypass preparation, tempo, harmony, grid, phrase, headroom, or capability checks.

## Safety and application integration

```text
Trusted current track + DJ state + music pool
    → music/candidates.mjs: approved candidates and valid strategies
    → FlyDecisionEngine: local propagation and preference
    → FlyDecision: selected IDs, risk, energy direction,
                   aggressiveness, blend bars, show-off
    → mixer/controller.mjs: validate intent and execute through an adapter
```

The activity engine never receives rejected candidates. Empty safe sets return `decision: null` and `reason: no-safe-candidates`. The controller checks constraints before preparation and again afterward, handles stale state, and serializes transitions. Intent cannot create additional capabilities. The controller is an integration interface; a production audio/DSP adapter remains future work.

Server code can call `await createDJFly()` from `index.mjs` once and reuse `fly.decide(request)` offline. Pass trusted server-side measurements/capabilities and publish only `result.telemetry` to public clients. Public requests must not declare arbitrary mixer capabilities or replace trusted track analysis.

## Replay, development, and telemetry

```powershell
npm run demo
node scripts/replay.mjs generated/demo.json generated/replayed.json
npm run benchmark
npm run preview -- --debug
```

The preview binds to `127.0.0.1:5189/djfly/` and uses the real manifest by default. It is a local validation tool with synthetic music state, not a deployed DJ service. Debug mode records approved/rejected candidates, normalized features, stimulated body IDs/values, group activity, readouts, intent, seed, graph ID, and artifact SHA-256. Replay rejects a different graph SHA. Change request `seed` for another deterministic run; retain graph, mapping/model code, measurements, capabilities, and state for reproducibility.

Fixture work remains explicit:

```powershell
.\.venv\Scripts\python.exe connectome/preprocessing/build.py fixture
npm run test:fixture
npm run demo:fixture
node scripts/replay.mjs --fixture generated/fixture-demo.json generated/fixture-replayed.json
npm run benchmark:fixture
npm run preview -- --fixture --debug
```

Alternatively set `DJFLY_GRAPH_SOURCE=DEVELOPMENT_FIXTURE` in a development process. Telemetry always exposes `REAL_MALECNS` or `DEVELOPMENT_FIXTURE`, dataset, identity, and attribution. Fixture IDs and copy identify non-biological development data. Production rejects fixture mode.

Visualization samples actual state: up to 64 nodes per role (132 for this graph), 192 existing directed edges, six paths built from those edges, and group/readout activity. The five real payloads are under 30 KB. Positions are stable stylized role lanes, not anatomical coordinates. Edge activity is a display proxy from endpoint activity, not a simulated synaptic current. `preferenceMargin` is score separation, not a calibrated probability. No whole-connectome or skeleton endpoint is exposed; random animation does not generate activity.

## Scientific and operational limits

This reduced, unsigned model lacks receptor dynamics, inhibitory/modulatory physiology, synaptic timing, learning, complete sensory pathways, and most of the CNS. Music mappings and readout labels are RadioTEDU designs. The fly does not literally hear or prefer a track.

Synthetic cases validate connectivity, determinism, numerical behavior, safety, telemetry, and responsiveness. They do not establish musical quality, learned personality, or audience preference. Energy direction is a relative neural score, not calibrated to guarantee a requested increase. All five fixed-pool cases chose the same track; their readouts and safe strategies varied, and swapping features changed the selected track without changing IDs.

Before event use, implement production music analysis and the audio adapter in the separate mixer phase, validate real tracks and hardware capabilities, and measure end-to-end timing on the event host. This implementation has not changed IIS routing, deployed the preview, or connected live playback.
