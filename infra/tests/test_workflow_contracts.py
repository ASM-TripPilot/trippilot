from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]


def workflow(name):
    # YAML 1.1 resolves the GitHub key `on` as a boolean; BaseLoader preserves it.
    return yaml.load((ROOT / '.github/workflows' / name).read_text(), Loader=yaml.BaseLoader)


class WorkflowContractTests(unittest.TestCase):
    def test_aws_deploy_is_only_manual(self):
        for filename in ('aws-deploy.yml', 'aws-bootstrap.yml'):
            with self.subTest(filename=filename):
                value = workflow(filename)
                self.assertEqual(set(value['on']), {'workflow_dispatch'})
                self.assertEqual(value['on']['workflow_dispatch']['inputs']['environment']['options'], ['dev', 'prd'])
                self.assertEqual(value['concurrency']['group'], 'aws-${{ inputs.environment }}')
                self.assertEqual(value['concurrency']['cancel-in-progress'], 'false')

    def test_plan_has_no_application_or_bootstrap_mutations(self):
        value = workflow('aws-deploy.yml')
        self.assertEqual(value['on']['workflow_dispatch']['inputs']['mode']['default'], 'plan')
        steps = value['jobs']['deploy']['steps']
        apply = next(step for step in steps if step.get('name') == 'Apply the saved run plan')
        self.assertEqual(apply['if'], "inputs.mode == 'apply'")
        for step in steps:
            if step.get('name', '').startswith(('Build and publish', 'Synchronize runtime', 'Initialize database', 'Deploy and wait')):
                self.assertIn("steps.config.outputs.deploy_application == 'true'", step['if'])
        text = (ROOT / '.github/workflows/aws-deploy.yml').read_text()
        self.assertNotIn('aws-bootstrap.yml', text)
        self.assertNotIn('terraform destroy', text)
        self.assertNotIn('upload-artifact', text)

    def test_environment_credentials_and_state_are_explicit(self):
        value = workflow('aws-deploy.yml')['jobs']['deploy']
        self.assertEqual(value['environment'], '${{ inputs.environment }}')
        self.assertEqual(value['permissions']['id-token'], 'write')
        init = next(s['run'] for s in value['steps'] if s.get('name') == 'Initialize existing environment state')
        self.assertIn('use_lockfile=true', init)
        self.assertIn('key=terraform.tfstate', init)
        self.assertIn('encrypt=true', init)

    def test_plan_b_kb_is_on_by_default_and_loaded_on_every_deploy(self):
        """기본값 false 였을 때 기본값 배포 한 번(2026-10-03 13:38)이 KB 를 조용히 껐고,
        적재는 손으로 했다 — 재계획은 200 을 내며 규칙 랭킹으로만 돌았다."""
        value = workflow('aws-deploy.yml')
        self.assertEqual(value['on']['workflow_dispatch']['inputs']['embedding_enabled']['default'], 'true')
        steps = value['jobs']['deploy']['steps']
        names = [s.get('name', '') for s in steps]
        load = steps[names.index('Load the Plan-B knowledge base')]
        self.assertIn('inputs.embedding_enabled', load['if'])
        self.assertIn('runtime.py load-kb', load['run'])
        # 앱이 뜬 뒤여야 한다 — 적재는 ai 파드 안에서 돈다
        self.assertGreater(names.index('Load the Plan-B knowledge base'), names.index('Deploy and wait for healthy workloads'))

    def test_push_mode_is_kept_unless_the_deployer_chooses(self):
        """푸시 모드는 시크릿에 보존된다 — 입력 기본값은 '유지'여야 기본 배포가 켜고 끄지 않는다."""
        value = workflow('aws-deploy.yml')
        push = value['on']['workflow_dispatch']['inputs']['push_mode']
        self.assertEqual(push['default'], 'keep')
        self.assertEqual(push['options'], ['keep', 'off', 'expo'])
        steps = value['jobs']['deploy']['steps']
        sync = next(s for s in steps if s.get('name') == 'Synchronize runtime secrets and render nonsecret Helm values')
        self.assertIn('--push-mode', sync['run'])
        self.assertIn('PUSH_MODE_INPUT', sync['run'])


if __name__ == '__main__':
    unittest.main()
