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

    def test_embedding_image_is_content_addressed_and_reused(self):
        """임베딩 이미지는 빌드 맥락(ai/embedding) 트리 해시 태그 — 있으면 빌드를 건너뛰고 같은 태그를 렌더한다.
        런 태그였을 땐 매 배포 임베딩이 재시작돼 maxSurge 0 공백이 생겼다(10-14 하루 15회+)."""
        steps = workflow('aws-deploy.yml')['jobs']['deploy']['steps']
        names = [s.get('name', '') for s in steps]
        resolve = steps[names.index('Resolve the embedding image tag')]
        self.assertIn('git rev-parse HEAD:ai/embedding', resolve['run'])
        build = steps[names.index('Build and publish embedding')]
        self.assertEqual(build['with']['context'], './ai/embedding')  # 해시를 잰 맥락과 빌드 맥락이 같아야 한다
        self.assertIn("steps.embedding-tag.outputs.exists != 'true'", build['if'])
        self.assertIn('steps.embedding-tag.outputs.tag', build['with']['tags'])
        render = steps[names.index('Synchronize runtime secrets and render nonsecret Helm values')]
        self.assertEqual(render['env']['EMBEDDING_IMAGE_TAG'], '${{ steps.embedding-tag.outputs.tag }}')
        self.assertIn('--embedding-image-tag', render['run'])
        self.assertLess(names.index('Resolve the embedding image tag'), names.index('Build and publish embedding'))

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

    def test_infra_changes_are_validated_on_pull_requests_without_credentials(self):
        """Terraform PR 에는 체크가 없었고 차트 PR 은 gradle 초록만 받았다 — 깨진 변경이 머지 뒤
        다음 배포에서야 드러났다(#887). PR 에서 도는 잡이라 자격 증명에 닿으면 안 된다."""
        value = workflow('infra-validate.yml')
        paths = value['on']['pull_request']['paths']
        self.assertIn('infra/**', paths)
        self.assertIn('deploy/**', paths)
        # 아래 계약 테스트가 읽는 워크플로가 바뀌어도 게이트가 돈다
        for filename in ('aws-deploy.yml', 'aws-bootstrap.yml', 'infra-validate.yml'):
            self.assertIn(f'.github/workflows/{filename}', paths)
        # deploy/eks/tests 가 실제 파일을 읽는다(runtime_pois.SCRIPT) — 옮기거나 지우면 여기서 걸려야 한다
        self.assertIn('backend/scripts/ingest_pois.py', paths)
        self.assertEqual(value['permissions'], {'contents': 'read'})
        # 잡 단위 permissions 는 워크플로 단위를 덮는다 — 거기서 쓰기 토큰을 여는 길도 막는다
        self.assertNotIn('permissions', value['jobs']['validate'])
        text = (ROOT / '.github/workflows/infra-validate.yml').read_text()
        for forbidden in ('id-token', 'secrets.', 'vars.', 'environment:', 'configure-aws-credentials'):
            self.assertNotIn(forbidden, text)

    def test_deploy_runs_the_same_validation_as_pull_requests(self):
        """잡을 복제하면 두 사본이 갈라진다 — 배포는 PR 게이트를 그대로 호출한다."""
        deploy = workflow('aws-deploy.yml')
        self.assertEqual(deploy['jobs']['validate']['uses'], './.github/workflows/infra-validate.yml')
        # 호출 쪽에서 자격을 넘겨주는 길(`secrets: inherit`·`permissions`)도 막는다 — 검증 잡은 `uses`·`with` 뿐이다
        self.assertEqual(set(deploy['jobs']['validate']), {'uses', 'with'})
        self.assertEqual(deploy['jobs']['deploy']['needs'], 'validate')
        self.assertEqual(deploy['env']['TF_VERSION'], workflow('infra-validate.yml')['env']['TF_VERSION'])
        # 입력 기본값이 false 라, 이 배선이 빠지면 앱 배포 직전의 종료 설정 검사가 조용히 건너뛰어진다
        self.assertEqual(
            deploy['jobs']['validate']['with']['verify_backend_shutdown'],
            "${{ inputs.mode == 'apply' && inputs.deploy_application }}",
        )
        gate = workflow('infra-validate.yml')
        self.assertIn('verify_backend_shutdown', gate['on']['workflow_call']['inputs'])
        shutdown = next(s for s in gate['jobs']['validate']['steps'] if s.get('name') == 'Verify backend shutdown configuration')
        self.assertEqual(shutdown['if'], 'inputs.verify_backend_shutdown')


if __name__ == '__main__':
    unittest.main()
