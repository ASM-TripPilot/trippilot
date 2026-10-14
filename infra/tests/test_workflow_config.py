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
            'EMBEDDING_ENABLED': 'false', 'DEPLOY_TARGET': 'prod', **overrides,
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

    def test_prod_target_is_unchanged(self):
        actual = config.settings(self.settings(EMBEDDING_ENABLED='true'))
        self.assertEqual((actual['target'], actual['terraform'], actual['namespace'], actual['values_file'], actual['embedding_enabled']),
                         ('prod', True, 'trippilot', 'values-dev.yaml', True))

    def test_dev_target_skips_terraform_and_forces_embedding_off(self):
        """기본값(임베딩 켬)으로 개발 배포를 눌러도 큰 임베딩 노드가 뜨지 않고 공유 인프라를 안 바꾼다."""
        actual = config.settings(self.settings(DEPLOY_TARGET='dev', EMBEDDING_ENABLED='true', DEPLOY_MODE='apply',
                                               ACM_CERTIFICATE_ARN='arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789abc',
                                               API_HOSTNAME='dev-api.example.com'))
        self.assertEqual((actual['terraform'], actual['namespace'], actual['values_file'], actual['embedding_enabled'], actual['deploy_application']),
                         (False, 'trippilot-dev', 'values-dev-target.yaml', False, True))

    def test_dev_target_refuses_real_push_and_other_stacks(self):
        with self.assertRaisesRegex(ValueError, 'push'):
            config.settings(self.settings(DEPLOY_TARGET='dev', PUSH_MODE_INPUT='expo'))
        prd = self.settings(DEPLOY_ENVIRONMENT='prd', AWS_ROLE_ARN='arn:aws:iam::123456789012:role/trippilot-prd-github-deploy',
                            GITHUB_REF='refs/heads/main', DEPLOY_TARGET='dev')
        with self.assertRaisesRegex(ValueError, 'dev stack'):
            config.settings(prd)
        for value in ('', 'staging', 'prod;x'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'DEPLOY_TARGET'):
                config.settings(self.settings(DEPLOY_TARGET=value))
        self.assertEqual(config.settings(self.settings(DEPLOY_TARGET='dev', PUSH_MODE_INPUT='off'))['target'], 'dev')


if __name__ == '__main__':
    unittest.main()

class WorkflowMainTests(unittest.TestCase):
    def test_main_writes_validated_outputs(self):
        from unittest.mock import patch
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output'
            environment = Path(directory) / 'env'
            env = {**WorkflowConfigTests().settings(DEPLOY_TARGET='dev', EMBEDDING_ENABLED='true'),
                   'GITHUB_OUTPUT': str(output), 'GITHUB_ENV': str(environment)}
            with patch.dict(config.os.environ, env, clear=True):
                config.main()
            self.assertIn('deploy_application=false\n', output.read_text())
            self.assertIn('terraform=false\n', output.read_text())
            # 뒤 스텝 셸은 대상이 정한 값만 본다 — 입력(EMBEDDING_ENABLED=true)이 아니라
            self.assertEqual(environment.read_text().splitlines(),
                             ['NAMESPACE=trippilot-dev', 'VALUES_FILE=values-dev-target.yaml', 'EFFECTIVE_EMBEDDING=false'])

    def test_main_fails_before_writing_for_bad_environment(self):
        from unittest.mock import patch
        import io
        with patch.dict(config.os.environ, {'DEPLOY_ENVIRONMENT': 'bad'}, clear=True), patch('sys.stderr', new_callable=io.StringIO) as stderr:
            with self.assertRaises(SystemExit) as failure:
                config.main()
        self.assertEqual(failure.exception.code, 1)
        self.assertIn('DEPLOY_ENVIRONMENT', stderr.getvalue())
