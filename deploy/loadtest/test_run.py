"""run.py 매니페스트의 안전 성질 — 클러스터 없이 본다."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run  # noqa: E402


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.config, self.job = run.manifest("trippilot-dev", "db.example.internal", "trippilot", 50, "1m:20,1m:0")
        self.pod = self.job["spec"]["template"]

    def test_pod_carries_the_label_the_dev_network_policy_opens(self):
        self.assertEqual(self.pod["metadata"]["labels"], {"app.kubernetes.io/name": "trippilot-loadtest"})

    def test_secrets_are_referenced_never_inlined(self):
        text = json.dumps(self.job)
        for c in self.pod["spec"]["initContainers"] + self.pod["spec"]["containers"]:
            for e in c.get("env", []):
                if any(k in e["name"] for k in ("PASSWORD", "SIGNING_KEY")):
                    self.assertIn("secretKeyRef", e["valueFrom"])
                    self.assertNotIn("value", e)
        self.assertNotIn("BEGIN PRIVATE KEY", text)

    def test_restricted_pod_security(self):
        for c in self.pod["spec"]["initContainers"] + self.pod["spec"]["containers"]:
            sc = c["securityContext"]
            self.assertFalse(sc["allowPrivilegeEscalation"])
            self.assertTrue(sc["runAsNonRoot"])
            self.assertEqual(sc["capabilities"], {"drop": ["ALL"]})

    def test_refuses_the_production_namespace(self):
        with self.assertRaises(SystemExit):
            run.main(["--namespace", "trippilot"])


if __name__ == "__main__":
    unittest.main()
