"""Airflow 운영 적용의 클러스터 준비·정리 — airflow-deploy.yml 이 부른다(TRIP-1725 2단계).

- `install`: 메타 DB(`airflow` 롤·DB, 기존 RDS) + 시크릿 셋을 만든다. 여러 번 돌려도 같다.
    airflow-metadata  connection·password — 비밀번호는 처음 한 번 만들고 다음부터 재사용한다
    airflow-keys      fernet-key·api-secret-key·jwt-secret·admin-password — 처음 한 번만. 차트가 helm upgrade 마다
                      키를 새로 만들면 저장된 연결이 안 풀리고 도는 태스크의 JWT 가 깨진다
    batch-collect     수집 키·GH_TOKEN·BATCH_LIVE — 매번 GitHub 시크릿으로 덮는다(값은 Actions 안에서만 오간다)
- `uninstall`: 메타 DB·롤을 지운다(시크릿은 네임스페이스와 함께 사라진다).

비밀값은 명령 인자·로그에 싣지 않는다 — kubectl 에는 표준입력으로, DB 비밀번호는 SCRAM 검증자로만(runtime_db 와 같다).
"""
import argparse
import base64
import json
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "eks"))
from runtime_db import scram_verifier  # noqa: E402
from runtime_io import CommandError, command, wait_job  # noqa: E402
from runtime_secrets import get_secret  # noqa: E402

DB = "airflow"
# 수집기·DAG 가 읽는 이름 → 값이 오는 환경변수(워크플로가 GitHub 시크릿을 이 이름으로 넘긴다).
COLLECT_KEYS = ("GH_TOKEN", "TOUR_API_KEY", "TOUR_API_KEY2", "TOUR_API_KEY3", "NAVER_SEARCH_CLIENT_ID",
                "NAVER_SEARCH_CLIENT_SECRET", "KAKAO_REST_API_KEY", "ANTHROPIC_API_KEY")

CREATE_SQL = r"""\set ON_ERROR_STOP on
\set ECHO none
\getenv airflow_password AIRFLOW_DB_PASSWORD
SELECT 'CREATE ROLE airflow LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airflow') \gexec
SELECT format('ALTER ROLE airflow PASSWORD %L', :'airflow_password') \gexec
-- PostgreSQL 16 은 롤 관리자에게 SET ROLE 을 저절로 주지 않는다 — OWNER airflow 로 DB 를 만들려면 필요하다(bootstrap.sql 과 같다).
SELECT format('GRANT airflow TO %I WITH SET TRUE', current_user) \gexec
SELECT 'CREATE DATABASE airflow OWNER airflow' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'airflow') \gexec
REVOKE CONNECT, TEMPORARY ON DATABASE airflow FROM PUBLIC;
GRANT CONNECT ON DATABASE airflow TO airflow;
"""

DROP_SQL = r"""\set ON_ERROR_STOP on
DROP DATABASE IF EXISTS airflow WITH (FORCE);
DROP ROLE IF EXISTS airflow;
"""


def kubectl_apply(manifest):
    command(["kubectl", "apply", "-f", "-"], json.dumps(manifest))


def read_secret(namespace, name):
    """있으면 {키: 값}, 없으면 {} — 값은 화면에 찍지 않는다."""
    try:
        raw = command(["kubectl", "get", "secret", name, "-n", namespace, "-o", "json"])
    except CommandError as error:
        if "NotFound" in error.detail:
            return {}
        raise
    return {k: base64.b64decode(v).decode() for k, v in (json.loads(raw).get("data") or {}).items()}


def secret(namespace, name, values):
    return {"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
            "metadata": {"name": name, "namespace": namespace}, "stringData": values}


def run_sql(namespace, host, master, sql, run_id, extra=None):
    """마스터 계정으로 SQL 한 번 — runtime_db 의 임시 Job 과 같은 모양(사설 VPC 안, 끝나면 지운다)."""
    name = f"airflow-db-{run_id}"
    meta = {"name": name, "namespace": namespace}
    values = {"PGUSER": master["username"], "PGPASSWORD": master["password"], **(extra or {})}
    container = {
        "name": "psql", "image": "postgres:16-alpine",
        "command": ["psql", "--no-psqlrc", "--no-password", "--file=/sql/run.sql"],
        "env": [{"name": k, "value": v} for k, v in {"PGHOST": host, "PGPORT": "5432", "PGDATABASE": "postgres",
                                                     "PGSSLMODE": "require", "PGCONNECT_TIMEOUT": "15", "HOME": "/tmp"}.items()]
        + [{"name": k, "valueFrom": {"secretKeyRef": {"name": name, "key": k}}} for k in values],
        "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}},
        "resources": {"requests": {"cpu": "100m", "memory": "128Mi"}, "limits": {"cpu": "500m", "memory": "256Mi"}},
        "volumeMounts": [{"name": "sql", "mountPath": "/sql", "readOnly": True}, {"name": "tmp", "mountPath": "/tmp"}],
    }
    job = {"apiVersion": "batch/v1", "kind": "Job", "metadata": meta,
           "spec": {"backoffLimit": 0, "activeDeadlineSeconds": 300, "ttlSecondsAfterFinished": 300,
                    "template": {"metadata": {"annotations": {"karpenter.sh/do-not-disrupt": "true"}},
                                 "spec": {"restartPolicy": "Never", "automountServiceAccountToken": False,
                                          "securityContext": {"runAsNonRoot": True, "runAsUser": 10001, "runAsGroup": 10001,
                                                              "seccompProfile": {"type": "RuntimeDefault"}},
                                          "containers": [container],
                                          "volumes": [{"name": "sql", "configMap": {"name": name}}, {"name": "tmp", "emptyDir": {}}]}}}}
    try:
        kubectl_apply(secret(namespace, name, values))
        kubectl_apply({"apiVersion": "v1", "kind": "ConfigMap", "metadata": meta, "data": {"run.sql": sql}})
        kubectl_apply(job)
        try:
            wait_job(command, namespace, name, 240)
        except CommandError:
            print(command(["kubectl", "logs", f"job/{name}", "-n", namespace, "--tail=20"]), file=sys.stderr)
            raise
    finally:
        for kind in ("job", "secret", "configmap"):
            command(["kubectl", "delete", kind, name, "-n", namespace, "--ignore-not-found", "--wait=false"])


def install(args, master):
    ns = args.namespace
    # 입력부터 본다 — 빠진 키로 멈출 거면 DB·시크릿을 건드리기 전에 멈춘다.
    missing = [k for k in COLLECT_KEYS if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"batch-collect 에 넣을 값이 없다: {', '.join(missing)} — 리포 시크릿을 확인할 것")
    live = os.environ.get("BATCH_LIVE", "0")
    if live not in ("0", "1"):
        raise SystemExit("BATCH_LIVE 는 0 또는 1")
    kubectl_apply({"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": ns}})

    password = read_secret(ns, "airflow-metadata").get("password") or secrets.token_urlsafe(32)
    run_sql(ns, args.db_host, master, CREATE_SQL, args.run_id, {"AIRFLOW_DB_PASSWORD": scram_verifier(password)})
    kubectl_apply(secret(ns, "airflow-metadata", {
        "password": password, "connection": f"postgresql://{DB}:{password}@{args.db_host}:5432/{DB}?sslmode=require"}))

    if not read_secret(ns, "airflow-keys"):
        kubectl_apply(secret(ns, "airflow-keys", {
            "fernet-key": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
            "api-secret-key": secrets.token_urlsafe(32), "jwt-secret": secrets.token_urlsafe(32),
            "admin-password": secrets.token_urlsafe(18)}))

    kubectl_apply(secret(ns, "batch-collect", {**{k: os.environ[k] for k in COLLECT_KEYS}, "BATCH_LIVE": live}))
    print(f"준비 끝 — namespace={ns} BATCH_LIVE={live}")


def uninstall(args, master):
    # 설치한 적 없거나 반쯤 지워진 상태에서도 DB 정리 Job 이 설 자리 — 네임스페이스는 워크플로가 마지막에 지운다.
    kubectl_apply({"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": args.namespace}})
    run_sql(args.namespace, args.db_host, master, DROP_SQL, args.run_id)
    print("메타 DB·롤 삭제 끝")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["install", "uninstall"])
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--db-host", required=True)
    parser.add_argument("--master-secret-arn", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    master = get_secret(command, args.region, args.master_secret_arn)
    if not master.get("username") or not master.get("password"):
        raise SystemExit("RDS 마스터 시크릿에 username·password 가 없다")
    (install if args.action == "install" else uninstall)(args, master)


if __name__ == "__main__":
    main()
