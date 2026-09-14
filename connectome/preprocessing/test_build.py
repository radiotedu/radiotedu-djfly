import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location("build", Path(__file__).with_name("build.py"))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class PreprocessingTests(unittest.TestCase):
    def setUp(self):
        self.config = build.read_json(build.DEFAULT_CONFIG)

    def test_missing_token_is_actionable_and_never_generates_real_data(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(build.PipelineError, "NEUPRINT_TOKEN is missing"):
                build.connect(self.config)

    def test_direct_dataset_bootstrap_verifies_version_before_constructing_client(self):
        response = Mock()
        response.json.return_value = {"columns": ["dataset", "tag", "uuid"],
                                      "data": [["male-cns", "v1.0", "0" * 32]]}
        with patch.dict("os.environ", {"NEUPRINT_TOKEN": "unit-test-only"}), patch("requests.post", return_value=response) as post, patch("neuprint.Client") as client:
            client.DATASETS_CACHE = {}
            result = build.connect(self.config)
            self.assertEqual(result.djfly_identity["tag"], "v1.0")
            self.assertEqual(post.call_args.kwargs["json"]["dataset"], "male-cns:v1.0")
            self.assertEqual(client.call_args.kwargs["dataset"], "male-cns:v1.0")
            self.assertIn("male-cns:v1.0", client.DATASETS_CACHE[self.config["server"]])
        response.json.return_value["data"][0][1] = "v0.9"
        with patch.dict("os.environ", {"NEUPRINT_TOKEN": "unit-test-only"}), patch("requests.post", return_value=response), patch("neuprint.Client") as client:
            with self.assertRaisesRegex(build.PipelineError, "does not match"):
                build.connect(self.config)
            client.assert_not_called()

    def test_projection_policy_reports_full_circuit_loss_without_fabricating_edges(self):
        nodes = [{"bodyId": str(i), "type": f"KC{i % 2}", "role": "input"} for i in range(20)]
        nodes += [{"bodyId": "30", "type": "APL", "role": "intermediate"}, {"bodyId": "31", "type": "MBON01", "role": "output"}]
        edges = [[str(i), "30", 4] for i in range(20)] + [["30", "31", 10], ["31", "30", 2], ["0", "1", 100]]
        _, selected, metrics = build.select({"nodes": nodes, "edges": edges}, 40, 1, {"excludeRolePairs": [["input", "input"]]})
        self.assertNotIn(["0", "1", 100], selected)
        self.assertEqual(metrics["retainedWeightFraction"], 1)
        self.assertLess(metrics["fullCircuitRetainedWeightFraction"], 0.5)
        self.assertEqual(metrics["excludedRolePairEdges"], 1)

    def test_fixture_is_reproducible_and_cannot_claim_real_body_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            a, b = Path(directory) / "a.json", Path(directory) / "b.json"
            build.fixture(self.config, a)
            build.fixture(self.config, b)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            graph = build.read_json(a)
            self.assertEqual(graph["provenance"]["kind"], "development-fixture")
            self.assertIsNone(graph["provenance"]["dataset"])
            self.assertTrue(all(n["bodyId"].startswith("fixture:") for n in graph["nodes"]))

    def test_current_client_adjacency_return_order_and_total_weight_arguments(self):
        import pandas as pd
        neurons = pd.DataFrame({"bodyId": [1, 2]})
        edges = pd.DataFrame({"bodyId_pre": [1, 1, 2], "bodyId_post": [2, 2, 1], "weight": [3, 4, 5]})
        with patch("neuprint.fetch_adjacencies", return_value=(neurons, edges)) as fetch:
            result = build.adjacency(object(), self.config, [1], [2])
            self.assertEqual(result, [["1", "2", 7], ["2", "1", 5]])
            self.assertTrue(fetch.call_args.kwargs["omit_rois"])
            self.assertEqual(fetch.call_args.kwargs["weight_props"], ["weight"])
            self.assertEqual(fetch.call_args.kwargs["threads"], 1)
        with patch("neuprint.fetch_adjacencies", return_value=(edges, neurons)):
            with self.assertRaisesRegex(ValueError, "schema"):
                build.adjacency(object(), self.config, [1], [2])

    def test_path_pruning_weight_retention_and_recurrence(self):
        nodes = [{"bodyId": str(i), "role": "input", "type": f"KC{i % 2}"} for i in range(20)]
        nodes += [{"bodyId": "30", "role": "intermediate", "type": "APL"},
                  {"bodyId": "31", "role": "output", "type": "MBON01"},
                  {"bodyId": "32", "role": "input", "type": "KC-orphan"}]
        edges = [[str(i), "30", 2 + i] for i in range(20)] + [["30", "31", 9], ["31", "30", 3]]
        selected, kept, metrics = build.select({"nodes": nodes, "edges": edges}, 40, 1)
        self.assertNotIn("32", [node["bodyId"] for node in selected])
        self.assertEqual(metrics["retainedWeightFraction"], 1)
        self.assertEqual(metrics["outputReachability"], 1)
        self.assertEqual(metrics["largestStrongComponent"], 2)
        self.assertEqual(len(kept), len(edges))
        with self.assertRaisesRegex(ValueError, "Budget"):
            build.select({"nodes": nodes, "edges": edges}, 10, 1)

    def test_sparse_direction_is_target_row_source_column(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "fixture.json"
            build.fixture(self.config, file)
            graph = build.read_json(file)
            first_source = graph["nodes"][0]["bodyId"]
            target_row = next(i for i, n in enumerate(graph["nodes"]) if n["bodyId"] == "fixture:intermediate:000")
            e = graph["edges"]
            sources = [graph["nodes"][i]["bodyId"] for i in e["indices"][e["indptr"][target_row]:e["indptr"][target_row + 1]]]
            self.assertIn(first_source, sources)
            self.assertEqual(graph["selection"]["signMode"], "unsigned-synapse-proxy")

    def test_failed_benchmark_preserves_previous_artifact_and_records_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            fixture_file = directory / "fixture.json"
            build.fixture(self.config, fixture_file)
            graph = build.read_json(fixture_file)
            sparse, nodes = graph["edges"], graph["nodes"]
            edges = [[nodes[sparse["indices"][e]]["bodyId"], node["bodyId"], sparse["synapses"][e]]
                     for row, node in enumerate(nodes)
                     for e in range(sparse["indptr"][row], sparse["indptr"][row + 1])]
            config = json.loads(json.dumps(self.config))
            config["experiments"]["maxNeurons"] = [144]
            config["experiments"]["minSynapses"] = [1]
            snapshot = {"nodes": nodes, "edges": edges, "configHash": build.digest(config),
                        "dataset": config["dataset"], "retrievedAt": "TEST_ONLY", "clientVersion": "TEST_ONLY"}
            output = directory / "output"
            output.mkdir()
            previous = output / "malecns-v1.graph.json.gz"
            previous.write_bytes(b"previous-reviewed-artifact")
            original_artifact = build.artifact

            def labeled_test_artifact(nodes, edges, config, provenance, metrics):
                return original_artifact(nodes, edges, config, graph["provenance"], metrics)

            slow = subprocess.CompletedProcess([], 0, stdout=json.dumps({"p95Ms": 999,
                "maxCandidatePreferenceSpread": 0.1}))
            with patch.object(build, "artifact", side_effect=labeled_test_artifact), patch.object(build.subprocess, "run", return_value=slow):
                with self.assertRaisesRegex(ValueError, "No measured graph"):
                    build.build(config, snapshot, output)
            self.assertEqual(previous.read_bytes(), b"previous-reviewed-artifact")
            report = build.read_json(output / "selection-report.json")
            self.assertIsNone(report["chosen"])
            self.assertIn("runtime exceeds decision budget", report["experiments"][0]["rejectedReasons"])
            fast = subprocess.CompletedProcess([], 0, stdout=json.dumps({"p95Ms": 1,
                "maxCandidatePreferenceSpread": 0.1}))
            with patch.object(build, "artifact", side_effect=labeled_test_artifact), patch.object(build.subprocess, "run", return_value=fast):
                build.build(config, snapshot, output)
            self.assertEqual(build.read_json(previous)["provenance"]["kind"], "development-fixture")
            self.assertTrue(build.read_json(output / "selection-report.json")["chosen"]["eligible"])


if __name__ == "__main__":
    unittest.main()
