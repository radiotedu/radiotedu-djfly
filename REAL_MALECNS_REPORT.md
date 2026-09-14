# Real MaleCNS decision integration — completion report

The requested MaleCNS decision phase is complete: authentication and queries succeeded against the exact dataset, a real derived graph was generated and activated, and decisions were executed through the normal runtime. The development fixture remains available only by explicit selection. Final live audio integration was not started.

## Dataset, populations, and graph

| Item | Verified result |
| --- | --- |
| Dataset | HHMI Janelia `male-cns:v1.0`, official neuPrint, client 0.6.3 |
| Server identity | `male-cns` / `v1.0`; UUID `4b2087c0fbe046bfaf0d60bc970e3e5d` |
| Extraction time | 2026-09-13 12:17:26 UTC |
| Input population | 3,483 Kenyon cells selected from 4,064 annotated `KC.*` cells |
| Intermediate population | Two APL and two DPM cells; all four retained |
| Output population | All 97 annotated MBON cells, covering 37 MBON types |
| Total | **3,584 neurons; 54 annotated types** |
| Directed edges | **53,504**, retaining **868,371 synapses** |
| Format | Gzip JSON containing target-row CSR sparse arrays, nodes, annotations, memberships, and provenance |
| Artifact size | **219,941 bytes** (about 215 KiB) |
| Isolated neurons | 0 |
| Components | 1 weak component, size 3,584; 3 strong components, largest 3,582 |
| Density | 0.41664% of possible non-self directed edges; one additional self-edge |
| Synapses per edge | Minimum 3; median 9; 90th percentile 40; 99th percentile 72; maximum 1,878 |
| Input-to-output reachability | All 3,483 inputs reach an output; every feature group reaches every output channel and its members |
| Nearest output distance | Median 1 directed edge; maximum 2 |
| Measured runtime | Eight safe candidates: median 57.60 ms; p95 91.30 ms; maximum 94.03 ms over 30 decisions |

Kenyon cells, APL/DPM feedback, and MBON outputs form an anatomically motivated mushroom-body circuit. The music semantics are artificial. Neurons were selected by annotated role and type coverage, then by retained connection strength within each input type; no random IDs or global top-degree selection were used. Node data preserves body ID, type, ROI membership, synapse totals, and available neurotransmitter/confidence fields. Regions include the left/right mushroom body, calyx, peduncle, and lobe annotations in CentralBrain. No skeleton download was necessary.

The full extracted circuit contained 4,165 cells, 730,592 edges, and 2,208,721 synapses. Initial full-circuit experiments failed the original cost/retention constraints. The implemented model explicitly removes KC-to-KC edges and compares caps 1,024, 2,048, 3,072, 3,584, and the full population at edge thresholds 1, 3, and 5 synapses. It chooses the smallest measured eligible graph without relaxing its constraints. The selected 3,584/3 configuration retains **82.32% of the remaining projection/feedback weight**, and **39.32% of the full original extracted weight**. These are separate denominators; the omitted biological connections are a material simplification.

The default artifact is [generated/malecns-v1.graph.json.gz](generated/malecns-v1.graph.json.gz), pinned by [generated/runtime-manifest.json](generated/runtime-manifest.json):

```text
Graph ID: dceabe6e548ff40b6985ddd593438899c69147b499fc272df324f2b8b1b77cfa
File SHA-256: a04137cdf9bb8a3f50d2ff3bdc209205833b73cc4c0581ed39f90086e2eb206e
```

## Activity and mapping

The replaceable model uses square-root synapse weights, target-row L1 normalization, zero initial state for each candidate, and 16 recurrent steps:

```text
x(next) = 0.25*x + 0.75*tanh(0.85*W*x + 1.2*stimulus)
readout = 0.5 + 0.5*tanh(8*(groupMean - meanOfGroupMeans))
```

Parameters are leak 0.25, recurrence 0.85, stimulus gain 1.2, readout gain 8, and 16 steps. The contraction bound is 0.8875. Moving to 32 steps changes tested readouts by at most 0.000345 with no changed track selections. Activity stays finite and below saturation; tested selected-state activity spans approximately 0.4493–0.9503, with no values above 0.99. No individual neuron contributes 0.033% or more of summed activity, and no readout group contributes 18% or more of summed group means.

Fourteen normalized music/state features map to explicit KC types. Tempo uses `KCab-m`; tempo difference and requested energy direction use `KCa'b'-ap1`; rhythm uses `KCa'b'-ap2`; mid energy uses `KCa'b'-m`; bass uses `KCab-c`; loudness uses `KCab-s`; centroid uses `KCab-p`; high energy/flatness use `KCg-d`; energy, set energy, and transition opportunity use specified gamma groups. Harmonic compatibility shares `KCab-m`. The [complete normalization, type, and cell-count table](README.md#artificial-music-feature-mapping) documents every feature. A fixed mapping seed and body-ID ordering keep assignment reproducible; per-decision seeded input gains remain fixed across candidates.

The six readouts are preference (18 MBONs), risk (18), energy direction (23), aggressiveness (12), blend (14), and show-off (12). Types are assigned deterministically with each type kept intact; [the exact MBON list](README.md#activity-and-readouts) is documented. The blend target is 4–32 bars. Intent chooses among allowed strategy/bar pairs; it does not touch DSP nodes.

## Five real-graph decisions

Inputs are synthetic music metadata in [examples/scenarios.mjs](examples/scenarios.mjs), all with seed 42. Every row uses the same real artifact and the music safety layer. Values below are rounded; full inputs, candidate lists, readouts, and decisions are in [generated/real-validation.json](generated/real-validation.json).

| Case | Track | Safe strategy | Risk | Energy direction | Aggressiveness | Blend bars | Show-off |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| A: conservative groove | development-E | long-eq-blend | 0.4360 | 0.4426 | 0.5305 | 16 | 0.4928 |
| B: energy increase | development-E | filter-sweep | 0.4342 | 0.4553 | 0.5569 | 16 | 0.4733 |
| C: risky/high-energy candidates | development-E | filter-sweep | 0.4338 | 0.4542 | 0.5592 | 16 | 0.4710 |
| D: long smooth opportunity | development-E | long-eq-blend | 0.4492 | 0.4215 | 0.5140 | 16 | 0.4947 |
| E: short transition opportunity | development-E | echo-transition | 0.4312 | 0.4537 | 0.5539 | 4 | 0.4684 |

All five cases select the same candidate in this shared pool. The system nevertheless produces different channel values, three strategy IDs, and two blend durations. Cross-case ranges are 0.05562 for preference, 0.01799 for risk, 0.03383 for energy direction, 0.04518 for aggressiveness, 0.03216 for blend, and 0.02633 for show-off. Strategy variation reflects both neural intent and the allowed capabilities/opportunities; it is not attributed solely to the graph.

A controlled check keeps candidate IDs fixed and swaps the chosen candidate's feature packet with another approved candidate: selection changes from `development-E` to `development-F`, matching the swapped features. All repeated runs with identical graph, seed, state, and measurements reproduce the entire result exactly. Feature ablations put the largest individual feature contribution below 25.3% of summed readout change in every case. These checks demonstrate responsiveness without asserting different winners in every scenario.

## Runtime and safety evidence

- The post-activation report records `sourceMode: REAL_MALECNS`, `normalDefaultRuntime: true`, the pinned artifact SHA, and `networkDisabledDuringDecisions: true`. Default creation and the real HTTP preview both execute through that artifact.
- An exhaustive comparison confirms that all 3,584 exported body IDs/types/roles and all 53,504 directed edges with their synapse counts match the authenticated extraction. A default CLI decision and replay also produce byte-identical files.
- A missing/corrupt artifact, wrong metadata, checksum mismatch, or fixture substitution fails. Fixture mode is explicit and forbidden with `NODE_ENV=production`. Production real-mode loading passes. No fallback branch silently chooses fixture data.
- Only approved music candidates enter propagation. The incompatible test track remains rejected. Every selected track, strategy, and bar count is asserted to belong to the corresponding safe set. Existing stale-state and controller safety tests still pass.
- Telemetry contains actual selected-state activity, stimulated cells, group/readout means, and real edges/paths. Five payloads are 29,439–29,569 bytes, with at most 132 visible nodes for this graph and 192 edges. Stable role-lane layout is stylized, not anatomical. Score margin is not a confidence probability. The browser receives no full runtime graph.
- Seventeen Node tests and eight Python tests pass. TypeScript interface checking, 22 JavaScript syntax checks, and three Python syntax checks also pass. The [validation record](VALIDATION.md) gives commands and coverage.
- Authentication used a temporary preprocessing environment. A comparison over source, docs, backups, generated files, and decompressed caches found no persisted credential. There is no development credential file in the repository, and runtime does not need one.

## Biological derivation, limits, and attribution

Biologically derived: body IDs, annotated types/regions, selected directed connectivity, synapse counts, and supplied neurotransmitter metadata. RadioTEDU-designed: circuit reduction, feature encoding, seeded gains, unsigned normalization/propagation, readout groups and semantics, candidate/strategy ranking, and visualization layout.

Cellwise neurotransmitter predictions and consensus disagree substantially in the extracted data. They are preserved for inspection, but signs are not inferred. Consequently APL inhibition and DPM modulation are not faithfully represented. This is not a complete biological brain simulation: KC-to-KC wiring, most CNS populations, receptor dynamics, learning, and real sensory inputs are outside the model. An energy-direction score is not yet calibrated to guarantee a requested musical increase. Synthetic scenarios do not establish musical taste, learned personality, or audience preference.

Source credit: **HHMI Janelia FlyEM and MaleCNS project collaborators**, [MaleCNS v1.0](https://male-cns.janelia.org/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), with RadioTEDU's changes explicitly recorded. Access follows the [official data documentation](https://male-cns.janelia.org/download/); natverse/malecns was a reference, not a simulator.

## Files and next step

| Area | Created or modified in this phase |
| --- | --- |
| Extraction and graph | `connectome/preprocessing/build.py`, `probe.py`, `test_build.py`; `connectome/selection.json`, `load.mjs`, `metrics.mjs`; regenerated `connectome/fixtures/development.graph.json` |
| Decision/runtime | `decision/activity.mjs`, `mapping.json`, `engine.mjs`; `telemetry/state.mjs`; `index.mjs`, `index.d.mts` |
| Tooling and tests | `scripts/preprocess-session.mjs`, `activate-artifact.mjs`, `validate-real.mjs`, `benchmark.mjs`; `examples/scenarios.mjs`; `tests/real.test.mjs`; `package.json`, `.env.example` |
| Documentation | `README.md`, `VALIDATION.md`, `REAL_MALECNS_REPORT.md` |
| Local generated evidence | Canonical real graph, runtime manifest, selection/validation reports, candidate experiments, extraction snapshot and exploration report; ignored by Git |

Critical source backups are in `changes/20260913-150218-before-real-malecns/`. The final artifact and manifest must travel together when packaging another runtime installation; regeneration and environment-only authentication are documented in [README.md](README.md#explore-build-validate-and-activate).

The recommended next step is the separate production music-analysis/audio-adapter phase: feed trusted measurements and actual mixer capabilities into this validated decision boundary, then test real transitions and the public `/djfly` experience. No IIS changes, service deployment, final mixer integration, or visual redesign were performed here.
