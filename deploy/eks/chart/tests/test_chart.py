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
            # **PDB 가 있으면 그 컴포넌트의 복제본은 2 이상이어야 한다.** `minAvailable: 1` 에
            # 복제본이 1 이면 자발적 축출이 **영구히** 거부되어 노드 통합·교체가 멈춘다
            # (EKS Auto 의 Karpenter 가 수시로 드레인한다). HPA 가 수를 쥔 컴포넌트는
            # `replicas` 가 없으므로 그쪽 바닥은 minReplicas 로 센다.
            floors = {item["spec"]["scaleTargetRef"]["name"]: item["spec"]["minReplicas"]
                      for item in documents if item["kind"] == "HorizontalPodAutoscaler"}
            counts = {item["metadata"]["name"]: item["spec"].get("replicas")
                      for item in documents if item["kind"] == "Deployment"}
            for pdb in pdbs:
                name = pdb["metadata"]["name"]
                floor = floors.get(name, counts.get(name))
                self.assertIsNotNone(floor, f"{name} 의 복제본 바닥을 정하는 곳이 없다")
                self.assertGreaterEqual(
                    floor, pdb["spec"]["minAvailable"] + 1,
                    f"{environment}/{name}: PDB minAvailable={pdb['spec']['minAvailable']} 인데 "
                    f"복제본 바닥이 {floor} 다 — 드레인이 영구히 막힌다")

    def test_embedding_and_vector_wiring_are_opt_in(self):
        for enabled in (False, True):
            documents = render("prd", enabled)
            deployments = {item["metadata"]["name"]: item for item in documents if item["kind"] == "Deployment"}
            self.assertEqual("embedding" in deployments, enabled)
            ai_container = deployments["ai"]["spec"]["template"]["spec"]["containers"][0]
            env = {item["name"]: item for item in ai_container["env"]}
            self.assertEqual("TRIPPILOT_VECTOR_DB_URL" in env, enabled)
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
        documents = render(embedding=True, overrides=[
            "--set", "ai.autoscaling.enabled=true",
            "--set", "ai.autoscaling.minReplicas=1",
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
            for name in ("AFFILIATE_MODE", "TRIPCOM_ALLIANCE_ID", "TRIPCOM_SID", "TRIPCOM_AD_ID"):
                ref = env[name]["valueFrom"]["secretKeyRef"]
                self.assertEqual(ref["name"], "trippilot-backend")
                self.assertEqual(ref["key"], name)
                self.assertTrue(ref["optional"])


if __name__ == "__main__":
    unittest.main()
