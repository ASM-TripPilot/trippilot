"""run.py 의 안전 성질 — 클러스터 없이 본다(kubectl 은 가짜로 바꾼다)."""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run  # noqa: E402

DB = {"host": "db.example.internal", "port": "5432", "db": "trippilot", "user": "app_user"}
ALLOWING_POLICY = json.dumps({"spec": {"ingress": [{"from": [
    {"podSelector": {"matchLabels": {"app.kubernetes.io/component": "gateway"}}},
    {"podSelector": {"matchLabels": {"app.kubernetes.io/name": "trippilot-loadtest"}}}]}]}})


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.config, self.job = run.manifest("trippilot-dev", DB, 50, "1m:20,1m:0")
        self.pod = self.job["spec"]["template"]
        self.containers = self.pod["spec"]["initContainers"] + self.pod["spec"]["containers"]

    def test_pod_carries_the_label_the_dev_network_policy_opens(self):
        self.assertEqual(self.pod["metadata"]["labels"], {"app.kubernetes.io/name": "trippilot-loadtest"})

    def test_secrets_are_referenced_never_inlined(self):
        for c in self.containers:
            for e in c.get("env", []):
                if any(k in e["name"] for k in ("PASSWORD", "SIGNING_KEY")):
                    self.assertIn("secretKeyRef", e["valueFrom"])
                    self.assertNotIn("value", e)

    def test_restricted_pod_security(self):
        self.assertEqual(self.pod["spec"]["securityContext"]["seccompProfile"], {"type": "RuntimeDefault"})
        self.assertTrue(self.pod["spec"]["securityContext"]["runAsNonRoot"])
        for c in self.containers:
            sc = c["securityContext"]
            self.assertFalse(sc["allowPrivilegeEscalation"])
            self.assertTrue(sc["runAsNonRoot"])
            self.assertTrue(sc["readOnlyRootFilesystem"])
            self.assertEqual(sc["capabilities"], {"drop": ["ALL"]})

    def test_seed_connects_where_the_backend_does(self):
        env = {e["name"]: e.get("value") for e in self.pod["spec"]["initContainers"][0]["env"]}
        self.assertEqual((env["PGHOST"], env["PGPORT"], env["PGDATABASE"], env["PGUSER"]),
                         ("db.example.internal", "5432", "trippilot", "app_user"))


class GuardTests(unittest.TestCase):
    def test_only_the_dev_namespace_is_allowed(self):
        for ns in ("trippilot", "default", "kube-system", "trippilot-prd", "trippilot-batch"):
            with self.assertRaises(SystemExit):
                run.main(["--namespace", ns])

    def test_stages_must_fit_the_job_deadline(self):
        self.assertEqual(run.stage_seconds("1m:20,30s:5,1h:0"), 60 + 30 + 3600)
        with self.assertRaises(SystemExit):
            run.stage_seconds("1x:20")
        with self.assertRaises(SystemExit):
            run.main(["--stages", "50m:100"])   # 3000초 + init 몫 > 시한

    def test_refuses_when_the_policy_does_not_admit_the_job_yet(self):
        with mock.patch.object(run, "kubectl", return_value=json.dumps({"spec": {"ingress": [{"from": []}]}})):
            with self.assertRaises(SystemExit):
                run.main([])


class CleanupTests(unittest.TestCase):
    """중간에 무엇이 터져도 Job·ConfigMap 을 지우고 복제본 수를 되돌린다."""

    def fake(self, fail_on):
        calls = []

        def kubectl(*args, input=None, check=True):
            calls.append(args)
            if args[:4] == ("-n", "trippilot-dev", "get", "networkpolicy"):
                return ALLOWING_POLICY
            if "jsonpath={.spec.replicas}" in args:
                return "1"
            if "jsonpath={.status.readyReplicas}" in args:
                return "2"
            if args and args[0] == fail_on:
                raise KeyboardInterrupt
            return ""
        return calls, kubectl

    def test_interrupt_after_apply_deletes_the_job_and_restores_replicas(self):
        calls, kubectl = self.fake(fail_on="apply")
        with mock.patch.object(run, "kubectl", side_effect=kubectl), \
                mock.patch.object(run, "database", return_value=DB):
            with self.assertRaises(KeyboardInterrupt):
                run.main(["--replicas", "2"])
        self.assertIn(("-n", "trippilot-dev", "delete", "job,configmap", run.NAME, "--ignore-not-found"), calls)
        self.assertIn(("-n", "trippilot-dev", "scale", "deploy/backend", "--replicas=1"), calls)

    def test_sleep_scales_everything_to_zero_even_on_failure(self):
        calls, kubectl = self.fake(fail_on="apply")
        with mock.patch.object(run, "kubectl", side_effect=kubectl), \
                mock.patch.object(run, "database", return_value=DB):
            with self.assertRaises(KeyboardInterrupt):
                run.main(["--replicas", "2", "--sleep"])
        self.assertIn(("-n", "trippilot-dev", "scale", "deploy", "--all", "--replicas=0"), calls)


if __name__ == "__main__":
    unittest.main()
