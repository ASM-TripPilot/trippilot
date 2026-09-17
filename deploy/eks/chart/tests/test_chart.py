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


if __name__ == "__main__":
    unittest.main()
