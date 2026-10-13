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
        statements = self.resources["TerraformStateBucketPolicy"]["Properties"]["PolicyDocument"]["Statement"]
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
        # The managed policy attached to the deployment role is under the same guard as the inline one.
        attached = self.resources["DeploymentExtraPolicy"]["Properties"]
        self.assertEqual(attached["Roles"], [{"Ref": "DeploymentRole"}])
        statements = self.statements + attached["PolicyDocument"]["Statement"]
        self.assertFalse(any("iam:PutRolePolicy" in item["Action"] for item in statements))
        forbidden = {"iam:CreateRole", "iam:UpdateAssumeRolePolicy", "iam:AttachRolePolicy", "iam:DeleteRole"}
        self.assertFalse(any(forbidden.intersection(item["Action"]) for item in statements))
        passes = next(item for item in attached["PolicyDocument"]["Statement"] if item["Sid"] == "PassAiPodRoleToPods")
        self.assertTrue(passes["Resource"]["Fn::Sub"].endswith("-${Environment}-ai-pod"))
        self.assertEqual(passes["Condition"]["StringEquals"]["iam:PassedToService"], "pods.eks.amazonaws.com")
        # The serving judge reads metrics and cost; it must never gain a write verb.
        reads = next(item for item in attached["PolicyDocument"]["Statement"] if item["Sid"] == "ReadServingMetricsAndCost")
        self.assertTrue(all(action.split(":")[1].startswith(("Get", "List")) for action in reads["Action"]))

    def test_cluster_and_node_roles_have_fixed_aws_service_trust(self):
        expected = {
            "ClusterRole": "eks.amazonaws.com",
            "NodeRole": "ec2.amazonaws.com",
            "AiPodRole": "pods.eks.amazonaws.com",
            "CloudWatchPodRole": "pods.eks.amazonaws.com",
        }
        for role, service in expected.items():
            trust = self.resources[role]["Properties"]["AssumeRolePolicyDocument"]["Statement"]
            self.assertEqual(len(trust), 1)
            self.assertEqual(trust[0]["Principal"], {"Service": service})
        cluster = self.resources["ClusterRole"]["Properties"]
        self.assertIn("sts:TagSession", cluster["AssumeRolePolicyDocument"]["Statement"][0]["Action"])

    def test_ai_pod_role_can_only_invoke_imported_bedrock_models(self):
        policies = self.resources["AiPodRole"]["Properties"]["Policies"]
        statements = [item for policy in policies for item in policy["PolicyDocument"]["Statement"]]
        self.assertEqual(len(statements), 1)
        self.assertEqual(statements[0]["Action"], ["bedrock:InvokeModel"])
        self.assertTrue(statements[0]["Resource"]["Fn::Sub"].endswith(":imported-model/*"))
        self.assertNotIn("ManagedPolicyArns", self.resources["AiPodRole"]["Properties"])

    def test_cloudwatch_pod_role_can_only_write_this_environment_container_logs(self):
        """로그 수집기 역할이 로그 쓰기 말고 아무것도 못 하는지.

        `cloudwatch:PutMetricData` 가 붙으면 수집기가 커스텀 지표를 만들 수 있고,
        커스텀 지표는 개당 월정액으로 과금된다 — 로그 한 줄 보려고 켠 애드온이
        조용히 지표 요금을 만드는 경로를 막는다. 로그 그룹도 해당 환경으로 묶는다.
        """
        properties = self.resources["CloudWatchPodRole"]["Properties"]
        statements = [item for policy in properties["Policies"] for item in policy["PolicyDocument"]["Statement"]]
        self.assertEqual(len(statements), 1)
        self.assertTrue(all(action.startswith("logs:") for action in statements[0]["Action"]))
        self.assertTrue(statements[0]["Resource"]["Fn::Sub"].endswith(
            ":log-group:/aws/containerinsights/trippilot-${Environment}/*"))
        self.assertNotIn("ManagedPolicyArns", properties)

        attached = self.resources["DeploymentExtraPolicy"]["Properties"]["PolicyDocument"]["Statement"]
        passes = next(item for item in attached if item["Sid"] == "PassCloudWatchPodRoleToPods")
        self.assertTrue(passes["Resource"]["Fn::Sub"].endswith("-${Environment}-cloudwatch-pod"))
        self.assertEqual(passes["Condition"]["StringEquals"]["iam:PassedToService"], "pods.eks.amazonaws.com")

    def test_new_security_group_rules_have_tag_authorization(self):
        create = self.statement("CreateTaggedSecurityRules")
        self.assertEqual(create["Condition"]["StringEquals"]["aws:RequestTag/Environment"], {"Ref": "Environment"})
        tag_actions = self.statement("TagNetworkOnCreate")["Condition"]["StringEquals"]["ec2:CreateAction"]
        self.assertIn("AuthorizeSecurityGroupIngress", tag_actions)

    def test_rds_master_secret_read_requires_own_database_system_tag(self):
        read = self.statement("ReadEnvironmentRdsMasterSecret")
        tag = read["Condition"]["StringEquals"]["secretsmanager:ResourceTag/aws:rds:primaryDBInstanceArn"]
        self.assertTrue(tag["Fn::Sub"].endswith(":db:trippilot-${Environment}"))

    def test_bootstrap_principal_may_create_everything_the_stack_declares(self):
        """부트스트랩 역할의 권한 예제가 템플릿이 만드는 IAM 리소스를 전부 덮는지.

        여기가 어긋나면 스택이 403 으로 롤백되고, 터미널에서는 "Resource creation
        cancelled" 만 보여 원인이 지워진다. 실제로 두 번 그랬다 — #742 가 AiPodRole 을,
        #753 이 DeploymentExtraPolicy 를 넣고 권한 예제를 안 고쳐서 dev 부트스트랩이
        2026-09-25·10-01 두 번 실패했다(iam:CreatePolicy 거부).

        권한 예제는 사람이 손으로 인라인 정책에 등록하는 **문서**다(docs/guides/
        aws-bootstrap.md). 문서가 틀리면 계정에 붙은 정책도 틀린다.
        """
        example = json.loads((BOOTSTRAP / "bootstrap-policy.example.json").read_text())

        def allowed(action, arn):
            for item in example["Statement"]:
                actions = item["Action"]
                actions = [actions] if isinstance(actions, str) else actions
                resources = item["Resource"]
                resources = [resources] if isinstance(resources, str) else resources
                if action in actions and arn in resources:
                    return True
            return False

        def arn(service, kind, name):
            # 템플릿은 Fn::Sub, 권한 예제는 <PLACEHOLDER> 로 같은 값을 쓴다.
            rendered = name["Fn::Sub"].replace("${Environment}", "<ENVIRONMENT>")
            return f"arn:aws:{service}::<AWS_ACCOUNT_ID>:{kind}/{rendered}"

        for name, resource in self.resources.items():
            properties = resource["Properties"]
            if resource["Type"] == "AWS::IAM::Role":
                target = arn("iam", "role", properties["RoleName"])
                self.assertTrue(allowed("iam:CreateRole", target),
                                f"{name}: 권한 예제에 iam:CreateRole {target} 이 없다")
                if properties.get("Policies"):
                    self.assertTrue(allowed("iam:PutRolePolicy", target),
                                    f"{name}: 인라인 정책이 있는데 iam:PutRolePolicy 가 없다")
            elif resource["Type"] == "AWS::IAM::ManagedPolicy":
                target = arn("iam", "policy", properties["ManagedPolicyName"])
                self.assertTrue(allowed("iam:CreatePolicy", target),
                                f"{name}: 권한 예제에 iam:CreatePolicy {target} 이 없다")
                # 만들기만 하면 역할에 붙지 않는다 — 붙이는 권한도 같이 있어야 한다.
                for role in properties["Roles"]:
                    holder = arn("iam", "role",
                                 self.resources[role["Ref"]]["Properties"]["RoleName"])
                    self.assertTrue(allowed("iam:AttachRolePolicy", holder),
                                    f"{name}: {holder} 에 붙일 iam:AttachRolePolicy 가 없다")

    def test_role_inline_policy_stays_below_aws_character_limit(self):
        size = sum(len(json.dumps(item["PolicyDocument"], separators=(",", ":"))) for item in self.role["Policies"])
        self.assertLess(size, 10240)


if __name__ == "__main__":
    unittest.main()
