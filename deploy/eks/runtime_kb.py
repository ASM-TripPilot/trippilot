"""Plan-B KB load — a short-lived Job on the serving AI image, never inside the serving pod."""
import json
import re

NAME = "trippilot-kb-load"
DEADLINE_SEC = 3600

# `scheme://user:pass@` 와 `KEY=value` 꼴의 비밀을 가린다(실패 출력용).
_CREDENTIAL = re.compile(r"(://)[^\s/@]+@|((?:KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*=)\S+", re.IGNORECASE)


def _secret(env, optional=False):
    return {"name": env, "valueFrom": {"secretKeyRef": {"name": "trippilot-ai", "key": env, "optional": optional}}}


def manifest(namespace, image):
    """서빙 ai 파드와 **같은 이미지·같은 벡터 env** — 다른 모델이면 적재와 질의가 다른 벡터 공간을 탄다.

    서빙 컨테이너에 exec 하지 않는 이유: 그 컨테이너 메모리(2Gi)를 uvicorn 워커 둘과 나눠 써서
    적재가 137(OOM)로 죽었다(2026-10-04) — 최악엔 서빙 워커가 대신 죽는다. 묶음 32건은 같은
    임베딩 파드가 실시간 질의도 받기 때문이다(작은 묶음이 경합에 강하다 — `INDEX_BATCH` 주석).
    """
    env = [
        {"name": "PYTHONUNBUFFERED", "value": "1"},
        {"name": "PYTHONDONTWRITEBYTECODE", "value": "1"},
        {"name": "HOME", "value": "/tmp"},
        {"name": "XDG_CACHE_HOME", "value": "/tmp/cache"},
        {"name": "TRIPPILOT_EMBEDDING_PROVIDER", "value": "http"},
        {"name": "TRIPPILOT_EMBEDDING_BASE_URL", "value": "http://embedding:8100"},
        {"name": "TRIPPILOT_INDEX_BATCH", "value": "32"},
        _secret("TRIPPILOT_VECTOR_DB_URL"),
        _secret("TRIPPILOT_EMBEDDING_MODEL", optional=True),
    ]
    container = {
        "name": "load", "image": image, "imagePullPolicy": "IfNotPresent",
        "command": ["/app/.venv/bin/python", "scripts/load_kb.py"], "env": env,
        "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True,
                            "runAsNonRoot": True, "capabilities": {"drop": ["ALL"]}},
        # 로컬 실측 최대 RSS 85MB(KB-5 1,470건) — 512Mi 는 넉넉한 상한이다.
        "resources": {"requests": {"cpu": "100m", "memory": "256Mi"}, "limits": {"cpu": "500m", "memory": "512Mi"}},
        "volumeMounts": [{"name": "tmp", "mountPath": "/tmp"}],
    }
    return {
        "apiVersion": "batch/v1", "kind": "Job",
        "metadata": {"name": NAME, "namespace": namespace},
        # 멱등(이미 들어간 문서는 건너뜀)이라 재시도가 이어받는다 — 임베딩 파드 일시 장애 대비.
        # 마감 60분: DEV 임베딩(CPU 2)은 건당 ≈1.5초라 KB-5 전량(1,470건)이 ≈37분이다 — 30분이던
        # 첫 적재가 끊겼다(2026-10-04). 전량 재적재는 모델·데이터가 바뀔 때뿐이고 평소엔 건너뛴다.
        "spec": {"backoffLimit": 2, "activeDeadlineSeconds": DEADLINE_SEC, "ttlSecondsAfterFinished": 3600,
                 "template": {"metadata": {"labels": {"app.kubernetes.io/name": NAME}},
                              "spec": {
                                  "restartPolicy": "Never", "automountServiceAccountToken": False,
                                  "nodeSelector": {"kubernetes.io/os": "linux", "kubernetes.io/arch": "amd64"},
                                  "securityContext": {"runAsNonRoot": True, "runAsUser": 10001, "runAsGroup": 10001,
                                                      "seccompProfile": {"type": "RuntimeDefault"}},
                                  "containers": [container],
                                  "volumes": [{"name": "tmp", "emptyDir": {}}],
                              }}},
    }


def run(namespace, shell):
    delete = ["kubectl", "delete", "job", NAME, "--namespace", namespace,
              "--ignore-not-found", "--cascade=foreground", "--wait=true", "--timeout=90s"]
    shell(delete)
    image = shell(["kubectl", "get", "deployment/ai", "--namespace", namespace,
                   "-o", "jsonpath={.spec.template.spec.containers[0].image}"]).strip()
    try:
        shell(["kubectl", "apply", "--server-side", "--field-manager=trippilot-runtime", "-f", "-"],
              json.dumps(manifest(namespace, image)))
        try:
            shell(["kubectl", "wait", "--namespace", namespace, "--for=condition=complete",
                   f"job/{NAME}", f"--timeout={DEADLINE_SEC}s"])
        except Exception:
            # 공용 헬퍼는 stderr 를 숨긴다. 적재 로그 마지막 줄들이 원인이라 자격만 가리고 보인다.
            logs = shell(["kubectl", "logs", "--namespace", namespace, f"job/{NAME}", "--tail=20"])
            for line in logs.strip().splitlines()[-5:]:
                print(_CREDENTIAL.sub(lambda m: (m.group(1) or m.group(2)) + "***", line))
            raise
        print(shell(["kubectl", "logs", "--namespace", namespace, f"job/{NAME}", "--tail=20"]).strip())
    finally:
        shell(delete)
