#!/usr/bin/env bash
# 클러스터를 통째로 지운다. 데이터(PVC)와 SigNoz 가 수집한 텔레메트리도 함께
# 사라진다 — 로컬 전용이므로 그게 맞다.

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_cmd kind

if kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
  log "클러스터 '${CLUSTER_NAME}' 삭제"
  kind delete cluster --name "${CLUSTER_NAME}"
  ok "삭제 완료"
else
  ok "클러스터 '${CLUSTER_NAME}' 가 없습니다 — 할 일 없음."
fi
