#!/usr/bin/env bash
#
# 백엔드와 PostgreSQL 을 로컬 클러스터에 배포한다(최초 배포 및 매니페스트 변경 시).
#
#   ./deploy/bin/deploy.sh
#
# 코드만 바꿨다면 update.sh 가 더 빠르다.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_cmd kubectl docker
require_cluster
require_kind_context

# 이미지가 없으면 파드가 ErrImageNeverPull 로 멈춘다. 배포 전에 잡아준다.
if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  die "이미지 '${IMAGE}' 가 없습니다. 먼저 ./deploy/bin/build.sh 를 실행하세요."
fi

# 네임스페이스를 먼저 만든다.
# `kubectl apply -f <디렉터리>` 는 파일명 알파벳 순으로 적용하므로 configmap·deployment 가
# namespace 보다 먼저 처리되어 "namespaces not found" 로 실패한다.
log "네임스페이스 적용"
kubectl apply -f "${MANIFEST_DIR}/namespace.yaml"

# ── PostgreSQL 먼저 ────────────────────────────────────────────────────────
# 백엔드는 기동 시 Flyway 마이그레이션을 돌리므로 DB 가 먼저 살아 있어야 한다.
# (Deployment 의 initContainer 가 한 번 더 기다리지만, 여기서 먼저 세우면
#  실패했을 때 "DB 가 안 떴다"는 것이 바로 드러난다.)
log "PostgreSQL 적용"
kubectl apply -f "${POSTGRES_MANIFEST_DIR}"

log "PostgreSQL 기동 대기"
if ! kubectl rollout status "statefulset/${POSTGRES}" -n "${NAMESPACE}" --timeout=180s; then
  warn "PostgreSQL 기동 실패 — 진단 정보:"
  kubectl get pods -n "${NAMESPACE}" -o wide
  kubectl describe "statefulset/${POSTGRES}" -n "${NAMESPACE}" | tail -25
  die "배포 실패"
fi

# ── 백엔드 ────────────────────────────────────────────────────────────────
log "백엔드 매니페스트 적용: ${MANIFEST_DIR}"
kubectl apply -f "${MANIFEST_DIR}"

log "롤아웃 대기"
if ! kubectl rollout status "deployment/${DEPLOYMENT}" -n "${NAMESPACE}" --timeout=240s; then
  warn "롤아웃 실패 — 진단 정보:"
  kubectl get pods -n "${NAMESPACE}" -o wide
  kubectl describe "deployment/${DEPLOYMENT}" -n "${NAMESPACE}" | tail -25
  kubectl logs "deployment/${DEPLOYMENT}" -n "${NAMESPACE}" --tail=40 2>/dev/null || true
  die "배포 실패"
fi

# ── SigNoz UI NodePort (있을 때만) ────────────────────────────────────────
# SigNoz 는 별도 설치(cluster-up.sh)라 없을 수도 있다. 없으면 조용히 건너뛴다.
if kubectl get namespace signoz >/dev/null 2>&1; then
  log "SigNoz UI NodePort 적용"
  kubectl apply -f "${SIGNOZ_MANIFEST_DIR}"
else
  warn "signoz 네임스페이스가 없어 UI NodePort 를 건너뜁니다 (./deploy/bin/cluster-up.sh 참조)."
fi

# ── 나머지 서비스 (TRIP-325) ──────────────────────────────────────────────
# redis 는 백엔드의 조회 캐시라 백엔드보다 먼저 있어야 하지만, 없어도 기능은
# degrade 만 되므로 롤아웃을 기다리지는 않는다.
log "redis 적용"
kubectl apply -f "${REPO_ROOT}/deploy/k8s/redis"

log "ai · frontend 적용"
kubectl apply -f "${REPO_ROOT}/deploy/k8s/ai"
kubectl apply -f "${REPO_ROOT}/deploy/k8s/frontend"

for d in redis ai frontend; do
  if ! kubectl rollout status "deployment/${d}" -n "${NAMESPACE}" --timeout=180s; then
    warn "${d} 롤아웃 실패 — 진단 정보:"
    kubectl describe "deployment/${d}" -n "${NAMESPACE}" | tail -20
    die "배포 실패"
  fi
done

cat <<EOF

$(ok "배포 완료")

  frontend:   http://localhost:8080
  backend:    http://localhost:8081/actuator/health/readiness
  ai:         http://localhost:8082/health
  SigNoz UI:  http://localhost:8083     (port-forward 불필요)

  로그 보기:  kubectl logs -f deployment/${DEPLOYMENT} -n ${NAMESPACE}
  SigNoz 필터: service.name = trippilot-backend

EOF
