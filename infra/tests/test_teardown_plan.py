"""삭제 전용 override와 저장 계획의 허용 범위 회귀 검사."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from test_teardown_config import valid_settings


def resource(address, values):
    return {"address": address, "mode": "managed", "values": values}


def change(address, before, after, actions=None, unknown=None):
    return {
        "address": address,
        "mode": "managed",
        "change": {
            "actions": actions or ["update"],
            "before": before,
            "after": after,
            "after_unknown": unknown or {},
        },
    }


def plan(changes=None, resources=None):
    return {
        "format_version": "1.2",
        "complete": True,
        "errored": False,
        "resource_changes": changes or [],
        "prior_state": {"values": {"root_module": {"resources": resources or []}}},
    }


class DestroyPlanTest(unittest.TestCase):
    def test_redis_and_shared_secret_belong_to_environment(self):
        from teardown_identity import validate_owned_state
        tags = {'Project': 'trippilot', 'Environment': 'dev', 'ManagedBy': 'terraform'}
        redis = {'tags_all': tags, 'replication_group_id': 'trippilot-dev',
                 'arn': 'arn:aws:elasticache:ap-northeast-2:123456789012:replicationgroup:trippilot-dev'}
        resources = {
            'aws_elasticache_replication_group.redis': redis,
            'aws_elasticache_subnet_group.redis': {'tags_all': tags},
            'aws_security_group.redis': {'tags_all': tags},
            'aws_vpc_security_group_ingress_rule.redis_from_eks': {'tags_all': tags},
            'aws_secretsmanager_secret.app["shared"]': {'tags_all': tags},
        }
        validate_owned_state(resources, valid_settings())
        with self.assertRaises(ValueError):
            validate_owned_state({**resources, 'aws_elasticache_replication_group.redis': {**redis, 'replication_group_id': 'foreign'}}, valid_settings())

    def test_detached_owned_internet_gateway_can_resume_failed_delete(self):
        from teardown_identity import validate_owned_state

        gateway = {
            "id": "igw-aaaaaaaaaaaaaaaaa",
            "arn": "arn:aws:ec2:ap-northeast-2:123456789012:internet-gateway/igw-aaaaaaaaaaaaaaaaa",
            "vpc_id": "",
            "tags_all": {
                "Project": "trippilot",
                "Environment": "dev",
                "ManagedBy": "terraform",
            },
        }
        validate_owned_state({"aws_internet_gateway.this": gateway}, valid_settings())
        for address, changes in (
            ("aws_subnet.public[0]", {}),
            ("aws_internet_gateway.this", {"vpc_id": "vpc-other"}),
            ("aws_internet_gateway.this", {"arn": None}),
            (
                "aws_internet_gateway.this",
                {"tags_all": {**gateway["tags_all"], "Environment": "prd"}},
            ),
        ):
            with (
                self.subTest(address=address, changes=changes),
                self.assertRaises(ValueError),
            ):
                validate_owned_state(
                    {address: {**gateway, **changes}}, valid_settings()
                )

    def test_copied_or_unowned_state_cannot_delete_network_or_unknown_resources(self):
        from teardown_identity import validate_owned_state

        tags = {"Project": "trippilot", "Environment": "dev", "ManagedBy": "terraform"}
        vpc = {"id": "vpc-aaaaaaaaaaaaaaaaa", "tags_all": tags}
        validate_owned_state({"aws_vpc.this": vpc}, valid_settings())
        for resources in (
            {"aws_vpc.this": {**vpc, "tags_all": {**tags, "Environment": "prd"}}},
            {"aws_vpc.this": {"id": "vpc-a"}},
            {"aws_vpc.foreign": vpc},
            {
                "aws_vpc.this": {
                    **vpc,
                    "arn": "arn:aws:ec2:ap-northeast-2:999999999999:vpc/wrong",
                }
            },
            {
                "aws_vpc.this": vpc,
                "aws_subnet.public[0]": {"vpc_id": "wrong", "tags_all": tags},
            },
            {"aws_route.internet": {"route_table_id": "wrong"}},
            {"aws_nat_gateway.this[0]": {"subnet_id": "wrong", "tags_all": tags}},
            {
                "aws_eks_cluster.this": {
                    "arn": "arn:aws:eks:ap-northeast-2:123456789012:cluster/trippilot-prd",
                    "tags_all": tags,
                }
            },
        ):
            with self.subTest(resources=resources), self.assertRaises(ValueError):
                validate_owned_state(resources, valid_settings())

    def test_tagless_resources_require_owned_parents_or_exact_environment_identity(
        self,
    ):
        from teardown_identity import validate_owned_state

        tags = {"Project": "trippilot", "Environment": "dev", "ManagedBy": "terraform"}
        resources = {
            "aws_route_table.public": {"id": "rtb-a", "tags_all": tags},
            "aws_subnet.public[0]": {"id": "subnet-a", "tags_all": tags},
            "aws_route.internet": {"route_table_id": "rtb-a"},
            "aws_route_table_association.public[0]": {
                "route_table_id": "rtb-a",
                "subnet_id": "subnet-a",
            },
            'aws_ecr_repository.app["backend"]': {
                "name": "trippilot-dev/scene-api",
                "tags_all": tags,
            },
            'aws_ecr_lifecycle_policy.app["backend"]': {
                "repository": "trippilot-dev/scene-api"
            },
            "aws_eks_access_policy_association.deployment": {
                "cluster_name": "trippilot-dev",
                "principal_arn": valid_settings().role,
            },
        }
        validate_owned_state(resources, valid_settings())
        for address in (
            'aws_ecr_lifecycle_policy.app["backend"]',
            "aws_eks_access_policy_association.deployment",
        ):
            with self.subTest(address=address), self.assertRaises(ValueError):
                validate_owned_state({**resources, address: {}}, valid_settings())

    def test_saved_plan_uses_locking_private_file_and_json_without_logging_secrets(
        self,
    ):
        from teardown_plan import saved_plan

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            destination = directory / "destroy.tfplan"
            destination.write_text("opaque fixture")
            run = Mock(side_effect=["sensitive plan text", json.dumps(plan())])
            self.assertEqual(
                saved_plan(
                    run, directory, directory / "vars.json", destination, destroy=True
                ),
                plan(),
            )
            command = run.call_args_list[0].args[0]
            self.assertIn("-destroy", command)
            self.assertIn("-lock-timeout=60s", command)
            self.assertTrue(all(call.kwargs["quiet"] for call in run.call_args_list))
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            run = Mock(side_effect=["", json.dumps(plan())])
            saved_plan(
                run,
                directory,
                directory / "vars.json",
                directory / "absent",
                targets=["aws_eks_cluster.this"],
            )
            self.assertIn("-target=aws_eks_cluster.this", run.call_args_list[0].args[0])

    def test_state_schema_and_plan_state_disagreement_fail_closed(self):
        from teardown_plan import (
            module_resources,
            resource_values,
            validate_destroy_state,
        )

        for value in ([], {"resources": "invalid"}, {"child_modules": "invalid"}):
            with self.subTest(value=value), self.assertRaises(TypeError):
                module_resources(value)
        for items in (
            [None],
            [{"address": "a", "mode": "wrong"}],
            [resource("a", None)],
            [resource("a", {}), resource("a", {})],
        ):
            with self.subTest(items=items), self.assertRaises(ValueError):
                resource_values(plan(resources=items))
        with self.assertRaises(ValueError):
            validate_destroy_state(
                plan([change("aws_vpc.this", {}, None, ["delete"])]), {}
            )
        validate_destroy_state(plan(), {})

    def test_nested_unknown_and_invalid_plan_records_are_rejected(self):
        from teardown_plan import validate_destroy, validate_preparation

        valid = change(
            "aws_eks_cluster.this",
            {"deletion_protection": True},
            {"deletion_protection": False},
        )
        expected = {"aws_eks_cluster.this": {"deletion_protection": False}}
        for records in ([None], [{"change": None}]):
            with self.assertRaises(TypeError):
                validate_destroy(plan(records))
        with self.assertRaises(ValueError):
            validate_destroy(plan([{**valid, "mode": "invalid"}]))
        with self.assertRaises(TypeError):
            validate_preparation(
                plan([{**valid, "change": {**valid["change"], "before": None}}]),
                expected,
            )
        with self.assertRaises(ValueError):
            validate_preparation(
                plan(
                    [
                        {
                            **valid,
                            "change": {
                                **valid["change"],
                                "after_unknown": {"a": [False, {"nested": True}]},
                            },
                        }
                    ]
                ),
                expected,
            )
        for change_overrides in (
            {"after_unknown": {"id": True}},
            {"after": {"id": "still-present"}},
        ):
            bad = change("aws_vpc.this", {}, None, ["delete"])
            with self.assertRaises(ValueError):
                validate_destroy(
                    plan([{**bad, "change": {**bad["change"], **change_overrides}}])
                )

    def test_override_is_private_and_never_changes_original_source(self):
        from teardown_plan import write_override

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            original = directory / "database.tf"
            original.write_text("deletion_protection = true\n")
            expected = write_override(directory, valid_settings(), "retain")
            override = directory / "teardown_override.tf.json"
            values = json.loads(override.read_text())["resource"]
            database = values["aws_db_instance"]["postgres"]
            self.assertFalse(database["deletion_protection"])
            self.assertFalse(database["skip_final_snapshot"])
            self.assertTrue(database["delete_automated_backups"])
            self.assertEqual(
                database["final_snapshot_identifier"], "trippilot-dev-final-123-1"
            )
            self.assertEqual(override.stat().st_mode & 0o777, 0o600)
            self.assertEqual(original.read_text(), "deletion_protection = true\n")
            self.assertEqual(expected["aws_db_instance.postgres"], database)
            self.assertTrue(values["aws_ecr_repository"]["app"]["force_delete"])

    def test_skip_and_invalid_policy(self):
        from teardown_plan import write_override

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            expected = write_override(directory, valid_settings(), "skip")
            self.assertTrue(expected["aws_db_instance.postgres"]["skip_final_snapshot"])
            self.assertIsNone(
                expected["aws_db_instance.postgres"]["final_snapshot_identifier"]
            )
            with self.assertRaises(ValueError):
                write_override(directory, valid_settings(), "anything")

    def test_nested_state_and_only_existing_preparation_targets(self):
        from teardown_plan import preparation_targets, resource_values

        data = plan(resources=[resource("aws_vpc.this", {"id": "vpc-a"})])
        data["prior_state"]["values"]["root_module"]["child_modules"] = [
            {"resources": [resource("aws_db_instance.postgres", {"id": "db"})]}
        ]
        values = resource_values(data)
        self.assertEqual(preparation_targets(values), ["aws_db_instance.postgres"])
        self.assertEqual(values["aws_vpc.this"]["id"], "vpc-a")
        self.assertEqual(preparation_targets({}), [])

    def test_preparation_accepts_exact_allowlisted_attributes(self):
        from teardown_plan import validate_preparation

        address = "aws_eks_cluster.this"
        expected = {address: {"deletion_protection": False}}
        before = {"name": "trippilot-dev", "deletion_protection": True}
        after = {**before, "deletion_protection": False}
        validate_preparation(plan([change(address, before, after)]), expected)
        validate_preparation(plan([change(address, after, after, ["no-op"])]), expected)
        for item in (
            change(address, before, {**after, "name": "wrong"}),
            change(address, before, {**after, "version": "1.99"}),
            change(address, before, after, ["create"]),
            change(address, before, after, ["delete", "create"]),
            change(address, before, after, unknown={"endpoint": True}),
            change("aws_vpc.this", before, after),
            change(address, before, before, ["no-op"]),
        ):
            with self.subTest(item=item), self.assertRaises(ValueError):
                validate_preparation(plan([item]), expected)

    def test_destroy_rejects_creation_update_replacement_and_unknown_schema(self):
        from teardown_plan import validate_destroy

        valid = change("aws_vpc.this", {"id": "vpc-a"}, None, ["delete"])
        validate_destroy(plan([valid]))
        validate_destroy(plan())
        for actions in (["create"], ["update"], ["delete", "create"], ["read"]):
            with self.subTest(actions=actions), self.assertRaises(ValueError):
                validate_destroy(
                    plan([{**valid, "change": {**valid["change"], "actions": actions}}])
                )
        for updates in (
            {"format_version": "2.0"},
            {"complete": False},
            {"errored": True},
            {"deferred_changes": [{}]},
            {"resource_changes": "invalid"},
        ):
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                validate_destroy({**plan(), **updates})


if __name__ == "__main__":
    unittest.main()
