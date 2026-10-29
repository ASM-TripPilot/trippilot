import importlib.util
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
        self.assertEqual(apply['if'], "inputs.mode == 'apply' && steps.config.outputs.terraform == 'true'")
        plan = next(step for step in steps if step.get('name') == 'Terraform plan')
        self.assertEqual(plan['if'], "steps.config.outputs.terraform == 'true'")
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

    def test_events_store_is_refreshed_from_collect_state_before_the_ai_image(self):
        """행사 수집은 collect-state 에만 쌓이는데 운영 AI 는 이미지 동봉본을 읽어서, 동봉본이 8-22 이후 멈춰 있었다(10-18)."""
        steps = workflow('aws-deploy.yml')['jobs']['deploy']['steps']
        names = [s.get('name', '') for s in steps]
        refresh = steps[names.index('Refresh the bundled events store from collect-state')]
        self.assertIn('origin collect-state', refresh['run'])
        self.assertIn('deploy/eks/refresh_events.py', refresh['run'])
        self.assertIn('ai/data/collected_events.json', refresh['run'])
        self.assertIn("steps.config.outputs.deploy_application == 'true'", refresh['if'])
        # 이미지를 굽기 **전**이어야 한다 — 빌드 맥락(./ai)이 갈아 끼운 파일을 담는다
        self.assertLess(names.index('Refresh the bundled events store from collect-state'), names.index('Build and publish AI'))

    def test_plan_b_kb_is_on_by_default_and_loaded_on_every_deploy(self):
        """기본값 false 였을 때 기본값 배포 한 번(2026-10-03 13:38)이 KB 를 조용히 껐고,
        적재는 손으로 했다 — 재계획은 200 을 내며 규칙 랭킹으로만 돌았다."""
        value = workflow('aws-deploy.yml')
        self.assertEqual(value['on']['workflow_dispatch']['inputs']['embedding_enabled']['default'], 'true')
        steps = value['jobs']['deploy']['steps']
        names = [s.get('name', '') for s in steps]
        load = steps[names.index('Load the Plan-B knowledge base')]
        # 입력을 그대로 보지 않고 workflow_config 가 정한 값(EFFECTIVE)을 본다 — 대상별 규칙이 한 곳에 모인다
        self.assertIn("steps.config.outputs.embedding_enabled == 'true'", load['if'])
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
        self.assertIn('EFFECTIVE_PUSH_MODE', sync['run'])

    def test_dialogue_inputs_keep_stored_values_unless_the_deployer_chooses(self):
        """스위치·배정의 기본값은 '유지'여야 다른 세션의 평소 배포가 켜고 끄지 않는다. 셸은 검증된 EFFECTIVE_* 만 읽는다."""
        value = workflow('aws-deploy.yml')
        inputs = value['on']['workflow_dispatch']['inputs']
        self.assertEqual(inputs['dialogue_orchestrator']['default'], 'keep')
        self.assertEqual(inputs['dialogue_orchestrator']['options'], ['keep', 'on', 'off'])
        self.assertEqual(inputs['llm_feature_models']['default'], '')
        sync = next(s for s in value['jobs']['deploy']['steps'] if s.get('name') == 'Synchronize runtime secrets and render nonsecret Helm values')
        for flag, name in (('--dialogue-orchestrator', 'EFFECTIVE_DIALOGUE_ORCHESTRATOR'), ('--llm-feature-models', 'EFFECTIVE_LLM_FEATURE_MODELS')):
            self.assertIn(flag, sync['run'])
            self.assertIn(name, sync['run'])
        self.assertNotIn('DIALOGUE_ORCHESTRATOR_INPUT', sync['run'])
        self.assertNotIn('LLM_FEATURE_MODELS_INPUT', sync['run'])
        self.assertNotIn('inputs.', sync['run'])  # 입력을 셸에 직접 끼우지 않는다(주입 방지)

    def test_runtime_switches_reach_only_the_secret_sync_step(self):
        """상황 감지 스위치(KEY=VALUE;…)는 비어 있으면 아무것도 안 한다 — 기본값 배포가 켜고 끄지 않는다. 입력은 그 스텝 env 로만 받고
        (잡 env·GITHUB_ENV 를 거치지 않는다) 비어 있지 않을 때만 플래그로 넘긴다. 형식·허용 키·값 검증은 sync-secrets 한 곳이다."""
        value = workflow('aws-deploy.yml')
        switches = value['on']['workflow_dispatch']['inputs']['runtime_switches']
        self.assertEqual((switches['type'], switches['required'], switches['default']), ('string', 'false', ''))
        for word in ('KEY=VALUE;', 'PLANB_SITUATION_SWEEP_ACCOUNT_IDS', 'HOLIDAY_CLOSURE_MODE', 'KEY='):
            self.assertIn(word, switches['description'])
        job = value['jobs']['deploy']
        sync = next(s for s in job['steps'] if s.get('name') == 'Synchronize runtime secrets and render nonsecret Helm values')
        self.assertEqual(sync['env']['RUNTIME_SWITCHES_INPUT'], '${{ inputs.runtime_switches }}')
        self.assertNotIn('RUNTIME_SWITCHES_INPUT', job['env'])
        self.assertIn('if [ -n "$RUNTIME_SWITCHES_INPUT" ]; then switch_args+=(--runtime-switches "$RUNTIME_SWITCHES_INPUT"); fi',
                      sync['run'])
        self.assertIn('"${switch_args[@]}"', sync['run'].split('runtime.py render-values')[0])  # sync-secrets 호출에 실린다
        self.assertNotIn('inputs.', sync['run'])
        others = [s for s in job['steps'] if s is not sync]
        self.assertFalse(any('runtime_switches' in str(s) or 'RUNTIME_SWITCHES' in str(s) for s in others))

    def test_deploy_target_drives_namespace_and_never_hardcodes_production(self):
        """개발 대상 런이 운영 네임스페이스를 건드리면 운영 파드 시크릿이 개발 값으로 덮인다(#1258 검수)."""
        value = workflow('aws-deploy.yml')
        self.assertEqual(value['on']['workflow_dispatch']['inputs']['target']['options'], ['prod', 'dev'])
        self.assertEqual(value['on']['workflow_dispatch']['inputs']['target']['default'], 'prod')
        env = value['jobs']['deploy']['env']
        # 인증서·주소는 workflow_config 가 골라 내보낸다 — 잡 env 에서 식으로 고르면 빈 개발 변수가 운영 값으로 떨어진다
        self.assertNotIn('ACM_CERTIFICATE_ARN', env)
        self.assertNotIn('API_HOSTNAME', env)
        self.assertEqual(env['DEV_TARGET_ACM_CERTIFICATE_ARN'], '${{ vars.DEV_TARGET_ACM_CERTIFICATE_ARN }}')
        self.assertEqual(env['PROD_ACM_CERTIFICATE_ARN'], '${{ vars.ACM_CERTIFICATE_ARN }}')
        sync = next(s for s in value['jobs']['deploy']['steps'] if s.get('name') == 'Synchronize runtime secrets and render nonsecret Helm values')
        self.assertIn('EFFECTIVE_PUSH_MODE', sync['run'])
        self.assertNotIn('PUSH_MODE_INPUT', sync['run'])
        text = (ROOT / '.github/workflows/aws-deploy.yml').read_text()
        self.assertNotIn('--namespace trippilot', text)
        self.assertNotIn('-n trippilot ', text)
        self.assertNotIn('values-$DEPLOY_ENVIRONMENT', text)
        # 모든 runtime.py 호출이 대상을 넘긴다(여러 줄 명령이라 횟수로 맞춘다)
        self.assertEqual(text.count('python3 deploy/eks/runtime.py'), text.count('--target "$DEPLOY_TARGET"'))

    def test_credentials_are_refreshed_before_the_long_loads(self):
        """첫 자격 증명(2시간)은 잡 시작 직후에 받는다 — KB(최대 95분)·POI(25분) 적재 뒤 cleanup-db 가 만료로
        실패하면 RDS 관리자 비밀번호 Secret 이 클러스터에 남는다(#1296 재검수)."""
        steps = workflow('aws-deploy.yml')['jobs']['deploy']['steps']
        names = [s.get('name', '') for s in steps]
        for load in ('Load the Plan-B knowledge base', 'Load the POI shared document into the backend'):
            with self.subTest(load=load):
                before = steps[names.index(load) - 1]
                self.assertTrue(before['name'].startswith('Refresh AWS credentials'))
                self.assertIn('configure-aws-credentials', before['uses'])
                self.assertEqual(before['with']['role-duration-seconds'], '7200')

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


    # ── 운영 배포 규칙(TRIP-1659) ──
    def test_production_deploys_must_declare_release_or_hotfix(self):
        value = workflow('aws-deploy.yml')
        inputs = value['on']['workflow_dispatch']['inputs']
        self.assertEqual(inputs['deploy_kind']['options'], ['none', 'release', 'hotfix'])
        self.assertEqual(inputs['deploy_kind']['default'], 'none')  # 기본값 그대로 눌러서는 운영에 나가지 않는다
        self.assertEqual(inputs['dev_sleep_after']['default'], 'true')  # 깜빡해도 비용이 새지 않는 쪽이 기본
        env = value['jobs']['deploy']['env']
        for name, source in (('DEPLOY_KIND', 'deploy_kind'), ('DEPLOY_REF', 'deploy_ref'),
                             ('DEPLOY_REASON', 'deploy_reason'), ('DEV_SLEEP_AFTER', 'dev_sleep_after')):
            self.assertEqual(env[name], '${{ inputs.%s }}' % source)

    def test_release_gate_runs_after_the_declaration_check_and_before_any_aws_credentials(self):
        job = workflow('aws-deploy.yml')['jobs']['deploy']
        steps = job['steps']
        names = [s.get('name', '') for s in steps]
        gate_index = names.index('Require a validated dev run for production releases')
        credentials = next(i for i, s in enumerate(steps) if str(s.get('uses', '')).startswith('aws-actions/configure-aws-credentials'))
        self.assertLess(names.index('Validate environment and branch before AWS access'), gate_index)
        self.assertLess(gate_index, credentials)
        gate_step = steps[gate_index]
        self.assertIn("steps.config.outputs.target == 'prod'", gate_step['if'])
        # 선언 검사와 같은 조건(운영 apply) — 앱 배포 여부로 좁히면 인프라만의 release apply 가 검증 없이 나간다
        self.assertIn("steps.config.outputs.mode == 'apply'", gate_step['if'])
        self.assertNotIn('deploy_application', gate_step['if'])
        self.assertEqual(gate_step['env']['DEPLOY_KIND'], '${{ steps.config.outputs.deploy_kind }}')  # 검증된 값만 쓴다
        self.assertEqual(gate_step['run'], 'python3 infra/scripts/deploy_gate.py')
        self.assertEqual(job['permissions'], {'contents': 'read', 'id-token': 'write', 'actions': 'read'})  # 쓰기 권한은 늘리지 않는다

    def test_run_name_matches_what_the_gate_looks_for(self):
        run_name = workflow('aws-deploy.yml')['run-name']
        rendered = (run_name.replace('${{ inputs.target }}', 'dev').replace('${{ inputs.mode }}', 'apply')
                    .replace('${{ inputs.deploy_application }}', 'true').replace('${{ inputs.deploy_kind }}', 'none'))
        self.assertNotIn('${{', rendered)
        module = Path(__file__).resolve().parents[1] / 'scripts' / 'deploy_gate.py'
        spec = importlib.util.spec_from_file_location('deploy_gate_contract', module)
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        self.assertTrue(rendered.startswith(gate.DEV_TITLE))
        self.assertIn('kind=', rendered)  # 런 목록에서 어떤 선언으로 나갔는지 보인다

    def test_dev_workloads_wake_before_helm_and_sleep_only_after_everything_succeeded(self):
        steps = workflow('aws-deploy.yml')['jobs']['deploy']['steps']
        names = [s.get('name', '') for s in steps]
        wake_index = names.index('Wake sleeping dev workloads')
        self.assertLess(wake_index, names.index('Deploy and wait for healthy workloads'))
        wake = steps[wake_index]
        self.assertIn("steps.config.outputs.target == 'dev'", wake['if'])
        self.assertIn('-n "$NAMESPACE"', wake['run'])
        self.assertIn('--replicas=1', wake['run'])
        self.assertIn('embedding', wake['run'])  # 임베딩을 끈 배포는 임베딩을 올리지 않는다
        sleep = steps[names.index('Put the dev workloads to sleep')]
        self.assertTrue(sleep['if'].startswith('success()'))  # 실패하면 원인을 보려고 켜 둔다
        self.assertIn("steps.config.outputs.dev_sleep == 'true'", sleep['if'])
        self.assertIn('-n "$NAMESPACE"', sleep['run'])  # 네임스페이스는 대상이 정한 값만 — 하드코딩 금지
        self.assertIn('--replicas=0', sleep['run'])
        self.assertLess(names.index('Load the POI shared document into the backend'), names.index('Put the dev workloads to sleep'))
        self.assertLess(names.index('Put the dev workloads to sleep'), names.index('Deployment summary'))


if __name__ == '__main__':
    unittest.main()
