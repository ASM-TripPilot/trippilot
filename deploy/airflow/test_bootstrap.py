"""bootstrap.py — 비밀값이 명령 인자에 실리지 않는가·두 번째 실행이 비밀번호·키를 바꾸지 않는가.

    python3 deploy/airflow/test_bootstrap.py
"""
import base64
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bootstrap  # noqa: E402

MASTER = {"username": "master", "password": "MASTER-PW-xyz"}
KEYS = {k: f"value-of-{k}" for k in bootstrap.COLLECT_KEYS}


class FakeCluster:
    """kubectl apply 를 시크릿 저장소로 흉내 낸다 — 나머지 명령은 기록만."""

    def __init__(self):
        self.secrets, self.argv = {}, []

    def command(self, argv, payload=None):
        self.argv.append(argv)
        if argv[:2] == ["kubectl", "apply"]:
            doc = json.loads(payload)
            if doc["kind"] == "Secret":
                self.secrets[doc["metadata"]["name"]] = dict(doc["stringData"])
            return ""
        if argv[:3] == ["kubectl", "get", "secret"]:
            name = argv[3]
            if name not in self.secrets:
                raise bootstrap.CommandError("kubectl", f'secrets "{name}" NotFound')
            data = {k: base64.b64encode(v.encode()).decode() for k, v in self.secrets[name].items()}
            return json.dumps({"data": data})
        return ""


class BootstrapTest(unittest.TestCase):
    def run_install(self, cluster, live="0"):
        args = mock.Mock(namespace="trippilot-batch", db_host="db.example", run_id="1")
        with mock.patch.object(bootstrap, "command", cluster.command), \
             mock.patch.object(bootstrap, "wait_job"), \
             mock.patch.dict(os.environ, {**KEYS, "BATCH_LIVE": live}):
            bootstrap.install(args, MASTER)

    def test_비밀값은_명령_인자에_없다(self):
        cluster = FakeCluster()
        self.run_install(cluster)
        argv = " ".join(" ".join(a) for a in cluster.argv)
        password = cluster.secrets["airflow-metadata"]["password"]
        for secret in [MASTER["password"], password, *KEYS.values(), *cluster.secrets["airflow-keys"].values()]:
            self.assertNotIn(secret, argv)

    def test_두_번째_실행은_비밀번호와_키를_바꾸지_않는다(self):
        cluster = FakeCluster()
        self.run_install(cluster)
        first_db, first_keys = cluster.secrets["airflow-metadata"], cluster.secrets["airflow-keys"]
        self.run_install(cluster, live="1")
        self.assertEqual(cluster.secrets["airflow-metadata"], first_db)
        self.assertEqual(cluster.secrets["airflow-keys"], first_keys)
        self.assertEqual(cluster.secrets["batch-collect"]["BATCH_LIVE"], "1")   # 스위치만 바뀐다
        self.assertIn(f"airflow:{first_db['password']}@db.example:5432/airflow?sslmode=require", first_db["connection"])

    def test_수집_키가_빠지면_아무것도_덮지_않고_멈춘다(self):
        cluster = FakeCluster()
        args = mock.Mock(namespace="trippilot-batch", db_host="db.example", run_id="1")
        with mock.patch.object(bootstrap, "command", cluster.command), mock.patch.object(bootstrap, "wait_job"), \
             mock.patch.dict(os.environ, {**KEYS, "ANTHROPIC_API_KEY": ""}):
            with self.assertRaises(SystemExit):
                bootstrap.install(args, MASTER)
        self.assertEqual(cluster.secrets, {})   # DB·키 시크릿도 만들기 전에 멈췄다
        self.assertEqual(cluster.argv, [])


class ShadowAndNamespaceTest(unittest.TestCase):
    def test_그림자는_GH_TOKEN_없이도_준비된다(self):
        cluster = FakeCluster()
        keys = {k: v for k, v in KEYS.items() if k != "GH_TOKEN"}
        args = mock.Mock(namespace="trippilot-batch", db_host="db.example", run_id="1")
        with mock.patch.object(bootstrap, "command", cluster.command), mock.patch.object(bootstrap, "wait_job"), \
             mock.patch.dict(os.environ, {**keys, "BATCH_LIVE": "0"}, clear=True):
            bootstrap.install(args, MASTER)
        self.assertNotIn("GH_TOKEN", cluster.secrets["batch-collect"])

    def test_실_수집은_GH_TOKEN_없으면_아무것도_건드리지_않고_멈춘다(self):
        cluster = FakeCluster()
        keys = {k: v for k, v in KEYS.items() if k != "GH_TOKEN"}
        args = mock.Mock(namespace="trippilot-batch", db_host="db.example", run_id="1")
        with mock.patch.object(bootstrap, "command", cluster.command), mock.patch.object(bootstrap, "wait_job"), \
             mock.patch.dict(os.environ, {**keys, "BATCH_LIVE": "1"}, clear=True):
            with self.assertRaises(SystemExit):
                bootstrap.install(args, MASTER)
        self.assertEqual(cluster.argv, [])

    def test_네임스페이스는_PodSecurity_baseline_을_강제한다(self):
        labels = bootstrap.namespace("trippilot-batch")["metadata"]["labels"]
        self.assertEqual(labels["pod-security.kubernetes.io/enforce"], "baseline")
        self.assertEqual(labels["pod-security.kubernetes.io/warn"], "restricted")


if __name__ == "__main__":
    unittest.main()
