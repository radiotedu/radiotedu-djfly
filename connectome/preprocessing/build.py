"""Offline extraction and reproducible selection; no production credentials are exported."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
import gzip
import hashlib
from importlib.metadata import version as package_version
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "connectome" / "selection.json"
MAPPING = json.loads((ROOT / "decision" / "mapping.json").read_text(encoding="utf-8"))


class PipelineError(ValueError):
    """An actionable, credential-free error raised by this pipeline."""


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def extraction_hash(config):
    return digest({key: config[key] for key in ["dataset", "server", "populations", "query"]})


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=True, separators=(",", ":"), allow_nan=False).encode()
    if path.suffix == ".gz":
        payload = gzip.compress(payload, mtime=0)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def read_json(path):
    payload = Path(path).read_bytes()
    return json.loads(gzip.decompress(payload) if str(path).endswith(".gz") else payload)


def clean(value):
    if value is None:
        return None
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if hasattr(value, "tolist"):
        return clean(value.tolist())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def connect(config):
    token = os.environ.get("NEUPRINT_TOKEN", "").strip()
    if not token:
        raise PipelineError("NEUPRINT_TOKEN is missing. Set it in this shell as described in README.md; "
                           "real extraction has not run. Use fixture explicitly for development.")
    if package_version("neuprint-python") != "0.6.3":
        raise PipelineError("Install the pinned neuprint-python==0.6.3 before extraction.")
    from neuprint import Client
    import requests
    # Dataset discovery currently returns HTTP 500. Verify the pinned database directly
    # before seeding the client's discovery cache; authentication and TLS remain enabled.
    response = requests.post(config["server"] + "/api/custom/custom", timeout=(10, 60),
                             headers={"Authorization": "Bearer " + token},
                             json={"dataset": config["dataset"], "cypher":
                                   "MATCH (m:Meta) RETURN m.dataset AS dataset, m.tag AS tag, m.uuid AS uuid"})
    response.raise_for_status()
    body = response.json()
    if body.get("columns") != ["dataset", "tag", "uuid"] or len(body.get("data", [])) != 1:
        raise PipelineError("Unexpected server dataset identity response.")
    name, tag, uuid = body["data"][0]
    if f"{name}:{tag}" != config["dataset"] or not uuid:
        raise PipelineError("Server metadata does not match the pinned male-cns:v1.0 dataset.")
    identity = {"dataset": name, "tag": tag, "uuid": uuid}
    Client.DATASETS_CACHE[config["server"]] = {config["dataset"]: identity}
    client = Client(config["server"], dataset=config["dataset"], token=token, progress=False)
    client.djfly_identity = identity
    return client


def fetch_population(config, client):
    from neuprint import NeuronCriteria, fetch_neurons
    nodes = []
    summaries = []
    for population in config["populations"]:
        pattern = population["typeRegex"]
        count = int(client.fetch_custom(
            f"MATCH (n:Neuron) WHERE n.type =~ {json.dumps(pattern)} RETURN count(n) AS count"
        ).iloc[0]["count"])
        if count == 0 or count > config["query"]["maxPopulationNeurons"]:
            raise PipelineError(f"{population['name']}: {count} neurons; inspect annotation/selection "
                             "before proceeding (zero or above query budget).")
        frame, roi_counts = fetch_neurons(
            NeuronCriteria(type=pattern, regex=True, client=client), client=client)
        nt_keys = [key for key in frame.columns if
                   re.search(r"neurotrans|(^nt$)|Nt$|NtProb$|nt.*confidence", key, re.I)]
        roi_totals = roi_counts.groupby("roi")[["pre", "post"]].sum().to_dict("index") if len(roi_counts) else {}
        summaries.append({"population": population["name"], "count": len(frame),
                          "types": dict(sorted(Counter(frame["type"]).items())),
                          "neurotransmitterFields": nt_keys,
                          "roiCountsOverlappingDoNotSum": clean(roi_totals)})
        for row in frame.to_dict("records"):
            roi_info = row.get("roiInfo") or {}
            if isinstance(roi_info, str):
                roi_info = json.loads(roi_info)
            nodes.append({"bodyId": str(int(row["bodyId"])), "type": row.get("type"),
                          "population": population["name"], "role": population["role"],
                          "rois": sorted(roi_info.keys()),
                          "pre": clean(row.get("pre")),
                          "post": clean(row.get("post")),
                          "annotations": clean({k: row.get(k) for k in ["status", "cropped"] + nt_keys})})
    if len({n["bodyId"] for n in nodes}) != len(nodes):
        raise PipelineError("Population selectors overlap; roles must be unambiguous.")
    return sorted(nodes, key=lambda n: int(n["bodyId"])), summaries


def adjacency(client, config, sources, targets):
    from neuprint import fetch_adjacencies
    # Total body-pair counts avoid double-counting nested/non-primary ROIs.
    neuron_frame, edge_frame = fetch_adjacencies(
        sources, targets, min_total_weight=1, omit_rois=True,
        weight_props=["weight"], batch_size=config["query"]["batchSize"],
        threads=config["query"]["threads"], client=client)
    required = {"bodyId_pre", "bodyId_post", "weight"}
    if not required.issubset(edge_frame.columns) or "bodyId" not in neuron_frame.columns:
        raise PipelineError("Unexpected neuprint-python adjacency schema; refusing an ambiguous export.")
    grouped = edge_frame.groupby(["bodyId_pre", "bodyId_post"], sort=True)["weight"].sum()
    edges = []
    for (source, target), weight in grouped.items():
        if not math.isfinite(float(weight)) or weight <= 0 or int(weight) != weight:
            raise PipelineError("Expected positive integer synapse counts.")
        edges.append([str(int(source)), str(int(target)), int(weight)])
    return edges


def extract(config, cache, body_ids=()):
    client = connect(config)
    nodes, populations = fetch_population(config, client)
    ids = [int(n["bodyId"]) for n in nodes]
    edges = adjacency(client, config, ids, ids)
    samples = list(body_ids) or [int(n["bodyId"]) for n in nodes if n["role"] == "output"][:3]
    if len(samples) > 8:
        raise PipelineError("At most eight body IDs may be explored at once.")
    inspection = {"sampleBodyIds": samples,
                  "incoming": adjacency(client, config, None, samples),
                  "outgoing": adjacency(client, config, samples, None)}
    snapshot = {"schemaVersion": 1, "dataset": config["dataset"],
                "server": config["server"], "configHash": digest(config),
                "extractionConfigHash": extraction_hash(config),
                "retrievedAt": datetime.now(timezone.utc).isoformat(),
                "clientVersion": package_version("neuprint-python"),
                "serverIdentity": client.djfly_identity, "nodes": nodes, "edges": edges}
    cache.mkdir(parents=True, exist_ok=True)
    write_json(cache / "snapshot.json.gz", snapshot)
    write_json(cache / "exploration.json", {
        "dataset": config["dataset"], "populations": populations,
        "edgeCount": len(edges), "synapseCount": sum(e[2] for e in edges),
        "inspection": inspection,
        "warning": "ROI counts overlap; synapse counts are unsigned proxies, not conductances."})
    return snapshot


def reachable(starts, edges, reverse=False):
    neighbors = defaultdict(list)
    for source, target, _ in edges:
        neighbors[target if reverse else source].append(source if reverse else target)
    seen = set(starts)
    queue = deque(starts)
    while queue:
        for other in neighbors[queue.popleft()]:
            if other not in seen:
                seen.add(other)
                queue.append(other)
    return seen


def largest_scc(nodes, edges):
    forward, backward = defaultdict(list), defaultdict(list)
    for source, target, _ in edges:
        forward[source].append(target)
        backward[target].append(source)
    seen, order = set(), []
    for node in nodes:
        start = node["bodyId"]
        if start in seen:
            continue
        stack = [(start, False)]
        while stack:
            current, finished = stack.pop()
            if finished:
                order.append(current)
            elif current not in seen:
                seen.add(current)
                stack.append((current, True))
                stack.extend((n, False) for n in forward[current] if n not in seen)
    seen, largest = set(), 0
    for start in reversed(order):
        if start in seen:
            continue
        stack, size = [start], 0
        seen.add(start)
        while stack:
            size += 1
            for other in backward[stack.pop()]:
                if other not in seen:
                    seen.add(other)
                    stack.append(other)
        largest = max(largest, size)
    return largest


def select(snapshot, cap, threshold, edge_policy=None):
    nodes, all_edges = snapshot["nodes"], snapshot["edges"]
    roles = {n["bodyId"]: n["role"] for n in nodes}
    excluded = {tuple(pair) for pair in (edge_policy or {}).get("excludeRolePairs", [])}
    circuit_edges = [e for e in all_edges if (roles[e[0]], roles[e[1]]) not in excluded]
    output_ids = {n["bodyId"] for n in nodes if n["role"] == "output"}
    input_ids = {n["bodyId"] for n in nodes if n["role"] == "input"}
    pool_edges = [e for e in circuit_edges if e[2] >= threshold]
    viable = reachable(input_ids, pool_edges) & reachable(output_ids, pool_edges, reverse=True)
    core = [n for n in nodes if n["role"] != "input" and n["bodyId"] in viable]
    if len(core) + len(MAPPING["features"]) > cap:
        raise PipelineError("Budget cannot retain core/readouts and all stimulus channels.")
    strength = Counter()
    for source, target, weight in pool_edges:
        if source in viable and target in viable:
            strength[source] += weight
            strength[target] += weight
    by_type = defaultdict(list)
    for node in nodes:
        if node["role"] == "input" and node["bodyId"] in viable:
            by_type[node["type"] or "untyped"].append(node)
    for group in by_type.values():
        group.sort(key=lambda n: (-strength[n["bodyId"]], n["bodyId"]))
    # Round-robin annotated types preserves type coverage before favoring stronger cells.
    ranked, depth = [], 0
    while any(depth < len(group) for group in by_type.values()):
        for key in sorted(by_type):
            if depth < len(by_type[key]):
                ranked.append(by_type[key][depth])
        depth += 1
    selected = core + ranked[:cap - len(core)]
    selected_ids = {n["bodyId"] for n in selected}
    edges = [e for e in pool_edges if e[0] in selected_ids and e[1] in selected_ids]
    useful = reachable(input_ids & selected_ids, edges) & reachable(output_ids & selected_ids, edges, reverse=True)
    selected = sorted((n for n in selected if n["bodyId"] in useful), key=lambda n: n["bodyId"])
    edges = [e for e in edges if e[0] in useful and e[1] in useful]
    reached_outputs = output_ids & useful
    metrics = {"nodes": len(selected), "edges": len(edges),
               "largestStrongComponent": largest_scc(selected, edges),
               "outputReachability": len(reached_outputs) / max(1, len(output_ids)),
               "retainedWeightFraction": sum(e[2] for e in edges) / max(1, sum(e[2] for e in circuit_edges)),
               "fullCircuitRetainedWeightFraction": sum(e[2] for e in edges) / max(1, sum(e[2] for e in all_edges)),
               "sourceCircuitEdges": len(all_edges), "eligibleCircuitEdges": len(circuit_edges),
               "excludedRolePairEdges": len(all_edges) - len(circuit_edges),
               "eligibleCircuitSynapses": sum(e[2] for e in circuit_edges),
               "retainedSynapses": sum(e[2] for e in edges),
               "types": len({n["type"] for n in selected}),
               "inputNodes": sum(n["role"] == "input" for n in selected),
               "outputNodes": len(reached_outputs),
               "thresholdSynapses": threshold, "neuronBudget": cap}
    return selected, edges, metrics


def artifact(nodes, edges, config, provenance, metrics):
    by_id = {n["bodyId"]: i for i, n in enumerate(nodes)}
    input_nodes = [i for i, n in enumerate(nodes) if n["role"] == "input"]
    input_nodes.sort(key=lambda i: hashlib.sha256(
        (config["mappingSeed"] + ":" + nodes[i]["bodyId"]).encode()).hexdigest())
    inputs = {name: [] for name in MAPPING["features"]}
    if provenance["kind"] == "malecns":
        type_positions = Counter()
        for index in input_nodes:
            cell_type = nodes[index]["type"]
            channels = config.get("inputTypeChannels", {}).get(cell_type)
            if not channels or any(channel not in inputs for channel in channels):
                raise PipelineError(f"No explicit stimulus mapping for input type {cell_type}.")
            inputs[channels[type_positions[cell_type] % len(channels)]].append(index)
            type_positions[cell_type] += 1
    else:
        for position, index in enumerate(input_nodes):
            inputs[MAPPING["features"][position % len(inputs)]].append(index)
    by_type = defaultdict(list)
    for i, node in enumerate(nodes):
        if node["role"] == "output":
            by_type[node["type"] or node["bodyId"]].append(i)
    outputs = {name: [] for name in MAPPING["channels"]}
    for position, name in enumerate(sorted(by_type)):
        outputs[MAPPING["channels"][position % len(outputs)]].extend(by_type[name])
    if any(not group for group in [*inputs.values(), *outputs.values()]):
        raise PipelineError("Selection leaves an empty stimulus/readout channel; increase budget or inspect types.")
    rows = [[] for _ in nodes]
    for source, target, weight in edges:
        rows[by_id[target]].append((by_id[source], weight))
    indptr, indices, weights = [0], [], []
    for row in rows:
        for source, weight in sorted(row):
            indices.append(source)
            weights.append(weight)
        indptr.append(len(indices))
    graph = {"schemaVersion": 1, "mappingVersion": MAPPING["version"],
             "provenance": provenance, "selection": {"version": config["version"],
             "configHash": digest(config), "mappingSeed": config["mappingSeed"],
             "signMode": config["signMode"], "edgePolicy": config.get("edgePolicy", {}),
             "inputTypeChannels": config.get("inputTypeChannels", {}) if provenance["kind"] == "malecns" else {}}, "metrics": metrics,
             "nodes": nodes, "edges": {"format": "csr-target-source", "indptr": indptr,
             "indices": indices, "synapses": weights},
             "inputs": inputs, "outputs": outputs}
    graph["graphId"] = digest(graph)
    return graph


def fixture(config, output):
    nodes, edges = [], []
    for role, count in [("input", 84), ("intermediate", 24), ("output", 36)]:
        for i in range(count):
            nodes.append({"bodyId": f"fixture:{role}:{i:03}", "type": f"fixture-{role}-{i % 12:02}",
                          "population": f"fixture-{role}", "role": role,
                          "rois": [f"fixture-{role}-region"], "annotations": {}})
    inputs = [n["bodyId"] for n in nodes if n["role"] == "input"]
    middle = [n["bodyId"] for n in nodes if n["role"] == "intermediate"]
    outputs = [n["bodyId"] for n in nodes if n["role"] == "output"]
    for i, source in enumerate(inputs):
        edges.extend([[source, middle[i % len(middle)], 2 + i % 11],
                      [source, outputs[(i * 7) % len(outputs)], 1 + i % 5]])
    for i, source in enumerate(middle):
        edges.extend([[source, middle[(i + 1) % len(middle)], 2],
                      [source, outputs[i % len(outputs)], 5],
                      [source, outputs[(i + 17) % len(outputs)], 3]])
    for i, source in enumerate(outputs):
        edges.append([source, middle[(i * 5) % len(middle)], 2])
    graph = artifact(nodes, edges, config, {
        "kind": "development-fixture", "dataset": None,
        "label": "DEVELOPMENT FIXTURE: handcrafted topology, no MaleCNS neurons or edges",
        "generator": "build.py fixture v1"}, {"nodes": len(nodes), "edges": len(edges),
        "note": "Only validates software contracts. These are not biological graph measurements."})
    write_json(output, graph)


def build(config, snapshot, output):
    cache_matches = snapshot.get("extractionConfigHash") == extraction_hash(config) or snapshot["configHash"] == digest(config)
    if snapshot["dataset"] != config["dataset"] or not cache_matches:
        raise PipelineError("Cached snapshot dataset/config mismatch; rerun explore.")
    output.mkdir(parents=True, exist_ok=True)
    experiments = config["experiments"]
    results = []
    provenance = {"kind": "malecns", "dataset": config["dataset"],
                  "project": "https://male-cns.janelia.org/",
                  "source": config["server"], "license": "CC-BY-4.0",
                  "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
                  "attribution": "HHMI Janelia FlyEM and MaleCNS project collaborators",
                  "changes": "Selected mushroom-body subgraph, filtered synapse counts, sparse export; "
                             "artificial feature/readout mappings and simplified activity model by RadioTEDU.",
                  "retrievedAt": snapshot["retrievedAt"], "snapshotHash": digest(snapshot),
                  "serverIdentity": snapshot.get("serverIdentity"),
                  "clientVersion": snapshot["clientVersion"]}
    budgets = set(experiments["maxNeurons"])
    if experiments.get("includeFullPopulationBaseline"):
        budgets.add(len(snapshot["nodes"]))
    for cap in sorted(budgets):
        for threshold in experiments["minSynapses"]:
            entry = {"neuronBudget": cap, "thresholdSynapses": threshold}
            try:
                nodes, edges, metrics = select(snapshot, cap, threshold, config.get("edgePolicy"))
                graph = artifact(nodes, edges, config, provenance, metrics)
                file = output / f"candidate-{cap}-{threshold}.json.gz"
                write_json(file, graph)
                benchmark = subprocess.run(
                    ["node", str(ROOT / "scripts" / "benchmark.mjs"), str(file), "--json"],
                    capture_output=True, text=True, check=True, timeout=90)
                timing = json.loads(benchmark.stdout)
                entry.update(metrics, artifact=str(file.resolve()), graphId=graph["graphId"],
                             compressedBytes=file.stat().st_size, runtime=timing)
                reasons = []
                if metrics["retainedWeightFraction"] < experiments["retainedWeightFraction"]:
                    reasons.append("retained synapse fraction below target")
                if metrics["outputReachability"] < experiments["minOutputReachability"]:
                    reasons.append("not all selected-population outputs reachable")
                if metrics["largestStrongComponent"] < 2:
                    reasons.append("no recurrent component")
                if metrics["edges"] > experiments["maxEdges"] or file.stat().st_size > experiments["maxCompressedBytes"]:
                    reasons.append("artifact exceeds edge/size budget")
                if timing["p95Ms"] > experiments["maxDecisionP95Ms"]:
                    reasons.append("runtime exceeds decision budget")
                if timing["maxCandidatePreferenceSpread"] < 1e-5:
                    reasons.append("readouts insensitive to benchmark stimuli")
                entry["rejectedReasons"] = reasons
                entry["eligible"] = not reasons
            except (ValueError, subprocess.SubprocessError) as error:
                entry.update(eligible=False, error=type(error).__name__,
                             detail=str(error) if isinstance(error, ValueError) else "Runtime benchmark failed; run it directly.")
            results.append(entry)
    eligible = sorted((r for r in results if r.get("eligible")),
                      key=lambda r: (r["nodes"], r["edges"], -r["retainedWeightFraction"]))
    report = {"dataset": config["dataset"], "config": config, "experiments": results,
              "selectionRule": "Smallest measured eligible graph by nodes, then edges; no automatic budget relaxation.",
              "chosen": eligible[0] if eligible else None}
    write_json(output / "selection-report.json", report)
    if not eligible:
        raise PipelineError("No measured graph meets the configured budgets. Inspect selection-report.json; "
                         "expand justified budgets or revise populations, then rebuild.")
    write_json(output / "malecns-v1.graph.json.gz", read_json(eligible[0]["artifact"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["explore", "build", "fixture"])
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--cache", type=Path, default=ROOT / "connectome" / "cache")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--body-id", type=int, action="append", default=[])
    args = parser.parse_args()
    config = read_json(args.config)
    if config["dataset"] != "male-cns:v1.0" or config["server"] != "https://neuprint.janelia.org":
        parser.error("This pipeline is pinned to official male-cns:v1.0.")
    if args.command == "fixture":
        path = args.output or ROOT / "connectome" / "fixtures" / "development.graph.json"
        fixture(config, path)
    elif args.command == "explore":
        extract(config, args.cache, args.body_id)
        path = args.cache / "exploration.json"
    else:
        path = args.output or ROOT / "generated"
        snapshot = read_json(args.cache / "snapshot.json.gz")
        build(config, snapshot, path)
    print(str(path.resolve()))


if __name__ == "__main__":
    try:
        main()
    except (PipelineError, FileNotFoundError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
    except Exception as error:
        # Third-party exception strings may include request details. Do not print credentials.
        print(f"Preprocessing failed ({type(error).__name__}). Check credentials, dataset availability "
              "and the pinned client installation. No runtime artifact was activated.", file=sys.stderr)
        sys.exit(2)
