#!/usr/bin/env python3
"""개발 서버(trippilot-dev) 부하 테스트 — 클러스터 안 Job 으로 backend:8080 에 k6 를 쏘고, 그동안 파드 자원을 기록한다.

왜 개발 서버인가: 운영 DB·사용자를 건드리지 않는다. 같은 이미지·같은 RDS 장비 등급(t4g 계열)·같은 노드풀이라
파드 하나가 버티는 양은 운영과 같다(운영은 backend 2개 — --replicas 2 로 맞춰 잴 수 있다).
왜 클러스터 안인가: gateway 는 IP 당 10r/s 로 막는다(클라이언트 보호). 여기서 재는 것은 서버 용량이다.

Job 구성(개발 네임스페이스 trippilot-dev, 라벨 trippilot-loadtest — 차트가 개발 대상에서만 backend 로 연다):
  init accounts  seed.sql — 부하 계정 N개(고정 id, 다시 돌려도 같은 계정을 다시 쓴다 — 개발 DB 에만 남는다)
  init tokens    mint.py  — 백엔드와 같은 서명 키로 그 계정들의 토큰을 만든다(키는 Job 밖으로 나가지 않는다).
                 pyjwt·cryptography 를 실행마다 PyPI 에서 받는다(NAT 경유 — 네임스페이스에 egress 정책이 없다)
  k6             scenario.js — 단계별 동시 사용자, 끝나면 LOADTEST_SUMMARY 한 줄을 남긴다

해석 주의: 부하 계정은 여행·알림이 없어 trips·notifications 는 빈 목록 조회다 — 실제 사용자보다 가볍다. 무거운 쪽은
places(지역·키워드 검색, 공개 장소 데이터)이고, 그쪽은 실제와 같은 데이터를 읽는다.

전제: 개발 서버가 떠 있고 이 차트(loadTest.allow)가 개발 대상에 배포돼 있어야 한다 — aws-deploy(target=dev,
dev_sleep_after=false)로 켠다. 어떤 끝(성공·실패·Ctrl-C)이든 Job·ConfigMap 을 지우고 복제본 수를 되돌린다(--sleep 이면 0).

    AWS_PROFILE=... python3 deploy/loadtest/run.py                       # 기본 단계 1m:20,2m:50,2m:100,1m:0
    AWS_PROFILE=... python3 deploy/loadtest/run.py --stages 1m:50,3m:200,1m:0 --replicas 2 --sleep
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
NAME = "trippilot-loadtest"
ALLOWED_NAMESPACES = ("trippilot-dev",)   # 허용 목록 — seed.sql 이 그 네임스페이스 backend 의 DB 에 바로 쓴다
K6_IMAGE = "grafana/k6:2.3.0"
PSQL_IMAGE = "postgres:16-alpine"
PY_IMAGE = "python:3.12-alpine"
JOB_DEADLINE_S = 3600
INIT_BUDGET_S = 600   # 계정·토큰 init(pip 설치 포함)에 남겨 두는 몫


def kubectl(*args: str, input: str | None = None, check: bool = True) -> str:
    r = subprocess.run(["kubectl", *args], input=input, capture_output=True, text=True)
    if check and r.returncode:
        raise SystemExit(f"kubectl {' '.join(args)} 실패: {r.stderr.strip()}")
    return r.stdout


def stage_seconds(stages: str) -> int:
    """'1m:20,30s:50' → 합계 초. 형식이 틀리면 멈춘다."""
    total = 0
    for part in stages.split(","):
        m = re.fullmatch(r"(\d+)(s|m|h):(\d+)", part.strip())
        if not m:
            raise SystemExit(f"--stages 형식은 '<숫자><s|m|h>:<동시 사용자>' 다: {part!r}")
        total += int(m.group(1)) * {"s": 1, "m": 60, "h": 3600}[m.group(2)]
    return total


def database(namespace: str) -> dict[str, str]:
    """백엔드 디플로이먼트의 DB_URL·DB_USER(비밀 아님)를 읽는다 — 차트가 바뀌어도 앱과 같은 곳에 붙는다."""
    env = {e["name"]: e.get("value") for e in json.loads(kubectl(
        "-n", namespace, "get", "deploy", "backend", "-o", "jsonpath={.spec.template.spec.containers[0].env}"))}
    parsed = urlparse(env["DB_URL"].removeprefix("jdbc:"))
    return {"host": parsed.hostname, "port": str(parsed.port or 5432), "db": parsed.path.lstrip("/"),
            "user": env.get("DB_USER") or "app_user"}


def restricted(user: int) -> dict:
    return {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True, "runAsNonRoot": True,
            "runAsUser": user, "capabilities": {"drop": ["ALL"]}}


def manifest(namespace: str, db: dict[str, str], accounts: int, stages: str) -> list[dict]:
    scripts = {f: (HERE / f).read_text() for f in ("scenario.js", "seed.sql", "mint.py")}
    tmp = {"name": "tmp", "mountPath": "/tmp"}
    mounts = [{"name": "scripts", "mountPath": "/scripts"}, {"name": "work", "mountPath": "/work"}, tmp]
    small = {"requests": {"cpu": "100m", "memory": "128Mi"}, "limits": {"cpu": "500m", "memory": "512Mi"}}
    return [
        {"apiVersion": "v1", "kind": "ConfigMap", "metadata": {"name": NAME, "namespace": namespace}, "data": scripts},
        {"apiVersion": "batch/v1", "kind": "Job", "metadata": {"name": NAME, "namespace": namespace},
         "spec": {"backoffLimit": 0, "activeDeadlineSeconds": JOB_DEADLINE_S, "ttlSecondsAfterFinished": 600,
                  "template": {
                      "metadata": {"labels": {"app.kubernetes.io/name": NAME},
                                   "annotations": {"karpenter.sh/do-not-disrupt": "true"}},
                      "spec": {
                          "restartPolicy": "Never", "automountServiceAccountToken": False,
                          "securityContext": {"runAsNonRoot": True, "seccompProfile": {"type": "RuntimeDefault"}},
                          "volumes": [{"name": "scripts", "configMap": {"name": NAME}},
                                      {"name": "work", "emptyDir": {}}, {"name": "tmp", "emptyDir": {}}],
                          "initContainers": [
                              {"name": "accounts", "image": PSQL_IMAGE, "securityContext": restricted(70),
                               "command": ["psql", "--no-psqlrc", "-v", f"n={accounts}", "-f", "/scripts/seed.sql"],
                               "env": [{"name": "PGHOST", "value": db["host"]}, {"name": "PGPORT", "value": db["port"]},
                                       {"name": "PGDATABASE", "value": db["db"]}, {"name": "PGUSER", "value": db["user"]},
                                       {"name": "PGSSLMODE", "value": "require"}, {"name": "HOME", "value": "/tmp"},
                                       {"name": "PGPASSWORD", "valueFrom": {"secretKeyRef": {
                                           "name": "trippilot-database", "key": "DB_PASSWORD"}}}],
                               "volumeMounts": mounts, "resources": small},
                              {"name": "tokens", "image": PY_IMAGE, "securityContext": restricted(10001),
                               "command": ["sh", "-c", "pip install -q --no-cache-dir --target /tmp/py 'pyjwt==2.15.1' "
                                           "'cryptography==50.0.2' && PYTHONPATH=/tmp/py python /scripts/mint.py > /work/tokens.json"],
                               "env": [{"name": "ACCOUNTS", "value": str(accounts)}, {"name": "HOME", "value": "/tmp"},
                                       {"name": "JWT_SIGNING_KEY", "valueFrom": {"secretKeyRef": {
                                           "name": "trippilot-backend", "key": "JWT_SIGNING_KEY"}}}],
                               "volumeMounts": mounts, "resources": small},
                          ],
                          "containers": [
                              {"name": "k6", "image": K6_IMAGE, "securityContext": restricted(12345),
                               "args": ["run", "--quiet", "/scripts/scenario.js"],
                               "env": [{"name": "STAGES", "value": stages}, {"name": "BASE_URL", "value": "http://backend:8080"},
                                       {"name": "HOME", "value": "/tmp"}],
                               "volumeMounts": mounts,
                               "resources": {"requests": {"cpu": "500m", "memory": "256Mi"},
                                             "limits": {"cpu": "1", "memory": "1Gi"}}},
                          ],
                      }}}},
    ]


def policy_allows_loadtest(namespace: str) -> bool:
    """개발 대상 차트(loadTest.allow)가 이미 배포돼 backend 정책이 이 Job 을 받는가 — 아니면 요청이 전부 막혀 '실패율 100%'가 나온다."""
    policy = json.loads(kubectl("-n", namespace, "get", "networkpolicy", "backend", "-o", "json", check=False) or "{}")
    sources = [s.get("podSelector", {}).get("matchLabels") for rule in policy.get("spec", {}).get("ingress", [])
               for s in rule.get("from", [])]
    return {"app.kubernetes.io/name": NAME} in sources


def watch_top(namespace: str, stop: threading.Event, peaks: dict) -> None:
    """15초마다 kubectl top — 파드별 최대 CPU(m)·메모리(Mi). top 은 항상 m·Mi 단위로 낸다."""
    while not stop.wait(15):
        for line in kubectl("-n", namespace, "top", "pods", "--no-headers", check=False).splitlines():
            parts = line.split()
            if len(parts) < 3 or parts[0].startswith(NAME):
                continue
            pod, cpu, mem = parts[0], int(re.sub(r"\D", "", parts[1]) or 0), int(re.sub(r"\D", "", parts[2]) or 0)
            p = peaks.setdefault(pod, [0, 0])
            p[0], p[1] = max(p[0], cpu), max(p[1], mem)


def report(s: dict, peaks: dict) -> None:
    d = s.get("duration") or {}
    fmt = lambda v, f: format(v, f) if isinstance(v, (int, float)) else "-"  # noqa: E731 — 요청 0건이면 값이 비어 온다
    print(f"\n요청 {fmt(s.get('requests'), ',')}건 · 초당 {fmt(s.get('rps'), '.1f')} · 최대 동시 {s.get('vus_max')}"
          f" · 실패율 {fmt(s.get('failed_rate'), '.2%')}")
    print(f"전체  p50 {fmt(d.get('med'), '.0f')}ms · p95 {fmt(d.get('p(95)'), '.0f')}ms · p99 {fmt(d.get('p(99)'), '.0f')}ms"
          f" · max {fmt(d.get('max'), '.0f')}ms")
    for name, v in sorted((s.get("by_endpoint") or {}).items()):
        print(f"  {name:14s} p50 {fmt(v.get('med'), '6.0f')}ms  p95 {fmt(v.get('p(95)'), '6.0f')}ms  p99 {fmt(v.get('p(99)'), '6.0f')}ms")
    print("파드 최대 자원(15초 표본):")
    for pod, (cpu, mem) in sorted(peaks.items()):
        print(f"  {pod:40s} CPU {cpu}m · 메모리 {mem}Mi")
    print(f"목표(p95<800ms·실패<1%) {'통과' if s.get('thresholds_ok') else '미달'}")
    print("주의: 부하 계정은 여행·알림이 없어 trips·notifications 는 빈 목록 조회다(실사용보다 가볍다).")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--namespace", default="trippilot-dev")
    ap.add_argument("--stages", default="1m:20,2m:50,2m:100,1m:0")
    ap.add_argument("--accounts", type=int, default=50)
    ap.add_argument("--replicas", type=int, help="시험 동안 개발 backend 복제본을 이 수로(운영은 2) — 끝나면 되돌린다")
    ap.add_argument("--sleep", action="store_true", help="끝나면 개발 서버 파드를 0 으로 내린다")
    args = ap.parse_args(argv)
    ns = args.namespace
    if ns not in ALLOWED_NAMESPACES:
        raise SystemExit(f"{ns} 에는 돌리지 않는다 — 허용: {', '.join(ALLOWED_NAMESPACES)}")
    if stage_seconds(args.stages) > JOB_DEADLINE_S - INIT_BUDGET_S:
        raise SystemExit(f"--stages 합계가 {JOB_DEADLINE_S - INIT_BUDGET_S}초를 넘는다 — Job 시한({JOB_DEADLINE_S}초)에 잘린다")
    if not policy_allows_loadtest(ns):
        raise SystemExit("backend NetworkPolicy 가 trippilot-loadtest 를 받지 않는다 — 이 차트를 개발 대상으로 먼저 배포한다")

    original = int(kubectl("-n", ns, "get", "deploy", "backend", "-o", "jsonpath={.spec.replicas}") or 0)
    stop, peaks = threading.Event(), {}
    watcher = threading.Thread(target=watch_top, args=(ns, stop, peaks), daemon=True)
    try:
        if args.replicas:
            kubectl("-n", ns, "scale", "deploy/backend", f"--replicas={args.replicas}")
            kubectl("-n", ns, "rollout", "status", "deploy/backend", "--timeout=10m")
        ready = kubectl("-n", ns, "get", "deploy", "backend", "-o", "jsonpath={.status.readyReplicas}") or "0"
        if int(ready) < 1:
            raise SystemExit("개발 backend 가 0개다 — aws-deploy(target=dev, dev_sleep_after=false)로 먼저 켠다")

        kubectl("-n", ns, "delete", "job,configmap", NAME, "--ignore-not-found", "--wait=true")
        kubectl("apply", "-f", "-", input=json.dumps({"apiVersion": "v1", "kind": "List",
                                                       "items": manifest(ns, database(ns), args.accounts, args.stages)}))
        print(f"시작 {time.strftime('%H:%M:%S')} · backend {ready}개 · 단계 {args.stages}", flush=True)
        watcher.start()

        # k6 는 목표(p95·실패율)를 넘으면 종료 코드 99 로 끝나 Job 이 Failed 가 된다 — 미달도 결과이므로 끝나기만 기다린다.
        deadline = time.time() + JOB_DEADLINE_S + 60
        while time.time() < deadline:
            if kubectl("-n", ns, "get", f"job/{NAME}", "-o", "jsonpath={.status.succeeded}/{.status.failed}", check=False).strip("/"):
                break
            time.sleep(10)
        stop.set()
        watcher.join(timeout=30)

        logs = kubectl("-n", ns, "logs", f"job/{NAME}", "-c", "k6", check=False)
        summary = next((l.split(" ", 1)[1] for l in logs.splitlines() if l.startswith("LOADTEST_SUMMARY ")), None)
        if not summary:
            print(kubectl("-n", ns, "describe", f"job/{NAME}", check=False)[-3000:])
            for c in ("accounts", "tokens", "k6"):
                print(f"--- {c}\n" + kubectl("-n", ns, "logs", f"job/{NAME}", "-c", c, "--tail=40", check=False))
            return 1
        s = json.loads(summary)
        report(s, peaks)
        (HERE / "last-result.json").write_text(json.dumps({**s, "pod_peaks": peaks}, ensure_ascii=False, indent=2))
        return 0
    finally:
        # 어떤 끝이든: Job 을 멈추고(지우면 파드도 죽는다) 손으로 바꾼 복제본 수를 되돌린다 — helm 3-way 병합은 차트 값이
        # 그대로면 손으로 바꾼 수를 되돌리지 않는다(aws-deploy.yml 의 wake 단계 주석).
        stop.set()
        kubectl("-n", ns, "delete", "job,configmap", NAME, "--ignore-not-found", check=False)
        if args.sleep:
            kubectl("-n", ns, "scale", "deploy", "--all", "--replicas=0", check=False)
            print("개발 서버 파드를 0 으로 내렸다")
        elif args.replicas and args.replicas != original:
            kubectl("-n", ns, "scale", "deploy/backend", f"--replicas={original}", check=False)
            print(f"개발 backend 복제본을 {original}개로 되돌렸다")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
