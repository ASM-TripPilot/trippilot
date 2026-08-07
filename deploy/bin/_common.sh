#!/usr/bin/env bash
# deploy/bin/* 이 공통으로 쓰는 설정과 도우미. 단독 실행하지 않는다.

set -euo pipefail

CLUSTER_NAME="trippilot"
NAMESPACE="trippilot"
KUBE_CONTEXT="kind-${CLUSTER_NAME}"

# 이 스크립트가 어디서 호출되든 저장소 루트를 기준으로 동작하게 한다.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# 없는 도구를 만나면 절반쯤 진행한 뒤 알 수 없는 에러로 죽는 대신 여기서 멈춘다.
require() {
  local cmd="$1" hint="${2:-}"
  command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' 가 없습니다. ${hint}"
}

require_docker() {
  require docker "Docker Desktop 을 설치·실행하세요 (docs/installs/k8s_install.md)."
  docker info >/dev/null 2>&1 || die "Docker 데몬이 꺼져 있습니다. Docker Desktop 을 실행하세요."
}

# kubectl 이 다른 클러스터를 가리킨 채로 apply 하는 사고를 막는다.
require_cluster() {
  require kubectl "brew install kubectl"
  kubectl config get-contexts -o name 2>/dev/null | grep -qx "$KUBE_CONTEXT" \
    || die "'$KUBE_CONTEXT' 컨텍스트가 없습니다. 먼저 'just cluster-up' 을 실행하세요."
}

kc() { kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" "$@"; }
