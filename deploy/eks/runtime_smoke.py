"""In-cluster smoke checks, including the public gateway's route deny boundary."""
import json

from runtime_io import CommandError, wait_job

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
# `kma_weather.KmaWeatherAdapter.__init__`). `공휴일 휴무` 는 HOLIDAY_CLOSURE_MODE 줄(`ai/main._holiday_source`).
_WIRING_MARKERS = ("미설정", "미배선", "비어 있음", "기상청 단기예보", "실경로 배선",
                   "기능별 모델 배정", "공휴일 휴무")


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


# AI 파드 안에서 도는 표준 라이브러리 스크립트 — 발화·답변 문장·토큰은 찍지 않고 결과 모양만 한 줄로 낸다.
# 10번째 턴이라 요약이 due 다: 실 LLM 2~3회 + ai_kb.dialogue_memory 1행 쓰기 → 곧바로 DELETE 로 지운다(지운 수가 DB 왕복 증거).
_DIALOGUE_PROBE = r'''
import json, os, time, urllib.error, urllib.request, uuid
from datetime import datetime, timezone
token = os.environ.get("SERVICE_AUTH_TOKEN") or ""
headers = {"Content-Type": "application/json", **({"X-Service-Token": token} if token else {})}
session = "smoke-" + uuid.uuid4().hex[:12]
slot = {"slot_key": "2099-01-01#" + str(uuid.uuid4()), "name": "배포 확인 카페", "start_at": "10:00", "category": "CAFE"}
body = {"request_meta": {"request_id": session, "requested_at": datetime.now(timezone.utc).isoformat(), "deadline_ms": 9000},
        "utterance": "다음 일정 뭐야", "session_id": session,
        "recent_turns": [{"role": "USER", "text": "첫날 일정 알려줘"}, {"role": "ASSISTANT", "text": "첫날은 카페 한 곳이에요."}],
        "dialogue_context": {"pending": None, "turn_index": 10, "clarify_count": 0},
        "context": {"surface": "ITINERARY", "base_stays": [],
                    "trip": {"trip_id": session, "regions": ["제주"], "start_date": "2099-01-01", "end_date": "2099-01-02",
                             "phase": "PLANNING"},
                    "itinerary": {"status": "PLANNED", "days": [{"date": "2099-01-01", "slots": [slot]}]}}}
def call(method, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request("http://127.0.0.1:8000" + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, None
    except Exception as error:  # 접속 거부·시한·깨진 JSON — 종류만 싣는다(값·본문은 싣지 않는다)
        return type(error).__name__, None
started = time.monotonic()
result = {}
try:
    status, out = call("POST", "/ai/v1/dialogue/interpret", body)
    result.update(http=status, elapsed_ms=int((time.monotonic() - started) * 1000))
    if isinstance(out, dict):
        result.update(outcome=out.get("outcome"), kind=(out.get("answer") or {}).get("kind"), llm_calls=out.get("llm_calls"))
finally:
    status, out = call("DELETE", "/ai/v1/dialogue/memory?session_id=" + session)  # 쓴 기억은 무슨 일이 있어도 지운다
    result["memory_deleted"] = out.get("deleted") if status == 200 and isinstance(out, dict) else f"http {status}"
    print("ai-dialogue-probe " + json.dumps(result))
'''


def report_ai_dialogue(namespace, shell):
    """도우미 한 턴을 AI 파드 안에서 실제로 돌려 결과 **모양만** 적는다 — 기록만 한다(report_ai_wiring 과 같은 이유).

    **왜 필요한가**: 기동 배선 줄은 "켜졌다"까지만 말한다. 오케스트레이터는 실 LLM 배정·ai_kb 권한·섀도까지 붙어야
    한 턴이 되는데, 그것은 실제 턴으로만 드러난다 — 개발·운영 서버 둘 다 사용자 토큰 없이 부를 길이 없다. 섀도 비교는
    AI 로그(`intent_shadow`, trace_id `smoke-…` — 집계 스크립트가 거른다)에만 남는다.
    꺼진 환경이면 종전 경로 모양(FRAME·memory_deleted 0)이 찍힌다. 결과 줄이 없으면 아무것도 출력하지 않는다.
    """
    try:
        output = shell(["kubectl", "exec", "--namespace", namespace, "-i", "deployment/ai", "-c", "ai", "--",
                        "/app/.venv/bin/python", "-"], _DIALOGUE_PROBE)
    except CommandError as error:
        print(f"ai-dialogue: 확인 못 함 — {error}")
        return
    marker = "ai-dialogue-probe "
    line = next((line for line in output.splitlines() if line.startswith(marker)), None)
    if line:
        print(f"ai-dialogue: {line[len(marker):]}")


def run(namespace, shell):
    delete = ["kubectl", "delete", "job", "trippilot-smoke", "--namespace", namespace,
              "--ignore-not-found", "--cascade=foreground", "--wait=true", "--timeout=90s"]
    shell(delete)
    try:
        shell(["kubectl", "apply", "--server-side", "--field-manager=trippilot-runtime", "-f", "-"], json.dumps(manifest(namespace)))
        wait_job(shell, namespace, "trippilot-smoke", 330)
    finally:
        shell(delete)
    report_autoscalers(namespace, shell)
    report_ai_dialogue(namespace, shell)
    report_ai_wiring(namespace, shell)
