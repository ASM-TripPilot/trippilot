"""Input and identity boundary tests run before AWS credentials are requested."""
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))


def valid_settings(**overrides):
    from teardown_config import Settings
    return Settings(**{
        'environment': 'dev', 'account': '123456789012',
        'region': 'ap-northeast-2',
        'role': 'arn:aws:iam::123456789012:role/trippilot-dev-github-deploy',
        'sha': 'a' * 40, 'run_id': '123', 'attempt': '1',
        'bootstrap_role': 'arn:aws:iam::123456789012:role/external-bootstrap',
        **overrides,
    })


def load_balancer():
    return {
        'Type': 'network', 'Scheme': 'internet-facing',
        'LoadBalancerArn': 'arn:aws:elasticloadbalancing:ap-northeast-2:123456789012:loadbalancer/net/trippilot/aaaaaaaaaaaaaaaa',
        'VpcId': 'vpc-aaaaaaaaaaaaaaaaa',
        'DNSName': 'trippilot.elb.ap-northeast-2.amazonaws.com',
        'AvailabilityZones': [
            {'SubnetId': 'subnet-aaaaaaaaaaaaaaaaa'},
            {'SubnetId': 'subnet-bbbbbbbbbbbbbbbbb'},
        ],
    }


def environment(**overrides):
    return {
        'DEPLOY_ENVIRONMENT': 'dev', 'TEARDOWN_SCOPE': 'service',
        'TEARDOWN_OPERATION': 'plan', 'SNAPSHOT_POLICY': 'retain',
        'PURGE_STATE': 'false', 'DELETE_CONFIRMATION': '',
        'AWS_ACCOUNT_ID': '123456789012', 'AWS_REGION': 'ap-northeast-2',
        'AWS_ROLE_ARN': 'arn:aws:iam::123456789012:role/trippilot-dev-github-deploy',
        'AWS_BOOTSTRAP_ROLE_ARN': 'arn:aws:iam::123456789012:role/external-bootstrap',
        'AWS_COMMIT_SHA': 'a' * 40, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
        'GITHUB_REF': 'refs/heads/develop', 'GITHUB_REPOSITORY': 'ASM-TripPilot/trippilot',
        'GITHUB_EVENT_NAME': 'workflow_dispatch', **overrides,
    }


class ConfigurationTests(unittest.TestCase):
    def test_environment_contract_and_defaults(self):
        from teardown_config import configuration
        settings, options = configuration(environment())
        self.assertEqual(settings.cluster, 'trippilot-dev')
        self.assertEqual(settings.state_key, 'terraform.tfstate')
        self.assertEqual(settings.state_bucket, 'trippilot-tfstate-123456789012-ap-northeast-2-dev')
        self.assertEqual(options.operation, 'plan')
        self.assertFalse(options.purge_state)

    def test_invalid_environment_role_branch_sha_and_confirmation_fail(self):
        from teardown_config import configuration
        bad = [
            {'DEPLOY_ENVIRONMENT': 'qa'}, {'AWS_ACCOUNT_ID': '123'},
            {'AWS_REGION': 'https://attacker'}, {'AWS_COMMIT_SHA': 'HEAD'},
            {'AWS_ROLE_ARN': 'arn:aws:iam::123456789012:role/admin'},
            {'GITHUB_REF': 'refs/heads/feature'}, {'GITHUB_REPOSITORY': 'attacker/repo'},
            {'GITHUB_EVENT_NAME': 'push'}, {'GITHUB_RUN_ID': '1;rm'},
            {'TEARDOWN_OPERATION': 'destroy'}, {'PURGE_STATE': 'true'},
            {'SNAPSHOT_POLICY': 'other'}, {'PURGE_STATE': 'yes'},
            {'TEARDOWN_SCOPE': 'bootstrap', 'SNAPSHOT_POLICY': 'skip'},
            {'TEARDOWN_SCOPE': 'bootstrap', 'AWS_BOOTSTRAP_ROLE_ARN': ''},
            {'TEARDOWN_SCOPE': 'bootstrap', 'AWS_BOOTSTRAP_ROLE_ARN': 'arn:aws:iam::123456789012:role/trippilot-dev-node'},
            {'TEARDOWN_SCOPE': 'bootstrap', 'AWS_BOOTSTRAP_ROLE_ARN': 'arn:aws:iam::123456789012:role/other-path/trippilot-dev-node'},
        ]
        for changes in bad:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                configuration(environment(**changes))

    def test_confirmed_destroy_and_prd_branch(self):
        from teardown_config import configuration
        settings, options = configuration(environment(
            DEPLOY_ENVIRONMENT='prd', GITHUB_REF='refs/heads/main',
            AWS_ROLE_ARN='arn:aws:iam::123456789012:role/trippilot-prd-github-deploy',
            TEARDOWN_OPERATION='destroy', DELETE_CONFIRMATION='DELETE prd 123456789012'))
        self.assertEqual(settings.environment, 'prd')
        self.assertEqual(options.operation, 'destroy')

    def test_sts_rejects_foreign_account_or_role(self):
        from teardown_config import verify_caller
        good = {'Account': '123456789012', 'Arn': 'arn:aws:sts::123456789012:assumed-role/trippilot-dev-github-deploy/session'}
        verify_caller(Mock(return_value=json.dumps(good)), valid_settings(), 'service')
        for changes in ({'Account': '999999999999'}, {'Arn': 'arn:aws:sts::123456789012:assumed-role/admin/session'}, {'Arn': ''}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                verify_caller(Mock(return_value=json.dumps({**good, **changes})), valid_settings(), 'service')

    def test_runner_hides_output_and_blocks_endpoint_overrides(self):
        from teardown_config import Runner
        with patch.dict(os.environ, {'AWS_ENDPOINT_URL': 'https://foreign'}, clear=True):
            with self.assertRaises(ValueError):
                Runner(Path.cwd())(['aws', 'sts', 'get-caller-identity'])
        result = Mock(returncode=1, stderr='SECRET-VALUE', stdout='SECRET-VALUE')
        with patch('teardown_config.subprocess.run', return_value=result), patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RuntimeError) as context:
                Runner(Path.cwd())(['aws', 'sts', 'get-caller-identity'])
        self.assertNotIn('SECRET-VALUE', str(context.exception))


if __name__ == '__main__':
    unittest.main()
