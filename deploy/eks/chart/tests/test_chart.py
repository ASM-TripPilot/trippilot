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
        for environment, expected in [("dev", 1), ("prd", 2)]:
            documents = render(environment)
            deployments = [item for item in documents if item["kind"] == "Deployment"]
            self.assertEqual(len(deployments), 3)
            for deployment in deployments:
                self.assertEqual(deployment["spec"]["replicas"], expected)
                pod = deployment["spec"]["template"]
                self.assertEqual(pod["metadata"]["annotations"]["trippilot.io/rollout-nonce"], "run-123")
                self.assertFalse(pod["spec"]["automountServiceAccountToken"])
                container = pod["spec"]["containers"][0]
                self.assertTrue(container["securityContext"]["readOnlyRootFilesystem"])
                self.assertFalse(container["securityContext"]["allowPrivilegeEscalation"])
                self.assertNotIn("envFrom", container)
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
            self.assertEqual(len(pdbs), 3 if environment == "prd" else 0)

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
                self.assertEqual(len(sources), 1)
                self.assertEqual(sources[0]["podSelector"]["matchLabels"]["app.kubernetes.io/component"], "ai")

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

    def test_autoscaling_is_off_by_default(self):
        documents = render()
        self.assertEqual(
            [item for item in documents if item["kind"] == "HorizontalPodAutoscaler"], [])
        deployments = {item["metadata"]["name"]: item
                       for item in documents if item["kind"] == "Deployment"}
        self.assertEqual(deployments["ai"]["spec"]["replicas"], 1)

    def test_reminder_serving_is_opt_in_and_off_by_default(self):
        documents = render()
        names = {(item["kind"], item["metadata"]["name"]) for item in documents}
        self.assertNotIn(("Deployment", "reminder-llm"), names)
        self.assertNotIn(("ScaledObject", "reminder-llm"), names)

    def test_reminder_serving_keeps_the_served_model_name_contract(self):
        documents = render(overrides=["--set", "reminderLlm.enabled=true"])
        deployment = next(item for item in documents
                          if item["kind"] == "Deployment"
                          and item["metadata"]["name"] == "reminder-llm")
        container = deployment["spec"]["template"]["spec"]["containers"][0]
        # 이 문자열이 계약이다. Triton 모델 디렉토리명 · 요청의 model= · 앱의
        # TRIPPILOT_LLM_FEATURE_MODELS 배정이 전부 같아야 하고, `local` 로 시작하지
        # 않으면 앱이 로컬 라우트를 아예 안 켜고 외부 벤더로 조용히 나간다.
        served = container["env"]
        served_name = {item["name"]: item["value"] for item in served}["SERVED_MODEL_NAME"]
        self.assertEqual(served_name, "local-reminder-qwen3-4b-v1")
        self.assertTrue(served_name.startswith("local"))
        self.assertIn(served_name, " ".join(container["args"]))

    def test_reminder_serving_asks_for_a_gpu_and_scales_to_zero(self):
        documents = render(overrides=["--set", "reminderLlm.enabled=true"])
        deployment = next(item for item in documents
                          if item["kind"] == "Deployment"
                          and item["metadata"]["name"] == "reminder-llm")
        spec = deployment["spec"]["template"]["spec"]
        resources = spec["containers"][0]["resources"]
        self.assertEqual(resources["limits"]["nvidia.com/gpu"], 1)
        # 기본 general-purpose NodePool 에는 GPU 가 없다 — 전용 풀로만 떨어져야 한다.
        self.assertEqual(spec["nodeSelector"]["trippilot.io/nodepool"], "gpu")
        self.assertEqual(spec["tolerations"][0]["key"], "nvidia.com/gpu")
        scaler = next(item for item in documents if item["kind"] == "ScaledObject")
        # 0 으로 내려가지 않으면 GPU 노드가 상주해 Modal 기각 근거(무요청 0원)를 못 이긴다.
        self.assertEqual(scaler["spec"]["minReplicaCount"], 0)
        self.assertEqual(scaler["spec"]["scaleTargetRef"]["name"], "reminder-llm")

    def test_ai_points_at_the_in_cluster_reminder_service_when_enabled(self):
        documents = render(overrides=["--set", "reminderLlm.enabled=true"])
        ai = next(item for item in documents
                  if item["kind"] == "Deployment" and item["metadata"]["name"] == "ai")
        env = {item["name"]: item for item in ai["spec"]["template"]["spec"]["containers"][0]["env"]}
        self.assertEqual(env["TRIPPILOT_LOCAL_LLM_BASE_URL"]["value"],
                         "http://reminder-llm:8000/v1")

    def test_embedding_autoscaling_key_is_rejected(self):
        # 임베딩은 파드당 4.2 GiB·모델 로드 수십 초라 늘려도 늦다. 스키마가 막는다.
        with self.assertRaises(subprocess.CalledProcessError):
            render(embedding=True, overrides=["--set", "embedding.autoscaling.enabled=true"])


if __name__ == "__main__":
    unittest.main()
