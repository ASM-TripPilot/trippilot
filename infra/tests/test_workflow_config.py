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
            'GITHUB_REF': 'refs/heads/main', 'DEPLOY_APPLICATION': 'true',
            'EMBEDDING_ENABLED': 'false', 'DEPLOY_TARGET': 'prod',
            'DEPLOY_KIND': 'release', 'DEPLOY_REF': 'app-1.2.0', **overrides,
        }

    def test_plan_does_not_require_certificate(self):
        actual = config.settings(self.settings())
        self.assertEqual(actual['state_bucket'], 'trippilot-tfstate-123456789012-ap-northeast-2-dev')
        self.assertFalse(actual['deploy_application'])

    def test_apply_requires_certificate_and_hostname(self):
        with self.assertRaisesRegex(ValueError, 'ACM_CERTIFICATE_ARN'):
            config.settings(self.settings(DEPLOY_MODE='apply'))
        with self.assertRaisesRegex(ValueError, 'API_HOSTNAME'):
            config.settings(self.settings(DEPLOY_MODE='apply', PROD_ACM_CERTIFICATE_ARN='arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789abc'))

    def test_apply_infrastructure_only_needs_no_certificate(self):
        actual = config.settings(self.settings(DEPLOY_MODE='apply', DEPLOY_APPLICATION='false'))
        self.assertFalse(actual['deploy_application'])

    def test_rejects_cross_environment_or_account_role(self):
        for role in ('arn:aws:iam::123456789012:role/trippilot-prd-github-deploy', 'arn:aws:iam::999999999999:role/trippilot-dev-github-deploy'):
            with self.subTest(role=role), self.assertRaisesRegex(ValueError, 'AWS_ROLE_ARN'):
                config.settings(self.settings(AWS_ROLE_ARN=role))

    def test_prd_uses_main_branch(self):
        inputs = self.settings(DEPLOY_ENVIRONMENT='prd', AWS_ROLE_ARN='arn:aws:iam::123456789012:role/trippilot-prd-github-deploy',
                               GITHUB_REF='refs/heads/develop')
        with self.assertRaisesRegex(ValueError, 'branch'):
            config.settings(inputs)
        self.assertEqual(config.settings({**inputs, 'GITHUB_REF': 'refs/heads/main'})['environment'], 'prd')

    def test_rejects_invalid_configuration(self):
        for key, value in [('DEPLOY_ENVIRONMENT', '../prd'), ('DEPLOY_MODE', 'destroy'), ('AWS_ACCOUNT_ID', ''), ('AWS_REGION', 'x;echo fail'), ('DEPLOY_APPLICATION', 'yes'), ('EMBEDDING_ENABLED', 'yes'), ('GITHUB_REF', 'refs/tags/main')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                config.settings(self.settings(**{key: value}))

    def test_custom_protected_branch(self):
        # 운영 대상은 main 고정이라 사용자 지정 브랜치는 개발 대상·prd 스택에만 먹는다
        self.assertEqual(config.settings(self.dev(DEPLOY_BRANCH='release', GITHUB_REF='refs/heads/release'))['environment'], 'dev')

    def test_certificate_must_match_account_and_region(self):
        with self.assertRaisesRegex(ValueError, 'ACM_CERTIFICATE_ARN'):
            config.settings(self.settings(DEPLOY_MODE='apply', PROD_ACM_CERTIFICATE_ARN='arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789abc', PROD_API_HOSTNAME='api.example.com'))

    def test_valid_application_config(self):
        actual = config.settings(self.settings(DEPLOY_MODE='apply', PROD_ACM_CERTIFICATE_ARN='arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789abc', PROD_API_HOSTNAME='api-dev.example.com', EMBEDDING_ENABLED='true'))
        self.assertTrue(actual['deploy_application'])
        self.assertTrue(actual['embedding_enabled'])

    def test_production_ships_only_from_main_and_dev_only_from_develop(self):
        """2026-10-15 분리 — develop 머지가 곧장 출시 앱 서버로 나가던 것(10/14 저녁 빈 일정 사고)을 끊는다."""
        with self.assertRaisesRegex(ValueError, 'branch must be main'):
            config.settings(self.settings(GITHUB_REF='refs/heads/develop'))
        with self.assertRaisesRegex(ValueError, 'branch must be develop'):
            config.settings(self.dev(GITHUB_REF='refs/heads/main'))
        self.assertEqual(config.settings(self.settings())['target'], 'prod')
        self.assertEqual(config.settings(self.dev())['target'], 'dev')

    def test_deploy_branch_override_cannot_send_develop_to_production(self):
        with self.assertRaisesRegex(ValueError, 'branch must be main'):
            config.settings(self.settings(DEPLOY_BRANCH='develop', GITHUB_REF='refs/heads/develop'))
        # 개발 대상에는 여전히 먹는다
        self.assertEqual(config.settings(self.dev(DEPLOY_BRANCH='feature', GITHUB_REF='refs/heads/feature'))['target'], 'dev')

    def test_prod_target_is_unchanged(self):
        actual = config.settings(self.settings(EMBEDDING_ENABLED='true'))
        self.assertEqual((actual['target'], actual['terraform'], actual['namespace'], actual['values_file'], actual['embedding_enabled']),
                         ('prod', True, 'trippilot', 'values-dev.yaml', True))

    def test_dev_target_skips_terraform_and_follows_embedding_input(self):
        """공유 인프라(Terraform)는 안 바꾸고, 임베딩은 입력대로 — 강제로 끄면 개발 Plan-B 가 KB 없이 돌아 운영과 다르게 골랐다(10-15)."""
        actual = config.settings(self.dev(EMBEDDING_ENABLED='true'))
        self.assertEqual((actual['terraform'], actual['namespace'], actual['values_file'], actual['embedding_enabled'], actual['deploy_application']),
                         (False, 'trippilot-dev', 'values-dev-target.yaml', True, True))
        self.assertFalse(config.settings(self.dev(EMBEDDING_ENABLED='false'))['embedding_enabled'])
        self.assertEqual((actual['certificate_arn'], actual['hostname']), (self.DEV_CERT, 'dev-api.example.com'))

    PROD_CERT = 'arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789abc'
    DEV_CERT = 'arn:aws:acm:ap-northeast-2:123456789012:certificate/87654321-4321-4321-4321-cba987654321'

    def dev(self, **overrides):
        return self.settings(**{'DEPLOY_TARGET': 'dev', 'DEPLOY_MODE': 'apply', 'GITHUB_REF': 'refs/heads/develop',
                                'PROD_ACM_CERTIFICATE_ARN': self.PROD_CERT, 'PROD_API_HOSTNAME': 'api-dev.example.com',
                                'DEV_TARGET_ACM_CERTIFICATE_ARN': self.DEV_CERT, 'DEV_TARGET_API_HOSTNAME': 'dev-api.example.com',
                                **overrides})

    def test_dev_target_never_borrows_production_address_or_certificate(self):
        """식으로 고르던 때는 개발 변수가 비면 운영 인증서·주소로 조용히 떨어졌다(#1261 검수)."""
        for overrides in ({'DEV_TARGET_ACM_CERTIFICATE_ARN': ''}, {'DEV_TARGET_API_HOSTNAME': ''},
                          {'DEV_TARGET_ACM_CERTIFICATE_ARN': self.PROD_CERT}, {'DEV_TARGET_API_HOSTNAME': 'api-dev.example.com'}):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                config.settings(self.dev(**overrides))

    def test_dev_target_push_is_always_off_and_plan_is_refused(self):
        for push in ('keep', 'off', ''):
            with self.subTest(push=push):
                self.assertEqual(config.settings(self.dev(PUSH_MODE_INPUT=push))['push_mode'], 'off')
        self.assertEqual(config.settings(self.settings(PUSH_MODE_INPUT='expo'))['push_mode'], 'expo')  # 운영은 입력대로
        with self.assertRaisesRegex(ValueError, 'apply'):
            config.settings(self.dev(DEPLOY_MODE='plan'))

    def test_dialogue_inputs_are_validated_before_aws_access(self):
        """도우미 스위치·모델 배정 입력은 자격을 받기 전에 거른다 — 모델 배정은 GITHUB_ENV 한 줄로 넘어가므로 줄바꿈이 끼면
        뒤 스텝 env 를 위조한다. 기능 이름의 실재 여부는 runtime_secrets 가 같은 커밋 소스로 본다."""
        result = config.settings(self.dev())
        self.assertEqual((result['dialogue_orchestrator'], result['llm_feature_models']), ('keep', ''))
        ok = config.settings(self.dev(DIALOGUE_ORCHESTRATOR_INPUT='on',
                                      LLM_FEATURE_MODELS_INPUT='DIALOGUE_INTENT=gpt-5.6-luna, DIALOGUE_ANSWER=gpt-5.6-luna'))
        self.assertEqual(ok['dialogue_orchestrator'], 'on')
        self.assertEqual(ok['llm_feature_models'], 'DIALOGUE_INTENT=gpt-5.6-luna, DIALOGUE_ANSWER=gpt-5.6-luna')
        for value in ('true', 'ON', 'keep;off'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'DIALOGUE_ORCHESTRATOR_INPUT'):
                config.settings(self.dev(DIALOGUE_ORCHESTRATOR_INPUT=value))
        for value in ('DIALOGUE_INTENT=gpt\nEFFECTIVE_PUSH_MODE=expo', 'DIALOGUE_INTENT=', '=gpt-5.6-luna',
                      'DIALOGUE_INTENT=gpt-5.6-luna,', 'DIALOGUE_INTENT=a b', 'DIALOGUE_INTENT=gpt;rm'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'LLM_FEATURE_MODELS_INPUT'):
                config.settings(self.dev(LLM_FEATURE_MODELS_INPUT=value))

    # ── 운영 배포 규칙(TRIP-1659): 열차·핫픽스 선언 ──
    def prod_apply(self, **overrides):
        return self.settings(DEPLOY_MODE='apply', PROD_ACM_CERTIFICATE_ARN=self.PROD_CERT,
                             PROD_API_HOSTNAME='api-dev.example.com', **overrides)

    def test_prod_apply_needs_a_declaration(self):
        """운영 서버는 열차와 핫픽스 때만 만진다 — 선언 없는 apply 는 AWS 자격 증명 전에 거절한다."""
        for kind in ('', 'none', 'deploy', 'release;hotfix'):
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'DEPLOY_KIND'):
                config.settings(self.prod_apply(DEPLOY_KIND=kind))

    def test_infra_only_prod_apply_is_also_a_prod_change(self):
        with self.assertRaisesRegex(ValueError, 'DEPLOY_KIND'):
            config.settings(self.prod_apply(DEPLOY_APPLICATION='false', DEPLOY_KIND=''))
        self.assertEqual(config.settings(self.prod_apply(DEPLOY_APPLICATION='false'))['deploy_kind'], 'release')

    def test_plan_and_dev_target_need_no_declaration(self):
        self.assertEqual(config.settings(self.settings(DEPLOY_KIND=''))['deploy_kind'], 'none')
        dev = config.settings(self.dev(DEPLOY_KIND='', DEPLOY_REF=''))
        self.assertEqual((dev['deploy_kind'], dev['deploy_ref'], dev['deploy_reason']), ('none', '', ''))

    def test_release_needs_a_name(self):
        ok = config.settings(self.prod_apply(DEPLOY_KIND='release', DEPLOY_REF='app-1.4.0'))
        self.assertEqual((ok['deploy_kind'], ok['deploy_ref'], ok['deploy_reason']), ('release', 'app-1.4.0', ''))
        for ref in ('', 'a b', '../x', 'x;rm', 'x' * 41, '-lead', 'a\nb=c'):
            with self.subTest(ref=ref), self.assertRaisesRegex(ValueError, 'DEPLOY_REF'):
                config.settings(self.prod_apply(DEPLOY_KIND='release', DEPLOY_REF=ref))

    def test_hotfix_needs_a_jira_key_and_a_reason(self):
        ok = config.settings(self.prod_apply(DEPLOY_KIND='hotfix', DEPLOY_REF='TRIP-1631', DEPLOY_REASON='  LLM 키 401 — 일정 AI 가 꺼졌다  '))
        self.assertEqual((ok['deploy_kind'], ok['deploy_ref'], ok['deploy_reason']), ('hotfix', 'TRIP-1631', 'LLM 키 401 — 일정 AI 가 꺼졌다'))
        for ref in ('', 'trip-1', 'TRIP-', 'TRIP-1;x', 'app-1.4.0'):
            with self.subTest(ref=ref), self.assertRaisesRegex(ValueError, 'DEPLOY_REF'):
                config.settings(self.prod_apply(DEPLOY_KIND='hotfix', DEPLOY_REF=ref, DEPLOY_REASON='사유가 있다'))
        # 사유는 GITHUB_OUTPUT 한 줄로 나간다 — 줄바꿈·제어 문자가 끼면 뒤 스텝 출력을 위조한다
        for reason in ('', '  ', 'ab', 'x' * 201, '사유\nDEPLOY_KIND=release', 'a\rb', 'tab\there'):
            with self.subTest(reason=reason), self.assertRaisesRegex(ValueError, 'DEPLOY_REASON'):
                config.settings(self.prod_apply(DEPLOY_KIND='hotfix', DEPLOY_REF='TRIP-1', DEPLOY_REASON=reason))

    def test_dev_sleep_applies_only_to_a_dev_app_deploy(self):
        self.assertTrue(config.settings(self.dev(DEV_SLEEP_AFTER='true'))['dev_sleep'])
        for value in ('false', ''):
            self.assertFalse(config.settings(self.dev(DEV_SLEEP_AFTER=value))['dev_sleep'])
        self.assertFalse(config.settings(self.dev())['dev_sleep'])  # 입력이 없으면 끈 것으로 — 켜 두는 쪽이 비용이 새는 쪽
        self.assertFalse(config.settings(self.dev(DEV_SLEEP_AFTER='true', DEPLOY_APPLICATION='false'))['dev_sleep'])
        self.assertFalse(config.settings(self.prod_apply(DEV_SLEEP_AFTER='true'))['dev_sleep'])  # 운영은 절대 재우지 않는다
        with self.assertRaisesRegex(ValueError, 'DEV_SLEEP_AFTER'):
            config.settings(self.dev(DEV_SLEEP_AFTER='maybe'))

    def test_main_writes_the_declaration_outputs(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            out, env = Path(tmp, 'output'), Path(tmp, 'env')
            out.touch(); env.touch()
            values = {**self.prod_apply(DEPLOY_KIND='hotfix', DEPLOY_REF='TRIP-9', DEPLOY_REASON='로그인 불가'),
                      'GITHUB_OUTPUT': str(out), 'GITHUB_ENV': str(env)}
            with patch.dict(config.os.environ, values, clear=True):
                config.main()
            lines = out.read_text(encoding='utf-8').splitlines()
        for expected in ('deploy_kind=hotfix', 'deploy_ref=TRIP-9', 'deploy_reason=로그인 불가', 'dev_sleep=false'):
            self.assertIn(expected, lines)

    def test_dev_target_refuses_real_push_and_other_stacks(self):
        with self.assertRaisesRegex(ValueError, 'push'):
            config.settings(self.dev(PUSH_MODE_INPUT='expo'))
        prd = self.settings(DEPLOY_ENVIRONMENT='prd', AWS_ROLE_ARN='arn:aws:iam::123456789012:role/trippilot-prd-github-deploy',
                            GITHUB_REF='refs/heads/main', DEPLOY_TARGET='dev')
        with self.assertRaisesRegex(ValueError, 'dev stack'):
            config.settings(prd)
        for value in ('', 'staging', 'prod;x'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'DEPLOY_TARGET'):
                config.settings(self.settings(DEPLOY_TARGET=value))
        self.assertEqual(config.settings(self.dev(PUSH_MODE_INPUT='off'))['target'], 'dev')


if __name__ == '__main__':
    unittest.main()

class WorkflowMainTests(unittest.TestCase):
    def test_main_writes_validated_outputs(self):
        from unittest.mock import patch
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output'
            environment = Path(directory) / 'env'
            env = {**WorkflowConfigTests().dev(EMBEDDING_ENABLED='true', DEPLOY_APPLICATION='false'),
                   'GITHUB_OUTPUT': str(output), 'GITHUB_ENV': str(environment)}
            with patch.dict(config.os.environ, env, clear=True):
                config.main()
            self.assertIn('deploy_application=false\n', output.read_text())
            self.assertIn('terraform=false\n', output.read_text())
            # 뒤 스텝 셸은 대상이 정한 값만 본다 — 푸시는 입력과 무관하게 off, 임베딩은 입력대로
            self.assertEqual(environment.read_text().splitlines(),
                             ['NAMESPACE=trippilot-dev', 'VALUES_FILE=values-dev-target.yaml', 'EFFECTIVE_EMBEDDING=true',
                              'EFFECTIVE_PUSH_MODE=off', 'EFFECTIVE_DIALOGUE_ORCHESTRATOR=keep', 'EFFECTIVE_LLM_FEATURE_MODELS=',
                              f'ACM_CERTIFICATE_ARN={WorkflowConfigTests.DEV_CERT}',
                              'API_HOSTNAME=dev-api.example.com'])

    def test_main_fails_before_writing_for_bad_environment(self):
        from unittest.mock import patch
        import io
        with patch.dict(config.os.environ, {'DEPLOY_ENVIRONMENT': 'bad'}, clear=True), patch('sys.stderr', new_callable=io.StringIO) as stderr:
            with self.assertRaises(SystemExit) as failure:
                config.main()
        self.assertEqual(failure.exception.code, 1)
        self.assertIn('DEPLOY_ENVIRONMENT', stderr.getvalue())
