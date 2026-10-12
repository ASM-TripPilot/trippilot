"""POI 공유본 적재 — 서빙 AI 이미지의 `data/collected_pois.json` 을 백엔드 수신 API 에 붓는 짧은 Job.

왜 배포가 하나 — dev DB 에 수집본을 넣는 길이 "사람이 port-forward 를 띄우고 손으로 스크립트"
뿐이라, 되감기가 채운 휴무 원문(TRIP-1244) 13,042건이 dev 에 닿지 못했다(2026-10-12 —
자격 있는 사람이 없으면 그냥 멈춘다). 클러스터에 닿는 워크플로는 `aws-deploy.yml` 하나다.

**완충은 그대로다.** `docs/guides/poi-수집본-적재.md` §자동화하지 않은 이유가 막은 것은
수집 워크플로가 **리뷰 없이** DB 로 미는 것이다. 이 Job 은 공유본 PR 이 머지돼 **이미지에
들어간 것만** 붓는다 — 사람의 kubectl 단계를 대체할 뿐 리뷰 단계는 건너뛰지 않는다.

스크립트는 복제하지 않는다 — `backend/scripts/ingest_pois.py`(로컬 절차와 같은 정본)를
러너 체크아웃에서 읽어 ConfigMap 으로 실어 보낸다. 두 벌이면 한쪽만 고쳐져 갈라진다.
"""
import json
import os
import re
from pathlib import Path

NAME = "trippilot-poi-load"
DEADLINE_SEC = 1200
SCRIPT = Path(__file__).resolve().parents[2] / "backend" / "scripts" / "ingest_pois.py"
DOCUMENT = "/app/data/collected_pois.json"  # ai/Dockerfile `COPY data ./data`
BACKEND = "http://backend:8080"

_CREDENTIAL = re.compile(r"(://)[^\s/@]+@|((?:KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*=)\S+", re.IGNORECASE)


def manifest(namespace, image, script_source, *, close_missing=False, close_missing_dry_run=False):
    """서빙 ai 와 **같은 이미지**(문서가 그 안에 있다) + 정본 스크립트(ConfigMap) — `List` 한 장.

    `--close-missing` 은 입력으로만 켠다(기본 꺼짐). `--allow-mass-close` 는 **절대 넘기지 않는다** —
    비율 가드(409)는 "문서가 그 출처의 전부가 아니다"는 신호라 사람이 봐야 한다. 가드에 걸리면
    닫힌 행도 적재된 행도 없이 스크립트가 0 이 아닌 코드로 끝나고, 이 스텝이 실패한다.
    되돌리기 SQL 은 스크립트가 작업 디렉토리에 쓰므로 `/tmp` 를 작업 디렉토리로 주고, 끝나면
    로그에 그대로 찍는다 — 파드가 사라지면 파일도 사라진다.

    `close_missing_dry_run` 은 **닫힐 수만 묻고**(`--dry-run --close-missing`, 서버가 계산만 한다)
    그 다음 평소대로 upsert 한다 — kubectl 자격이 아무에게도 없어 "몇 건이 닫힐지"를 볼 길이
    배포 로그뿐이다. 드라이런이 upsert 를 대신하면 그 배포는 공유본을 안 붓게 되므로 둘을 잇는다.
    실제 `close_missing` 이 켜져 있으면 드라이런은 뜻이 없어 건너뛴다.
    """
    base = ["/app/.venv/bin/python", "/scripts/ingest_pois.py", "--base-url", BACKEND, DOCUMENT]
    command = base + (["--close-missing"] if close_missing else [])
    shell = " ".join(command)
    if close_missing_dry_run and not close_missing:
        # `;` 이지 `&&` 가 아니다 — 드라이런도 비율 가드(409)를 받을 수 있고(서버가 dryRun 분기 **앞**에서
        # 판정한다), 그때 upsert 가 건너뛰어지면 "닫힐 수를 물어본 배포"가 공유본을 안 붓는다. 드라이런은
        # 정보용이라 그 결과(409 메시지의 `ACTIVE N건 중 목록에 있는 것 P건`도)는 요약에 실리고 적재는 간다.
        shell = " ".join(base + ["--dry-run", "--close-missing"]) + "; " + shell
    shell += "; status=$?; cat /tmp/close-missing-undo-*.sql 2>/dev/null; exit $status"
    container = {
        "name": "load", "image": image, "imagePullPolicy": "IfNotPresent",
        "command": ["/bin/sh", "-c", shell], "workingDir": "/tmp",
        "env": [
            {"name": "PYTHONUNBUFFERED", "value": "1"},
            {"name": "PYTHONDONTWRITEBYTECODE", "value": "1"},
            {"name": "SERVICE_AUTH_TOKEN", "valueFrom": {"secretKeyRef": {
                "name": "trippilot-shared", "key": "SERVICE_AUTH_TOKEN", "optional": False}}},
        ],
        "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True,
                            "runAsNonRoot": True, "capabilities": {"drop": ["ALL"]}},
        # 31MB JSON 을 통째로 파싱한다 — 실측 없음, 파이썬 객체 팽창을 보아 1Gi 상한(ponytail: 실측 뒤 조정).
        "resources": {"requests": {"cpu": "100m", "memory": "512Mi"}, "limits": {"cpu": "500m", "memory": "1Gi"}},
        "volumeMounts": [{"name": "tmp", "mountPath": "/tmp"},
                         {"name": "script", "mountPath": "/scripts", "readOnly": True}],
    }
    configmap = {
        "apiVersion": "v1", "kind": "ConfigMap",
        "metadata": {"name": NAME, "namespace": namespace},
        "data": {"ingest_pois.py": script_source},
    }
    job = {
        "apiVersion": "batch/v1", "kind": "Job",
        "metadata": {"name": NAME, "namespace": namespace},
        # 멱등(upsert)이라 재시도가 이어받는다. 20분: 19,084건·500건 묶음 39회 — 로컬 수 초, 원격 DB 여유.
        "spec": {"backoffLimit": 1, "activeDeadlineSeconds": DEADLINE_SEC, "ttlSecondsAfterFinished": 3600,
                 "template": {"metadata": {"labels": {"app.kubernetes.io/name": NAME}},
                              "spec": {
                                  "restartPolicy": "Never", "automountServiceAccountToken": False,
                                  "nodeSelector": {"kubernetes.io/os": "linux", "kubernetes.io/arch": "amd64"},
                                  "securityContext": {"runAsNonRoot": True, "runAsUser": 10001, "runAsGroup": 10001,
                                                      "seccompProfile": {"type": "RuntimeDefault"}},
                                  "containers": [container],
                                  "volumes": [{"name": "tmp", "emptyDir": {}},
                                              {"name": "script", "configMap": {"name": NAME}}],
                              }}},
    }
    return {"apiVersion": "v1", "kind": "List", "items": [configmap, job]}


# 요약으로 올릴 줄 — 적재 합계·탈락(사유별 수)·드라이런의 "닫을 것". 묶음별 진행 줄은 뺀다.
_SUMMARY_LINE = re.compile(r"^\s*(합계 — |합계 제안 |탈락|\S[^:]*: \d+$|미포함 정리)")


def summary_of(logs):
    """Job 로그 → 한 줄(` · ` 로 잇는다) — 배포 요약(GITHUB_STEP_SUMMARY)에 올라가 로그를 안 열어도 보인다."""
    picked = [line.strip() for line in logs.splitlines() if _SUMMARY_LINE.match(line)]
    return " · ".join(picked)


def _github_output(name, value):
    """GitHub Actions 스텝 출력 — 로컬·테스트에선 환경변수가 없어 아무것도 안 한다."""
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as stream:
            stream.write(f"{name}={value.replace(chr(10), ' ')}\n")


def run(namespace, shell, *, close_missing=False, close_missing_dry_run=False, script_source=None):
    source = script_source if script_source is not None else SCRIPT.read_text(encoding="utf-8")
    delete = ["kubectl", "delete", "job,configmap", NAME, "--namespace", namespace,
              "--ignore-not-found", "--cascade=foreground", "--wait=true", "--timeout=90s"]
    shell(delete)
    image = shell(["kubectl", "get", "deployment/ai", "--namespace", namespace,
                   "-o", "jsonpath={.spec.template.spec.containers[0].image}"]).strip()
    try:
        shell(["kubectl", "apply", "--server-side", "--field-manager=trippilot-runtime", "-f", "-"],
              json.dumps(manifest(namespace, image, source, close_missing=close_missing,
                                  close_missing_dry_run=close_missing_dry_run)))
        try:
            shell(["kubectl", "wait", "--namespace", namespace, "--for=condition=complete",
                   f"job/{NAME}", f"--timeout={DEADLINE_SEC}s"])
        except Exception:
            logs = shell(["kubectl", "logs", "--namespace", namespace, f"job/{NAME}", "--tail=40"])
            for line in logs.strip().splitlines()[-12:]:
                print(_CREDENTIAL.sub(lambda m: (m.group(1) or m.group(2)) + "***", line))
            raise
        logs = shell(["kubectl", "logs", "--namespace", namespace, f"job/{NAME}", "--tail=80"]).strip()
        print(logs)
        # "효과 없음"은 성공이 아니다(INV-4) — 합계 줄이 없거나 신규·갱신이 둘 다 0 이면 실패로 올린다.
        # 탈락·지역코드미상은 데이터 품질 신호라 로그로 크게 보이되 배포를 막지 않는다(코드 출시를 묶지 않는다).
        summary = re.search(r"합계 — 접수=(\d+) 신규=(\d+) 갱신=(\d+)", logs)
        if summary is None or int(summary.group(2)) + int(summary.group(3)) == 0:
            raise RuntimeError("poi load had no effect — 합계 줄이 없거나 신규·갱신이 0 이다 (위 로그 참조)")
        line = summary_of(logs)
        _github_output("summary", line)
        return line
    finally:
        shell(delete)
