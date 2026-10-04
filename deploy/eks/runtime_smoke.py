"""In-cluster smoke checks, including the public gateway's route deny boundary."""
import json

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
