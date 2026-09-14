# DJ Fly validation record — 2026-09-13

The authenticated `male-cns:v1.0` extraction, selected sparse artifact, normal default runtime, and real-graph decisions were exercised on Windows with Node.js v24.13.0 and Python 3.12. The final audio mixer and production website deployment are outside this validation.

## Automated checks

| Check | Result |
| --- | --- |
| `node --test tests/engine.test.mjs tests/http.test.mjs tests/real.test.mjs` | 17 passed, 0 failed |
| `.venv/Scripts/python.exe connectome/preprocessing/test_build.py` | 8 passed, 0 failed |
| `node ../backend/node_modules/typescript/bin/tsc --noEmit --strict --module nodenext --target es2022 index.d.mts` | Passed |
| `node --check` over 22 module files | Passed |
| Python AST parsing of 3 preprocessing files | Passed |
| Credential comparison against 102 task files, including 23 decompressed gzip files | No persisted credential matches |
| Default CLI decision followed by replay of its debug record | Byte-identical output; `REAL_MALECNS` source |
| Exhaustive artifact-to-extraction comparison | All 3,584 body IDs/types/roles and 53,504 edge directions/weights match the authenticated snapshot |

There is no dedicated linter or compiled runtime build configured in this independent Node module. Syntax, interface, unit, integration, and runtime checks above cover the changed package. Existing fixture/controller tests were retained. No tests were weakened to make the real artifact pass.

The six real-graph tests cover default manifest/SHA/dataset loading; metadata, memberships, type coverage and reachability; deterministic and bounded decisions; safe candidate and transition membership; actual state-to-telemetry values and existing edges; compression round trips; corrupt, absent, wrong-source and checksum-mismatched artifacts; explicit development fixture controls; production fixture rejection; and a local HTTP preview using the real default source. The HTTP test returns 200 for the real preview and telemetry, and 404 for unavailable debug/full-graph routes. Runtime fetch is disabled in the real decision test.

Python tests include the authenticated-dataset bootstrap's identity check, rejection of a wrong version, explicit role-pair exclusion with honest full-circuit retention, and preservation of a previously generated artifact when no experiment meets the selection budgets.

## Graph evidence

Canonical artifact: [generated/malecns-v1.graph.json.gz](generated/malecns-v1.graph.json.gz).

```text
Dataset: male-cns:v1.0
Meta UUID: 4b2087c0fbe046bfaf0d60bc970e3e5d
Graph ID: dceabe6e548ff40b6985ddd593438899c69147b499fc272df324f2b8b1b77cfa
File SHA-256: a04137cdf9bb8a3f50d2ff3bdc209205833b73cc4c0581ed39f90086e2eb206e
Size: 219941 bytes
Neurons: 3584 = 3483 input + 4 intermediate + 97 output
Edges: 53504; retained synapses: 868371
```

All nodes retain real body IDs and annotations. An exhaustive comparison against the authenticated extraction found zero mismatches in exported body IDs, types, roles, edge directions, or original synapse counts. The graph has no isolated neurons, one weak component containing all 3,584 nodes, and three strong components with a largest size of 3,582. Directed density excluding the one self-edge is 0.00416642. All inputs reach an output, and each of the 14 feature groups reaches every output channel and all of its member neurons. Nearest input-to-output paths are one edge at the median and at most two.

The graph retains 82.32% of the explicitly selected projection/feedback circuit's synapse weight, but only 39.32% of the original KC/APL/DPM/MBON circuit's weight. KC-to-KC connections are deliberately excluded; the distinction is recorded in both metrics and documentation.

## Activity, sensitivity, and replay evidence

[generated/real-validation.json](generated/real-validation.json) records five synthetic music scenarios executed through the real artifact, with `sourceMode=REAL_MALECNS`, `normalDefaultRuntime=true`, and `networkDisabledDuringDecisions=true`.

- Identical graph, inputs, capabilities, state, and seed reproduce the complete result exactly.
- Sixteen steps differ from 32 by at most 0.000344867 in any tested readout; selected tracks do not change. The maximum 16-step residual is 0.000435147.
- Across the five selected states, all values remain finite. No state value is below 0.000001 or above 0.99. The overall activity range is approximately 0.4493–0.9503.
- The largest individual neuron's share of summed activity is below 0.033%; the largest output group's share of summed output-group means is below 18%.
- One-feature ablations produce a maximum individual feature share of 25.253% of summed readout change. Loudness has the largest influence in these cases; it does not dominate the aggregate response.
- Across cases, readout ranges are 0.05562 preference, 0.01799 risk, 0.03383 energy direction, 0.04518 aggressiveness, 0.03216 blend, and 0.02633 show-off. Three different safe strategy IDs and two blend durations result.
- All five shared-pool cases select `development-E`. Keeping IDs fixed and swapping its feature packet with another approved candidate changes the winner to `development-F`, exactly as expected. This supports feature-dependent selection without claiming every scenario must choose a different track.
- Public telemetry in the five cases is 29,439–29,569 bytes. Its rounded activities match computed state, and sampled edges/paths belong to the graph. A preference margin is not a calibrated confidence probability.

The full failed full-circuit trials, earlier 32-step trials, and initial mapping's weak sensitivity remain available as local historical evidence in `generated/initial-full-circuit-experiments.json`, `generated/projection-32step-experiments.json`, and `generated/initial-mapping-validation.json`. They are diagnostic records, not passing validation for the active artifact. The selected experiment is recorded in [generated/selection-report.json](generated/selection-report.json): 30 decisions with eight safe candidates, median 57.60 ms, p95 91.30 ms, maximum 94.03 ms. Shared-host load can change timings.

## Fail-closed runtime and deployment boundary

[generated/runtime-manifest.json](generated/runtime-manifest.json) pins the real artifact. Default loading was exercised after activation without an explicit graph path. Missing/corrupt artifacts, a changed checksum, or incompatible metadata fail instead of substituting development data. `DEVELOPMENT_FIXTURE` is an explicit development choice and is rejected in production. The real default also passes with `NODE_ENV=production`.

The credential was supplied through a preprocessing child process environment. No source, documentation, backup, raw cache, or compressed artifact contained the credential in the recorded audit. Generated artifacts/caches and credential files are ignored by Git. No credential is required during any runtime test or event decision.

This validates the local decision system and its existing HTTP preview. It does not claim a deployed `/djfly` audit, working live mixer, music-analysis accuracy, hardware timing, listener preference, or biological realism. Next-phase work should integrate trusted measured features and the production audio adapter, then verify actual transitions and the public experience against real event conditions.
