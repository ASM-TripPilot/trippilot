"""export_env 의 매핑·이스케이프 — 클러스터 없이 본다."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_env import bedrock_features, build, env_line, to_local_db  # noqa: E402

DB = {"DB_PASSWORD": "a", "DB_MIGRATE_PASSWORD": "b", "AI_DB_PASSWORD": "c"}


def deployment(*refs):
    env = [{"name": "PLAIN", "value": "x"}] + [
        {"name": n, "valueFrom": {"secretKeyRef": {"name": s, "key": k, "optional": o}}} for n, s, k, o in refs]
    return {"spec": {"template": {"spec": {"containers": [{"env": env}]}}}}


class ExportEnvTests(unittest.TestCase):
    def test_follows_secret_key_refs_and_renames(self):
        deployments = {
            "backend": deployment(("TRIPPILOT_PUSH_MODE", "trippilot-backend", "PUSH_MODE", True),
                                  ("KAKAO_APP_ID", "trippilot-backend", "KAKAO_APP_ID", True),
                                  ("DB_PASSWORD", "trippilot-database", "DB_PASSWORD", False)),
            "ai": deployment(("TRIPPILOT_VECTOR_DB_URL", "trippilot-ai", "TRIPPILOT_VECTOR_DB_URL", False)),
        }
        data = {"trippilot-backend": {"PUSH_MODE": "expo", "GOOGLE_CLIENT_SECRET": "never"},
                "trippilot-database": DB,
                "trippilot-ai": {"TRIPPILOT_VECTOR_DB_URL": "postgresql://ai_user:p%40w@x.rds.amazonaws.com:5432/ai_kb?sslmode=require"}}
        backend, ai, vector, db = build(deployments, data, "pg")
        # 차트가 참조하지 않는 키(GOOGLE_CLIENT_SECRET)는 시크릿에 있어도 따라오지 않는다.
        self.assertEqual(backend, {"TRIPPILOT_PUSH_MODE": "expo", "DB_PASSWORD": "a", "AI_REMINDER_COPY_MODE": "off"})
        self.assertEqual(ai, {})
        self.assertEqual(vector, {"TRIPPILOT_VECTOR_DB_URL": "postgresql://ai_user:p%40w@db:5432/ai_kb?sslmode=disable"})
        self.assertEqual(db, {"POSTGRES_PASSWORD": "pg", **DB})

    def test_missing_required_key_stops(self):
        deployments = {"backend": deployment(("JWT_SIGNING_KEY", "trippilot-backend", "JWT_SIGNING_KEY", False)),
                       "ai": deployment()}
        with self.assertRaises(SystemExit) as stop:
            build(deployments, {"trippilot-backend": {}, "trippilot-database": DB}, "pg")
        self.assertIn("trippilot-backend/JWT_SIGNING_KEY", str(stop.exception))

    def test_env_line_escapes_for_compose(self):
        # 실제 compose(v5) 가 이 줄을 원문으로 되읽는 것은 로컬에서 확인했다(여러 줄 PEM · $ · 따옴표).
        self.assertEqual(env_line("K", 'a\nb"c\\d$e'), 'K="a\\nb\\"c\\\\d\\$e"\n')

    def test_bedrock_features(self):
        self.assertEqual(bedrock_features({"TRIPPILOT_LLM_FEATURE_MODELS": "REMINDER_COPY=local-qwen, INTENT=claude-haiku"}),
                         ["REMINDER_COPY"])
        self.assertEqual(bedrock_features({}), [])

    def test_to_local_db_without_port(self):
        self.assertEqual(to_local_db("postgresql://u:p@host/trippilot?sslmode=require"),
                         "postgresql://u:p@db:5432/trippilot?sslmode=disable")


if __name__ == "__main__":
    unittest.main()
