"""In-cluster smoke checks, including the public gateway's route deny boundary."""
import json

from runtime_io import CommandError

SMOKE_SCRIPT = """set -eu
for url in http://gateway:443/healthz http://backend:8080/actuator/health/readiness http://ai:8000/health; do
  curl --fail --silent --show-error --retry 6 --retry-all-errors --retry-delay 5 --max-time 15 --output /dev/null "$url"
done
for path in /internal/health /actuator/health /; do
  status=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "http://gateway:443$path")
  test "$status" = 404
done
"""


def manifest(namespace):
    return {
        "apiVersion": "batch/v1", "kind": "Job",
        "metadata": {"name": "trippilot-smoke", "namespace": namespace},
        "spec": {"backoffLimit": 0, "activeDeadlineSeconds": 300, "ttlSecondsAfterFinished": 600,
                 "template": {"metadata": {"labels": {"app.kubernetes.io/name": "trippilot-smoke"}},
                              "spec": {
                                  "restartPolicy": "Never", "automountServiceAccountToken": False,
                                  "nodeSelector": {"kubernetes.io/os": "linux", "kubernetes.io/arch": "amd64"},
                                  "securityContext": {"runAsNonRoot": True, "runAsUser": 10001, "runAsGroup": 10001,
                                                      "seccompProfile": {"type": "RuntimeDefault"}},
                                  "containers": [{"name": "smoke", "image": "curlimages/curl:8.12.1",
                                                  "command": ["/bin/sh", "-c", SMOKE_SCRIPT],
                                                  "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True,
                                                                      "capabilities": {"drop": ["ALL"]}},
                                                  "resources": {"requests": {"cpu": "50m", "memory": "32Mi"},
                                                                "limits": {"cpu": "200m", "memory": "64Mi"}}}],
                              }}},
    }


def report_autoscalers(namespace, shell):
    """HPA 의 현재 목표치를 **기록만** 한다 — 통과/실패를 가르지 않는다.

    HPA 가 켜져 있어도 metrics-server 가 없으면 목표치가 `<unknown>` 인 채 replica
    소유권만 가져간다(Deployment 가 `replicas` 를 렌더하지 않으므로 아무도 수를 정하지
    않는 상태). 그 사고는 배포가 성공한 뒤에 조용히 시작되므로, 배포 로그에 증거를
    남겨 두는 자리가 필요하다.

    **단언하지 않는 이유**: 메트릭은 파드 기동 뒤 수십 초가 지나야 채워진다. 여기서
    단언하면 멀쩡한 배포가 타이밍으로 깨진다 — 깜빡이는 게이트는 없는 게이트보다 나쁘다.
    HPA 가 없으면(= 그 환경이 안 켰으면) 아무것도 출력하지 않는다.
    """
    output = shell(["kubectl", "get", "hpa", "--namespace", namespace,
                    "--output", "custom-columns="
                    "NAME:.metadata.name,TARGETS:.spec.metrics[*].resource.target.averageUtilization,"
                    "CURRENT:.status.currentMetrics[*].resource.current.averageUtilization,"
                    "MIN:.spec.minReplicas,MAX:.spec.maxReplicas,REPLICAS:.status.currentReplicas",
                    "--ignore-not-found"])
    if output and output.strip():
        print("autoscalers:")
        print(output.rstrip())
        if "<none>" in output:
            print("autoscalers: 현재값이 아직 비어 있다 — 수십 초 뒤 다시 보라. "
                  "계속 비어 있으면 metrics-server 애드온을 확인한다"
                  "(infra/terraform/stack/eks.tf aws_eks_addon.metrics_server)")


# AI 가 기동 때 스스로 적는 한 줄들. 외부 배선은 **있으면 INFO 로 주소를, 없으면 WARN
# 으로 미설정을** 남기므로, 이 표식들만 뽑으면 양쪽이 다 보인다(`ai/main._warn_unwired`,
# `kma_weather.KmaWeatherAdapter.__init__`).
_WIRING_MARKERS = ("미설정", "미배선", "비어 있음", "기상청 단기예보")


def report_ai_wiring(namespace, shell):
    """AI 의 기동 배선 한 줄들을 배포 로그로 끌어올린다 — **기록만** 한다.

    **왜 필요한가**: 외부 키가 빠지면 AI 는 기동에 성공하고 품질만 조용히 떨어진다
    (날씨 `no_adjust`, KB 없이 규칙 랭킹). 그 경고는 파드 로그에만 남고, 파드 로그는
    클러스터 자격이 있는 사람만 본다 — 실제로 "키를 시크릿에 넣었는데 붙었는지 확인할
    길이 없다"에서 막혔다(2026-10-05). 배포 로그가 그 증거를 두는 자리다.

    **단언하지 않는 이유**: 배선 공백은 설정값의 결과이지 배포의 결함이 아니다. 여기서
    실패시키면 날씨 키 없이 도는 환경을 배포할 수 없게 된다 — `WEATHER_API` 는 선택값이다.

    표식이 하나도 없으면 아무것도 출력하지 않는다. 기동 줄이 `--tail` 밖으로 밀렸거나
    조립 경로가 `TRIPPILOT_WIRING=unwired` 인 경우라 **"공백 없음"의 증거가 아니다.**
    """
    try:
        output = shell(["kubectl", "logs", "--namespace", namespace, "deployment/ai", "--tail", "400"])
    except CommandError as error:
        print(f"ai-wiring: AI 로그를 못 읽었다 — {error}")
        return
    lines = [line.strip() for line in output.splitlines()
             if any(marker in line for marker in _WIRING_MARKERS)]
    if lines:
        print("ai-wiring:")
        for line in lines:
            print(f"  {line}")


def run(namespace, shell):
    delete = ["kubectl", "delete", "job", "trippilot-smoke", "--namespace", namespace,
              "--ignore-not-found", "--cascade=foreground", "--wait=true", "--timeout=90s"]
    shell(delete)
    try:
        shell(["kubectl", "apply", "--server-side", "--field-manager=trippilot-runtime", "-f", "-"], json.dumps(manifest(namespace)))
        shell(["kubectl", "wait", "--namespace", namespace, "--for=condition=complete", "job/trippilot-smoke", "--timeout=330s"])
    finally:
        shell(delete)
    report_autoscalers(namespace, shell)
    report_ai_wiring(namespace, shell)
