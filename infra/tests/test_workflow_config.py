import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'scripts' / 'workflow_config.py'
spec = importlib.util.spec_from_file_location('workflow_config', MODULE)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


class WorkflowConfigTests(unittest.TestCase):
    def settings(self, **overrides):
        return {
            'DEPLOY_ENVIRONMENT': 'dev', 'DEPLOY_MODE': 'plan',
            'AWS_ACCOUNT_ID': '123456789012', 'AWS_REGION': 'ap-northeast-2',
            'AWS_ROLE_ARN': 'arn:aws:iam::123456789012:role/trippilot-dev-github-deploy',
            'GITHUB_REF': 'refs/heads/develop', 'DEPLOY_APPLICATION': 'true',
            'EMBEDDING_ENABLED': 'false', **overrides,
        }

    def test_plan_does_not_require_certificate(self):
        actual = config.settings(self.settings())
        self.assertEqual(actual['state_bucket'], 'trippilot-tfstate-123456789012-ap-northeast-2-dev')
        self.assertFalse(actual['deploy_application'])

    def test_apply_requires_certificate_and_hostname(self):
        with self.assertRaisesRegex(ValueError, 'ACM_CERTIFICATE_ARN'):
            config.settings(self.settings(DEPLOY_MODE='apply'))
        with self.assertRaisesRegex(ValueError, 'API_HOSTNAME'):
            config.settings(self.settings(DEPLOY_MODE='apply', ACM_CERTIFICATE_ARN='arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789abc'))

    def test_apply_infrastructure_only_needs_no_certificate(self):
        actual = config.settings(self.settings(DEPLOY_MODE='apply', DEPLOY_APPLICATION='false'))
        self.assertFalse(actual['deploy_application'])

    def test_rejects_cross_environment_or_account_role(self):
        for role in ('arn:aws:iam::123456789012:role/trippilot-prd-github-deploy', 'arn:aws:iam::999999999999:role/trippilot-dev-github-deploy'):
            with self.subTest(role=role), self.assertRaisesRegex(ValueError, 'AWS_ROLE_ARN'):
                config.settings(self.settings(AWS_ROLE_ARN=role))

    def test_prd_uses_main_branch(self):
        inputs = self.settings(DEPLOY_ENVIRONMENT='prd', AWS_ROLE_ARN='arn:aws:iam::123456789012:role/trippilot-prd-github-deploy')
        with self.assertRaisesRegex(ValueError, 'branch'):
            config.settings(inputs)
        self.assertEqual(config.settings({**inputs, 'GITHUB_REF': 'refs/heads/main'})['environment'], 'prd')

    def test_rejects_invalid_configuration(self):
        for key, value in [('DEPLOY_ENVIRONMENT', '../prd'), ('DEPLOY_MODE', 'destroy'), ('AWS_ACCOUNT_ID', ''), ('AWS_REGION', 'x;echo fail'), ('DEPLOY_APPLICATION', 'yes'), ('EMBEDDING_ENABLED', 'yes'), ('GITHUB_REF', 'refs/tags/main')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                config.settings(self.settings(**{key: value}))

    def test_custom_protected_branch(self):
        self.assertEqual(config.settings(self.settings(DEPLOY_BRANCH='release', GITHUB_REF='refs/heads/release'))['environment'], 'dev')

    def test_certificate_must_match_account_and_region(self):
        with self.assertRaisesRegex(ValueError, 'ACM_CERTIFICATE_ARN'):
            config.settings(self.settings(DEPLOY_MODE='apply', ACM_CERTIFICATE_ARN='arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789abc', API_HOSTNAME='api.example.com'))

    def test_valid_application_config(self):
        actual = config.settings(self.settings(DEPLOY_MODE='apply', ACM_CERTIFICATE_ARN='arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789abc', API_HOSTNAME='api-dev.example.com', EMBEDDING_ENABLED='true'))
        self.assertTrue(actual['deploy_application'])
        self.assertTrue(actual['embedding_enabled'])


if __name__ == '__main__':
    unittest.main()

class WorkflowMainTests(unittest.TestCase):
    def test_main_writes_validated_outputs(self):
        from unittest.mock import patch
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output'
            env = {**WorkflowConfigTests().settings(), 'GITHUB_OUTPUT': str(output)}
            with patch.dict(config.os.environ, env, clear=True):
                config.main()
            self.assertIn('deploy_application=false\n', output.read_text())

    def test_main_fails_before_writing_for_bad_environment(self):
        from unittest.mock import patch
        import io
        with patch.dict(config.os.environ, {'DEPLOY_ENVIRONMENT': 'bad'}, clear=True), patch('sys.stderr', new_callable=io.StringIO) as stderr:
            with self.assertRaises(SystemExit) as failure:
                config.main()
        self.assertEqual(failure.exception.code, 1)
        self.assertIn('DEPLOY_ENVIRONMENT', stderr.getvalue())
