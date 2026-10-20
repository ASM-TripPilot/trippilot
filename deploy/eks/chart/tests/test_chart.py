"""Render real Helm templates and assert deployment/security contracts (no cluster needed)."""
import pathlib
import shutil
import subprocess
import unittest

import yaml

CHART = pathlib.Path(__file__).resolve().parents[1]


def render(environment="dev", embedding=False, overrides=None):
    result = subprocess.run(
        [shutil.which("helm") or "helm", "template", "trippilot", str(CHART),
         "--namespace", f"trippilot-{environment}", "-f", str(CHART / f"values-{environment}.yaml"),
         "--set", "images.backend.repository=example/backend,images.backend.tag=sha123",
         "--set", "images.ai.repository=example/ai,images.ai.tag=sha123",
         "--set", "images.embedding.repository=example/embedding,images.embedding.tag=sha123",
         "--set", "config.databaseHost=database.example.internal,config.redisHost=redis.example.internal",
         "--set", "gateway.certificateArn=arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789012",
         "--set", f"embedding.enabled={str(embedding).lower()}",
         "--set-string", "rolloutNonce=run-123"] + (overrides or []),
        check=True, text=True, capture_output=True,
    )
    return [item for item in yaml.safe_load_all(result.stdout) if item]


def render_default(overrides=None):
    """환경 파일 **없이** 차트 기본값만 렌더한다 — `values.yaml` 의 성질을 보는 자리."""
    result = subprocess.run(
        [shutil.which("helm") or "helm", "template", "trippilot", str(CHART),
         "--namespace", "trippilot-dev",
         "--set", "images.backend.repository=example/backend,images.backend.tag=sha123",
         "--set", "images.ai.repository=example/ai,images.ai.tag=sha123",
         "--set", "images.embedding.repository=example/embedding,images.embedding.tag=sha123",
         "--set", "config.databaseHost=database.example.internal,config.redisHost=redis.example.internal",
         "--set", "gateway.certificateArn=arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789012",
         "--set-string", "rolloutNonce=run-123"] + (overrides or []),
        check=True, text=True, capture_output=True,
    )
    return [item for item in yaml.safe_load_all(result.stdout) if item]


class ChartTests(unittest.TestCase):
    def test_rolling_deployments_allow_long_ai_requests_to_drain(self):
        documents = render("prd")
        deployments = {item["metadata"]["name"]: item for item in documents if item["kind"] == "Deployment"}
        for name in ("backend", "ai", "gateway"):
            self.assertEqual(deployments[name]["spec"]["template"]["spec"]["terminationGracePeriodSeconds"], 660)
        backend = deployments["backend"]["spec"]["template"]["spec"]["containers"][0]
        env = {item["name"]: item for item in backend["env"]}
        self.assertEqual(env["SPRING_LIFECYCLE_TIMEOUT_PER_SHUTDOWN_PHASE"]["value"], "630s")
        ai = deployments["ai"]["spec"]["template"]["spec"]["containers"][0]
        flag = ai["args"].index("--timeout-graceful-shutdown")
        self.assertEqual(ai["args"][flag + 1], "630")

    def test_ai_workers_are_not_killed_while_still_starting(self):
        """기본 5초 핑 시한이면 CPU 가 밀린 노드에서 기동 중인 작업 프로세스가 죽고 다시 뜨기를 되풀이한다(10-18 개발 롤아웃 12회 →
        스모크 기억 삭제 500). 여러 작업 프로세스일 때만 감독자가 있으므로 차트 args 에만 둔다."""
        for environment in ("dev", "prd"):
            ai = next(item for item in render(environment)
                      if item["kind"] == "Deployment" and item["metadata"]["name"] == "ai")
            args = ai["spec"]["template"]["spec"]["containers"][0]["args"]
            self.assertIn("--workers", args)
            self.assertEqual(args[args.index("--timeout-worker-healthcheck") + 1], "30")

    def test_ai_disables_uvicorn_access_log_everywhere_it_is_launched(self):
        """메모리 경계(`DELETE|GET /ai/v1/dialogue/memory?account_ref=…`)는 계정 참조를 **쿼리 문자열**로 받는다. uvicorn 기본
        access log 는 쿼리까지 포함한 request_line 을 stdout 에 찍어 CloudWatch 로 나간다(SEC-U8-06·BR-AO-08③ 위반).
        요청 관측은 TraceMiddleware 의 `http_request`(path 만)가 이미 한다 — 차트 args 와 이미지 CMD(compose·단독 실행)가
        같은 플래그를 가져야 한다(Dockerfile 머리말의 "이미지 단독 실행과 배포가 다른 것을 돌리지 않는다")."""
        for environment in ("dev", "prd"):
            documents = render(environment)
            ai = next(item for item in documents if item["kind"] == "Deployment" and item["metadata"]["name"] == "ai")
            self.assertIn("--no-access-log", ai["spec"]["template"]["spec"]["containers"][0]["args"])
        dockerfile = (CHART.parents[2] / "ai" / "Dockerfile").read_text(encoding="utf-8")
        cmd = next(line for line in dockerfile.splitlines() if line.startswith("CMD "))
        self.assertIn('"--no-access-log"', cmd)
        nginx = next(item for item in documents if item["kind"] == "ConfigMap")["data"]["nginx.conf"]
        self.assertIn("worker_shutdown_timeout 630s;", nginx)
        gateway = next(item for item in documents if item["kind"] == "Service" and item["metadata"]["name"] == "gateway")
        attributes = gateway["metadata"]["annotations"]["service.beta.kubernetes.io/aws-load-balancer-target-group-attributes"]
        self.assertIn("deregistration_delay.timeout_seconds=630", attributes)
        self.assertIn("deregistration_delay.connection_termination.enabled=false", attributes)

    def test_invalid_certificate_endpoint_and_prd_replica_count_fail_closed(self):
        for override in (
            "gateway.certificateArn=not-an-arn",
            "config.databaseHost=jdbc:postgresql://untrusted",
            "backend.replicas=1",
        ):
            with self.subTest(override=override), self.assertRaises(subprocess.CalledProcessError):
                render("prd", overrides=["--set", override])

    def test_only_tls_gateway_is_public_and_internal_paths_are_denied(self):
        documents = render()
        services = {item["metadata"]["name"]: item for item in documents if item["kind"] == "Service"}
        public = [item for item in services.values() if item["spec"]["type"] == "LoadBalancer"]
        self.assertEqual(len(public), 1)
        self.assertEqual(public[0]["spec"]["loadBalancerClass"], "eks.amazonaws.com/nlb")
        self.assertEqual([port["port"] for port in public[0]["spec"]["ports"]], [443])
        self.assertEqual(services["backend"]["spec"]["type"], "ClusterIP")
        self.assertEqual(services["ai"]["spec"]["type"], "ClusterIP")
        config = next(item for item in documents if item["kind"] == "ConfigMap")["data"]["nginx.conf"]
        self.assertIn("location = /api {", config)
        self.assertIn("location /api/ {", config)
        self.assertIn("location / { return 404; }", config)
        self.assertIn("proxy_set_header X-Forwarded-Proto https;", config)

    def assert_pdb_floors(self, documents, label=""):
        """**PDB 가 있으면 그 컴포넌트의 복제본 바닥이 minAvailable+1 이상이어야 한다.**

        `minAvailable: 1` 에 복제본이 1 이면 자발적 축출이 **영구히** 거부되어 노드
        통합·교체가 멈춘다(EKS Auto 의 Karpenter 가 수시로 드레인한다). HPA 가 수를 쥔
        컴포넌트는 Deployment 에 `replicas` 가 없으므로 바닥을 `minReplicas` 로 센다.

        **헬퍼로 뺀 이유**: 오버라이드로 렌더하는 테스트(`--set ai.autoscaling.minReplicas=1`)가
        이 불변식을 위반하는 매니페스트를 만들면서 검사하지 않았다. 렌더하는 모든 자리에서
        같은 질문을 하게 만든다.
        """
        pdbs = [item for item in documents if item["kind"] == "PodDisruptionBudget"]
        floors = {item["spec"]["scaleTargetRef"]["name"]: item["spec"]["minReplicas"]
                  for item in documents if item["kind"] == "HorizontalPodAutoscaler"}
        counts = {item["metadata"]["name"]: item["spec"].get("replicas")
                  for item in documents if item["kind"] == "Deployment"}
        for pdb in pdbs:
            name = pdb["metadata"]["name"]
            floor = floors.get(name, counts.get(name))
            self.assertIsNotNone(floor, f"{label}/{name}: 복제본 바닥을 정하는 곳이 없다")
            self.assertGreaterEqual(
                floor, pdb["spec"]["minAvailable"] + 1,
                f"{label}/{name}: PDB minAvailable={pdb['spec']['minAvailable']} 인데 "
                f"복제본 바닥이 {floor} 다 — 드레인이 영구히 막힌다")

    def test_environment_replicas_secrets_and_pod_security(self):
        # dev 도 2 다(2026-10-04) — 스토어 출시를 dev 스택으로 받기로 해서 노드 드레인·
        # 장애를 견뎌야 한다. 롤아웃은 원래 무중단이었다(maxUnavailable 0 · maxSurge 1).
        for environment, expected in [("dev", 2), ("prd", 2)]:
            documents = render(environment)
            deployments = [item for item in documents if item["kind"] == "Deployment"]
            self.assertEqual(len(deployments), 3)
            for deployment in deployments:
                # HPA 가 켜진 컴포넌트는 `replicas` 를 렌더하지 않는다(BR-MLO-15) —
                # dev 의 ai 가 그렇다. 둘 다 실으면 helm upgrade 가 HPA 가 정한 수를
                # 되돌리므로, 여기서 고정 수를 기대하면 안 되는 쪽이 맞다.
                scaled = {item["spec"]["scaleTargetRef"]["name"] for item in documents
                          if item["kind"] == "HorizontalPodAutoscaler"}
                if deployment["metadata"]["name"] in scaled:
                    self.assertNotIn("replicas", deployment["spec"])
                else:
                    self.assertEqual(deployment["spec"]["replicas"], expected)
                pod = deployment["spec"]["template"]
                self.assertEqual(pod["metadata"]["annotations"]["trippilot.io/rollout-nonce"], "run-123")
                self.assertFalse(pod["spec"]["automountServiceAccountToken"])
                container = pod["spec"]["containers"][0]
                self.assertTrue(container["securityContext"]["readOnlyRootFilesystem"])
                self.assertFalse(container["securityContext"]["allowPrivilegeEscalation"])
                self.assertNotIn("envFrom", container)
            # Only the AI pods carry the named account that Pod Identity binds to Bedrock;
            # the others stay on default with no token mounted.
            accounts = {item["metadata"]["name"]: item["spec"]["template"]["spec"].get("serviceAccountName") for item in deployments}
            self.assertEqual(accounts.pop("ai"), "ai")
            self.assertTrue(all(account is None for account in accounts.values()))
            service_account = next(item for item in documents if item["kind"] == "ServiceAccount")
            self.assertEqual(service_account["metadata"]["name"], "ai")
            self.assertFalse(service_account["automountServiceAccountToken"])
            backend = next(item for item in deployments if item["metadata"]["name"] == "backend")
            env = {item["name"]: item for item in backend["spec"]["template"]["spec"]["containers"][0]["env"]}
            self.assertIn("sslmode=require", env["DB_URL"]["value"])
            self.assertEqual(env["SPRING_DATA_REDIS_SSL_ENABLED"]["value"], "true")
            self.assertEqual(env["JWT_REQUIRE_CONFIGURED_KEY"]["value"], "true")
            self.assertEqual(env["SERVICE_AUTH_REQUIRE_TOKEN"]["value"], "true")
            self.assertEqual(env["TRIPPILOT_ASYNC_AWAIT_TERMINATION_SECONDS"]["value"], "630")
            self.assertEqual(env["DB_MIGRATE_PASSWORD"]["valueFrom"]["secretKeyRef"]["name"], "trippilot-database")
            self.assertEqual(env["JWT_SIGNING_KEY"]["valueFrom"]["secretKeyRef"]["name"], "trippilot-backend")
            pdbs = [item for item in documents if item["kind"] == "PodDisruptionBudget"]
            self.assertEqual(len(pdbs), 3)
            self.assert_pdb_floors(documents, environment)

    def test_embedding_is_opt_in_but_the_vector_dsn_is_always_wired(self):
        """임베딩(파드·PROVIDER·BASE_URL)은 배포 입력이 켜고 끄지만, ai_kb DSN 은 **항상** 꽂힌다 —
        도우미 세션 메모리(dialogue_memory, assistant-orchestrator FD DE §4)가 그 DB 에 살아서다. 종전처럼
        embedding.enabled 안에 두면 임베딩을 끈 배포에서 메모리가 조용히 프로세스 안(InMemory)으로 떨어진다.
        시크릿 값은 runtime_secrets.runtime_manifests 가 같은 조건(무조건)으로 합성한다 — 둘이 어긋나면
        optional 아닌 secretKeyRef 라 파드가 CreateContainerConfigError 로 멈춘다."""
        for enabled in (False, True):
            documents = render("prd", enabled)
            deployments = {item["metadata"]["name"]: item for item in documents if item["kind"] == "Deployment"}
            self.assertEqual("embedding" in deployments, enabled)
            ai_container = deployments["ai"]["spec"]["template"]["spec"]["containers"][0]
            env = {item["name"]: item for item in ai_container["env"]}
            self.assertEqual(env["TRIPPILOT_VECTOR_DB_URL"]["valueFrom"]["secretKeyRef"],
                             {"name": "trippilot-ai", "key": "TRIPPILOT_VECTOR_DB_URL", "optional": False})
            self.assertEqual("TRIPPILOT_EMBEDDING_PROVIDER" in env, enabled)
            self.assertEqual("TRIPPILOT_EMBEDDING_BASE_URL" in env, enabled)
            self.assertEqual(ai_container["command"][0], "/app/.venv/bin/uvicorn")
            if enabled:
                embedding = deployments["embedding"]
                self.assertEqual(embedding["spec"]["replicas"], 1)
                resources = embedding["spec"]["template"]["spec"]["containers"][0]["resources"]
                self.assertEqual(resources["requests"]["memory"], "5Gi")
                self.assertEqual(resources["limits"]["memory"], "6Gi")
                policy = next(item for item in documents if item["kind"] == "NetworkPolicy" and item["metadata"]["name"] == "embedding")
                sources = policy["spec"]["ingress"][0]["from"]
                # ai 파드 + 배포 워크플로의 KB 적재 Job(runtime_kb.py) — 그 밖은 막는다
                self.assertEqual(len(sources), 2)
                self.assertEqual(sources[0]["podSelector"]["matchLabels"]["app.kubernetes.io/component"], "ai")
                self.assertEqual(sources[1]["podSelector"]["matchLabels"], {"app.kubernetes.io/name": "trippilot-kb-load"})

    def test_autoscaling_replaces_static_replicas_and_skips_embedding(self):
        # `minReplicas` 는 2 를 쓴다 — 이 테스트가 보려는 것은 "HPA 가 정적 replicas 를
        # 대체하는가"이고, 1 로 두면 PDB 가 켜진 dev 값 위에서 **드레인이 영구히 막히는
        # 매니페스트**를 만들어 버린다(assert_pdb_floors 가 그것을 잡는다). 오버라이드가
        # 먹는지는 maxReplicas=4 가 증명한다.
        documents = render(embedding=True, overrides=[
            "--set", "ai.autoscaling.enabled=true",
            "--set", "ai.autoscaling.minReplicas=2",
            "--set", "ai.autoscaling.maxReplicas=4",
        ])
        scalers = {item["metadata"]["name"]: item
                   for item in documents if item["kind"] == "HorizontalPodAutoscaler"}
        self.assertEqual(set(scalers), {"ai"})
        target = scalers["ai"]["spec"]["scaleTargetRef"]
        self.assertEqual((target["kind"], target["name"]), ("Deployment", "ai"))
        self.assertEqual(scalers["ai"]["spec"]["maxReplicas"], 4)
        deployments = {item["metadata"]["name"]: item
                       for item in documents if item["kind"] == "Deployment"}
        # HPA 가 소유하면 Deployment 는 replicas 를 싣지 않는다 — 둘 다 실으면
        # 다음 helm upgrade 가 HPA 가 정한 수를 되돌린다.
        self.assertNotIn("replicas", deployments["ai"]["spec"])
        self.assertEqual(deployments["embedding"]["spec"]["replicas"], 1)
        # dev 값 위에 minReplicas=1 을 덮었다 — PDB 가 켜진 환경이므로 불변식이 걸린다.
        self.assert_pdb_floors(documents, "autoscaling-override")

    def test_autoscaling_is_off_in_the_chart_default(self):
        """차트 기본값은 꺼짐이다 — 켜는 것은 **환경 파일의 선택**이어야 한다.

        `values.yaml` 만으로 렌더하면 HPA 가 하나도 없고 Deployment 가 수를 들고 있다.
        metrics-server 가 없는 클러스터에 차트를 올려도 안전해야 하기 때문이다(목표치가
        `<unknown>` 인 채 HPA 가 replica 소유권만 가져가는 상태를 기본값으로 둘 수 없다).
        환경별로 켜진 것은 아래 `test_dev_enables_ai_autoscaling` 이 본다.
        """
        documents = render_default()
        self.assertEqual(
            [item for item in documents if item["kind"] == "HorizontalPodAutoscaler"], [])
        deployments = {item["metadata"]["name"]: item
                       for item in documents if item["kind"] == "Deployment"}
        self.assertEqual(deployments["ai"]["spec"]["replicas"], 1)

    def test_dev_enables_ai_autoscaling(self):
        """dev 는 ai HPA 를 켠다 — prd 보다 먼저 동작을 보는 자리다.

        켤 수 있는 전제는 `infra/terraform/stack/eks.tf` 의 `aws_eks_addon.metrics_server`
        다. 그 애드온 없이 이 값을 켜면 목표치가 `<unknown>` 이 되고, Deployment 가
        `replicas` 를 렌더하지 않으므로 **아무도 수를 정하지 않는 상태**가 된다.
        """
        documents = render("dev")
        scalers = {item["metadata"]["name"]: item for item in documents
                   if item["kind"] == "HorizontalPodAutoscaler"}
        self.assertEqual(set(scalers), {"ai"})
        # 2026-10-04: 바닥을 2 로 올렸다. autoscaling 과 다른 축이다 — 부하 대응이 아니라
        # PDB 가 성립하려면(minAvailable 1) 복제본이 2 이상이어야 하기 때문이다.
        self.assertEqual(scalers["ai"]["spec"]["minReplicas"], 2)
        self.assertEqual(scalers["ai"]["spec"]["maxReplicas"], 3)
        target = scalers["ai"]["spec"]["scaleTargetRef"]
        self.assertEqual((target["kind"], target["name"]), ("Deployment", "ai"))

    def test_prd_keeps_fixed_replicas_until_a_human_turns_it_on(self):
        """prd 는 아직 고정 2 다 — 켜는 것은 사람의 판단으로 남긴다.

        prd 배포는 리뷰어 승인을 거치므로, 값만 미리 머지해 두면 다음 prd 배포가
        조용히 동작을 바꾼다. dev 실측 뒤에 따로 켠다(TRIP-966).
        """
        documents = render("prd")
        self.assertEqual(
            [item for item in documents if item["kind"] == "HorizontalPodAutoscaler"], [])
        deployments = {item["metadata"]["name"]: item
                       for item in documents if item["kind"] == "Deployment"}
        self.assertEqual(deployments["ai"]["spec"]["replicas"], 2)

    def test_in_cluster_reminder_serving_was_withdrawn(self):
        # GPU 파드로 리마인드 모델을 직접 서빙하는 구성은 접었다(2026-10-01) — 운영
        # 경로는 Bedrock Custom Model Import 다. 값만 되살아나면 템플릿 없이 조용히
        # 아무 일도 안 일어나므로 스키마가 거부해야 한다.
        with self.assertRaises(subprocess.CalledProcessError):
            render(overrides=["--set", "reminderLlm.enabled=true"])

    def test_embedding_autoscaling_key_is_rejected(self):
        # 임베딩은 파드당 4.2 GiB·모델 로드 수십 초라 늘려도 늦다. 스키마가 막는다.
        with self.assertRaises(subprocess.CalledProcessError):
            render(embedding=True, overrides=["--set", "embedding.autoscaling.enabled=true"])
    def test_ai_validates_the_inbound_service_token(self):
        """AI 경계도 X-Service-Token 을 **검사**해야 한다 — 보내는 것만으로는 안 열린다.

        AI 는 두 env 를 쓴다. `TRIPPILOT_SERVICE_AUTH_TOKEN`(접두어 있음)은 백엔드를 부를 때
        싣는 **발신용**이고, 인바운드 검증 미들웨어는 접두어 없는 `SERVICE_AUTH_TOKEN` 을
        읽는다(`ai/src/trippilot/api/middleware.py`). 차트가 발신용만 주던 동안 AI 경계는
        클러스터 안에서 무인증으로 열려 있었다 — 백엔드는 이미 헤더를 보내고 있었다.

        `/health`·`/` 는 미들웨어가 면제하므로 배포 스모크와 컨테이너 헬스체크는 안 깨진다.
        """
        for environment in ("dev", "prd"):
            documents = render(environment)
            ai = next(item for item in documents
                      if item["kind"] == "Deployment" and item["metadata"]["name"] == "ai")
            env = {item["name"]: item
                   for item in ai["spec"]["template"]["spec"]["containers"][0]["env"]}
            inbound = env["SERVICE_AUTH_TOKEN"]["valueFrom"]["secretKeyRef"]
            outbound = env["TRIPPILOT_SERVICE_AUTH_TOKEN"]["valueFrom"]["secretKeyRef"]
            # 같은 공유 시크릿의 같은 키 — 값이 갈리면 백엔드 호출이 전부 401 이 된다.
            self.assertEqual(inbound["name"], "trippilot-shared")
            self.assertEqual(inbound["key"], "SERVICE_AUTH_TOKEN")
            self.assertEqual(inbound, outbound)
            # fail-open 금지: 토큰이 없으면 조용히 열리는 대신 기동이 실패한다.
            self.assertEqual(env["SERVICE_AUTH_REQUIRE_TOKEN"]["value"], "true")

    def test_backend_receives_affiliate_switch_from_secret(self):
        """제휴 스위치 4종은 backend Secret 에서 와야 한다 — 배선이 빠지면 조용히 폴백이다.

        시크릿에 AFFILIATE_MODE=tripcom + TRIPCOM 3종을 넣어도 차트가 env 로 안 실어 주면
        validate_groups 는 통과하고 파드도 뜨는데, yml 기본 fallback 으로 돌아 수수료만
        조용히 샌다(TRIP-850 에서 실측한 구멍). optional 이라 값이 없어도 기동은 안 막는다.
        """
        for environment in ("dev", "prd"):
            documents = render(environment)
            backend = next(item for item in documents
                           if item["kind"] == "Deployment" and item["metadata"]["name"] == "backend")
            env = {item["name"]: item
                   for item in backend["spec"]["template"]["spec"]["containers"][0]["env"]}
            # 생성 상한 2종(TRIP-1314)도 같은 길이다 — 빠지면 등록한 개발자 계정이 조용히 상한에 걸린다.
            for name in ("AFFILIATE_MODE", "TRIPCOM_ALLIANCE_ID", "TRIPCOM_SID", "TRIPCOM_AD_ID",
                         "ITINERARY_GENERATION_DAILY_LIMIT", "ITINERARY_GENERATION_LIMIT_EXEMPT_ACCOUNT_IDS",
                         # 카카오 앱 ID(TRIP-1317) — 빠지면 시크릿에 넣어도 발급 앱 대조가 조용히 꺼진 채 돈다.
                         "KAKAO_APP_ID",
                         # 도우미 해석 스위치(U8) — 빠지면 시크릿의 off 가 파드에 안 닿아 운영이 앱 기본값(fake)으로 뜬다.
                         "ASSISTANT_INTERPRET_MODE",
                         # U10 킬 스위치 — 빠지면 시크릿에 false 를 넣어도 자동 기록이 안 꺼진다.
                         "LOCATION_AUTOMATION_ENABLED",
                         # Plan-B 상황 감시 4종(situation-awareness §7) — 빠지면 시크릿에 on 을 넣어도 스윕이 기본 off 로 돈다.
                         "PLANB_SITUATION_SWEEP", "PLANB_SITUATION_HORIZON", "PLANB_SITUATION_SWEEP_ACCOUNT_IDS",
                         "PLANB_PREPARED_REPLAN"):
                ref = env[name]["valueFrom"]["secretKeyRef"]
                self.assertEqual(ref["name"], "trippilot-backend")
                self.assertEqual(ref["key"], name)
                self.assertTrue(ref["optional"])


    def test_backend_calls_the_ai_opportunity_path_by_fixed_env(self):
        """기회 카드(situation-awareness DEC-SA-8)는 차트 고정 env 다 — 시크릿·허용목록을 거치지 않는다.

        앱 기본은 off 라 이 줄이 빠지면 배포가 조용히 카드 없이 돈다(오류도 로그도 없다). 시크릿으로 두지 않는 이유:
        켜고 끌 운영 판단이 없는 조회형 경로이고(구 앱은 이 BE 경로를 부르지 않는다), 시크릿 키는 두 번 배포 규칙을 탄다.
        주소는 일정·회고 경계와 같은 AI_URL 을 읽는다 — 비면 컨테이너가 자기 자신(localhost)을 부른다.
        """
        for environment in ("dev", "prd"):
            documents = render(environment)
            backend = next(item for item in documents
                           if item["kind"] == "Deployment" and item["metadata"]["name"] == "backend")
            env = {item["name"]: item for item in backend["spec"]["template"]["spec"]["containers"][0]["env"]}
            self.assertEqual(env["AI_OPPORTUNITY_MODE"], {"name": "AI_OPPORTUNITY_MODE", "value": "http"})
            self.assertEqual(env["AI_URL"]["value"], "http://ai:8000")

    def test_ai_receives_dialogue_orchestrator_switches_from_secret(self):
        """도우미 오케스트레이터 스위치 2종(assistant-orchestrator 1단계)은 ai Secret 에서 와야 한다 —
        runtime_secrets allowlist 에 넣어도 차트가 env 로 안 실어 주면 시크릿의 on 이 파드에 닿지 않아
        종전 DialogueInterpreter 경로로 조용히 돈다(AFFILIATE_MODE 가 겪은 것과 같은 구멍, TRIP-850).
        optional 이라 값이 없어도 기동은 안 막는다(기본 off · 섀도 1.0 은 main.py 가 정한다)."""
        for environment in ("dev", "prd"):
            documents = render(environment)
            ai = next(item for item in documents
                      if item["kind"] == "Deployment" and item["metadata"]["name"] == "ai")
            env = {item["name"]: item for item in ai["spec"]["template"]["spec"]["containers"][0]["env"]}
            for name in ("TRIPPILOT_DIALOGUE_ORCHESTRATOR", "TRIPPILOT_DIALOGUE_SHADOW_RATE"):
                self.assertEqual(env[name]["valueFrom"]["secretKeyRef"],
                                 {"name": "trippilot-ai", "key": name, "optional": True})


    def test_ai_receives_holiday_closure_mode_from_secret(self):
        """공휴일 휴무 스위치(상황 감지 H1)는 ai Secret 에서 와야 한다 — allowlist 에 넣어도 차트가 env 로 안 실어 주면
        시크릿의 on 이 파드에 닿지 않아 조용히 off 로 돈다(위 도우미 스위치와 같은 구멍). optional 이라 값이 없어도
        기동은 안 막는다(기본 off 는 main.py 가 정한다)."""
        for environment in ("dev", "prd"):
            documents = render(environment)
            ai = next(item for item in documents
                      if item["kind"] == "Deployment" and item["metadata"]["name"] == "ai")
            env = {item["name"]: item for item in ai["spec"]["template"]["spec"]["containers"][0]["env"]}
            self.assertEqual(env["HOLIDAY_CLOSURE_MODE"]["valueFrom"]["secretKeyRef"],
                             {"name": "trippilot-ai", "key": "HOLIDAY_CLOSURE_MODE", "optional": True})


class RequestSizingTests(unittest.TestCase):
    def test_requests_follow_measured_usage(self):
        """2026-10-16 실측으로 요청을 맞췄다 — CPU 요청이 커지면 Karpenter 가 다시 CPU 형 노드를 산다,
        메모리 요청이 정점보다 작으면 노드 메모리가 빠듯할 때 먼저 쫓겨난다. 상한은 정점을 덮어야 한다."""
        deployments = {item["metadata"]["name"]: item for item in render("dev", embedding=True) if item["kind"] == "Deployment"}
        expected = {"backend": ("200m", "1280Mi", "2"), "ai": ("200m", "640Mi", "2"), "embedding": ("1", "5Gi", "2")}
        for name, (cpu, memory, cpu_limit) in expected.items():
            with self.subTest(name=name):
                resources = deployments[name]["spec"]["template"]["spec"]["containers"][0]["resources"]
                self.assertEqual((resources["requests"]["cpu"], resources["requests"]["memory"], resources["limits"]["cpu"]),
                                 (cpu, memory, cpu_limit))


class DevTargetValuesTests(unittest.TestCase):
    def test_dev_target_is_small_and_never_blocks_drains(self):
        """개발 대상은 운영과 같은 노드에 올라간다 — 복제본 1·HPA·PDB 없음·임베딩 없음. 복제본 1 에 PDB 가 걸리면
        드레인이 영구히 막혀 운영 노드 교체까지 멈춘다(values-dev.yaml 주석)."""
        documents = render("dev-target")
        kinds = [item["kind"] for item in documents]
        self.assertNotIn("PodDisruptionBudget", kinds)
        self.assertNotIn("HorizontalPodAutoscaler", kinds)
        deployments = {item["metadata"]["name"]: item for item in documents if item["kind"] == "Deployment"}
        self.assertEqual(set(deployments), {"backend", "ai", "gateway"})
        for name, deployment in deployments.items():
            with self.subTest(name=name):
                self.assertEqual(deployment["spec"]["replicas"], 1)
                for container in deployment["spec"]["template"]["spec"]["containers"]:
                    self.assertIn("memory", container["resources"]["limits"])

    def test_dev_target_ai_reserves_one_core(self):
        """개발 대상 AI 만 CPU 요청 1코어(10-19) — 200m 에선 붐비는 노드에서 조립이 진척 0 으로 멈췄다. 메모리 요청·상한은
        기본값을 그대로 물려받아야 한다(요청만 덮어도 limits 가 빠지지 않는지)."""
        deployments = {item["metadata"]["name"]: item for item in render("dev-target") if item["kind"] == "Deployment"}
        resources = deployments["ai"]["spec"]["template"]["spec"]["containers"][0]["resources"]
        self.assertEqual(resources["requests"], {"cpu": "1", "memory": "640Mi"})
        self.assertEqual(resources["limits"], {"cpu": "2", "memory": "2Gi"})

    def test_dev_target_embedding_follows_the_deploy_input_with_one_replica(self):
        """개발 서버도 Plan-B KB 를 쓴다(10-15) — 켜면 임베딩 1개, 드레인을 막는 PDB·HPA 는 여전히 없다."""
        documents = render("dev-target", embedding=True)
        deployments = {item["metadata"]["name"]: item for item in documents if item["kind"] == "Deployment"}
        self.assertEqual(deployments["embedding"]["spec"]["replicas"], 1)
        kinds = [item["kind"] for item in documents]
        self.assertNotIn("PodDisruptionBudget", kinds)
        self.assertNotIn("HorizontalPodAutoscaler", kinds)


if __name__ == "__main__":
    unittest.main()
