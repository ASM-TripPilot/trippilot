"""Offline regression checks for the AWS trust and Terraform-state boundary."""

import json
from pathlib import Path
import unittest


BOOTSTRAP = Path(__file__).resolve().parents[1]


class BootstrapSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template = json.loads((BOOTSTRAP / "template.json").read_text())
        cls.resources = cls.template["Resources"]
        cls.role = cls.resources["DeploymentRole"]["Properties"]
        cls.statements = [
            statement
            for policy in cls.role["Policies"]
            for statement in policy["PolicyDocument"]["Statement"]
        ]

    def statement(self, sid):
        return next(item for item in self.statements if item["Sid"] == sid)

    def test_only_named_github_environment_can_assume_role(self):
        trust = self.role["AssumeRolePolicyDocument"]["Statement"]
        self.assertEqual(len(trust), 1)
        self.assertEqual(trust[0]["Action"], "sts:AssumeRoleWithWebIdentity")
        conditions = trust[0]["Condition"]["StringEquals"]
        self.assertEqual(conditions["token.actions.githubusercontent.com:aud"], "sts.amazonaws.com")
        self.assertEqual(
            conditions["token.actions.githubusercontent.com:sub"]["Fn::Sub"],
            "repo:${GitHubRepository}:environment:${Environment}",
        )

    def test_state_bucket_is_private_encrypted_versioned_and_retained(self):
        bucket = self.resources["TerraformStateBucket"]
        self.assertEqual(bucket["DeletionPolicy"], "Retain")
        self.assertEqual(bucket["UpdateReplacePolicy"], "Retain")
        properties = bucket["Properties"]
        self.assertTrue(all(properties["PublicAccessBlockConfiguration"].values()))
        self.assertEqual(properties["VersioningConfiguration"]["Status"], "Enabled")
        self.assertEqual(
            properties["BucketEncryption"]["ServerSideEncryptionConfiguration"][0]
            ["ServerSideEncryptionByDefault"]["SSEAlgorithm"], "AES256"
        )
        policy = self.resources["TerraformStateBucketPolicy"]
        self.assertEqual(policy["DeletionPolicy"], "Retain")
        self.assertEqual(policy["UpdateReplacePolicy"], "Retain")
        statements = policy["Properties"]["PolicyDocument"]["Statement"]
        self.assertTrue(any(item.get("Condition", {}).get("Bool", {}).get("aws:SecureTransport") == "false" and item["Effect"] == "Deny" for item in statements))

    def test_only_lock_file_can_be_deleted(self):
        self.assertEqual(self.statement("StateReadWrite")["Action"], ["s3:GetObject", "s3:PutObject"])
        deletions = [item for item in self.statements if "s3:DeleteObject" in item["Action"]]
        self.assertEqual(len(deletions), 1)
        self.assertTrue(deletions[0]["Resource"]["Fn::Sub"].endswith("/terraform.tfstate.tflock"))

    def test_iam_write_and_passrole_cannot_target_deployment_role(self):
        for sid in ("ReadClusterRoles", "PassClusterRoles"):
            resources = self.statement(sid)["Resource"]
            self.assertEqual(len(resources), 2)
            self.assertTrue(all(item["Fn::Sub"].endswith(("-${Environment}-cluster", "-${Environment}-node")) for item in resources))
        self.assertNotIn("AdministratorAccess", json.dumps(self.template))
        self.assertFalse(any("iam:PutRolePolicy" in item["Action"] for item in self.statements))
        forbidden = {"iam:CreateRole", "iam:UpdateAssumeRolePolicy", "iam:AttachRolePolicy", "iam:DeleteRole"}
        self.assertFalse(any(forbidden.intersection(item["Action"]) for item in self.statements))

    def test_cluster_and_node_roles_have_fixed_aws_service_trust(self):
        expected = {"ClusterRole": "eks.amazonaws.com", "NodeRole": "ec2.amazonaws.com"}
        for role, service in expected.items():
            trust = self.resources[role]["Properties"]["AssumeRolePolicyDocument"]["Statement"]
            self.assertEqual(len(trust), 1)
            self.assertEqual(trust[0]["Principal"], {"Service": service})
        cluster = self.resources["ClusterRole"]["Properties"]
        self.assertIn("sts:TagSession", cluster["AssumeRolePolicyDocument"]["Statement"][0]["Action"])

    def test_new_security_group_rules_have_tag_authorization(self):
        create = self.statement("CreateTaggedSecurityRules")
        self.assertEqual(create["Condition"]["StringEquals"]["aws:RequestTag/Environment"], {"Ref": "Environment"})
        tag_actions = self.statement("TagNetworkOnCreate")["Condition"]["StringEquals"]["ec2:CreateAction"]
        self.assertIn("AuthorizeSecurityGroupIngress", tag_actions)

    def test_rds_master_secret_read_requires_own_database_system_tag(self):
        read = self.statement("ReadEnvironmentRdsMasterSecret")
        tag = read["Condition"]["StringEquals"]["secretsmanager:ResourceTag/aws:rds:primaryDBInstanceArn"]
        self.assertTrue(tag["Fn::Sub"].endswith(":db:trippilot-${Environment}"))

    def test_role_inline_policy_stays_below_aws_character_limit(self):
        size = sum(len(json.dumps(item["PolicyDocument"], separators=(",", ":"))) for item in self.role["Policies"])
        self.assertLess(size, 10240)


class TeardownPermissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.policy = json.loads((BOOTSTRAP / 'bootstrap-policy.example.json').read_text())
        cls.statements = {item['Sid']: item for item in cls.policy['Statement']}

    def test_stack_cleanup_is_limited_to_environment_stack(self):
        statement = self.statements['ManageEnvironmentBootstrapStack']
        for action in ['cloudformation:DeleteStack', 'cloudformation:ListStackResources', 'cloudformation:UpdateTerminationProtection']:
            self.assertIn(action, statement['Action'])
        self.assertTrue(any('stack/trippilot-<ENVIRONMENT>-bootstrap/' in arn for arn in statement['Resource']))

    def test_state_read_and_purge_have_separate_scopes(self):
        proof = self.statements['ReadEmptyStateProof']
        self.assertEqual(proof['Action'], ['s3:GetObjectVersion'])
        self.assertTrue(proof['Resource'].endswith('/terraform.tfstate'))
        purge = self.statements['PurgeRetainedStateObjects']
        self.assertEqual(set(purge['Action']), {'s3:DeleteObjectVersion', 's3:AbortMultipartUpload'})
        self.assertEqual(purge['Resource'], 'arn:aws:s3:::trippilot-tfstate-<AWS_ACCOUNT_ID>-<AWS_REGION>-<ENVIRONMENT>/*')
        bucket = self.statements['ManageStateBucketConfiguration']
        self.assertTrue({'s3:ListBucketVersions', 's3:ListBucketMultipartUploads', 's3:DeleteBucket'} <= set(bucket['Action']))

    def test_account_wide_discovery_is_read_only_and_regional(self):
        discovery = self.statements['VerifyServiceAbsence']
        self.assertEqual(discovery['Resource'], '*')
        self.assertEqual(discovery['Condition']['StringEquals']['aws:RequestedRegion'], '<AWS_REGION>')
        required = {'elasticache:DescribeReplicationGroups', 'elasticache:DescribeCacheClusters', 'elasticloadbalancing:DescribeLoadBalancers', 'elasticloadbalancing:DescribeTags', 'ecr:DescribeRepositories', 'secretsmanager:ListSecrets'}
        self.assertTrue(required <= set(discovery['Action']))
        self.assertTrue(all(action.split(':')[1].startswith(('List', 'Describe')) for action in discovery['Action']))

    def test_deploy_role_can_verify_nlb_ownership_without_elb_mutations(self):
        template = json.loads((BOOTSTRAP / 'template.json').read_text())
        statements = template['Resources']['DeploymentRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
        actions = {action for statement in statements for action in statement['Action']}
        self.assertTrue({'elasticloadbalancing:DescribeLoadBalancers', 'elasticloadbalancing:DescribeTags'} <= actions)
        self.assertFalse(any(action.startswith('elasticloadbalancing:Delete') for action in actions))


if __name__ == "__main__":
    unittest.main()
