"""Deployment boundary tests: no cloud account or cluster required."""
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
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
        # 운영은 버튼 모드로 뜬다 — 앱 기본값(fake)이 그대로 닿으면 운영이 대역으로 말을 "알아듣는다".
        self.assertEqual(seeded["backend"]["ASSISTANT_INTERPRET_MODE"], "off")

    def test_seed_keeps_an_explicit_assistant_mode(self):
        groups = {name: {} for name in runtime_secrets.GROUP_KEYS}
        for mode in ("fake", "http"):
            groups["backend"] = {"ASSISTANT_INTERPRET_MODE": mode}
            seeded = runtime_secrets.seed_groups(groups, lambda: "secret", lambda: "rsa")
            self.assertEqual(seeded["backend"]["ASSISTANT_INTERPRET_MODE"], mode)

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
            # 도우미 해석 — 오타는 백엔드가 기동에서 죽는다(http 는 TRIP-1410 부터 정상 값).
            {"backend": {"ASSISTANT_INTERPRET_MODE": "on"}},
            # U10 킬 스위치 — 백엔드는 on/off·yes/no 도 받지만 운영 스위치는 두 값으로 고정한다.
            {"backend": {"LOCATION_AUTOMATION_ENABLED": "off"}},
            {"backend": {"LOCATION_AUTOMATION_ENABLED": ""}},
            # 생성 상한(TRIP-1314) — 있는데 틀리면 백엔드가 기동에서 죽는 값들.
            {"backend": {"ITINERARY_GENERATION_DAILY_LIMIT": ""}},
            {"backend": {"ITINERARY_GENERATION_DAILY_LIMIT": "0"}},
            {"backend": {"ITINERARY_GENERATION_DAILY_LIMIT": "abc"}},
            {"backend": {"ITINERARY_GENERATION_DAILY_LIMIT": "2147483648"}},
            {"backend": {"ITINERARY_GENERATION_LIMIT_EXEMPT_ACCOUNT_IDS": "not-a-uuid"}},
            # 파이썬 uuid 는 받지만 백엔드는 못 읽는 모양 — DB 도구에서 대시 없이 복사해 오는 것이 흔하다.
            {"backend": {"ITINERARY_GENERATION_LIMIT_EXEMPT_ACCOUNT_IDS": "0d7f17ab5c4b4d6da7f7484ba11dda46"}},
            {"backend": {"ITINERARY_GENERATION_LIMIT_EXEMPT_ACCOUNT_IDS": "{0d7f17ab-5c4b-4d6d-a7f7-484ba11dda46}"}},
            {"backend": {"ITINERARY_GENERATION_LIMIT_EXEMPT_ACCOUNT_IDS": "0d7f17ab-5c4b-4d6d-a7f7-484ba11dda46,"}},
            # 카카오 앱 ID(TRIP-1317) 자리에 REST API 키를 넣는 실수 — 카카오 로그인이 전부 401 이 된다.
            {"backend": {"KAKAO_APP_ID": "0123456789abcdef0123456789abcdef"}},
            {"backend": {"KAKAO_APP_ID": " 1519823"}},
            # 앞자리 0 은 카카오가 돌려주는 정수와 영영 안 맞는다.
            {"backend": {"KAKAO_APP_ID": "01519823"}},
        ]
        for changed in cases:
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                runtime_secrets.validate_groups({**{name: {} for name in runtime_secrets.GROUP_KEYS}, **changed})
        runtime_secrets.validate_groups({**{name: {} for name in runtime_secrets.GROUP_KEYS}, "backend": {
            "AFFILIATE_MODE": "tripcom", "TRIPCOM_ALLIANCE_ID": "a", "TRIPCOM_SID": "s", "TRIPCOM_AD_ID": "D1"}})
        runtime_secrets.validate_groups({**{name: {} for name in runtime_secrets.GROUP_KEYS}, "backend": {
            "ITINERARY_GENERATION_DAILY_LIMIT": "50", "ITINERARY_GENERATION_LIMIT_EXEMPT_ACCOUNT_IDS":
            "0D7F17AB-5c4b-4d6d-a7f7-484ba11dda46, 11111111-2222-4333-8444-555555555555"}})
        runtime_secrets.validate_groups({**{name: {} for name in runtime_secrets.GROUP_KEYS}, "backend": {
            "ITINERARY_GENERATION_LIMIT_EXEMPT_ACCOUNT_IDS": ""}})
        for switch in ("true", "false"):
            runtime_secrets.validate_groups({**{name: {} for name in runtime_secrets.GROUP_KEYS}, "backend": {
                "LOCATION_AUTOMATION_ENABLED": switch}})
        for app_id in ("1519823", ""):
            runtime_secrets.validate_groups({**{name: {} for name in runtime_secrets.GROUP_KEYS}, "backend": {
                "KAKAO_APP_ID": app_id}})

    def test_situation_sweep_switches_are_allowlisted_and_validated(self):
        """Plan-B 상황 감시 스위치 4종(situation-awareness 설계서 §7)은 backend 시크릿으로만 켠다. allowlist 에 없으면 시크릿에
        넣는 순간 배포 전체가 거부되고, 값이 틀리면 백엔드가 기동에서 죽는다(모르는 모드·지평·UUID 오타 = 바인딩 실패) —
        파드가 뜨다 죽기 전에 여기서 막는다. 운영 카나리 계정 목록은 생성 상한 예외 계정과 같은 규칙에 더해 공백만 든 값도 막는다."""
        base = {name: {} for name in runtime_secrets.GROUP_KEYS}
        oks = [{"PLANB_SITUATION_SWEEP": mode} for mode in ("off", "dry-run", "on")]
        oks += [{"PLANB_SITUATION_HORIZON": horizon} for horizon in ("today", "tomorrow", "pre-trip")]
        oks += [{"PLANB_PREPARED_REPLAN": mode} for mode in ("off", "on")]
        oks += [{"PLANB_SITUATION_SWEEP_ACCOUNT_IDS": ids}
                for ids in ("", "0D7F17AB-5c4b-4d6d-a7f7-484ba11dda46, 11111111-2222-4333-8444-555555555555")]
        for ok in oks:
            with self.subTest(ok=ok):
                runtime_secrets.validate_groups({**base, "backend": ok})
        bads = [{"PLANB_SITUATION_SWEEP": mode} for mode in ("dry_run", "ON", "true", "")]
        bads += [{"PLANB_SITUATION_HORIZON": horizon} for horizon in ("d-1", "pretrip", "TOMORROW", "")]
        bads += [{"PLANB_PREPARED_REPLAN": mode} for mode in ("dry-run", "true", "")]
        # 파이썬 uuid 는 받지만 백엔드는 못 읽는 모양까지 — DB 도구에서 대시 없이 복사해 오는 것이 흔하다.
        # 공백만 든 값은 '빈 값'이 아니다 — 백엔드 바인딩이 [null] 로 읽어 아무 계정도 안 맞는 목록이 된다(백엔드가 기동에서 거부).
        bads += [{"PLANB_SITUATION_SWEEP_ACCOUNT_IDS": ids}
                 for ids in ("not-a-uuid", "0d7f17ab5c4b4d6da7f7484ba11dda46", "{0d7f17ab-5c4b-4d6d-a7f7-484ba11dda46}",
                             "0d7f17ab-5c4b-4d6d-a7f7-484ba11dda46,", " ", "\t")]
        for bad in bads:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                runtime_secrets.validate_groups({**base, "backend": bad})

    def test_situation_keys_reach_both_the_allowlist_and_the_chart(self):
        """정본 키 표(situation-awareness tech-stack 델타 6 — 백엔드 런타임 키 4종) ⊆ 허용목록 ∧ 차트가 파드에 싣는 목록.
        허용목록에서 빠지면 시크릿에 넣는 순간 배포가 거부되고, 차트에서 빠지면 시크릿 값이 파드에 **조용히** 안 닿는다
        (앱은 기본 off 로 뜬다). 차트가 싣는 backend 시크릿 키는 모두 허용목록 안이어야 한다 — 반대면 넣을 길이 없는 키다."""
        chart = (Path(__file__).resolve().parents[1] / "chart" / "templates" / "backend.yaml").read_text()
        line = next(text for text in chart.splitlines() if "range list" in text and '"GOOGLE_CLIENT_ID"' in text)
        listed = set(re.findall(r'"([A-Z0-9_]+)"', line))
        for key in ("PLANB_SITUATION_SWEEP", "PLANB_SITUATION_HORIZON", "PLANB_SITUATION_SWEEP_ACCOUNT_IDS",
                    "PLANB_PREPARED_REPLAN"):
            with self.subTest(key=key):
                self.assertIn(key, runtime_secrets.BACKEND_KEYS)
                self.assertIn(key, listed)
        self.assertLessEqual(listed, runtime_secrets.BACKEND_KEYS)

    def test_sweep_without_real_weather_is_called_out_on_every_deploy(self):
        """스윕을 켰는데(dry-run·on) 날씨 모드가 kma 가 아니면 단기예보·특보·대기질 감지기가 꺼진 채 돈다(휴무만 본다).
        배포는 막지 않는다 — 장소 감지만으로 켜는 것도 정상 선택이라서다. 대신 배포마다 크게 말한다."""
        def gaps(backend):
            return list(runtime_secrets.open_gaps({**{name: {} for name in runtime_secrets.GROUP_KEYS}, "backend": backend}))
        self.assertEqual(len(gaps({"PLANB_SITUATION_SWEEP": "on"})), 1)  # 날씨 모드가 없으면 기본 fake 다
        self.assertIn("WEATHER_MODE", gaps({"PLANB_SITUATION_SWEEP": "dry-run", "WEATHER_MODE": "fake"})[0])
        self.assertEqual(gaps({"PLANB_SITUATION_SWEEP": "on", "WEATHER_MODE": "kma", "WEATHER_API": "key"}), [])
        self.assertEqual(gaps({"PLANB_SITUATION_SWEEP": "off", "WEATHER_MODE": "fake"}), [])
        self.assertEqual(gaps({"WEATHER_MODE": "fake"}), [])  # 스윕 키가 없으면 꺼짐이다

    def test_missing_kakao_app_id_is_called_out_on_every_deploy(self):
        """값이 빠져도 배포는 막지 않는다 — 대신 조용히 넘어가지 않는다(TRIP-1317). 로그인에 카카오를 쓰는데
        앱 ID 가 없으면 남의 앱 토큰으로 가입이 열린 채 돈다."""
        def gaps(backend):
            return list(runtime_secrets.open_gaps({**{name: {} for name in runtime_secrets.GROUP_KEYS}, "backend": backend}))
        self.assertEqual(len(gaps({"KAKAO_CLIENT_ID": "rest-key"})), 1)
        self.assertIn("KAKAO_APP_ID", gaps({"KAKAO_CLIENT_ID": "rest-key", "KAKAO_APP_ID": ""})[0])
        self.assertEqual(gaps({"KAKAO_CLIENT_ID": "rest-key", "KAKAO_APP_ID": "1519823"}), [])
        self.assertEqual(gaps({}), [])  # 카카오 키가 아예 없는 환경은 말하지 않는다

    @patch("runtime_secrets.validate_rsa_key")
    @patch("runtime_secrets.rsa_key", return_value="fake-test-key")
    def test_sync_prints_open_gaps_as_workflow_warnings(self, keygen, keycheck):
        """`open_gaps` 가 맞아도 `sync` 가 안 부르면 아무도 못 본다 — 배포 실행 요약에 뜨는 형식까지 본다."""
        backend_arn = outputs()["app_secret_arns"]["backend"]
        def execute(argv, payload=None):
            if "get-secret-value" in argv:
                kakao = {"KAKAO_CLIENT_ID": "rest-key"} if argv[argv.index("--secret-id") + 1] == backend_arn else {}
                return json.dumps({"SecretString": json.dumps(kakao)})
            return "{}"
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            runtime_secrets.sync(outputs(), "trippilot", False, execute)
        self.assertRegex(printed.getvalue(), r"(?m)^::warning title=[^:,]+::KAKAO_APP_ID is not set")

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

    def test_public_data_key_is_allowlisted_in_backend_and_ai(self):
        """공공데이터포털 키(기상특보·에어코리아·특일정보)는 백엔드·AI 둘 다 읽는다 — 한쪽 목록에서 빠지면 그 그룹에 넣는 순간
        배포 전체가 거부된다."""
        for group in ("backend", "ai"):
            with self.subTest(group=group):
                runtime_secrets.validate_groups({**{name: {} for name in runtime_secrets.GROUP_KEYS},
                                                 group: {"PUBLIC_DATA_API_KEY": "key"}})

    def test_runtime_secret_does_not_expose_master_or_cross_service_keys(self):
        groups = runtime_secrets.seed_groups({name: {} for name in runtime_secrets.GROUP_KEYS}, lambda: "pass/@'word", lambda: "rsa")
        manifests = runtime_secrets.runtime_manifests(groups, outputs(), "trippilot")
        by_name = {item["metadata"]["name"]: item["stringData"] for item in manifests}
        ai = by_name["trippilot-ai"]
        self.assertIn("pass%2F%40%27word", ai["TRIPPILOT_VECTOR_DB_URL"])
        self.assertIn("sslmode=require", ai["TRIPPILOT_VECTOR_DB_URL"])
        self.assertNotIn("JWT_SIGNING_KEY", ai)
        self.assertNotIn("PGPASSWORD", json.dumps(manifests))
        self.assertNotIn("DB_PASSWORD", by_name["trippilot-backend"])
        self.assertTrue(all("data" not in item for item in manifests))

    def test_vector_connection_is_synthesized_regardless_of_embedding(self):
        """ai_kb 는 더는 임베딩 전용 DB 가 아니다 — 도우미 세션 메모리(dialogue_memory)가 거기 산다.
        종전에는 embedding_enabled 일 때만 DSN 을 합성했고, 그러면 임베딩을 끈 배포에서 메모리 저장소가
        조용히 InMemory(워커 2×파드 N 이라 '기억' 불성립)로 떨어진다. sync 의 embedding_enabled 인자는
        runtime.py CLI 계약으로 남지만 DSN 합성에는 더 쓰이지 않는다."""
        groups = runtime_secrets.seed_groups({name: {} for name in runtime_secrets.GROUP_KEYS}, lambda: "pw", lambda: "rsa")
        manifests = runtime_secrets.runtime_manifests(groups, outputs(), "trippilot")
        ai = next(item["stringData"] for item in manifests if item["metadata"]["name"] == "trippilot-ai")
        self.assertEqual(ai["TRIPPILOT_VECTOR_DB_URL"],
                         "postgresql://ai_user:pw@db.example.rds.amazonaws.com:5432/ai_kb?sslmode=require")

    def test_dialogue_orchestrator_switches_are_allowlisted_and_validated(self):
        """도우미 오케스트레이터 스위치 2종(assistant-orchestrator 1단계)은 ai 시크릿으로만 켠다.
        allowlist 에 없으면 시크릿에 넣는 순간 배포 전체가 거부되고, 값이 틀리면 AI 가 기동에서 죽는다
        (main.py: on|off 외 오타·0~1 밖 비율 = 기동 실패) — 파드가 뜨다 죽기 전에 여기서 막는다."""
        base = {name: {} for name in runtime_secrets.GROUP_KEYS}
        for ok in ({"TRIPPILOT_DIALOGUE_ORCHESTRATOR": "on"}, {"TRIPPILOT_DIALOGUE_ORCHESTRATOR": "off"},
                   {"TRIPPILOT_DIALOGUE_ORCHESTRATOR": ""},
                   {"TRIPPILOT_DIALOGUE_SHADOW_RATE": "0"}, {"TRIPPILOT_DIALOGUE_SHADOW_RATE": "1"},
                   {"TRIPPILOT_DIALOGUE_SHADOW_RATE": "0.2"}, {"TRIPPILOT_DIALOGUE_SHADOW_RATE": ""},
                   {"TRIPPILOT_DIALOGUE_ORCHESTRATOR": "on", "TRIPPILOT_DIALOGUE_SHADOW_RATE": "1.0"}):
            with self.subTest(ok=ok):
                runtime_secrets.validate_groups({**base, "ai": ok})
        for bad in ({"TRIPPILOT_DIALOGUE_ORCHESTRATOR": "true"}, {"TRIPPILOT_DIALOGUE_ORCHESTRATOR": "ON"},
                    {"TRIPPILOT_DIALOGUE_ORCHESTRATOR": "yes"},
                    {"TRIPPILOT_DIALOGUE_SHADOW_RATE": "1.5"}, {"TRIPPILOT_DIALOGUE_SHADOW_RATE": "-0.1"},
                    {"TRIPPILOT_DIALOGUE_SHADOW_RATE": "abc"}, {"TRIPPILOT_DIALOGUE_SHADOW_RATE": "nan"},
                    {"TRIPPILOT_DIALOGUE_SHADOW_RATE": "inf"}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                runtime_secrets.validate_groups({**base, "ai": bad})

    def test_dialogue_memory_ddl_is_identical_in_both_canons(self):
        """`dialogue_memory` DDL 정본은 둘이다(FD DE §4) — EKS 는 bootstrap.sql(마스터 Job, 매 배포 멱등),
        로컬 compose 는 ai/docker/vector-init/02-dialogue-memory.sql(initdb 1회). 어댑터는 DML 만 하므로
        두 파일이 갈리면 로컬에서 통과한 SQL 이 배포에서 깨진다. 주석·공백을 걷어 문장 단위로 비교한다.

        GRANT 는 bootstrap 에만 있다 — compose 의 ai-vectordb 는 POSTGRES_USER=ai_kb(소유자)로 붙고 `ai_user`
        롤이 없어, initdb 에서 GRANT … TO ai_user 는 ON_ERROR_STOP 으로 컨테이너 초기화를 통째로 죽인다."""
        import re

        def statements(path):
            text = re.sub(r"--[^\n]*", "", path.read_text(encoding="utf-8"))
            return {" ".join(stmt.split()) for stmt in text.split(";") if "dialogue_memory" in stmt}

        bootstrap = Path(runtime_db.__file__).with_name("bootstrap.sql")
        compose = Path(__file__).resolve().parents[3] / "ai" / "docker" / "vector-init" / "02-dialogue-memory.sql"
        eks, local = statements(bootstrap), statements(compose)
        grants = {stmt for stmt in eks if stmt.startswith("GRANT")}
        self.assertEqual(grants, {"GRANT SELECT, INSERT, UPDATE, DELETE ON public.dialogue_memory TO ai_user"})
        self.assertEqual(eks - grants, local)
        self.assertEqual({stmt.split(" (")[0] for stmt in local}, {
            "CREATE TABLE IF NOT EXISTS public.dialogue_memory",
            "CREATE INDEX IF NOT EXISTS ix_dialogue_memory_account ON public.dialogue_memory",
            "CREATE INDEX IF NOT EXISTS ix_dialogue_memory_trip ON public.dialogue_memory"})
        # ai_kb 데이터베이스 안에서만 — \connect 뒤에 있어야 trippilot DB 에 잘못 만들지 않는다.
        sql = bootstrap.read_text(encoding="utf-8")
        self.assertLess(sql.index("\\connect ai_kb"), sql.index("dialogue_memory"))

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


class TargetTests(unittest.TestCase):
    """개발·운영 분리(2026-10-15) — 대상이 네임스페이스·시크릿 그릇·DB 장비를 통째로 바꾼다."""

    DEV = {
        "dev_target_secret_arns": {name: f"arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:trippilot/dev/dev-target/{name}-x"
                                   for name in ("backend", "ai", "database", "shared")},
        "dev_target_database_host": "dev-target.example.rds.amazonaws.com",
        "dev_target_database_master_secret_arn": "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:rds!db-dev-target",
    }

    def raw(self, dev=None):
        return {key: {"value": value} for key, value in {**outputs(), **(self.DEV if dev is None else dev)}.items()}

    def test_dev_target_reads_only_its_own_secrets_and_database(self):
        dev = runtime.parse_outputs(self.raw(), "dev")
        prod = runtime.parse_outputs(self.raw(), "prod")
        self.assertEqual(prod, outputs())
        self.assertEqual(dev["app_secret_arns"], self.DEV["dev_target_secret_arns"])
        self.assertEqual(dev["database_host"], "dev-target.example.rds.amazonaws.com")
        self.assertIn("rds!db-dev-target", dev["database_master_secret_arn"])
        # 공유 자원(리전·클러스터·Redis·이미지 저장소)은 같다
        for key in ("aws_region", "cluster_name", "redis_host", "ecr_repositories"):
            self.assertEqual(dev[key], prod[key])

    def test_dev_target_never_falls_back_to_production(self):
        # 스위치가 꺼진 스택은 개발 출력이 빈 값이다 — 운영 값으로 떨어지면 개발 배포가 운영 DB·시크릿을 쓴다
        empty = {"dev_target_secret_arns": {}, "dev_target_database_host": "", "dev_target_database_master_secret_arn": ""}
        for dev in ({}, empty):
            with self.subTest(dev=dev), self.assertRaises(ValueError):
                runtime.parse_outputs(self.raw(dev), "dev")
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            runtime.parser().parse_args(["smoke", "--target", "staging"])

    def test_dev_outputs_wired_to_production_are_refused(self):
        prod = outputs()
        for dev in ({**self.DEV, "dev_target_database_host": prod["database_host"]},
                    {**self.DEV, "dev_target_database_master_secret_arn": prod["database_master_secret_arn"]},
                    {**self.DEV, "dev_target_secret_arns": prod["app_secret_arns"]}):
            with self.subTest(dev=dev), self.assertRaises(ValueError):
                runtime.parse_outputs(self.raw(dev), "dev")

    def test_main_hands_the_target_to_every_outputs_consumer(self):
        """누출을 실제로 막는 줄은 main 이 대상을 parse_outputs 로 넘기는 곳이다 — 빠지면 개발 배포가 운영 값을 쓴다."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "outputs.json"
            path.write_text(json.dumps(self.raw()))
            prod_values = {outputs()["database_host"], outputs()["database_master_secret_arn"], *outputs()["app_secret_arns"].values()}
            for action, patched, extra in (("sync-secrets", "runtime.runtime_secrets.sync", []),
                                           ("bootstrap-db", "runtime.runtime_db.bootstrap", ["--run-id", "1-1"])):
                with self.subTest(action=action), patch(patched) as consumer, patch("builtins.print"):
                    runtime.main([action, "--target", "dev", "--outputs", str(path), *extra])
                    seen, namespace = consumer.call_args.args[0], consumer.call_args.args[1]
                    self.assertEqual(namespace, "trippilot-dev")
                    self.assertEqual(seen["database_host"], self.DEV["dev_target_database_host"])
                    self.assertFalse(prod_values & {seen["database_host"], seen["database_master_secret_arn"], *seen["app_secret_arns"].values()})
            values = Path(directory) / "values.json"
            with patch("builtins.print"):
                runtime.main(["render-values", "--target", "dev", "--outputs", str(path), "--image-tag", "sha-1",
                              "--certificate-arn", "arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789abc",
                              "--hostname", "dev-api.example.com", "--output", str(values)])
            self.assertEqual(json.loads(values.read_text())["config"]["databaseHost"], self.DEV["dev_target_database_host"])

    def test_target_fixes_the_namespace(self):
        with patch("runtime.runtime_smoke.run") as smoke, patch("builtins.print"):
            runtime.main(["smoke", "--target", "dev"])
            self.assertEqual(smoke.call_args.args[0], "trippilot-dev")
            runtime.main(["smoke"])
            self.assertEqual(smoke.call_args.args[0], "trippilot")
            runtime.main(["smoke", "--target", "dev", "--namespace", "trippilot-dev"])
            self.assertEqual(smoke.call_args.args[0], "trippilot-dev")
        # 어긋난 짝은 무엇도 실행하기 전에 거절 — 개발 값이 운영 네임스페이스 시크릿을 덮는 사고
        for argv in (["smoke", "--target", "dev", "--namespace", "trippilot"],
                     ["smoke", "--namespace", "trippilot-dev"]):
            with self.subTest(argv=argv), patch("runtime.runtime_smoke.run") as smoke, self.assertRaises(ValueError):
                runtime.main(argv)
            smoke.assert_not_called()


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

    def test_embedding_uses_its_content_tag_so_unchanged_code_does_not_roll(self):
        """임베딩만 빌드 맥락 내용 해시 태그 — 런 태그를 쓰면 코드가 그대로여도 매 배포 파드가 바뀌고,
        maxSurge 0 이라 그때마다 엔드포인트가 빈다(10-14 하루 15회+). 다른 셋은 런 태그 그대로."""
        arn = "arn:aws:acm:ap-northeast-2:123456789012:certificate/12345678-1234-1234-1234-123456789abc"
        values = runtime.helm_values(outputs(), "sha-1-2-1", arn, "api-dev.example.com", True, "emb-abc123")
        self.assertEqual(values["images"]["embedding"]["tag"], "emb-abc123")
        self.assertEqual({values["images"][n]["tag"] for n in ("backend", "ai")}, {"sha-1-2-1"})
        # 안 주면 종전 그대로(임베딩을 끈 배포 등)
        self.assertEqual(runtime.helm_values(outputs(), "sha-1-2-1", arn, "api-dev.example.com", False)
                         ["images"]["embedding"]["tag"], "sha-1-2-1")
        with self.assertRaises(ValueError):
            runtime.helm_values(outputs(), "sha-1-2-1", arn, "api-dev.example.com", True, "bad tag")

    def test_only_embedding_template_skips_the_rollout_nonce(self):
        """nonce 는 시크릿 env 를 다시 읽히려는 것 — 시크릿 env 가 있는 셋엔 남고, 없는 임베딩엔 없다."""
        templates = Path(__file__).resolve().parents[1] / "chart" / "templates"
        self.assertNotIn("rolloutNonce", (templates / "embedding.yaml").read_text(encoding="utf-8"))
        self.assertNotIn("secretKeyRef", (templates / "embedding.yaml").read_text(encoding="utf-8"))
        for name in ("ai.yaml", "backend.yaml", "gateway.yaml"):
            with self.subTest(name=name):
                self.assertIn("rolloutNonce", (templates / name).read_text(encoding="utf-8"))

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

    def test_sync_overrides_push_mode_only_when_asked(self, keygen=None, keycheck=None):
        """푸시를 켜는 길이 시크릿 손편집뿐이면 로컬 자격이 만료된 날엔 못 켠다 — 배포 입력이 직접 쓴다.
        지정하지 않으면(유지) 저장된 값을 건드리지 않는다(종전 보존 규칙 그대로)."""
        saved = {arn: {} for arn in outputs()["app_secret_arns"].values()}
        backend_arn = outputs()["app_secret_arns"]["backend"]
        saved[backend_arn] = {"PUSH_MODE": "off"}

        def execute(argv, payload=None):
            if "get-secret-value" in argv:
                arn = argv[argv.index("--secret-id") + 1]
                return json.dumps({"SecretString": json.dumps(saved[arn])})
            if "put-secret-value" in argv:
                path = next(a for a in argv if a.startswith("file://"))[len("file://"):]
                with open(path, encoding="utf-8") as stream:
                    request = json.load(stream)
                saved[request["SecretId"]] = json.loads(request["SecretString"])
                return "{}"
            return "{}"

        with patch("runtime_secrets.rsa_key", return_value="k"), patch("runtime_secrets.validate_rsa_key"):
            runtime_secrets.sync(outputs(), "trippilot", False, execute)
            self.assertEqual(saved[backend_arn]["PUSH_MODE"], "off")
            runtime_secrets.sync(outputs(), "trippilot", False, execute, push_mode="expo")
            self.assertEqual(saved[backend_arn]["PUSH_MODE"], "expo")
            runtime_secrets.sync(outputs(), "trippilot", False, execute)
            self.assertEqual(saved[backend_arn]["PUSH_MODE"], "expo")  # 유지는 덮지 않는다

    def _saved_secrets(self, ai=None, running=None):
        """`running` = 지금 떠 있는 AI 이미지가 아는 기능 이름들(None 이면 AI Deployment 가 없는 첫 설치)."""
        saved = {arn: {} for arn in outputs()["app_secret_arns"].values()}
        saved[outputs()["app_secret_arns"]["ai"]] = dict(ai or {})
        self.writes = []

        def execute(argv, payload=None):
            if argv[:3] == ["kubectl", "get", "deployment"]:
                return "" if running is None else "deployment.apps/ai\n"
            if argv[:2] == ["kubectl", "exec"]:
                return " ".join(sorted(running or ())) + "\n"
            if argv[:2] == ["kubectl", "apply"]:
                self.writes.append("apply")
                return "{}"
            if "get-secret-value" in argv:
                arn = argv[argv.index("--secret-id") + 1]
                return json.dumps({"SecretString": json.dumps(saved[arn])})
            if "put-secret-value" in argv:
                path = next(a for a in argv if a.startswith("file://"))[len("file://"):]
                with open(path, encoding="utf-8") as stream:
                    request = json.load(stream)
                saved[request["SecretId"]] = json.loads(request["SecretString"])
                self.writes.append(request["SecretId"])
            return "{}"
        return saved, execute

    def test_sync_writes_dialogue_inputs_and_keeps_them_on_later_deploys(self):
        """도우미 스위치·모델 배정도 로컬 자격 없이 켤 수 있어야 한다(2026-10-18 샌드박스 토큰 만료) — 배포 입력이 시크릿에 쓰고,
        입력 없는 다음 배포(다른 세션의 평소 배포)는 저장값을 그대로 둔다. 다른 기능의 배정·키는 건드리지 않는다."""
        ai_arn = outputs()["app_secret_arns"]["ai"]
        saved, execute = self._saved_secrets({"OPENAI_API_KEY": "sk-x", "TRIPPILOT_LLM_FEATURE_MODELS": "INTENT=gpt-5.6-sol,PARAPHRASE=gpt-5.6-luna"},
                                             running=runtime_secrets.known_llm_features())
        with patch("runtime_secrets.rsa_key", return_value="k"), patch("runtime_secrets.validate_rsa_key"), \
                patch("builtins.print") as printed:
            runtime_secrets.sync(outputs(), "trippilot-dev", False, execute, target="dev", dialogue_orchestrator="on",
                                 llm_feature_models="DIALOGUE_INTENT=gpt-5.6-luna, intent=gpt-5.6-terra")
            ai = saved[ai_arn]
            self.assertEqual(ai["TRIPPILOT_DIALOGUE_ORCHESTRATOR"], "on")
            # 같은 기능은 자리 그대로 바뀌고(소문자도 같은 기능), 새 기능은 뒤에 붙고, 나머지는 그대로다
            self.assertEqual(ai["TRIPPILOT_LLM_FEATURE_MODELS"],
                             "INTENT=gpt-5.6-terra,PARAPHRASE=gpt-5.6-luna,DIALOGUE_INTENT=gpt-5.6-luna")
            self.assertEqual(ai["OPENAI_API_KEY"], "sk-x")
            self.assertNotIn("TRIPPILOT_DIALOGUE_SHADOW_RATE", ai)  # 개발 대상은 AI 기본값(1.0)을 쓴다
            lines = " ".join(str(call.args[0]) for call in printed.call_args_list)
            self.assertIn("TRIPPILOT_DIALOGUE_ORCHESTRATOR", lines)
            self.assertNotIn("sk-x", lines)  # 이름만 찍는다
            runtime_secrets.sync(outputs(), "trippilot-dev", False, execute, target="dev")
            self.assertEqual(saved[ai_arn], ai)  # 유지는 덮지 않는다
            runtime_secrets.sync(outputs(), "trippilot-dev", False, execute, target="dev", dialogue_orchestrator="off")
            self.assertEqual(saved[ai_arn]["TRIPPILOT_DIALOGUE_ORCHESTRATOR"], "off")

    def test_sync_seeds_production_shadow_rate_only_when_absent(self):
        """섀도 비율은 사용자 결정(개발 1.0 · 운영 0.2) — 운영 대상에서 비어 있을 때만 0.2 를 심고, 저장값은 이긴다."""
        ai_arn = outputs()["app_secret_arns"]["ai"]
        with patch("runtime_secrets.rsa_key", return_value="k"), patch("runtime_secrets.validate_rsa_key"), patch("builtins.print"):
            saved, execute = self._saved_secrets()
            runtime_secrets.sync(outputs(), "trippilot", False, execute, target="prod")
            self.assertEqual(saved[ai_arn]["TRIPPILOT_DIALOGUE_SHADOW_RATE"], "0.2")
            saved, execute = self._saved_secrets({"TRIPPILOT_DIALOGUE_SHADOW_RATE": "0.5"})
            runtime_secrets.sync(outputs(), "trippilot", False, execute, target="prod")
            self.assertEqual(saved[ai_arn]["TRIPPILOT_DIALOGUE_SHADOW_RATE"], "0.5")
            for blank in ("", "  "):  # 빈 값은 "없음" — AI 의 `_env` 도 빈 값을 미설정(1.0)으로 읽는다
                saved, execute = self._saved_secrets({"TRIPPILOT_DIALOGUE_SHADOW_RATE": blank})
                runtime_secrets.sync(outputs(), "trippilot", False, execute, target="prod")
                self.assertEqual(saved[ai_arn]["TRIPPILOT_DIALOGUE_SHADOW_RATE"], "0.2")
            saved, execute = self._saved_secrets()
            runtime_secrets.sync(outputs(), "trippilot-dev", False, execute, target="dev")
            self.assertEqual(saved[ai_arn], {})

    def test_sync_writes_the_public_data_key_to_backend_and_ai_without_printing_it(self):
        """공공데이터포털 키는 GitHub 시크릿 → 배포 역할이 backend·ai 두 그룹에 쓴다 — 로컬 AWS 자격 없이. 한쪽만 들어가면
        그쪽 기능만 조용히 빈다(날씨 키가 EKS 에서 겪는 두 그룹 함정). 값은 출력 어디에도 없다 — 쓴 그룹 이름만."""
        arns = outputs()["app_secret_arns"]
        saved, execute = self._saved_secrets({"OPENAI_API_KEY": "sk-x"})
        printed = io.StringIO()
        with patch("runtime_secrets.rsa_key", return_value="k"), patch("runtime_secrets.validate_rsa_key"):
            with contextlib.redirect_stdout(io.StringIO()):
                runtime_secrets.sync(outputs(), "trippilot", False, execute)  # 첫 배포 시드 — 아래 쓰기만 센다
            self.writes.clear()
            with contextlib.redirect_stdout(printed):
                runtime_secrets.sync(outputs(), "trippilot", False, execute, public_data_api_key=" pd-secret-value\n")
        for group in ("backend", "ai"):
            self.assertEqual(saved[arns[group]]["PUBLIC_DATA_API_KEY"], "pd-secret-value")
        self.assertEqual(sorted(write for write in self.writes if write != "apply"), sorted((arns["backend"], arns["ai"])))
        self.assertEqual(saved[arns["ai"]]["OPENAI_API_KEY"], "sk-x")  # 다른 키는 그대로
        self.assertIn("public data key written: backend, ai", printed.getvalue())
        self.assertNotIn("pd-secret-value", printed.getvalue())

    def test_sync_keeps_the_stored_public_data_key_when_absent_or_unchanged(self):
        """시크릿이 없거나 빈 런은 저장값을 지우지 않고, 같은 값이면 쓰지 않는다 — 다른 변경이 없으면 put 0회."""
        arns = outputs()["app_secret_arns"]
        saved, execute = self._saved_secrets({"PUBLIC_DATA_API_KEY": "stored"})
        with patch("runtime_secrets.rsa_key", return_value="k"), patch("runtime_secrets.validate_rsa_key"), \
                patch("builtins.print") as printed:
            runtime_secrets.sync(outputs(), "trippilot", False, execute)  # 첫 배포 시드
            saved[arns["backend"]]["PUBLIC_DATA_API_KEY"] = "stored"
            for given in (None, "", "  \n", "stored"):
                with self.subTest(given=given):
                    self.writes.clear()
                    printed.reset_mock()
                    runtime_secrets.sync(outputs(), "trippilot", False, execute, public_data_api_key=given)
                    self.assertEqual([write for write in self.writes if write != "apply"], [])
                    for group in ("backend", "ai"):
                        self.assertEqual(saved[arns[group]]["PUBLIC_DATA_API_KEY"], "stored")
                    self.assertNotIn("public data key written", " ".join(str(call.args[0]) for call in printed.call_args_list))

    def test_feature_model_overrides_reject_unknown_features_and_malformed_pairs_before_writing(self):
        """모르는 기능 이름이 배정에 들어가면 AI 가 기동에서 죽는다(`feature_models_from_env`) — 쓰기 전에 거절한다."""
        known = runtime_secrets.known_llm_features()
        for bad in ("DIALOGUE_INTNET=gpt-5.6-luna", "DIALOGUE_INTENT=", "DIALOGUE_INTENT", "DIALOGUE_INTENT=a b"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                runtime_secrets.merge_feature_models("", bad, known)
        saved, execute = self._saved_secrets({"TRIPPILOT_LLM_FEATURE_MODELS": "INTENT=gpt-5.6-sol"}, running=known)
        with patch("runtime_secrets.rsa_key", return_value="k"), patch("runtime_secrets.validate_rsa_key"), \
                self.assertRaises(ValueError):
            runtime_secrets.sync(outputs(), "trippilot", False, execute, target="prod", llm_feature_models="NOPE=gpt-5.6-luna")
        self.assertEqual(saved[outputs()["app_secret_arns"]["ai"]], {"TRIPPILOT_LLM_FEATURE_MODELS": "INTENT=gpt-5.6-sol"})
        self.assertEqual(self.writes, [])  # 시크릿·k8s Secret 어느 쪽도 쓰지 않았다
        # 저장값에 이 커밋이 모르는 낡은 이름이 있으면 덧씌우기도 거절한다(그대로 다시 쓰면 새 AI 가 기동에서 죽는다)
        with self.assertRaisesRegex(ValueError, "OLD_FEATURE"):
            runtime_secrets.merge_feature_models("OLD_FEATURE=gpt-5.6-sol", "INTENT=gpt-5.6-luna", known)

    def test_new_feature_names_wait_until_the_running_ai_image_knows_them(self):
        """sync 는 helm 보다 먼저 시크릿과 k8s Secret 을 덮고, helm --atomic 롤백은 그 Secret 을 되돌리지 않는다(차트 밖 리소스).
        그래서 새 기능 이름은 그 이름을 아는 이미지가 이미 떠 있을 때만 받는다 — 아니면 롤백된 옛 이미지가 재시작 때 기동에서
        죽는다(2026-10-18 리뷰 확정, origin/main 파서로 재현). 첫 설치(Deployment 없음)는 대조할 이미지가 없어 통과한다."""
        known = runtime_secrets.known_llm_features()
        old_image = known - {"DIALOGUE_INTENT", "DIALOGUE_ANSWER", "DIALOGUE_MEMORY"}
        ai_arn = outputs()["app_secret_arns"]["ai"]
        with patch("runtime_secrets.rsa_key", return_value="k"), patch("runtime_secrets.validate_rsa_key"), patch("builtins.print"):
            saved, execute = self._saved_secrets({"TRIPPILOT_LLM_FEATURE_MODELS": "INTENT=gpt-5.6-sol"}, running=old_image)
            with self.assertRaisesRegex(ValueError, "running AI image does not know DIALOGUE_INTENT"):
                runtime_secrets.sync(outputs(), "trippilot", False, execute, target="prod",
                                     llm_feature_models="DIALOGUE_INTENT=gpt-5.6-luna")
            self.assertEqual(self.writes, [])
            # 옛 이미지가 아는 이름만 바꾸는 것은 된다
            runtime_secrets.sync(outputs(), "trippilot", False, execute, target="prod", llm_feature_models="INTENT=gpt-5.6-luna")
            self.assertEqual(saved[ai_arn]["TRIPPILOT_LLM_FEATURE_MODELS"], "INTENT=gpt-5.6-luna")
            saved, execute = self._saved_secrets(running=None)  # 첫 설치
            runtime_secrets.sync(outputs(), "trippilot-dev", False, execute, target="dev",
                                 llm_feature_models="DIALOGUE_INTENT=gpt-5.6-luna")
            self.assertEqual(saved[ai_arn]["TRIPPILOT_LLM_FEATURE_MODELS"], "DIALOGUE_INTENT=gpt-5.6-luna")

    def test_known_features_are_read_from_the_same_commits_ai_enum(self):
        known = runtime_secrets.known_llm_features()
        self.assertTrue({"INTENT", "PARAPHRASE", "DIALOGUE_INTENT", "DIALOGUE_ANSWER", "DIALOGUE_MEMORY"} <= known)
        self.assertGreaterEqual(len(known), 20)  # 정규식이 조용히 빈 집합이 되면 모든 배정을 거절한다 — 그 고장을 여기서 본다

    def test_sync_secrets_cli_passes_dialogue_inputs_and_target(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "outputs.json"
            source.write_text(json.dumps({key: {"value": value} for key, value in outputs().items()}))
            with patch("runtime.runtime_secrets.sync") as sync, patch("builtins.print"):
                runtime.main(["sync-secrets", "--outputs", str(source), "--dialogue-orchestrator", "on",
                              "--llm-feature-models", "DIALOGUE_INTENT=gpt-5.6-luna"])
                self.assertEqual(sync.call_args.kwargs["dialogue_orchestrator"], "on")
                self.assertEqual(sync.call_args.kwargs["llm_feature_models"], "DIALOGUE_INTENT=gpt-5.6-luna")
                self.assertEqual(sync.call_args.kwargs["target"], "prod")
                runtime.main(["sync-secrets", "--outputs", str(source)])
                self.assertIsNone(sync.call_args.kwargs["dialogue_orchestrator"])
                self.assertIsNone(sync.call_args.kwargs["llm_feature_models"])
            with self.assertRaises(SystemExit), patch("sys.stderr"):
                runtime.main(["sync-secrets", "--outputs", str(source), "--dialogue-orchestrator", "true"])

    def test_sync_secrets_cli_passes_push_mode_and_rejects_unknown(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "outputs.json"
            source.write_text(json.dumps({key: {"value": value} for key, value in outputs().items()}))
            with patch("runtime.runtime_secrets.sync") as sync, patch("builtins.print"):
                runtime.main(["sync-secrets", "--outputs", str(source), "--push-mode", "expo"])
                self.assertEqual(sync.call_args.kwargs["push_mode"], "expo")
                runtime.main(["sync-secrets", "--outputs", str(source)])
                self.assertIsNone(sync.call_args.kwargs["push_mode"])
            with self.assertRaises(SystemExit), patch("sys.stderr"):
                runtime.main(["sync-secrets", "--outputs", str(source), "--push-mode", "fcm"])

    def test_sync_secrets_cli_reads_the_public_data_key_from_env_not_argv(self):
        """비밀값은 argv 에 올리지 않는다(프로세스 목록·로그에 남는다) — 워크플로가 그 스텝 env 로만 싣는다."""
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "outputs.json"
            source.write_text(json.dumps({key: {"value": value} for key, value in outputs().items()}))
            with patch("runtime.runtime_secrets.sync") as sync, patch("builtins.print"):
                with patch.dict(os.environ, {"PUBLIC_DATA_API_KEY": "pd-key"}):
                    runtime.main(["sync-secrets", "--outputs", str(source)])
                self.assertEqual(sync.call_args.kwargs["public_data_api_key"], "pd-key")
                with patch.dict(os.environ):
                    os.environ.pop("PUBLIC_DATA_API_KEY", None)
                    runtime.main(["sync-secrets", "--outputs", str(source)])
                self.assertIsNone(sync.call_args.kwargs["public_data_api_key"])

    def test_ensure_namespace_and_cli_commands_dispatch_with_validated_arguments(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "outputs.json"
            target = Path(folder) / "values.json"
            source.write_text(json.dumps({key: {"value": value} for key, value in outputs().items()}))
            common = ["--outputs", str(source)]
            with patch("runtime.command", return_value="{}") as shell, patch("builtins.print"), \
                    patch("runtime_smoke.wait_job"):
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
        shell = Mock(side_effect=["", "123.dkr.ecr/ai:sha-1", "", "Complete", "0", "trippilot-kb-load-ok", "총 1470건", ""])
        with patch("runtime.command", shell), patch("builtins.print") as out:
            runtime.main(["load-kb"])
        calls = [c.args[0] for c in shell.call_args_list]
        self.assertIn("deployment/ai", calls[1])
        applied = json.loads(shell.call_args_list[2].args[1])
        self.assertEqual(applied["spec"]["template"]["spec"]["containers"][0]["image"], "123.dkr.ecr/ai:sha-1")
        self.assertIn("job/trippilot-kb-load", calls[3])
        self.assertIn("pod/trippilot-kb-load-ok", calls[6])
        out.assert_any_call("총 1470건")
        self.assertFalse(any("재시도" in str(c.args[0]) for c in out.call_args_list))
        self.assertIn("delete", calls[-1])

    def test_load_kb_after_retries_shows_the_succeeded_attempt_not_the_failed_one(self):
        """재시도로 완료된 Job 에서 `logs job/…` 이 실패한 첫 시도의 EmbeddingUnreachable 트레이스를 찍고
        바로 'complete' 가 나왔다(10-15 개발 첫 적재) — 적재가 됐는지 로그로 판정할 수 없었다."""
        shell = Mock(side_effect=["", "img", "", "SuccessCriteriaMet Complete", "1", "trippilot-kb-load-2nd", "place_docs.json: 1470건 적재", ""])
        with patch("runtime.command", shell), patch("builtins.print") as out:
            runtime.main(["load-kb"])
        calls = [c.args[0] for c in shell.call_args_list]
        self.assertIn("status.phase=Succeeded", calls[5])
        self.assertIn("pod/trippilot-kb-load-2nd", calls[6])
        shown = "\n".join(str(c.args[0]) for c in out.call_args_list)
        self.assertIn("1회 실패한 뒤 재시도로 완료", shown)
        self.assertIn("place_docs.json: 1470건 적재", shown)

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

    def test_canonical_ingest_script_passes_its_self_check(self):
        """Job 이 싣는 정본 스크립트의 자체 점검을 CI 에서 돌린다 — 이 워크플로가 그 파일 경로에 걸려 있다.
        병합 공유본(출처가 섞인 문서)을 최상단 출처 하나로 몰아 보내면 다른 출처 항목이 한 벌 더 생긴다(#1202)."""
        import subprocess
        import runtime_pois
        done = subprocess.run([sys.executable, str(runtime_pois.SCRIPT), "--self-check"],
                              capture_output=True, text=True, timeout=120, check=False)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_load_pois_job_uses_serving_image_and_the_canonical_script(self):
        """공유본은 서빙 ai 이미지 안에 있고, 스크립트는 복제하지 않고 ConfigMap 으로 싣는다.
        `--close-missing` 은 입력으로만, `--allow-mass-close` 는 어떤 경우에도 넘기지 않는다."""
        import runtime_pois
        bundle = runtime_pois.manifest("trippilot", "123.dkr.ecr/ai:sha-1", "print('canon')")
        self.assertEqual(bundle["kind"], "List")
        configmap, job = bundle["items"]
        self.assertEqual(configmap["data"], {"ingest_pois.py": "print('canon')"})
        pod = job["spec"]["template"]["spec"]
        container = pod["containers"][0]
        self.assertEqual(container["image"], "123.dkr.ecr/ai:sha-1")
        shell = container["command"][2]
        self.assertIn("/scripts/ingest_pois.py --base-url http://backend:8080 /app/data/collected_pois.json", shell)
        self.assertNotIn("--close-missing", shell)
        self.assertEqual(container["workingDir"], "/tmp")  # 되돌리기 SQL 이 쓰이는 곳(루트는 읽기 전용)
        env = {e["name"]: e for e in container["env"]}
        self.assertEqual(env["SERVICE_AUTH_TOKEN"]["valueFrom"]["secretKeyRef"],
                         {"name": "trippilot-shared", "key": "SERVICE_AUTH_TOKEN", "optional": False})
        self.assertTrue(container["securityContext"]["readOnlyRootFilesystem"])
        self.assertEqual(job["spec"]["template"]["metadata"]["labels"]["app.kubernetes.io/name"],
                         "trippilot-poi-load")
        closing = runtime_pois.manifest("trippilot", "img", "x", close_missing=True)
        closing_shell = closing["items"][1]["spec"]["template"]["spec"]["containers"][0]["command"][2]
        self.assertIn("--close-missing", closing_shell)
        self.assertNotIn("--allow-mass-close", closing_shell)
        # 드라이런은 "닫힐 수"만 묻고 **그 다음 평소대로 upsert** — 드라이런이 upsert 를 대신하면 그 배포는 공유본을 안 붓는다.
        probing = runtime_pois.manifest("trippilot", "img", "x", close_missing_dry_run=True)
        probing_shell = probing["items"][1]["spec"]["template"]["spec"]["containers"][0]["command"][2]
        dry, _, real = probing_shell.partition("; ")
        self.assertIn("--dry-run --close-missing", dry)
        self.assertNotIn("&&", probing_shell)  # 드라이런이 409 로 끝나도 적재는 간다 — 정보용이지 게이트가 아니다
        self.assertIn("/app/data/collected_pois.json;", real)
        self.assertNotIn("--close-missing", real.split(";")[0])
        self.assertNotIn("--allow-mass-close", probing_shell)
        # 실제 close_missing 이 켜져 있으면 드라이런은 뜻이 없어 건너뛴다
        both = runtime_pois.manifest("trippilot", "img", "x", close_missing=True, close_missing_dry_run=True)
        self.assertNotIn("--dry-run", both["items"][1]["spec"]["template"]["spec"]["containers"][0]["command"][2])

    def test_load_pois_runs_waits_prints_the_summary_and_cleans_up(self):
        summary = "합계 — 접수=19084 신규=689 갱신=18395 지역코드미상=0\n탈락 없음"
        # 재시도가 있었던 Job: 성공한 파드 이름·실패 횟수 1 → 그 파드의 로그를 읽고 요약에 재시도를 남긴다
        shell = Mock(side_effect=["", "123.dkr.ecr/ai:sha-1", "", "Complete", "trippilot-poi-load-k7x2q", "1", summary, ""])
        with patch("runtime.command", shell), patch("builtins.print") as out:
            runtime.main(["load-pois"])
        calls = [c.args[0] for c in shell.call_args_list]
        self.assertIn("deployment/ai", calls[1])
        applied = json.loads(shell.call_args_list[2].args[1])
        self.assertEqual(applied["kind"], "List")
        self.assertIn("ingest_pois.py", applied["items"][0]["data"])  # 정본 스크립트가 실제로 읽혀 실렸다
        self.assertIn("job/trippilot-poi-load", calls[3])
        out.assert_any_call(summary)
        logs_call = next(c for c in calls if c[:2] == ["kubectl", "logs"])
        self.assertIn("pod/trippilot-poi-load-k7x2q", logs_call)  # `job/…` 이면 실패한 1차 파드 로그를 집을 수 있다
        self.assertIn("--tail=-1", logs_call)  # 꼬리만 읽으면 병합본(84묶음)의 맨 앞 "미포함 정리" 줄이 요약에서 잘린다
        printed = " ".join(str(c.args[0]) for c in out.call_args_list)
        self.assertIn("retried 1 time", printed)
        self.assertIn("job,configmap", calls[-1])  # 둘 다 치운다

    def test_load_pois_summary_reaches_the_step_output_with_drops_and_dry_run_count(self):
        """로그를 안 열어도 보이게 — 합계·탈락(사유별)·드라이런 "닫을 것" 을 한 줄로 GITHUB_OUTPUT 에 쓴다.
        묶음별 진행 줄(`[3/39] …`)·대상 줄은 올리지 않는다."""
        import os
        import tempfile
        import runtime_pois
        logs = ("대상: http://backend:8080/internal/pois/proposals (토큰 설정됨)\n"
                "  /app/data/collected_pois.json: source=TOURAPI 제안=19084건 → 요청 39회\n"
                "  미포함 정리(드라이런 — 닫지 않았다) — TOURAPI ACTIVE 19372 중 목록에 있음 19084 · 닫을 것 288\n"
                "합계 제안 19084건 — 드라이런이라 적재는 보내지 않았다\n"
                "  [1/39] 접수=500 신규=0 갱신=500\n"
                "합계 — 접수=19084 신규=0 갱신=19080 지역코드미상=3\n"
                "탈락(사유별):\n"
                "  gate.category_unmapped: 4\n")
        self.assertEqual(
            runtime_pois.summary_of(logs),
            "미포함 정리(드라이런 — 닫지 않았다) — TOURAPI ACTIVE 19372 중 목록에 있음 19084 · 닫을 것 288"
            " · 합계 제안 19084건 — 드라이런이라 적재는 보내지 않았다"
            " · 합계 — 접수=19084 신규=0 갱신=19080 지역코드미상=3 · 탈락(사유별): · gate.category_unmapped: 4")
        with tempfile.TemporaryDirectory() as folder:
            output = os.path.join(folder, "out")
            shell = Mock(side_effect=["", "img", "", "Complete", "trippilot-poi-load-abc12", "0", logs, ""])
            with patch("runtime.command", shell), patch("builtins.print"), \
                    patch.dict(os.environ, {"GITHUB_OUTPUT": output}):
                runtime.main(["load-pois", "--close-missing-dry-run"])
            with open(output, encoding="utf-8") as stream:
                written = stream.read()
        self.assertTrue(written.startswith("summary=미포함 정리(드라이런"), written)
        self.assertEqual(written.count("\n"), 1)  # 한 줄 — 여러 줄이면 GITHUB_OUTPUT 형식이 깨진다
        applied = json.loads(shell.call_args_list[2].args[1])
        self.assertIn("--dry-run --close-missing", applied["items"][1]["spec"]["template"]["spec"]["containers"][0]["command"][2])

    def test_load_pois_with_no_effect_is_a_failure(self):
        """적재가 '성공'인데 신규·갱신이 0 이면 아무것도 안 들어간 것이다 — 조용히 지나가면 "효과 없음"이 또 온다."""
        shell = Mock(side_effect=["", "img", "", "Complete", "", "0", "합계 — 접수=0 신규=0 갱신=0 지역코드미상=0", ""])
        with patch("runtime.command", shell), patch("builtins.print"), self.assertRaises(RuntimeError):
            runtime.main(["load-pois"])
        self.assertIn("delete", shell.call_args_list[-1].args[0])

    def test_load_pois_failure_shows_the_cause_without_the_token(self):
        logs = "SERVICE_AUTH_TOKEN=s3cret 가 비어 있다\n  [3/39] HTTP 401 — 중단한다. 응답: unauthorized\n"
        shell = Mock(side_effect=["", "img", "", runtime.CommandError("kubectl", "timed out"), logs, ""])
        with patch("runtime.command", shell), patch("builtins.print") as out, \
                self.assertRaises(runtime.CommandError):
            runtime.main(["load-pois"])
        shown = "\n".join(str(c.args[0]) for c in out.call_args_list)
        self.assertIn("HTTP 401", shown)
        self.assertNotIn("s3cret", shown)
        self.assertIn("delete", shell.call_args_list[-1].args[0])

    def test_load_pois_cli_passes_close_missing(self):
        with patch("runtime.runtime_pois.run") as run, patch("builtins.print"):
            runtime.main(["load-pois", "--close-missing"])
            self.assertTrue(run.call_args.kwargs["close_missing"])
            runtime.main(["load-pois"])
            self.assertFalse(run.call_args.kwargs["close_missing"])
            self.assertFalse(run.call_args.kwargs["close_missing_dry_run"])
            runtime.main(["load-pois", "--close-missing-dry-run"])
            self.assertTrue(run.call_args.kwargs["close_missing_dry_run"])

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
        shell = Mock(side_effect=["", "", "Complete", "", table, "", ""])
        with patch("builtins.print") as output:
            runtime_smoke.run("trippilot", shell)
        printed = " ".join(str(call.args[0]) for call in output.call_args_list)
        self.assertIn("ai", printed)
        self.assertIn("metrics-server", printed)  # 비어 있으면 어디를 볼지 알려준다
        get = next(call.args[0] for call in shell.call_args_list if call.args[0][:2] == ["kubectl", "get"])
        self.assertEqual(get[:3], ["kubectl", "get", "hpa"])
        self.assertIn("--ignore-not-found", get)  # HPA 를 안 켠 환경에서 깨지지 않는다

    def test_smoke_says_nothing_when_no_autoscaler_is_enabled(self):
        import runtime_smoke
        shell = Mock(side_effect=["", "", "Complete", "", "", "", ""])
        with patch("builtins.print") as output:
            runtime_smoke.run("trippilot", shell)
        output.assert_not_called()

    def test_smoke_reports_ai_wiring_lines_without_gating_the_deploy(self):
        """AI 기동 배선 한 줄들을 배포 로그에 남기되, 공백이어도 배포를 깨지 않는다.

        키가 빠지면 AI 는 기동에 성공하고 품질만 조용히 떨어진다 — 그 경고는 파드
        로그에만 남아 클러스터 자격 없이는 안 보였다(2026-10-05 실제로 막힌 자리).
        단언하지 않는 이유는 `WEATHER_API` 가 선택값이어서, 없이 도는 환경을 배포할 수
        있어야 하기 때문이다.
        """
        import runtime_smoke
        logs = ("INFO trippilot.poi_curation.adapters.kma_weather 기상청 단기예보 = "
                "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0 (키 파라미터 serviceKey)\n"
                "INFO trippilot.api.middleware GET /health 200\n"
                "WARNING trippilot.main 임베딩 미배선(TRIPPILOT_VECTOR_DB_URL 미설정) — 규칙 랭킹으로 강등된다\n")
        shell = Mock(side_effect=["", "", "Complete", "", "", "", logs])
        with patch("builtins.print") as output:
            runtime_smoke.run("trippilot", shell)
        printed = " ".join(str(call.args[0]) for call in output.call_args_list)
        self.assertIn("apis.data.go.kr", printed)  # 날씨가 붙은 증거
        self.assertIn("serviceKey", printed)  # 주소와 키 파라미터의 짝까지
        self.assertIn("임베딩 미배선", printed)
        self.assertNotIn("/health 200", printed)  # 요청 로그는 끌어오지 않는다
        logs_call = shell.call_args.args[0]
        self.assertEqual(logs_call[:2], ["kubectl", "logs"])
        self.assertIn("deployment/ai", logs_call)

    def test_smoke_reports_one_dialogue_turn_without_gating_the_deploy(self):
        """도우미 한 턴을 AI 파드 안에서 돌려 결과 모양만 배포 로그에 남긴다 — 실패해도 배포는 성공한다.
        배선 줄은 "켜졌다"까지만 말한다: 실 LLM 배정·ai_kb 권한·섀도는 실제 턴으로만 드러난다."""
        import runtime_smoke
        probe = 'ai-dialogue-probe {"http": 200, "outcome": "ANSWER", "kind": "INFO", "llm_calls": 3, "memory_deleted": 1}\n'
        shell = Mock(side_effect=["", "", "Complete", "", "", probe, ""])
        with patch("builtins.print") as output:
            runtime_smoke.run("trippilot", shell)
        printed = " ".join(str(call.args[0]) for call in output.call_args_list)
        self.assertIn('ai-dialogue: {"http": 200, "outcome": "ANSWER"', printed)
        exec_call = next(call for call in shell.call_args_list if call.args[0][:2] == ["kubectl", "exec"])
        argv = exec_call.args[0]
        for part in ("-i", "deployment/ai", "/app/.venv/bin/python"):
            self.assertIn(part, argv)
        self.assertEqual(argv[argv.index("-c") + 1], "ai")
        script = exec_call.args[1]
        sent = self._run_probe(script)
        self.assertEqual([method for method, _, _ in sent], ["POST", "DELETE"])  # 쓴 기억은 지운다
        self.assertTrue(sent[1][1].endswith(sent[0][2]["session_id"]))
        self._assert_matches_contract(sent[0][2], "DialogueInterpretRequest")
        failing = Mock(side_effect=["", "", "Complete", "", "", runtime.CommandError("kubectl", "exec denied"), ""])
        with patch("builtins.print") as output:
            runtime_smoke.run("trippilot", failing)
        self.assertIn("ai-dialogue: 확인 못 함", " ".join(str(call.args[0]) for call in output.call_args_list))

    def _run_probe(self, script, fail_post=False):
        """파드 안 스크립트를 urlopen 대역으로 돌려 보낸 요청을 잡는다 — (method, path, body)."""
        import types
        import urllib.request
        sent = []

        class _Response(io.BytesIO):
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        def urlopen(request, timeout=None):
            body = json.loads(request.data) if request.data else None
            sent.append((request.get_method(), request.full_url.replace("http://127.0.0.1:8000", ""), body))
            if fail_post and request.get_method() == "POST":
                raise ConnectionRefusedError("refused")
            if request.get_method() == "POST":
                return _Response(json.dumps({"outcome": "ANSWER", "llm_calls": 3, "answer": {"kind": "INFO"}}).encode())
            return _Response(b'{"deleted": 1}')

        with patch.object(urllib.request, "urlopen", urlopen), patch("builtins.print") as printed:
            exec(compile(script, "probe", "exec"), {"__name__": "probe"})
        self.probe_line = " ".join(str(call.args[0]) for call in printed.call_args_list)
        return sent

    def _assert_matches_contract(self, body, schema_name):
        """본문이 `ai/docs/openapi.json` 계약을 따르는가 — required ⊆ keys ⊆ properties(모든 층 extra=forbid)."""
        contract = json.loads((Path(__file__).resolve().parents[3] / "ai" / "docs" / "openapi.json").read_text())
        schemas = contract["components"]["schemas"]

        def resolve(schema):
            while "$ref" in schema:
                schema = schemas[schema["$ref"].rsplit("/", 1)[-1]]
            return schema

        def check(value, schema, where):
            schema = resolve(schema)
            if "anyOf" in schema:
                options = [resolve(s) for s in schema["anyOf"] if resolve(s).get("type") != "null" or value is None]
                if value is None:
                    return
                schema = next((s for s in options if s.get("type") == "object" or "properties" in s), options[0])
            if isinstance(value, dict) and "properties" in schema:
                props = schema["properties"]
                self.assertLessEqual(set(value), set(props), where)
                self.assertLessEqual(set(schema.get("required", ())), set(value), where)
                for key, item in value.items():
                    check(item, props[key], f"{where}.{key}")
            elif isinstance(value, list) and "items" in schema:
                for index, item in enumerate(value):
                    check(item, schema["items"], f"{where}[{index}]")

        check(body, {"$ref": f"#/components/schemas/{schema_name}"}, schema_name)

    def test_smoke_probe_always_deletes_its_memory_and_reports_errors_by_type(self):
        """POST 가 접속 거부로 죽어도 DELETE 는 돌고, 결과 줄에는 예외 **종류**만 실린다(값·본문 없음)."""
        import runtime_smoke
        sent = self._run_probe(runtime_smoke._DIALOGUE_PROBE, fail_post=True)
        self.assertEqual([method for method, _, _ in sent], ["POST", "DELETE"])
        self.assertIn('"http": "ConnectionRefusedError"', self.probe_line)
        self.assertIn('"memory_deleted": 1', self.probe_line)

    def test_smoke_survives_unreadable_ai_logs(self):
        """로그를 못 읽어도 배포는 성공한다 — 기록 수단이 게이트가 되면 안 된다."""
        import runtime_smoke
        shell = Mock(side_effect=["", "", "Complete", "", "", "", runtime.CommandError("kubectl", "failed")])
        with patch("builtins.print") as output:
            runtime_smoke.run("trippilot", shell)
        printed = " ".join(str(call.args[0]) for call in output.call_args_list)
        self.assertIn("못 읽었다", printed)

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


class JobWaitTests(unittest.TestCase):
    """실패한 Job 을 시한까지 기다리지 않는다 — `--for=condition=complete` 는 Failed 를 못 봐서 KB 적재가 90분을 태웠다(10-18)."""

    def test_waits_for_any_true_condition_and_reads_it_in_the_same_call(self):
        from runtime_io import wait_job
        shell = Mock(return_value="SuccessCriteriaMet Complete")
        wait_job(shell, "trippilot", "trippilot-kb-load", 5400)
        argv = shell.call_args.args[0]
        self.assertEqual(argv[:2], ["kubectl", "wait"])
        self.assertIn('--for=jsonpath={.status.conditions[?(@.status=="True")].type}', argv)
        self.assertIn("-o", argv)
        self.assertIn("job/trippilot-kb-load", argv)
        self.assertIn("--timeout=5400s", argv)
        self.assertNotIn("--for=condition=complete", argv)

    def test_failed_or_unknown_end_raises_right_away(self):
        from runtime_io import wait_job
        for states in ("FailureTarget Failed", "Failed", "", "Suspended"):
            with self.subTest(states=states), self.assertRaises(runtime.CommandError) as raised:
                wait_job(Mock(return_value=states), "trippilot", "trippilot-smoke", 330)
            self.assertIn("did not succeed", raised.exception.detail)

    def test_failed_kb_load_shows_its_logs_instead_of_burning_the_deadline(self):
        logs = "Traceback (most recent call last):\nEmbeddingUnreachable: Connection refused\n"
        shell = Mock(side_effect=["", "img", "", "FailureTarget Failed", logs, ""])
        with patch("runtime.command", shell), patch("builtins.print") as out, \
                self.assertRaises(runtime.CommandError):
            runtime.main(["load-kb"])
        shown = "\n".join(str(c.args[0]) for c in out.call_args_list)
        self.assertIn("EmbeddingUnreachable", shown)
        self.assertIn("delete", shell.call_args_list[-1].args[0])


class RefreshEventsTests(unittest.TestCase):
    """동봉 행사 저장소를 collect-state 정본으로 갈아 끼운다 — 동봉본이 8-22 이후 멈춰 있었다(10-18)."""

    @staticmethod
    def event(event_id, end):
        return {"event_id": event_id, "name": event_id, "start": "2026-10-01", "end": end}

    def run_refresh(self, state, bundled, today):
        import datetime
        import refresh_events
        with tempfile.TemporaryDirectory() as folder:
            state_path, bundled_path = Path(folder) / "state.json", Path(folder) / "bundled.json"
            state_path.write_text(state if isinstance(state, str) else json.dumps(state), encoding="utf-8")
            bundled_path.write_text(json.dumps(bundled), encoding="utf-8")
            with patch("builtins.print") as out:
                self.assertEqual(refresh_events.main([str(state_path), str(bundled_path)],
                                                     today=datetime.date.fromisoformat(today)), 0)
            return json.loads(bundled_path.read_text(encoding="utf-8")), "\n".join(str(c.args[0]) for c in out.call_args_list)

    def test_state_replaces_bundled_and_keeps_only_unexpired_manual_events(self):
        state = {"events": [self.event("a", "2026-10-20"), self.event("b", "2026-12-01")], "coverage": {"서울": "x"}}
        bundled = {"events": [self.event("a", "2026-01-01"),            # 정본에도 있다 — 정본이 이긴다
                              self.event("manual", "2026-10-25"),       # 동봉본에만, 미만료 — 남긴다
                              self.event("old", "2026-10-10")],         # 동봉본에만, 종료+7일 지남 — 버린다
                   "coverage": {}}
        merged, shown = self.run_refresh(state, bundled, "2026-10-18")
        self.assertEqual([e["event_id"] for e in merged["events"]], ["a", "b", "manual"])
        self.assertEqual(merged["events"][0]["end"], "2026-10-20")
        self.assertEqual(merged["coverage"], {"서울": "x"})
        self.assertIn("= 3건", shown)

    def test_grace_boundary_matches_the_collector(self):
        # 종료 + 7일 당일까지는 남는다(JsonEventStore.purge_expired 와 같은 경계)
        merged, _ = self.run_refresh({"events": [self.event("a", "2026-12-01")]},
                                     {"events": [self.event("edge", "2026-10-11")]}, "2026-10-18")
        self.assertEqual([e["event_id"] for e in merged["events"]], ["a", "edge"])

    def test_unreadable_or_empty_state_leaves_the_bundled_copy_with_a_warning(self):
        bundled = {"events": [self.event("keep", "2026-10-25")]}
        for state in ("{not json", {"events": []}, {"items": []}):
            with self.subTest(state=state):
                merged, shown = self.run_refresh(state, bundled, "2026-10-18")
                self.assertEqual(merged, bundled)
                self.assertIn("::warning::", shown)

    def test_expiry_grace_matches_the_event_store_constant(self):
        import refresh_events
        source = (Path(__file__).resolve().parents[3] / "ai" / "src" / "trippilot" / "background"
                  / "event_store.py").read_text(encoding="utf-8")
        self.assertIn(f"EXPIRE_GRACE_DAYS = {refresh_events.EXPIRE_GRACE_DAYS}", source)


if __name__ == "__main__":
    unittest.main()
