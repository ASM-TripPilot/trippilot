# 로컬 kind 클러스터 운영.
#
# 실제 동작은 deploy/bin/*.sh 에 있다. 레시피가 얇은 이유는 스크립트가
# 셸에서도 그대로 실행 가능해야 하기 때문이다(CI·디버깅).

ctx := "kind-trippilot"
ns := "trippilot"

cluster-up:
    ./deploy/bin/cluster-up.sh

cluster-down:
    ./deploy/bin/down.sh

deploy:
    ./deploy/bin/deploy.sh

# 워크로드 상태 한눈에
status:
    kubectl --context {{ ctx }} -n {{ ns }} get pods,svc -o wide

# just logs backend  /  just logs ai
logs SERVICE:
    kubectl --context {{ ctx }} -n {{ ns }} logs -f "deployment/{{ SERVICE }}" --tail=200

# 이미지를 새로 만들고 파드만 갈아끼운다 (클러스터는 그대로)
update: images
    kubectl --context {{ ctx }} -n {{ ns }} rollout restart deployment/backend deployment/ai deployment/frontend
    kubectl --context {{ ctx }} -n {{ ns }} rollout status deployment/backend --timeout=300s

# 매니페스트만 걷어낸다 (클러스터·데이터는 유지)
undeploy:
    kubectl --context {{ ctx }} delete namespace {{ ns }} --ignore-not-found

db-shell:
    kubectl --context {{ ctx }} -n {{ ns }} exec -it statefulset/postgres -- psql -U postgres -d trippilot

# 세 서비스가 실제로 응답하는지 확인
smoke:
    @printf 'frontend  '; curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:8080/ || echo FAIL
    @printf 'backend   '; curl -fsS http://localhost:8081/actuator/health || echo FAIL
    @printf '\nai        '; curl -fsS http://localhost:8082/health || echo FAIL
    @echo
