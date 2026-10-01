"""Source-to-diagram contracts. Run from this directory with unittest."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import generate_diagrams as diagrams


ROOT = Path(__file__).resolve().parents[3]


class DiagramTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = diagrams.load_source(ROOT)

    def test_dev_network_and_capacity_follow_tfvars(self):
        model = diagrams.build_model(self.source, "dev")
        self.assertEqual(model["vpc"], "10.40.0.0/16")
        self.assertEqual(model["subnets"], {
            "public": ["10.40.0.0/24", "10.40.1.0/24"],
            "private": ["10.40.16.0/20", "10.40.32.0/20"],
            "data": ["10.40.64.0/24", "10.40.65.0/24"],
        })
        self.assertEqual(model["nat_count"], 1)
        self.assertFalse(model["rds_multi_az"])
        self.assertEqual(model["redis_nodes"], 1)
        self.assertEqual(model["eks_pools"], ["general-purpose", "system"])

    def test_prd_capacity_is_not_copied_from_dev(self):
        model = diagrams.build_model(self.source, "prd")
        self.assertEqual(model["nat_count"], 3)
        self.assertEqual(model["subnets"]["public"][2], "10.50.2.0/24")
        self.assertTrue(model["rds_multi_az"])
        self.assertEqual(model["redis_nodes"], 3)

    def test_unknown_environment_and_expressions_fail_closed(self):
        with self.assertRaises(ValueError):
            diagrams.build_model(self.source, "staging")
        with self.assertRaises(ValueError):
            diagrams.evaluate("${unknown.function()}", {}, {})
        with self.assertRaises(ValueError):
            diagrams.subnet_cidr("10.40.0.0/16", "${unknown()}", 0)

    def test_topology_drift_fails_instead_of_drawing_stale_architecture(self):
        source = copy.deepcopy(self.source)
        source["resources"]["aws_eks_cluster.this"]["compute_config"][0]["enabled"] = False
        with self.assertRaisesRegex(ValueError, "Auto Mode"):
            diagrams.build_model(source, "dev")
        source = copy.deepcopy(self.source)
        source["resources"]["aws_route.data"] = {"route_table_id": "${aws_route_table.data.id}"}
        with self.assertRaisesRegex(ValueError, "isolated"):
            diagrams.build_model(source, "dev")

    def test_subnet_counts_and_database_placement_changes_fail_closed(self):
        changes = [
            ("aws_subnet.public", "count", 1),
            ("aws_subnet.private", "count", 1),
            ("aws_subnet.data", "count", 1),
            ("aws_db_subnet_group.postgres", "subnet_ids", "${aws_subnet.private[*].id}"),
            ("aws_elasticache_subnet_group.redis", "subnet_ids", "${aws_subnet.private[*].id}"),
            ("aws_db_instance.postgres", "db_subnet_group_name", "external-group"),
            ("aws_elasticache_replication_group.redis", "subnet_group_name", "external-group"),
        ]
        for resource, attribute, value in changes:
            with self.subTest(resource=resource, attribute=attribute):
                source = copy.deepcopy(self.source)
                source["resources"][resource][attribute] = value
                with self.assertRaisesRegex(ValueError, "topology"):
                    diagrams.build_model(source, "dev")

    def test_overview_explains_network_tiers_in_korean(self):
        rendered = diagrams.architecture_dot(diagrams.build_model(self.source, "dev"))
        for label in ("퍼블릭 서브넷", "앱용 프라이빗 서브넷", "데이터 전용 서브넷", "Apple SD Gothic Neo"):
            self.assertIn(label, rendered)

    def test_overview_distinguishes_ownership_and_unwired_redis(self):
        model = diagrams.build_model(self.source, "dev")
        rendered = diagrams.architecture_dot(model)
        for label in ("CloudFormation", "Helm / Auto Mode", "사전 준비", "미연결", "Terraform", "10.40.16.0/20"):
            self.assertIn(label, rendered)
        self.assertNotIn("aws_eks_node_group", rendered)
        self.assertIn("style=\"rounded,dashed,filled\"", rendered)

    def test_terraform_copy_removes_only_backend_not_resource_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            diagrams.prepare_terraform_copy(ROOT, Path(tmp))
            copied = Path(tmp)
            self.assertNotIn('backend "s3"', (copied / "versions.tf").read_text())
            self.assertEqual((copied / "network.tf").read_bytes(), (ROOT / "infra/terraform/stack/network.tf").read_bytes())
            self.assertTrue((copied / ".terraform.lock.hcl").exists())

    def test_manifest_records_source_inputs_without_account_credentials(self):
        manifest = diagrams.source_manifest(ROOT)
        self.assertIn("infra/terraform/stack/network.tf", manifest)
        self.assertIn("infra/terraform/environments/prd.tfvars", manifest)
        self.assertTrue(all(len(digest) == 64 for digest in manifest.values()))

    def test_generation_renders_both_environments_and_only_runs_read_only_terraform(self):
        commands = []
        original = diagrams.run

        def run(command):
            commands.append(command)
            if command[0] == "test-terraform":
                return 'digraph { "aws_vpc.this" -> "aws_subnet.private"; }' if command[2] == "graph" else ""
            return original(command)

        with tempfile.TemporaryDirectory() as temporary, patch.object(diagrams, "run", side_effect=run):
            output = Path(temporary)
            diagrams.generate(ROOT, output, terraform="test-terraform")
            for name in ("aws-architecture.svg", "aws-architecture-prd.svg", "terraform-dependencies.svg"):
                self.assertIn("<svg", (output / name).read_text())
            self.assertTrue((output / "diagram-provenance.json").exists())
        terraform_commands = [command for command in commands if command[0] == "test-terraform"]
        self.assertEqual([command[2] for command in terraform_commands], ["init", "graph"])
        self.assertIn("-backend=false", terraform_commands[0])

    def test_cli_overview_mode_does_not_request_terraform(self):
        with patch("sys.argv", ["generate_diagrams.py", "--overview-only"]), patch.object(diagrams, "generate") as generate:
            diagrams.main()
            generate.assert_called_once_with(diagrams.ROOT, diagrams.ASSETS, "terraform", "dot", False)

    def test_overview_labels_change_when_supported_source_values_change(self):
        source = copy.deepcopy(self.source)
        source["locals"]["app_secret_descriptions"]["extra"] = "Additional container"
        source["resources"]["aws_eks_cluster.this"]["compute_config"][0]["node_pools"] = ["system"]
        rendered = diagrams.architecture_dot(diagrams.build_model(source, "dev"))
        self.assertIn("5개 앱 비밀 보관함", rendered)
        self.assertIn("system 풀", rendered)
        self.assertNotIn("general-purpose + system 풀", rendered)

    def test_overview_only_preserves_original_dependency_graph_provenance(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            old = {"source_sha256": {"old.tf": "abc"}, "regenerated_this_run": True}
            (output / "diagram-provenance.json").write_text(json.dumps({"dependency_graph": old}))
            diagrams.generate(ROOT, output, dependencies=False)
            metadata = json.loads((output / "diagram-provenance.json").read_text())
            self.assertEqual(metadata["dependency_graph"]["source_sha256"], {"old.tf": "abc"})
            self.assertFalse(metadata["dependency_graph"]["regenerated_this_run"])


if __name__ == "__main__":
    unittest.main()
