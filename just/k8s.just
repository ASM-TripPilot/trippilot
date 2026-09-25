# 로컬 kind 클러스터 운영.
#
# 실제 동작은 deploy/bin/*.sh 에 있다. 레시피가 얇은 이유는 스크립트가
# 셸에서도 그대로 실행 가능해야 하기 때문이다(CI·디버깅).

ctx      := "kind-trippilot"
ns       := "trippilot"
backend  := "trippilot-backend"
postgres := "trippilot-postgres"

# 서비스에 접속할 때 쓰는 호스트. 기본은 localhost — 개발 PC 에서 직접 쓰면 그대로 둔다.
#
# 헤드리스 서버(홈 서버 등)에 띄우고 **다른 PC 브라우저·터미널**에서 볼 때는 서버 IP 를 준다.
# 클러스터 쪽은 손댈 게 없다 — kind 의 extraPortMappings 는 이미 0.0.0.0 에 바인딩하므로
# 여기 URL 만 IP 를 가리키면 된다.
#
#   just host=192.168.1.100 health
#   export TRIPPILOT_HOST=192.168.1.100     (셸에 고정)
host := env_var_or_default('TRIPPILOT_HOST', 'localhost')

# kind 클러스터 생성 + SigNoz 설치 (멱등)
cluster-up:
    ./deploy/bin/cluster-up.sh

# 클러스터 삭제 — 데이터와 수집한 텔레메트리도 함께 사라진다
cluster-down:
    ./deploy/bin/down.sh

# 매니페스트 적용 (postgres → backend → redis · ai · frontend)
deploy:
    ./deploy/bin/deploy.sh

# 워크로드 상태 한눈에
status:
    kubectl --context {{ ctx }} -n {{ ns }} get pods,svc -o wide

# just logs trippilot-backend  /  just logs ai  /  just logs frontend
logs SERVICE:
    kubectl --context {{ ctx }} -n {{ ns }} logs -f "deployment/{{ SERVICE }}" --tail=200

# 이미지를 새로 만들고 파드만 갈아끼운다 (클러스터는 그대로)
update: images
    kubectl --context {{ ctx }} -n {{ ns }} rollout restart \
        deployment/{{ backend }} deployment/ai deployment/frontend
    kubectl --context {{ ctx }} -n {{ ns }} rollout status deployment/{{ backend }} --timeout=300s

# 매니페스트만 걷어낸다 (클러스터·SigNoz 는 유지)
undeploy:
    kubectl --context {{ ctx }} delete namespace {{ ns }} --ignore-not-found

# 네 서비스가 실제로 응답하는지 확인
health:
    @printf 'frontend  '; curl -fsS -o /dev/null -w '%{http_code}\n' http://{{ host }}:8080/ || echo FAIL
    @printf 'backend   '; curl -fsS http://{{ host }}:8081/actuator/health || echo FAIL
    @printf '\nai        '; curl -fsS http://{{ host }}:8082/health || echo FAIL
    @printf '\nsignoz    '; curl -fsS -o /dev/null -w '%{http_code}\n' http://{{ host }}:8083/ || echo FAIL

# ── 데이터베이스 ──────────────────────────────────────────────────────────

# psql 셸 열기 (app_user 자격)
db-shell:
    kubectl --context {{ ctx }} -n {{ ns }} exec -it {{ postgres }}-0 -- psql -U app_user -d trippilot

# 적용된 Flyway 마이그레이션 확인
db-migrations:
    @kubectl --context {{ ctx }} -n {{ ns }} exec {{ postgres }}-0 -- psql -U app_migrate -d trippilot -c \
      "SELECT version, description, success FROM app.flyway_schema_history ORDER BY installed_rank"

# DB 를 완전히 비우고 다시 만든다 — 초기화 SQL(롤·스키마)을 고쳤을 때 필요.
#
# /docker-entrypoint-initdb.d 의 스크립트는 **데이터 디렉터리가 비어 있을 때만** 실행된다.
# 즉 ConfigMap 만 고치고 파드를 재시작해도 반영되지 않는다. PVC 를 지워야 한다.
[doc("DB 를 완전히 비우고 다시 만든다 (초기화 SQL 변경 시)")]
db-reset:
    @echo "⚠️  DB 의 모든 데이터가 사라집니다."
    kubectl --context {{ ctx }} -n {{ ns }} delete statefulset {{ postgres }} --ignore-not-found
    kubectl --context {{ ctx }} -n {{ ns }} delete pvc data-{{ postgres }}-0 --ignore-not-found
    kubectl --context {{ ctx }} -n {{ ns }} apply -f deploy/k8s/postgres
    kubectl --context {{ ctx }} -n {{ ns }} rollout status statefulset/{{ postgres }} --timeout=180s
    kubectl --context {{ ctx }} -n {{ ns }} rollout restart deployment/{{ backend }}
