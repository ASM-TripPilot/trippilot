# 관측성 — SigNoz (TRIP-218 에서 이식).
#
# 백엔드는 OTLP 로 세 신호를 SigNoz 에 보낸다.
#   로그   logback OTLP appender (MaskingAppender 경유) + stdout JSON
#   메트릭 OTel Java 에이전트   (Micrometer OTLP push 는 에이전트와 공존 시 조용히 유실)
#   트레이스 OTel Java 에이전트
#
# 에이전트는 Bazel 이 backend 이미지에 넣고 entrypoint 의 -javaagent 로 붙인다
# (deploy/BUILD.bazel · MODULE.bazel 의 otel_javaagent).

APP    := "trippilot-backend"
# host 는 just/k8s.just 에 있다 — 기본 localhost, TRIPPILOT_HOST 로 서버 IP 를 줄 수 있다.
API    := "http://" + host + ":8081"
# 8080 은 frontend 가 쓰므로 SigNoz UI 는 8083 이다(TRIP-325).
SIGNOZ := "http://" + host + ":8083"

# SigNoz UI 주소 안내 (port-forward 불필요 — NodePort 30083 → 호스트 8083)
signoz:
    @echo "→ {{ SIGNOZ }}"
    @echo "   필터:  service.name = {{ APP }}"

# 텔레메트리를 만들 트래픽 발생.
#
# 마지막 요청은 **마스킹 프로브**다. MDC(X-Trace-Id)에 JWT 형태 값을 실어 보내
# 두 로그 경로가 모두 그것을 가리는지 실제로 확인할 수 있게 한다.
[doc("텔레메트리를 만들 트래픽 발생 (마스킹 프로브 포함)")]
smoke:
    @for i in 1 2 3 4 5; do curl -s -o /dev/null {{ API }}/api/health; done
    @curl -s -o /dev/null {{ API }}/api/v1/terms
    @curl -s -o /dev/null -X POST {{ API }}/api/v1/auth/social/google \
        -H 'Content-Type: application/json' \
        -H 'X-Trace-Id: eyJhbGciOiJIUzI1NiJ9.bWFza2luZy1wcm9iZQ.SIGNATURE' \
        --data-raw '{"broken":' || true
    @echo "✓ 트래픽 발생 완료 — 메트릭은 15초 주기라 잠시 기다리세요"

# 주기적으로 트래픽을 발생시켜 SigNoz 에서 로그가 흐르는 것을 본다 (Ctrl+C 로 중지)
#
#   just load           2초 간격, 무한
#   just load 1         1초 간격
#   just load 0.5 60    0.5초 간격, 60회
#
# 모든 요청에 loadtest-<실행ID>-<순번> 형태의 상관 ID 를 실어 보낸다.
[doc("주기적으로 트래픽을 발생시킨다 (Ctrl+C 로 중지)")]
load interval="2" count="0":
    #!/usr/bin/env bash
    set -uo pipefail

    # just 는 이름있는 인자를 지원하지 않는다. `just load interval=1` 로 부르면
    # "interval=1" 이라는 문자열이 값으로 그대로 들어온다. 그대로 두면 아래
    # 산술 비교가 bash 의 "integer expression expected" 로 죽는데, 그 메시지만
    # 보고는 원인을 알 수 없다 — 여기서 먼저 잡아 올바른 사용법을 보여준다.
    # (`just --list` 가 기본값을 `interval="2"` 로 표시하는 탓에 그대로 따라
    #  치기 쉽다.)
    case "{{ interval }}" in
      ''|*[!0-9.]*) BAD="{{ interval }}" ;;
      *)            BAD="" ;;
    esac
    case "{{ count }}" in
      ''|*[!0-9]*)  BAD="{{ count }}" ;;
    esac
    if [ -n "${BAD}" ]; then
      echo "인자는 숫자만 받습니다 (받은 값: '${BAD}')." >&2
      echo >&2
      echo "  just load          # 2초 간격, 무한" >&2
      echo "  just load 1        # 1초 간격, 무한" >&2
      echo "  just load 0.5 60   # 0.5초 간격, 60회" >&2
      exit 2
    fi

    RUN=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c6)
    echo "실행 ID: ${RUN}   간격: {{ interval }}초   횟수: $([ "{{ count }}" = "0" ] && echo 무한 || echo {{ count }})"
    echo "SigNoz 필터:  traceId CONTAINS \"loadtest-${RUN}\""
    echo "중지: Ctrl+C"
    echo
    i=0
    while [ "{{ count }}" = "0" ] || [ "$i" -lt "{{ count }}" ]; do
      i=$((i+1))
      CID=$(printf 'loadtest-%s-%05d' "$RUN" "$i")
      CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Trace-Id: ${CID}" {{ API }}/api/v1/terms || echo 000)
      # 20회마다 오류 경로도 한 번 섞는다 — WARN 로그와 마스킹이 살아 있는지 확인.
      if [ $((i % 20)) -eq 0 ]; then
        curl -s -o /dev/null -X POST {{ API }}/api/v1/auth/social/google \
          -H 'Content-Type: application/json' \
          -H "X-Trace-Id: eyJhbGciOiJIUzI1NiJ9.${CID}.SIGNATURE" --data-raw '{"broken":' || true
      fi
      printf '\r  %s  http=%s' "$CID" "$CODE"
      sleep {{ interval }}
    done
    echo

# SigNoz 에 실제로 적재됐는지 확인 (ClickHouse 직접 조회)
#
# UI 를 거치지 않고 저장소를 직접 본다. "대시보드에 안 보인다"가 수집 실패인지
# 조회 조건 문제인지 가르는 것이 목적이다.
[doc("SigNoz 에 실제로 적재됐는지 확인 (ClickHouse 직접 조회)")]
verify-telemetry:
    #!/usr/bin/env bash
    set -uo pipefail
    CH=chi-signoz-telemetrystore-clickhouse-cluster-0-0-0
    # 별칭은 ASCII 로 둔다 — ClickHouse 는 따옴표 없는 비ASCII 식별자를 문법 오류로 거절한다.
    # stderr 는 버리지 않고 걸러서 보여준다. 조용히 삼키면 "0건"과 "질의 실패"가 구분되지 않는다.
    q() { kubectl exec -n signoz $CH -- clickhouse-client --query "$1" 2>&1 | grep -v 'Defaulted container'; }

    echo "── 로그 (최근 10분) ──"
    q "SELECT count() AS total, countIf(severity_text='WARN') AS warn,
              countIf(severity_text='ERROR') AS error,
              countIf(position(body,'eyJ')>0) AS unmasked_jwt
       FROM signoz_logs.distributed_logs_v2
       WHERE resources_string['service.name']='{{ APP }}'
         AND timestamp > toUnixTimestamp64Nano(now64()-toIntervalMinute(10))
       FORMAT Vertical"

    echo "── 트레이스 (최근 10분) ──"
    q "SELECT count() AS spans, uniq(trace_id) AS traces
       FROM signoz_traces.distributed_signoz_index_v3
       WHERE resource_string_service\$\$name='{{ APP }}' AND timestamp > now()-toIntervalMinute(10)
       FORMAT Vertical"

    echo "── 메트릭 (최근 10분, 샘플) ──"
    q "SELECT DISTINCT metric_name FROM signoz_metrics.distributed_samples_v4
       WHERE unix_milli > toUnixTimestamp(now()-toIntervalMinute(10))*1000
         AND metric_name LIKE 'jvm%' ORDER BY metric_name LIMIT 5 FORMAT TSV"

    echo
    echo "※ unmasked_jwt 가 0 이 아니면 사고입니다 — 원문 토큰이 수집기로 나갔다는 뜻."
    echo "※ 세 신호가 모두 0 이면 SigNoz 관리자 계정을 만들었는지 확인하세요(deploy/README.md)."

# SigNoz 적재 상황을 주기적으로 출력 (Ctrl+C 로 중지)
watch interval="5":
    #!/usr/bin/env bash
    set -uo pipefail
    CH=chi-signoz-telemetrystore-clickhouse-cluster-0-0-0
    echo "{{ interval }}초마다 갱신 — Ctrl+C 로 중지"
    while true; do
      kubectl exec -n signoz $CH -- clickhouse-client --query \
        "SELECT formatDateTime(now(),'%H:%M:%S') AS time,
                count() AS total,
                countIf(severity_text='ERROR') AS errors,
                countIf(severity_text='WARN')  AS warns,
                countIf(position(body,'eyJ')>0) AS unmasked
         FROM signoz_logs.distributed_logs_v2
         WHERE resources_string['service.name']='{{ APP }}'
           AND timestamp > toUnixTimestamp64Nano(now64()-toIntervalMinute(1))
         FORMAT TSVWithNames" 2>/dev/null | column -t
      echo
      sleep {{ interval }}
    done

# ── 교육자료 ──────────────────────────────────────────────────────────────

# 수업 슬라이드를 브라우저에서 열기 (오프라인·단일 파일)
slides:
    @open docs/education/k8s-observability-class.html 2>/dev/null \
      || xdg-open docs/education/k8s-observability-class.html 2>/dev/null \
      || echo "브라우저에서 여세요: docs/education/k8s-observability-class.html"
