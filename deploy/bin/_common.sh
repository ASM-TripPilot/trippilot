#!/usr/bin/env bash
# 배포 스크립트 공통 정의. 각 스크립트가 source 한다.
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-trippilot}"
KUBE_CONTEXT="kind-${CLUSTER_NAME}"
NAMESPACE="${NAMESPACE:-trippilot}"
IMAGE_NAME="${IMAGE_NAME:-trippilot-backend}"
IMAGE_TAG="${IMAGE_TAG:-dev}"
IMAGE="${IMAGE_NAME}:${IMAGE_TAG}"
DEPLOYMENT="trippilot-backend"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"
MANIFEST_DIR="${REPO_ROOT}/deploy/k8s/backend"
KIND_CONFIG="${REPO_ROOT}/deploy/kind/cluster.yaml"

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "'$c' 명령을 찾을 수 없습니다. 설치 후 다시 실행하세요."
  done
}

# 컨텍스트 가드 — 이 스크립트가 존재하는 가장 큰 이유다.
#
# kubectl 은 "현재 컨텍스트"에 조용히 적용한다. EKS 컨텍스트가 선택된 상태로 배포 스크립트를
# 돌리면 운영 클러스터에 로컬 이미지를 배포하려 시도한다. 확인이 아니라 차단이어야 한다.
require_kind_context() {
  local current
  current="$(kubectl config current-context 2>/dev/null || true)"
  if [[ "${current}" != "${KUBE_CONTEXT}" ]]; then
    die "현재 컨텍스트가 '${current:-<없음>}' 입니다. 이 스크립트는 '${KUBE_CONTEXT}' 에서만 동작합니다.
    로컬 클러스터가 없다면:  ./deploy/bin/cluster-up.sh
    컨텍스트만 바꾸려면:     kubectl config use-context ${KUBE_CONTEXT}"
  fi
}

require_cluster() {
  kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}" \
    || die "kind 클러스터 '${CLUSTER_NAME}' 이 없습니다. 먼저 ./deploy/bin/cluster-up.sh 를 실행하세요."
}
