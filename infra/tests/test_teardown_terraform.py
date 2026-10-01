"""실제 고정 Terraform 엔진으로 삭제 계획 형식과 격리 override를 검증한다."""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from test_teardown_config import valid_settings

from teardown_identity import TAGGED_ADDRESSES, validate_tagless
from teardown_plan import (
    resource_values,
    validate_destroy,
    validate_preparation,
    write_override,
)

VARIABLES = {
    "environment": "prd", "aws_account_id": "111122223333",
    "aws_region": "ap-northeast-2", "availability_zone_count": 3,
    "single_nat_gateway": False, "vpc_cidr": "10.50.0.0/16",
    "deployment_role_arn": "arn:aws:iam::111122223333:role/trippilot-prd-github-deploy",
}
MOCKS = """
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-northeast-2a", "ap-northeast-2b", "ap-northeast-2c"] }
  }
  mock_data "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/trippilot-prd-cluster" }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      master_user_secret = [{
        secret_arn = "arn:aws:secretsmanager:ap-northeast-2:111122223333:secret:rds!db-mock"
      }]
    }
  }
}
"""
BUILTIN = """
variable "protected" { default = true }
resource "terraform_data" "guard" {
  input = var.protected
}
resource "terraform_data" "other" { input = "unchanged" }
"""


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.root = Path(__file__).resolve().parents[2]
        self.binary = os.environ.get("TERRAFORM_BINARY") or shutil.which("terraform")
        if not self.binary:
            self.skipTest("Install Terraform 1.13.5 to run offline engine lifecycle tests")
        self.environment = {
            **os.environ, "TF_IN_AUTOMATION": "true", "TF_INPUT": "false",
            "AWS_EC2_METADATA_DISABLED": "true", "AWS_ACCESS_KEY_ID": "mock",
            "AWS_SECRET_ACCESS_KEY": "mock", "AWS_DEFAULT_REGION": "ap-northeast-2",
        }

    def terraform(self, *arguments):
        result = subprocess.run(
            [str(self.binary), *arguments],
            cwd=self.directory,
            env=self.environment,
            text=True,
            capture_output=True,
            timeout=120,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def saved_plan(self, *arguments):
        self.terraform("plan", "-input=false", "-out=plan", *arguments)
        return json.loads(self.terraform("show", "-json", "plan"))

    def initialize_builtin(self):
        (self.directory / "main.tf").write_text(BUILTIN, encoding="utf-8")
        self.terraform("init", "-backend=false", "-input=false")
        self.terraform("apply", "-auto-approve", "-input=false")

    def test_saved_targeted_noop_and_complete_destroy(self):
        self.initialize_builtin()
        shutil.copyfile(
            self.directory / "terraform.tfstate", self.directory / "prior.tfstate"
        )
        (self.directory / "read.tf").write_text(
            'data "terraform_remote_state" "previous" {\n'
            '  backend = "local"\n  config = { path = "prior.tfstate" }\n}\n',
            encoding="utf-8",
        )
        (self.directory / "main.tf").write_text(
            BUILTIN.replace(
                "input = var.protected",
                "input = var.protected\n"
                "  depends_on = [data.terraform_remote_state.previous]",
            ),
            encoding="utf-8",
        )
        self.terraform("apply", "-auto-approve", "-input=false")
        plan = self.saved_plan("-target=terraform_data.guard")
        self.assertFalse(plan["complete"])
        self.assertIn("terraform_data.guard", resource_values(plan))
        self.assertNotIn("data.terraform_remote_state.previous", resource_values(plan))
        self.assertTrue(
            any(
                item["mode"] == "data"
                for item in plan["prior_state"]["values"]["root_module"]["resources"]
            )
        )
        validate_preparation(plan, {"terraform_data.guard": {}})
        with self.assertRaisesRegex(ValueError, "불완전"):
            validate_destroy(plan)
        destroy = self.saved_plan("-destroy")
        self.assertTrue(destroy["complete"])
        self.assertEqual(len(resource_values(destroy)), 2)
        validate_destroy(destroy)
        self.terraform("apply", "-input=false", "plan")
        state = json.loads(self.terraform("show", "-json"))
        self.assertNotIn("values", state)

    def test_actual_computed_unknown_is_rejected_before_apply(self):
        self.initialize_builtin()
        plan = self.saved_plan("-target=terraform_data.guard", "-var=protected=false")
        change = plan["resource_changes"][0]["change"]
        self.assertEqual(change["actions"], ["update"])
        self.assertTrue(change["after_unknown"]["output"])
        with self.assertRaisesRegex(ValueError, "미확정"):
            validate_preparation(plan, {"terraform_data.guard": {"input": False}})

    def mocked_values(self, policy):
        source = self.root / "infra/terraform/stack"
        for path in source.iterdir():
            if path.name.endswith(('.tf', '.tf.json')) or path.name == '.terraform.lock.hcl':
                shutil.copyfile(path, self.directory / path.name)
        settings = SimpleNamespace(
            environment="prd",
            run_id="73",
            attempt="2",
            region="ap-northeast-2",
            account="111122223333",
            cluster="trippilot-prd",
            role="arn:aws:iam::111122223333:role/trippilot-prd-github-deploy",
        )
        expected = write_override(self.directory, settings, policy)
        (self.directory / "lifecycle.tftest.hcl").write_text(
            MOCKS + '\nrun "teardown_values" { command = apply }\n',
            encoding="utf-8",
        )
        variables = self.directory / "inputs.tfvars.json"
        variables.write_text(json.dumps(VARIABLES), encoding="utf-8")
        self.terraform("init", "-backend=false", "-input=false", "-lockfile=readonly")
        self.terraform("validate", "-no-color")
        output = self.terraform("test", "-json", "-verbose", f"-var-file={variables}")
        events = [json.loads(line) for line in output.splitlines()]
        states = [event["test_state"] for event in events if "test_state" in event]
        self.assertEqual(len(states), 1)
        actual = {
            item["address"]: item["values"]
            for item in states[0]["root_module"]["resources"]
            if item["mode"] == "managed"
        }
        self.validate_identity_categories(actual, settings)
        for address, attributes in expected.items():
            for key, value in attributes.items():
                self.assertEqual(actual[address][key], value, f"{address}.{key}")
        self.assertTrue(actual["aws_db_instance.postgres"]["multi_az"])
        self.assertEqual(
            actual["aws_db_instance.postgres"]["backup_retention_period"], 14
        )
        self.assertFalse((source / "teardown_override.tf.json").exists())

    def validate_identity_categories(self, resources, settings):
        self.assertTrue(resources)
        for address, values in resources.items():
            if any(re.fullmatch(pattern, address) for pattern in TAGGED_ADDRESSES):
                # mock의 계산된 태그·ARN 값 대신 실제 provider의 속성 존재를 확인한다.
                self.assertIn("tags_all", values, address)
            else:
                validate_tagless(address, values, resources, settings)

    def test_prd_isolated_override_retains_snapshot(self):
        self.mocked_values("retain")

    def test_prd_isolated_override_skips_snapshot(self):
        self.mocked_values("skip")


if __name__ == "__main__":
    unittest.main()
