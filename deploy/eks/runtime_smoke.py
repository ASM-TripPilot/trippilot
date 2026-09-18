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


def run(namespace, shell):
    delete = ["kubectl", "delete", "job", "trippilot-smoke", "--namespace", namespace,
              "--ignore-not-found", "--cascade=foreground", "--wait=true", "--timeout=90s"]
    shell(delete)
    try:
        shell(["kubectl", "apply", "--server-side", "--field-manager=trippilot-runtime", "-f", "-"], json.dumps(manifest(namespace)))
        shell(["kubectl", "wait", "--namespace", namespace, "--for=condition=complete", "job/trippilot-smoke", "--timeout=330s"])
    finally:
        shell(delete)
