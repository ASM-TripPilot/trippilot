#!/usr/bin/env bash
# 매니페스트를 적용하고 롤아웃이 끝날 때까지 기다린다(멱등 — 여러 번 돌려도 안전).

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_cluster

log "네임스페이스"
kubectl --context "$KUBE_CONTEXT" apply -f deploy/k8s/00-namespace.yaml

# DB 초기화 SQL 은 compose 가 쓰는 backend/docker/init 을 그대로 ConfigMap 으로
# 만든다. 매니페스트에 SQL 을 복사해두면 compose 쪽과 조용히 갈라진다.
log "postgres 초기화 SQL ConfigMap"
kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" create configmap postgres-init \
  --from-file=backend/docker/init/ \
  --dry-run=client -o yaml | kubectl --context "$KUBE_CONTEXT" apply -f -

log "데이터 계층 (postgres · redis)"
kc apply -f deploy/k8s/postgres/
kc apply -f deploy/k8s/redis/

log "postgres 준비 대기"
kc rollout status statefulset/postgres --timeout=180s

log "애플리케이션 (backend · ai · frontend)"
kc apply -f deploy/k8s/backend/
kc apply -f deploy/k8s/ai/
kc apply -f deploy/k8s/frontend/

for d in backend ai frontend; do
  log "$d 롤아웃 대기"
  kc rollout status "deployment/$d" --timeout=300s
done

ok "배포 완료"
cat <<'EOF'

  frontend  http://localhost:8080
  backend   http://localhost:8081/actuator/health
  ai        http://localhost:8082/health
  postgres  localhost:15432  (db=trippilot user=app_user pw=app_user)

EOF
