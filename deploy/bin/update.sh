#!/usr/bin/env bash
#
# 코드 변경 후 재배포. 빌드 → 노드 적재 → 롤링 재시작.
#
#   ./deploy/bin/update.sh
#
# 태그(:dev)를 그대로 두고 재시작하는 이유: 태그가 같아도 kind load 로 노드의 이미지가 교체되므로
# 새 파드는 새 이미지를 쓴다. imagePullPolicy 가 Never 라 레지스트리로 나가지 않는다.
# 태그를 매번 바꾸면 노드에 옛 이미지가 계속 쌓인다.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_cmd docker kind kubectl
require_cluster
require_kind_context

kubectl get "deployment/${DEPLOYMENT}" -n "${NAMESPACE}" >/dev/null 2>&1 \
  || die "배포된 Deployment 가 없습니다. 최초 배포는 ./deploy/bin/deploy.sh 입니다."

"$(dirname "${BASH_SOURCE[0]}")/build.sh"

log "롤링 재시작"
kubectl rollout restart "deployment/${DEPLOYMENT}" -n "${NAMESPACE}"

if ! kubectl rollout status "deployment/${DEPLOYMENT}" -n "${NAMESPACE}" --timeout=240s; then
  warn "롤아웃 실패 — 이전 ReplicaSet 으로 되돌리려면:"
  warn "  kubectl rollout undo deployment/${DEPLOYMENT} -n ${NAMESPACE}"
  kubectl get pods -n "${NAMESPACE}" -o wide
  kubectl logs "deployment/${DEPLOYMENT}" -n "${NAMESPACE}" --tail=40 2>/dev/null || true
  die "업데이트 실패"
fi

ok "업데이트 완료 — curl http://localhost:8081/api/health"
