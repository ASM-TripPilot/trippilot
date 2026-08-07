# TripPilot 개발 명령 모음.
#
#   just            사용 가능한 명령 보기
#   just doctor     필요한 도구가 다 있는지 확인
#
# 이 파일은 기존 스크립트를 **대체하지 않고 감싼다**. 실제 동작은 deploy/bin/*.sh 와
# Gradle 에 있고, 여기서는 외우기 쉬운 이름만 붙인다.

set shell := ["bash", "-uc"]

CLUSTER   := "trippilot"
NAMESPACE := "trippilot"
APP       := "trippilot-backend"
POSTGRES  := "trippilot-postgres"

# 호스트에서 본 백엔드 주소. Service NodePort 30081 이 kind 의 extraPortMappings 로
# 호스트 8081 에 연결돼 있어 port-forward 가 필요 없다(deploy/kind/cluster.yaml).
API    := "http://localhost:8081"
# SigNoz UI 도 같은 방식(NodePort 30080 → 호스트 8080).
SIGNOZ := "http://localhost:8080"

# JDK 25 툴체인. 호스트 기본 JDK 가 달라도 Gradle 이 흔들리지 않게 고정한다.
JDK := "/opt/homebrew/opt/openjdk@25"

# 사용 가능한 명령 목록
default:
    @just --list --unsorted

# ── 환경 점검 ──────────────────────────────────────────────────────────────

# 필요한 도구와 클러스터 상태를 한 번에 확인
doctor:
    @echo "── 도구 ──"
    @for c in docker kubectl kind helm just; do \
        if command -v $c >/dev/null 2>&1; then printf '  ✓ %-8s %s\n' "$c" "$(command -v $c)"; \
        else printf '  ✗ %-8s 없음\n' "$c"; fi; done
    @if [ -d "{{JDK}}" ]; then printf '  ✓ %-8s %s\n' "jdk25" "{{JDK}}"; \
      else printf '  ✗ %-8s 없음 (brew install openjdk@25)\n' "jdk25"; fi
    @echo "── 클러스터 ──"
    @kubectl config current-context 2>/dev/null | sed 's/^/  컨텍스트: /' || echo "  컨텍스트: 없음"
    @kubectl get nodes --no-headers 2>/dev/null | awk '{printf "  노드: %s %s\n",$1,$2}' || true
    @echo "── 앱 ──"
    @kubectl get pods -n {{NAMESPACE}} --no-headers 2>/dev/null | awk '{printf "  %s %s %s\n",$1,$2,$3}' || true

# ── 빌드와 테스트 (Gradle) ─────────────────────────────────────────────────

# 백엔드 전체 빌드
build:
    JAVA_HOME={{JDK}} ./backend/gradlew -p backend build

# 백엔드 전체 테스트
test:
    JAVA_HOME={{JDK}} ./backend/gradlew -p backend test

# 관측성 마스킹 테스트만 (두 로그 경로의 일치를 고정)
test-masking:
    JAVA_HOME={{JDK}} ./backend/gradlew -p backend :app:test \
      --tests "com.trippilot.app.observability.MaskingParityTest" \
      --tests "com.trippilot.app.MaskingLoggingTest"

# 테스트를 캐시 없이 다시 실행 — 결과가 의심스러울 때
retest:
    JAVA_HOME={{JDK}} ./backend/gradlew -p backend test --rerun-tasks

# Gradle 산출물 정리
clean:
    JAVA_HOME={{JDK}} ./backend/gradlew -p backend clean

# ── 클러스터와 배포 ────────────────────────────────────────────────────────

# kind 클러스터 생성 + SigNoz 설치 (멱등)
cluster-up:
    ./deploy/bin/cluster-up.sh

# 클러스터 삭제 — 수집한 텔레메트리도 함께 사라짐
cluster-down:
    kind delete cluster --name {{CLUSTER}}

# 컨테이너 이미지 빌드 + kind 노드 적재
image:
    ./deploy/bin/build.sh

# 최초 배포 (PostgreSQL + 백엔드 매니페스트 적용)
deploy:
    ./deploy/bin/deploy.sh

# 코드 변경 후 재배포 (빌드 + 적재 + 롤링 재시작)
update:
    ./deploy/bin/update.sh

# 처음부터 끝까지 — 클러스터부터 배포까지
up: cluster-up image deploy
    @echo "✓ 준비 완료 — just smoke 로 확인하세요"

# 배포 상태
status:
    kubectl get all -n {{NAMESPACE}}

# 앱 로그 따라가기
logs:
    kubectl logs -f deployment/{{APP}} -n {{NAMESPACE}}

# 배포 되돌리기
rollback:
    kubectl rollout undo deployment/{{APP}} -n {{NAMESPACE}}
    kubectl rollout status deployment/{{APP}} -n {{NAMESPACE}}

# 앱만 제거 (클러스터·SigNoz 는 유지)
undeploy:
    kubectl delete -f deploy/k8s/backend --ignore-not-found

# ── 데이터베이스 ──────────────────────────────────────────────────────────

# psql 셸 열기 (app_user 자격)
db-shell:
    kubectl exec -it {{POSTGRES}}-0 -n {{NAMESPACE}} -- psql -U app_user -d trippilot

# 적용된 Flyway 마이그레이션 확인
db-migrations:
    @kubectl exec {{POSTGRES}}-0 -n {{NAMESPACE}} -- psql -U app_migrate -d trippilot -c \
      "SELECT version, description, success FROM app.flyway_schema_history ORDER BY installed_rank"

# DB 를 완전히 비우고 다시 만든다 — 초기화 SQL(롤·스키마)을 고쳤을 때 필요.
#
# /docker-entrypoint-initdb.d 의 스크립트는 **데이터 디렉터리가 비어 있을 때만** 실행된다.
# 즉 ConfigMap 만 고치고 파드를 재시작해도 반영되지 않는다. PVC 를 지워야 한다.
[doc("DB 를 완전히 비우고 다시 만든다 (초기화 SQL 변경 시)")]
db-reset:
    @echo "⚠️  DB 의 모든 데이터가 사라집니다."
    kubectl delete statefulset {{POSTGRES}} -n {{NAMESPACE}} --ignore-not-found
    kubectl delete pvc data-{{POSTGRES}}-0 -n {{NAMESPACE}} --ignore-not-found
    kubectl apply -f deploy/k8s/postgres
    kubectl rollout status statefulset/{{POSTGRES}} -n {{NAMESPACE}} --timeout=180s
    kubectl rollout restart deployment/{{APP}} -n {{NAMESPACE}}

# ── 관측성 ────────────────────────────────────────────────────────────────

# SigNoz UI 주소 안내 (port-forward 불필요 — NodePort 30080 → 호스트 8080)
signoz:
    @echo "→ {{SIGNOZ}}"
    @echo "   필터:  service.name = {{APP}}"

# 앱 헬스체크
health:
    @curl -s {{API}}/actuator/health/liveness && echo
    @curl -s {{API}}/actuator/health/readiness && echo

# 텔레메트리를 만들 트래픽 발생.
#
# 마지막 요청은 **마스킹 프로브**다. MDC(X-Trace-Id)에 JWT 형태 값을 실어 보내
# 두 로그 경로가 모두 그것을 가리는지 실제로 확인할 수 있게 한다.
[doc("텔레메트리를 만들 트래픽 발생 (마스킹 프로브 포함)")]
smoke:
    @for i in 1 2 3 4 5; do curl -s -o /dev/null {{API}}/api/health; done
    @curl -s -o /dev/null {{API}}/api/v1/terms
    @curl -s -o /dev/null -X POST {{API}}/api/v1/auth/social/google \
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
# SigNoz 에서 이번 실행만 골라 볼 수 있다.
[doc("주기적으로 트래픽을 발생시킨다 (Ctrl+C 로 중지)")]
load interval="2" count="0":
    #!/usr/bin/env bash
    set -uo pipefail
    RUN=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c6)
    echo "실행 ID: ${RUN}   간격: {{interval}}초   횟수: $([ "{{count}}" = "0" ] && echo 무한 || echo {{count}})"
    echo "SigNoz 필터:  traceId CONTAINS \"loadtest-${RUN}\""
    echo "중지: Ctrl+C"
    echo
    i=0
    while [ "{{count}}" = "0" ] || [ "$i" -lt "{{count}}" ]; do
      i=$((i+1))
      CID=$(printf 'loadtest-%s-%05d' "$RUN" "$i")
      CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Trace-Id: ${CID}" {{API}}/api/v1/terms || echo 000)
      # 20회마다 오류 경로도 한 번 섞는다 — WARN 로그와 마스킹이 살아 있는지 확인.
      if [ $((i % 20)) -eq 0 ]; then
        curl -s -o /dev/null -X POST {{API}}/api/v1/auth/social/google \
          -H 'Content-Type: application/json' \
          -H "X-Trace-Id: eyJhbGciOiJIUzI1NiJ9.${CID}.SIGNATURE" --data-raw '{"broken":' || true
      fi
      printf '\r  %s  http=%s' "$CID" "$CODE"
      sleep {{interval}}
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
       WHERE resources_string['service.name']='{{APP}}'
         AND timestamp > toUnixTimestamp64Nano(now64()-toIntervalMinute(10))
       FORMAT Vertical"

    echo "── 트레이스 (최근 10분) ──"
    q "SELECT count() AS spans, uniq(trace_id) AS traces
       FROM signoz_traces.distributed_signoz_index_v3
       WHERE resource_string_service\$\$name='{{APP}}' AND timestamp > now()-toIntervalMinute(10)
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
    echo "{{interval}}초마다 갱신 — Ctrl+C 로 중지"
    while true; do
      kubectl exec -n signoz $CH -- clickhouse-client --query \
        "SELECT formatDateTime(now(),'%H:%M:%S') AS time,
                count() AS total,
                countIf(severity_text='ERROR') AS errors,
                countIf(severity_text='WARN')  AS warns,
                countIf(position(body,'eyJ')>0) AS unmasked
         FROM signoz_logs.distributed_logs_v2
         WHERE resources_string['service.name']='{{APP}}'
           AND timestamp > toUnixTimestamp64Nano(now64()-toIntervalMinute(1))
         FORMAT TSVWithNames" 2>/dev/null | column -t
      echo
      sleep {{interval}}
    done

# ── 교육자료 ──────────────────────────────────────────────────────────────

# 수업 슬라이드를 브라우저에서 열기 (오프라인·단일 파일)
slides:
    @open docs/education/k8s-observability-class.html 2>/dev/null \
      || xdg-open docs/education/k8s-observability-class.html 2>/dev/null \
      || echo "브라우저에서 여세요: docs/education/k8s-observability-class.html"
