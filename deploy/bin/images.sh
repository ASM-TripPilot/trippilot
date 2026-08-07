#!/usr/bin/env bash
# Bazel 로 이미지 3종을 만들고 Docker 데몬 → kind 노드 순으로 적재한다.
#
# kind 는 자체 containerd 를 쓰기 때문에 호스트 Docker 에만 이미지가 있으면
# 파드는 ImagePullBackOff 로 떨어진다. 'kind load' 가 그 간극을 메운다.

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_docker
require bazel "brew install bazelisk"
require kind "brew install kind"

# backend 이미지는 Gradle 산출물에 의존한다. 비어 있으면 jar 없는 이미지가
# 조용히 만들어져 파드가 기동 직후 죽는다 — 여기서 먼저 막는다.
[[ -f deploy/artifacts/backend/app.jar ]] \
  || die "deploy/artifacts/backend/app.jar 가 없습니다. 'just backend-build' 를 먼저 실행하세요."

log "Bazel 이미지 빌드"
bazel build //deploy:images

for svc in backend frontend ai; do
  log "Docker 데몬에 적재: trippilot/${svc}:local"
  bazel run "//deploy:${svc}_load"
done

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  for svc in backend frontend ai; do
    log "kind 노드에 적재: trippilot/${svc}:local"
    kind load docker-image "trippilot/${svc}:local" --name "$CLUSTER_NAME"
  done
  ok "이미지 3종 적재 완료"
else
  warn "클러스터 '$CLUSTER_NAME' 가 없어 kind 적재는 건너뜁니다 (Docker 에는 적재됨)."
fi
