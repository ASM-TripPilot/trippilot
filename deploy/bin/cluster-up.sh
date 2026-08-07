#!/usr/bin/env bash
# kind 클러스터를 만든다. 이미 있으면 아무것도 하지 않는다(멱등).

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_docker
require kind "brew install kind"
require kubectl "brew install kubectl"

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  ok "클러스터 '$CLUSTER_NAME' 가 이미 있습니다 — 건너뜁니다."
else
  log "kind 클러스터 '$CLUSTER_NAME' 생성 중 (1~2분)"
  kind create cluster --config deploy/kind/cluster.yaml
  ok "클러스터 생성 완료"
fi

kubectl config use-context "$KUBE_CONTEXT" >/dev/null
ok "현재 컨텍스트: $KUBE_CONTEXT"
