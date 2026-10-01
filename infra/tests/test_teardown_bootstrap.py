"""bootstrap 삭제 순서와 조회 실패 시 중단 경계."""

import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from unittest.mock import patch

from teardown_bootstrap import delete_bootstrap
from types import SimpleNamespace


def valid_settings():
    return SimpleNamespace(environment="dev", account="123456789012", region="ap-northeast-2")


class BootstrapRunner:
    def __init__(self):
        self.calls = []
        self.settings = valid_settings()
        self.bucket = "trippilot-tfstate-123456789012-ap-northeast-2-dev"
        self.key = "terraform.tfstate"
        self.stack_id = "arn:aws:cloudformation:ap-northeast-2:123456789012:stack/trippilot-dev-bootstrap/abc-123"
        self.state = {"version": 4, "serial": 1, "lineage": "fixture", "resources": []}
        self.versions = [{"Key": self.key, "VersionId": "current", "IsLatest": True}]
        self.markers = []
        self.stack_exists = True
        self.bucket_exists = True
        self.fail = None
        self.overrides = {}

    def __call__(self, command, **kwargs):
        self.calls.append((command, kwargs))
        operation = tuple(command[1:3])
        if operation == self.fail:
            raise RuntimeError("조회 실패")
        if operation in self.overrides:
            return json.dumps(self.overrides[operation])
        name = "trippilot-dev-bootstrap"
        resources = [
            ("TerraformStateBucket", "AWS::S3::Bucket", self.bucket),
            ("TerraformStateBucketPolicy", "AWS::S3::BucketPolicy", self.bucket),
            ("ClusterRole", "AWS::IAM::Role", "trippilot-dev-cluster"),
            ("NodeRole", "AWS::IAM::Role", "trippilot-dev-node"),
            ("DeploymentRole", "AWS::IAM::Role", "trippilot-dev-github-deploy"),
        ]
        outputs = {
            "TerraformStateBucket": self.bucket,
            "TerraformStateKey": self.key,
            "DeploymentRoleArn": "arn:aws:iam::123456789012:role/trippilot-dev-github-deploy",
        }
        responses = {
            ("cloudformation", "list-stacks"): {
                "StackSummaries": [
                    {
                        "StackName": name,
                        "StackId": self.stack_id,
                        "StackStatus": "CREATE_COMPLETE",
                    }
                ]
                if self.stack_exists
                else []
            },
            ("cloudformation", "describe-stacks"): {
                "Stacks": [
                    {
                        "StackName": name,
                        "StackId": self.stack_id,
                        "StackStatus": "CREATE_COMPLETE",
                        "Parameters": [
                            {"ParameterKey": "Environment", "ParameterValue": "dev"},
                            {
                                "ParameterKey": "GitHubRepository",
                                "ParameterValue": "ASM-TripPilot/trippilot",
                            },
                            {
                                "ParameterKey": "GitHubOidcProviderArn",
                                "ParameterValue": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com",
                            },
                        ],
                        "Outputs": [
                            {"OutputKey": key, "OutputValue": value}
                            for key, value in outputs.items()
                        ],
                    }
                ]
            },
            ("cloudformation", "list-stack-resources"): {
                "StackResourceSummaries": [
                    {
                        "LogicalResourceId": logical,
                        "ResourceType": kind,
                        "PhysicalResourceId": physical,
                    }
                    for logical, kind, physical in resources
                ]
            },
            ("cloudformation", "get-template"): {
                "TemplateBody": {
                    "Resources": {"TerraformStateBucket": {"DeletionPolicy": "Retain"}, "TerraformStateBucketPolicy": {"DeletionPolicy": "Retain"}}
                }
            },
            ("s3api", "list-buckets"): {
                "Buckets": [{"Name": self.bucket}] if self.bucket_exists else []
            },
            ("s3api", "get-bucket-location"): {"LocationConstraint": "ap-northeast-2"},
            ("s3api", "get-bucket-versioning"): {"Status": "Enabled"},
            ("s3api", "get-bucket-tagging"): {
                "TagSet": [
                    {"Key": "Project", "Value": "trippilot"},
                    {"Key": "Environment", "Value": "dev"},
                    {"Key": "ManagedBy", "Value": "cloudformation"},
                    {"Key": "aws:cloudformation:stack-id", "Value": self.stack_id},
                ]
            },
            ("s3api", "list-object-versions"): {
                "Versions": self.versions,
                "DeleteMarkers": self.markers,
                "IsTruncated": False,
            },
            ("s3api", "list-multipart-uploads"): {"Uploads": [], "IsTruncated": False},
            ("eks", "list-clusters"): {"clusters": []},
            ("rds", "describe-db-instances"): {"DBInstances": []},
            ("ec2", "describe-vpcs"): {"Vpcs": []},
            ("ecr", "describe-repositories"): {"repositories": []},
            ("elasticache", "describe-replication-groups"): {"ReplicationGroups": []},
            ("elasticache", "describe-cache-clusters"): {"CacheClusters": []},
            ("elbv2", "describe-load-balancers"): {"LoadBalancers": []},
            ("logs", "describe-log-groups"): {"logGroups": []},
            ("secretsmanager", "list-secrets"): {"SecretList": []},
        }
        if operation == ("s3api", "get-object"):
            target = Path(command[-1])
            assert target.stat().st_mode & 0o777 == 0o600
            target.write_text(json.dumps(self.state))
            return "{}"
        if operation == ("s3api", "delete-objects"):
            deleted = json.loads(kwargs["stdin"])["Delete"]["Objects"]
            keys = {(item["Key"], item["VersionId"]) for item in deleted}
            self.versions = [
                item
                for item in self.versions
                if (item["Key"], item["VersionId"]) not in keys
            ]
            self.markers = [
                item
                for item in self.markers
                if (item["Key"], item["VersionId"]) not in keys
            ]
        return json.dumps(responses.get(operation, {}))


class BootstrapDeleteTest(unittest.TestCase):
    def invoke(self, run, **kwargs):
        with tempfile.TemporaryDirectory() as directory:
            delete_bootstrap(run, run.settings, Path(directory), **kwargs)

    def test_plan_is_read_only(self):
        run = BootstrapRunner()
        self.invoke(run, purge_state=True)
        self.assertFalse(
            any(command[2].startswith(("delete", "abort")) for command, _ in run.calls)
        )
        self.assertTrue(all(kwargs.get("quiet") for _, kwargs in run.calls))

    def test_execute_removes_stack_before_bucket_and_preserves_state_by_default(self):
        run = BootstrapRunner()
        self.invoke(run, execute=True)
        operations = [command[2] for command, _ in run.calls]
        self.assertIn("delete-stack", operations)
        self.assertIn("wait", operations)
        self.assertNotIn("delete-bucket", operations)

    def test_purge_deletes_versions_and_bucket_after_stack_wait(self):
        run = BootstrapRunner()
        self.invoke(run, execute=True, purge_state=True)
        operations = [command[2] for command, _ in run.calls]
        self.assertLess(operations.index("wait"), operations.index("delete-objects"))
        self.assertLess(
            operations.index("delete-objects"), operations.index("delete-bucket")
        )
        for command, _ in run.calls:
            if command[1] == "s3api" and command[2] != "list-buckets":
                self.assertIn("--expected-bucket-owner", command)

    def test_managed_resource_blocks_stack_deletion(self):
        run = BootstrapRunner()
        run.state = {
            **run.state,
            "resources": [
                {
                    "mode": "managed",
                    "instances": [{"attributes": {"password": "sentinel"}}],
                }
            ],
        }
        with self.assertRaisesRegex(ValueError, "서비스"):
            self.invoke(run, execute=True)
        self.assertFalse(any(command[2] == "delete-stack" for command, _ in run.calls))

    def test_live_lock_blocks_deletion(self):
        run = BootstrapRunner()
        run.versions += [
            {"Key": run.key + ".tflock", "VersionId": "lock", "IsLatest": True}
        ]
        with self.assertRaisesRegex(ValueError, "잠금"):
            self.invoke(run, execute=True)

    def test_never_deployed_bootstrap_can_be_deleted(self):
        run = BootstrapRunner()
        run.versions = []
        self.invoke(run, execute=True)
        self.assertTrue(any(command[2] == "delete-stack" for command, _ in run.calls))

    def test_missing_current_state_with_history_blocks_deletion(self):
        run = BootstrapRunner()
        run.versions = [{**run.versions[0], "IsLatest": False}]
        run.markers = [{"Key": run.key, "VersionId": "marker", "IsLatest": True}]
        with self.assertRaisesRegex(ValueError, "state"):
            self.invoke(run, execute=True)

    def test_service_inventory_blocks_empty_state(self):
        responses = [
            (("eks", "list-clusters"), {"clusters": ["trippilot-dev"]}),
            (
                ("rds", "describe-db-instances"),
                {"DBInstances": [{"DBInstanceIdentifier": "trippilot-dev"}]},
            ),
            (("ec2", "describe-vpcs"), {"Vpcs": [{"VpcId": "vpc-123"}]}),
            (
                ("ecr", "describe-repositories"),
                {"repositories": [{"repositoryName": "trippilot-dev/scene-api"}]},
            ),
            (
                ("secretsmanager", "list-secrets"),
                {"SecretList": [{"Name": "trippilot/dev/scene-api"}]},
            ),
        ]
        for operation, response in responses:
            with self.subTest(operation=operation):
                run = BootstrapRunner()
                run.overrides[operation] = response
                with self.assertRaisesRegex(ValueError, "서비스"):
                    self.invoke(run, execute=True)

    def test_scheduled_secret_deletion_does_not_block(self):
        run = BootstrapRunner()
        run.overrides[("secretsmanager", "list-secrets")] = {
            "SecretList": [
                {"Name": "trippilot/dev/scene-api", "DeletedDate": "2026-09-21"}
            ]
        }
        self.invoke(run)

    def test_absent_stack_and_bucket_are_idempotent(self):
        run = BootstrapRunner()
        run.stack_exists = run.bucket_exists = False
        self.invoke(run, execute=True, purge_state=True)
        self.assertFalse(
            any(command[2].startswith("delete") for command, _ in run.calls)
        )

    def test_retained_bucket_can_be_purged_after_stack_deletion(self):
        run = BootstrapRunner()
        run.stack_exists = False
        self.invoke(run, execute=True, purge_state=True)
        operations = [command[2] for command, _ in run.calls]
        self.assertNotIn("delete-stack", operations)
        self.assertIn("delete-bucket", operations)

    def test_api_failure_is_not_treated_as_absence(self):
        run = BootstrapRunner()
        run.fail = ("cloudformation", "list-stacks")
        with self.assertRaises(RuntimeError):
            self.invoke(run, execute=True)

    def test_stack_wait_failure_prevents_bucket_purge(self):
        run = BootstrapRunner()
        run.fail = ("cloudformation", "wait")
        with self.assertRaises(RuntimeError):
            self.invoke(run, execute=True, purge_state=True)
        self.assertFalse(
            any(command[2] == "delete-objects" for command, _ in run.calls)
        )

    def test_missing_bucket_with_live_stack_blocks_deletion(self):
        run = BootstrapRunner()
        run.bucket_exists = False
        with self.assertRaisesRegex(ValueError, "버킷"):
            self.invoke(run, execute=True)

    def test_invalid_stack_metadata_blocks_deletion(self):
        original = BootstrapRunner()
        describe = json.loads(original(["aws", "cloudformation", "describe-stacks"]))[
            "Stacks"
        ][0]
        cases = [
            {**describe, "StackName": "other"},
            {**describe, "StackStatus": "UPDATE_IN_PROGRESS"},
            {**describe, "Outputs": []},
            {**describe, "Parameters": []},
            {
                **describe,
                "Parameters": [{"ParameterKey": "Environment", "ParameterValue": 1}],
            },
            {**describe, "Parameters": describe["Parameters"] * 2},
        ]
        for description in cases:
            with self.subTest(description=description):
                run = BootstrapRunner()
                run.overrides[("cloudformation", "describe-stacks")] = {
                    "Stacks": [description]
                }
                with self.assertRaises((ValueError, TypeError)):
                    self.invoke(run, execute=True)

    def test_wrong_repository_blocks_deletion(self):
        with (
            patch.dict("os.environ", {"GITHUB_REPOSITORY": "foreign/repository"}),
            self.assertRaisesRegex(ValueError, "저장소"),
        ):
            self.invoke(BootstrapRunner(), execute=True)

    def test_foreign_stack_arn_resources_and_retention_fail_closed(self):
        cases = [
            (
                ("cloudformation", "list-stacks"),
                {
                    "StackSummaries": [
                        {
                            "StackName": "trippilot-dev-bootstrap",
                            "StackStatus": "CREATE_COMPLETE",
                            "StackId": "arn:aws:cloudformation:ap-northeast-2:999999999999:stack/trippilot-dev-bootstrap/abc",
                        }
                    ]
                },
            ),
            (
                ("cloudformation", "list-stacks"),
                {"StackSummaries": [{"StackName": "trippilot-dev-bootstrap"}] * 2},
            ),
            (("cloudformation", "describe-stacks"), {"Stacks": []}),
            (
                ("cloudformation", "list-stack-resources"),
                {"StackResourceSummaries": []},
            ),
            (
                ("cloudformation", "get-template"),
                {
                    "TemplateBody": {
                        "Resources": {
                            "TerraformStateBucket": {"DeletionPolicy": "Delete"}
                        }
                    }
                },
            ),
            (("cloudformation", "get-template"), {"TemplateBody": []}),
        ]
        for operation, response in cases:
            with self.subTest(operation=operation, response=response):
                run = BootstrapRunner()
                run.overrides[operation] = response
                with self.assertRaises((ValueError, TypeError)):
                    self.invoke(run, execute=True)

    def test_incomplete_inventory_and_invalid_options_fail_closed(self):
        for operation, response in [
            (("cloudformation", "list-stacks"), {}),
            (("eks", "list-clusters"), {}),
            (("rds", "describe-db-instances"), {"DBInstances": [{}]}),
        ]:
            with self.subTest(operation=operation):
                run = BootstrapRunner()
                run.overrides[operation] = response
                with self.assertRaises(ValueError):
                    self.invoke(run, execute=True)
        with self.assertRaises(TypeError):
            self.invoke(BootstrapRunner(), execute="false")

    def test_bucket_owned_by_another_stack_generation_is_not_removed(self):
        run = BootstrapRunner()
        tags = json.loads(run(["aws", "s3api", "get-bucket-tagging"]))["TagSet"]
        tags = [
            {**item, "Value": item["Value"] + "-other"}
            if item["Key"] == "aws:cloudformation:stack-id"
            else item
            for item in tags
        ]
        run.overrides[("s3api", "get-bucket-tagging")] = {"TagSet": tags}
        with self.assertRaisesRegex(ValueError, "다른 bootstrap"):
            self.invoke(run, execute=True)

    def test_wrong_bucket_tags_and_location_fail_closed(self):
        for operation, response in [
            (("s3api", "get-bucket-tagging"), {"TagSet": []}),
            (("s3api", "get-bucket-location"), {"LocationConstraint": "us-east-1"}),
        ]:
            with self.subTest(operation=operation):
                run = BootstrapRunner()
                run.overrides[operation] = response
                with self.assertRaises(ValueError):
                    self.invoke(run, execute=True)

    def test_malformed_state_fails_without_echoing_contents(self):
        for state in (
            {},
            {"version": 4, "resources": "sentinel"},
            {"version": 4, "resources": [{"mode": "managed"}]},
        ):
            with self.subTest(state=state):
                run = BootstrapRunner()
                run.state = state
                with self.assertRaises((ValueError, TypeError)) as error:
                    self.invoke(run, execute=True)
                self.assertNotIn("sentinel", str(error.exception))


class TripPilotBootstrapTest(unittest.TestCase):
    invoke = BootstrapDeleteTest.invoke

    def test_disable_termination_protection_precedes_stack_deletion(self):
        run = BootstrapRunner()
        self.invoke(run, execute=True)
        commands = [command for command, _ in run.calls]
        protection = next(command for command in commands if command[2] == 'update-termination-protection')
        self.assertIn('--no-enable-termination-protection', protection)
        operations = [command[2] for command in commands]
        self.assertLess(operations.index('update-termination-protection'), operations.index('delete-stack'))

    def test_protection_failure_prevents_stack_and_state_deletion(self):
        run = BootstrapRunner()
        run.fail = ('cloudformation', 'update-termination-protection')
        with self.assertRaises(RuntimeError):
            self.invoke(run, execute=True, purge_state=True)
        self.assertFalse(any(command[2].startswith('delete') for command, _ in run.calls))

    def test_redis_and_eks_tagged_load_balancer_block_bootstrap_deletion(self):
        cases = [
            (('elasticache', 'describe-replication-groups'), {'ReplicationGroups': [{'ReplicationGroupId': 'trippilot-dev'}]}),
            (('elasticache', 'describe-cache-clusters'), {'CacheClusters': [{'CacheClusterId': 'trippilot-dev-001'}]}),
            (('elbv2', 'describe-load-balancers'), {'LoadBalancers': [{'LoadBalancerArn': 'arn:aws:elasticloadbalancing:ap-northeast-2:123456789012:loadbalancer/net/k8s-test/123', 'LoadBalancerName': 'k8s-test'}]}),
        ]
        for operation, response in cases:
            with self.subTest(operation=operation):
                run = BootstrapRunner()
                run.overrides[operation] = response
                run.overrides[('elbv2', 'describe-tags')] = {'TagDescriptions': [{'ResourceArn': 'arn:aws:elasticloadbalancing:ap-northeast-2:123456789012:loadbalancer/net/k8s-test/123', 'Tags': [{'Key': 'eks:eks-cluster-name', 'Value': 'trippilot-dev'}]}]}
                with self.assertRaisesRegex(ValueError, '서비스'):
                    self.invoke(run, execute=True)
                self.assertFalse(any(command[2].startswith('delete') for command, _ in run.calls))

    def test_foreign_services_do_not_block_target_environment(self):
        run = BootstrapRunner()
        run.overrides[('elasticache', 'describe-replication-groups')] = {'ReplicationGroups': [{'ReplicationGroupId': 'trippilot-prd'}]}
        run.overrides[('elasticache', 'describe-cache-clusters')] = {'CacheClusters': [{'CacheClusterId': 'trippilot-prd-001'}]}
        arn = 'arn:aws:elasticloadbalancing:ap-northeast-2:123456789012:loadbalancer/net/k8s-other/123'
        run.overrides[('elbv2', 'describe-load-balancers')] = {'LoadBalancers': [{'LoadBalancerArn': arn, 'LoadBalancerName': 'k8s-other'}]}
        run.overrides[('elbv2', 'describe-tags')] = {'TagDescriptions': [{'ResourceArn': arn, 'Tags': [{'Key': 'eks:eks-cluster-name', 'Value': 'trippilot-prd'}]}]}
        self.invoke(run, execute=True)

    def test_missing_load_balancer_tags_fail_closed(self):
        run = BootstrapRunner()
        run.overrides[('elbv2', 'describe-load-balancers')] = {'LoadBalancers': [{'LoadBalancerArn': 'arn:aws:elasticloadbalancing:ap-northeast-2:123456789012:loadbalancer/net/k8s-test/123', 'LoadBalancerName': 'k8s-test'}]}
        run.overrides[('elbv2', 'describe-tags')] = {'TagDescriptions': []}
        with self.assertRaisesRegex(ValueError, '태그'):
            self.invoke(run, execute=True)

    def test_foreign_repository_stack_fails_even_without_github_env(self):
        run = BootstrapRunner()
        stack = json.loads(run(['aws', 'cloudformation', 'describe-stacks']))['Stacks'][0]
        parameters = [{**item, 'ParameterValue': 'foreign/repository'} if item['ParameterKey'] == 'GitHubRepository' else item for item in stack['Parameters']]
        run.overrides[('cloudformation', 'describe-stacks')] = {'Stacks': [{**stack, 'Parameters': parameters}]}
        with patch.dict('os.environ', {}, clear=True), self.assertRaisesRegex(ValueError, '저장소'):
            self.invoke(run, execute=True)

    def test_bucket_versioning_drift_blocks_deletion(self):
        for response in ({}, {'Status': 'Suspended'}):
            with self.subTest(response=response):
                run = BootstrapRunner()
                run.overrides[('s3api', 'get-bucket-versioning')] = response
                with self.assertRaisesRegex(ValueError, '버전'):
                    self.invoke(run, execute=True)

    def test_json_string_cloudformation_template_is_supported(self):
        run = BootstrapRunner()
        run.overrides[('cloudformation', 'get-template')] = {'TemplateBody': json.dumps({'Resources': {'TerraformStateBucket': {'DeletionPolicy': 'Retain'}, 'TerraformStateBucketPolicy': {'DeletionPolicy': 'Retain'}}})}
        self.invoke(run)

    def test_managed_eks_logs_block_empty_state_drift(self):
        run = BootstrapRunner()
        run.overrides[('logs', 'describe-log-groups')] = {'logGroups': [{'logGroupName': '/aws/eks/trippilot-dev/cluster'}]}
        with self.assertRaisesRegex(ValueError, '서비스'):
            self.invoke(run, execute=True)

    def test_missing_bucket_policy_retention_blocks_stack_delete(self):
        run = BootstrapRunner()
        run.overrides[('cloudformation', 'get-template')] = {'TemplateBody': {'Resources': {'TerraformStateBucket': {'DeletionPolicy': 'Retain'}}}}
        with self.assertRaisesRegex(ValueError, '보존'):
            self.invoke(run, execute=True)
        self.assertFalse(any(command[2] == 'delete-stack' for command, _ in run.calls))

    def test_new_state_between_proof_and_stack_delete_blocks_mutation(self):
        class RacingRunner(BootstrapRunner):
            def __call__(self, command, **kwargs):
                if command[1:3] == ['s3api', 'get-object']:
                    result = super().__call__(command, **kwargs)
                    self.versions = [{**self.versions[0], 'VersionId': 'new'}]
                    return result
                return super().__call__(command, **kwargs)

        run = RacingRunner()
        with self.assertRaisesRegex(ValueError, '버전'):
            self.invoke(run, execute=True)
        self.assertFalse(any(command[2].startswith(('delete', 'update')) for command, _ in run.calls))
