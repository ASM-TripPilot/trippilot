"""Deployment boundary tests: no cloud account or cluster required."""
import copy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runtime
import runtime_db
import runtime_secrets


def outputs():
    return {
        "aws_region": "ap-northeast-2", "cluster_name": "trippilot-dev",
        "database_host": "db.example.rds.amazonaws.com",
        "database_master_secret_arn": "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:master-abc",
        "redis_host": "redis.example.cache.amazonaws.com",
        "ecr_repositories": {name: f"123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/trippilot-dev/{name}" for name in ("backend", "ai", "embedding")},
        "app_secret_arns": {name: f"arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:{name}-abc" for name in ("backend", "ai", "database", "shared")},
    }


class SecretTests(unittest.TestCase):
    def test_seed_preserves_existing_values_and_does_not_mutate_input(self):
        original = {"backend": {"JWT_SIGNING_KEY": "existing-key"}, "shared": {"SERVICE_AUTH_TOKEN": "existing-token"}, "database": {"DB_PASSWORD": "existing-db"}, "ai": {}}
        snapshot = copy.deepcopy(original)
        seeded = runtime_secrets.seed_groups(original, lambda: "new-password", lambda: "new-key")
        self.assertEqual(original, snapshot)
        self.assertEqual(seeded["backend"]["JWT_SIGNING_KEY"], "existing-key")
        self.assertEqual(seeded["shared"]["SERVICE_AUTH_TOKEN"], "existing-token")
        self.assertEqual(seeded["database"]["DB_PASSWORD"], "existing-db")
        self.assertEqual(seeded["database"]["AI_DB_PASSWORD"], "new-password")

    def test_seed_empty_first_deployment(self):
        seeded = runtime_secrets.seed_groups({name: {} for name in runtime_secrets.GROUP_KEYS}, lambda: "secret", lambda: "rsa")
        self.assertEqual(seeded["backend"]["JWT_SIGNING_KEY"], "rsa")
        self.assertEqual(seeded["shared"]["SERVICE_AUTH_TOKEN"], "secret")
        self.assertEqual(seeded["backend"]["PLACE_GEOCODE_MODE"], "stub")
        self.assertEqual(seeded["backend"]["AFFILIATE_MODE"], "fallback")

    def test_provider_credentials_fail_before_deployment(self):
        cases = [
            {"backend": {"PLACE_GEOCODE_MODE": "kakao"}},
            {"backend": {"WEATHER_MODE": "kma"}},
            {"ai": {"TRIPPILOT_LLM_PROVIDER": "openai"}},
            {"ai": {"TRIPPILOT_LLM_PROVIDER": "anthropic"}},
            {"ai": {"TRIPPILOT_LLM_PROVIDER": "mixed", "OPENAI_API_KEY": "key"}},
            {"ai": {"TRIPPILOT_LLM_PROVIDER": "typo"}},
            {"backend": {"PLACE_GEOCODE_MODE": "typo"}},
            {"backend": {"AFFILIATE_MODE": "tripcom"}},
            {"backend": {"AFFILIATE_MODE": "tripcom", "TRIPCOM_ALLIANCE_ID": "a", "TRIPCOM_SID": "s"}},
            {"backend": {"AFFILIATE_MODE": "typo"}},
        ]
        for changed in cases:
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                runtime_secrets.validate_groups({**{name: {} for name in runtime_secrets.GROUP_KEYS}, **changed})
        runtime_secrets.validate_groups({**{name: {} for name in runtime_secrets.GROUP_KEYS}, "backend": {
            "AFFILIATE_MODE": "tripcom", "TRIPCOM_ALLIANCE_ID": "a", "TRIPCOM_SID": "s", "TRIPCOM_AD_ID": "D1"}})

    def test_google_client_secret_must_stay_empty(self):
        """공개(iOS) 클라이언트에 시크릿을 보내면 Google 이 invalid_client 로 거절한다(2026-09-23 실측).

        부재·빈 값은 정상이어야 한다 — 그래야 이미 그 키가 들어 있는 시크릿의 배포 전체가
        검증에서 죽지 않고, 값을 채운 경우에만 이유와 함께 막힌다.
        """
        base = {name: {} for name in runtime_secrets.GROUP_KEYS}
        for ok in ({}, {"GOOGLE_CLIENT_SECRET": ""}, {"GOOGLE_CLIENT_SECRET": "   "}):
            with self.subTest(ok=ok):
                runtime_secrets.validate_groups({**base, "backend": ok})
        with self.assertRaises(ValueError) as caught:
            runtime_secrets.validate_groups({**base, "backend": {"GOOGLE_CLIENT_SECRET": "GOCSPX-무언가"}})
        self.assertIn("invalid_client", str(caught.exception))

    def test_rejects_unknown_keys_and_nonstring_secret_values(self):
        for bad in ({"AI_LLM_PROVIDER": "openai"}, {"OPENAI_API_KEY": 123}, {"OPENAI_API_KEY": "a\x00b"}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                runtime_secrets.validate_groups({**{name: {} for name in runtime_secrets.GROUP_KEYS}, "ai": bad})

    def test_runtime_secret_does_not_expose_master_or_cross_service_keys(self):
        groups = runtime_secrets.seed_groups({name: {} for name in runtime_secrets.GROUP_KEYS}, lambda: "pass/@'word", lambda: "rsa")
        manifests = runtime_secrets.runtime_manifests(groups, outputs(), "trippilot", True)
        by_name = {item["metadata"]["name"]: item["stringData"] for item in manifests}
        ai = by_name["trippilot-ai"]
        self.assertIn("pass%2F%40%27word", ai["TRIPPILOT_VECTOR_DB_URL"])
        self.assertIn("sslmode=require", ai["TRIPPILOT_VECTOR_DB_URL"])
        self.assertNotIn("JWT_SIGNING_KEY", ai)
        self.assertNotIn("PGPASSWORD", json.dumps(manifests))
        self.assertNotIn("DB_PASSWORD", by_name["trippilot-backend"])
        self.assertTrue(all("data" not in item for item in manifests))

    def test_disabled_embedding_omits_vector_connection(self):
        groups = {name: {} for name in runtime_secrets.GROUP_KEYS}
        manifests = runtime_secrets.runtime_manifests(groups, outputs(), "trippilot", False)
        self.assertNotIn("TRIPPILOT_VECTOR_DB_URL", manifests[1]["stringData"])

    def test_aws_put_keeps_secret_out_of_argv_and_removes_payload_file(self):
        observed = {}

        def shell(argv, payload=None):
            self.assertIsNone(payload)
            self.assertNotIn("private-value", " ".join(argv))
            observed["path"] = next(a for a in argv if a.startswith("file://"))[len("file://"):]
            with open(observed["path"], encoding="utf-8") as stream:
                self.assertIn("private-value", stream.read())
            self.assertEqual(os.stat(observed["path"]).st_mode & 0o777, 0o600)
            return "{}"

        runtime_secrets.put_secret(shell, "ap-northeast-2", "arn-example", {"DB_PASSWORD": "private-value"})
        self.assertFalse(os.path.exists(observed["path"]))

    def test_aws_empty_container_can_be_seeded_but_access_denied_fails(self):
        shell = Mock(side_effect=runtime.CommandError("aws", "ResourceNotFoundException"))
        self.assertEqual(runtime_secrets.get_secret(shell, "ap-northeast-2", "arn"), {})
        shell = Mock(side_effect=runtime.CommandError("aws", "AccessDeniedException private"))
        with self.assertRaises(runtime.CommandError):
            runtime_secrets.get_secret(shell, "ap-northeast-2", "arn")

    def test_invalid_json_is_not_echoed_in_error(self):
        for secret_string in ("TOP_SECRET_INVALID", "[1, 2]", '{"OPENAI_API_KEY": 123}'):
            shell = Mock(return_value=json.dumps({"SecretString": secret_string}))
            with self.assertRaises(ValueError) as raised:
                runtime_secrets.get_secret(shell, "ap-northeast-2", "arn")
            self.assertNotIn(secret_string, str(raised.exception))


class BootstrapTests(unittest.TestCase):
    def test_bootstrap_secret_only_references_passwords_and_sql_uses_psql_quoting(self):
        master = {"username": "master_user", "password": "private-master"}
        database = {"DB_PASSWORD": "app-secret", "DB_MIGRATE_PASSWORD": "migration-secret", "AI_DB_PASSWORD": "ai-secret"}
        manifests = runtime_db.bootstrap_manifests(outputs(), "trippilot", "123-1", master, database)
        by_kind = {item["kind"]: item for item in manifests}
        job = by_kind["Job"]
        self.assertNotIn("private-master", json.dumps(job))
        self.assertNotIn("app-secret", json.dumps(job))
        self.assertEqual(job["spec"]["activeDeadlineSeconds"], 600)
        pod = job["spec"]["template"]["spec"]
        self.assertFalse(pod["automountServiceAccountToken"])
        sql = by_kind["ConfigMap"]["data"]["bootstrap.sql"]
        self.assertIn("\\getenv db_password DB_PASSWORD", sql)
        self.assertIn(":'db_password'", sql)
        self.assertIn("format(", sql)
        self.assertIn("vector(1024)", sql)
        self.assertNotIn("private-master", sql)

    def test_bootstrap_cleans_up_even_when_job_wait_fails(self):
        shell = Mock()
        def execute(argv, payload=None):
            if "get-secret-value" in argv:
                secret = {"username": "master", "password": "secret"} if "master-abc" in " ".join(argv) else {"DB_PASSWORD": "x", "DB_MIGRATE_PASSWORD": "y", "AI_DB_PASSWORD": "z"}
                return json.dumps({"SecretString": json.dumps(secret)})
            if "wait" in argv:
                raise runtime.CommandError("kubectl", "timed out")
            return "{}"
        shell.side_effect = execute
        with self.assertRaises(runtime.CommandError):
            runtime_db.bootstrap(outputs(), "trippilot", "123-1", shell)
        self.assertTrue(any("delete" in call.args[0] and "secret" in call.args[0] for call in shell.call_args_list))

    def test_invalid_run_ids_rejected_before_command_execution(self):
        for run_id in ("../oops", "$(cat secrets)", "", "a" * 64):
            with self.subTest(run_id=run_id), self.assertRaises(ValueError):
                runtime_db.resource_name(run_id)


class ConfigurationTests(unittest.TestCase):
    def test_terraform_json_values_unwrapped_and_validated(self):
        raw = {key: {"value": value, "sensitive": False} for key, value in outputs().items()}
        self.assertEqual(runtime.parse_outputs(raw), outputs())
        raw["database_host"]["value"] = "db/evil"
        with self.assertRaises(ValueError):
            runtime.parse_outputs(raw)

    def test_render_values_contains_no_secret_material(self):
        values = runtime.helm_values(outputs(), "git-123abc", "arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789abc", "api-dev.example.com", True)
        self.assertEqual(values["images"]["backend"]["tag"], "git-123abc")
        self.assertTrue(values["embedding"]["enabled"])
        self.assertNotIn("secret", json.dumps(values).lower())
        self.assertNotIn("password", json.dumps(values).lower())

    def test_rejects_invalid_image_tag_certificate_and_host(self):
        good_arn = "arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789abc"
        for tag, cert, host in (("bad tag", good_arn, "api.example.com"), ("abc", "not-arn", "api.example.com"), ("abc", good_arn, "https://api.example.com")):
            with self.subTest(tag=tag, cert=cert, host=host), self.assertRaises(ValueError):
                runtime.helm_values(outputs(), tag, cert, host, False)

    @patch("runtime.subprocess.run")
    def test_shell_failure_does_not_print_command_stdin_or_stderr(self, run):
        run.return_value = Mock(returncode=1, stdout="secret-stdout", stderr="secret-stderr")
        with self.assertRaises(runtime.CommandError) as raised:
            runtime.command(["aws", "secretsmanager", "get-secret-value"], "secret-input")
        self.assertNotIn("secret-input", str(raised.exception))
        self.assertNotIn("secret-stderr", str(raised.exception))
        self.assertNotIn("secret-stdout", str(raised.exception))


class RuntimeIntegrationTests(unittest.TestCase):
    def test_real_rsa_generation_validates_as_app_compatible_pkcs8(self):
        key = runtime_secrets.rsa_key()
        runtime_secrets.validate_rsa_key(key)
        with self.assertRaises(ValueError):
            runtime_secrets.validate_rsa_key("invalid-base64")
        with self.assertRaises(ValueError):
            runtime_secrets.validate_rsa_key("dGhpcyBpcyBub3QgUlNB")

    def test_scram_password_verifiers_are_random_and_accept_special_characters(self):
        first = runtime_db.scram_verifier("sufficiently-long-password'@$!")
        second = runtime_db.scram_verifier("sufficiently-long-password'@$!")
        self.assertTrue(first.startswith("SCRAM-SHA-256$4096:"))
        self.assertNotEqual(first, second)
        self.assertNotIn("sufficiently-long", first)
        for invalid in ("password\n", "비밀번호"):
            with self.assertRaises(ValueError):
                runtime_db.scram_verifier(invalid)

    def test_rds_managed_secret_accepts_numeric_metadata(self):
        shell = Mock(return_value=json.dumps({"SecretString": json.dumps({"username": "admin", "password": "private", "port": 5432})}))
        master = runtime_secrets.get_secret(shell, "ap-northeast-2", "arn", strings_only=False)
        self.assertEqual(master["port"], 5432)

    def test_rds_managed_secret_arn_exclamation_mark(self):
        raw = {key: {"value": value} for key, value in outputs().items()}
        raw["database_master_secret_arn"]["value"] = "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:rds!db-12345678-1234-1234-1234-123456789abc-AbCdEf"
        self.assertIn("rds!db-", runtime.parse_outputs(raw)["database_master_secret_arn"])

    @patch("runtime_secrets.validate_rsa_key")
    @patch("runtime_secrets.rsa_key", return_value="fake-test-key")
    def test_sync_first_deploy_and_redeploy_are_idempotent(self, keygen, keycheck):
        saved = {arn: {} for arn in outputs()["app_secret_arns"].values()}
        applied = []
        writes = []
        def execute(argv, payload=None):
            if "get-secret-value" in argv:
                arn = argv[argv.index("--secret-id") + 1]
                return json.dumps({"SecretString": json.dumps(saved[arn])})
            if "put-secret-value" in argv:
                # put_secret 은 값을 argv 도 stdin 도 아닌 0600 임시파일로 넘긴다.
                path = next(a for a in argv if a.startswith("file://"))[len("file://"):]
                with open(path, encoding="utf-8") as stream:
                    request = json.load(stream)
                saved[request["SecretId"]] = json.loads(request["SecretString"])
                writes.append(request["SecretId"])
                return "{}"
            if "apply" in argv:
                applied.append(json.loads(payload))
                return "{}"
            self.fail("Unexpected command")
        runtime_secrets.sync(outputs(), "trippilot", True, execute)
        first_write_count = len(writes)
        runtime_secrets.sync(outputs(), "trippilot", True, execute)
        self.assertEqual(len(writes), first_write_count)
        self.assertEqual(first_write_count, 3)
        self.assertEqual(len(applied), 8)
        self.assertEqual(keygen.call_count, 1)

    def test_ensure_namespace_and_cli_commands_dispatch_with_validated_arguments(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "outputs.json"
            target = Path(folder) / "values.json"
            source.write_text(json.dumps({key: {"value": value} for key, value in outputs().items()}))
            common = ["--outputs", str(source)]
            with patch("runtime.command", return_value="{}") as shell, patch("builtins.print"):
                runtime.main(["ensure-namespace"])
                manifest = json.loads(shell.call_args.args[1])
                self.assertEqual(manifest["metadata"]["labels"]["pod-security.kubernetes.io/enforce"], "restricted")
                runtime.main(["cleanup-db", "--run-id", "123-1"])
                runtime.main(["smoke"])
            with patch("runtime.runtime_secrets.sync") as sync, patch("builtins.print"):
                runtime.main(["sync-secrets", *common, "--embedding-enabled"])
                self.assertTrue(sync.call_args.args[2])
            with patch("runtime.runtime_db.bootstrap") as bootstrap, patch("builtins.print"):
                runtime.main(["bootstrap-db", *common, "--run-id", "123-1"])
                self.assertEqual(bootstrap.call_args.args[2], "123-1")
            with patch("builtins.print"):
                runtime.main(["render-values", *common, "--image-tag", "sha-123", "--certificate-arn", "arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789abc", "--hostname", "api.example.com", "--output", str(target)])
                self.assertEqual(json.loads(target.read_text())["images"]["backend"]["tag"], "sha-123")
            with self.assertRaises(ValueError):
                runtime.main(["ensure-namespace", "--namespace", "../invalid"])

    def test_load_kb_runs_as_its_own_job_with_the_serving_image_and_env(self):
        """서빙 ai 컨테이너에 exec 하면 그 컨테이너 메모리(2Gi, uvicorn 워커 2개)를 나눠 써서
        적재가 137(OOM)로 죽었다 — 최악엔 서빙 워커가 죽는다. 같은 이미지·같은 벡터 env 로
        따로 돈다(다른 이미지나 모델이면 적재와 질의가 다른 벡터 공간을 탄다)."""
        import runtime_kb
        job = runtime_kb.manifest("trippilot", "123.dkr.ecr/ai:sha-1")
        pod = job["spec"]["template"]["spec"]
        container = pod["containers"][0]
        self.assertEqual(container["image"], "123.dkr.ecr/ai:sha-1")
        self.assertEqual(container["command"], ["/app/.venv/bin/python", "scripts/load_kb.py"])
        env = {e["name"]: e for e in container["env"]}
        self.assertEqual(env["TRIPPILOT_EMBEDDING_PROVIDER"]["value"], "http")
        self.assertEqual(env["TRIPPILOT_EMBEDDING_BASE_URL"]["value"], "http://embedding:8100")
        self.assertEqual(env["TRIPPILOT_VECTOR_DB_URL"]["valueFrom"]["secretKeyRef"],
                         {"name": "trippilot-ai", "key": "TRIPPILOT_VECTOR_DB_URL", "optional": False})
        self.assertTrue(env["TRIPPILOT_EMBEDDING_MODEL"]["valueFrom"]["secretKeyRef"]["optional"])
        self.assertEqual(pod["securityContext"]["runAsUser"], 10001)
        self.assertTrue(container["securityContext"]["readOnlyRootFilesystem"])
        self.assertIn("memory", container["resources"]["limits"])
        self.assertEqual(job["spec"]["template"]["metadata"]["labels"]["app.kubernetes.io/name"],
                         "trippilot-kb-load")

    def test_load_kb_reads_the_serving_image_prints_logs_and_cleans_up(self):
        shell = Mock(side_effect=["", "123.dkr.ecr/ai:sha-1", "", "", "총 1470건", ""])
        with patch("runtime.command", shell), patch("builtins.print") as out:
            runtime.main(["load-kb"])
        calls = [c.args[0] for c in shell.call_args_list]
        self.assertIn("deployment/ai", calls[1])
        applied = json.loads(shell.call_args_list[2].args[1])
        self.assertEqual(applied["spec"]["template"]["spec"]["containers"][0]["image"], "123.dkr.ecr/ai:sha-1")
        self.assertIn("job/trippilot-kb-load", calls[3])
        out.assert_any_call("총 1470건")
        self.assertIn("delete", calls[-1])

    def test_load_kb_failure_shows_the_cause_without_credentials(self):
        """실패가 'kubectl command failed' 한 줄뿐이라 원인을 몰랐다(2026-10-04 첫 적재). 적재
        로그의 끝 몇 줄은 원인이고, DSN 같은 자격은 가린다."""
        logs = ("Traceback (most recent call last):\n"
                "psycopg.OperationalError: connection to postgresql://ai_kb:s3cret@db:5432/ai_kb failed\n"
                "TimeoutError: timed out after 5.0s\n")
        shell = Mock(side_effect=["", "img", "", runtime.CommandError("kubectl", "timed out"), logs, ""])
        with patch("runtime.command", shell), patch("builtins.print") as out, \
                self.assertRaises(runtime.CommandError):
            runtime.main(["load-kb"])
        shown = "\n".join(str(c.args[0]) for c in out.call_args_list)
        self.assertIn("TimeoutError: timed out after 5.0s", shown)
        self.assertNotIn("s3cret", shown)
        self.assertIn("delete", shell.call_args_list[-1].args[0])

    def test_smoke_checks_internal_denial_and_cleans_up_failure(self):
        import runtime_smoke
        manifest = runtime_smoke.manifest("trippilot")
        script = manifest["spec"]["template"]["spec"]["containers"][0]["command"][2]
        self.assertIn("/internal/health", script)
        self.assertIn('test "$status" = 404', script)
        shell = Mock(side_effect=["", "", runtime.CommandError("kubectl", "failed"), ""])
        with self.assertRaises(runtime.CommandError):
            runtime_smoke.run("trippilot", shell)
        self.assertIn("delete", shell.call_args.args[0])

    def test_smoke_reports_autoscaler_targets_without_gating_the_deploy(self):
        """HPA 현재값을 배포 로그에 남기되, 비어 있어도 배포를 깨지 않는다.

        metrics-server 가 없으면 HPA 는 목표치가 `<unknown>` 인 채 replica 소유권만
        가져간다 — 배포가 성공한 뒤에 조용히 시작되는 사고라 로그에 증거가 필요하다.
        단언하지 않는 이유는 메트릭이 기동 수십 초 뒤에 채워져서, 단언하면 멀쩡한
        배포가 타이밍으로 깨지기 때문이다.
        """
        import runtime_smoke
        table = "NAME   TARGETS   CURRENT   MIN   MAX   REPLICAS\nai     70        <none>    1     3     1\n"
        shell = Mock(side_effect=["", "", "", "", table])
        with patch("builtins.print") as output:
            runtime_smoke.run("trippilot", shell)
        printed = " ".join(str(call.args[0]) for call in output.call_args_list)
        self.assertIn("ai", printed)
        self.assertIn("metrics-server", printed)  # 비어 있으면 어디를 볼지 알려준다
        get = shell.call_args.args[0]
        self.assertEqual(get[:3], ["kubectl", "get", "hpa"])
        self.assertIn("--ignore-not-found", get)  # HPA 를 안 켠 환경에서 깨지지 않는다

    def test_smoke_says_nothing_when_no_autoscaler_is_enabled(self):
        import runtime_smoke
        shell = Mock(side_effect=["", "", "", "", ""])
        with patch("builtins.print") as output:
            runtime_smoke.run("trippilot", shell)
        output.assert_not_called()

    @patch("runtime.subprocess.run")
    def test_command_returns_success_without_echo(self, run):
        run.return_value = Mock(returncode=0, stdout="private", stderr="")
        with patch("builtins.print") as output:
            self.assertEqual(runtime.command(["aws", "example"]), "private")
            output.assert_not_called()

    def test_invalid_terraform_contract_values_fail_closed(self):
        mutations = [
            {"aws_region": "not-a-region"}, {"ecr_repositories": {}},
            {"ecr_repositories": {name: "malicious image" for name in ("backend", "ai", "embedding")}},
            {"app_secret_arns": {}}, {"database_master_secret_arn": "not-an-arn"},
        ]
        for mutation in mutations:
            raw = {key: {"value": value} for key, value in {**outputs(), **mutation}.items()}
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                runtime.parse_outputs(raw)
        with self.assertRaises(ValueError):
            runtime.parse_outputs({})
        with self.assertRaises(ValueError):
            runtime.helm_values(outputs(), "tag", "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789abc", "api.example.com", False)


if __name__ == "__main__":
    unittest.main()
