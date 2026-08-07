#!/usr/bin/env bash
#
# 백엔드 컨테이너 이미지를 빌드하고 kind 노드에 적재한다.
#
#   ./deploy/bin/build.sh
#
# kind load 가 반드시 필요한 이유: kind 노드는 호스트 Docker 와 **별도의 이미지 스토어**를 쓴다.
# docker build 만 하면 노드에서는 그 이미지를 볼 수 없어 ErrImageNeverPull 이 난다.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

require_cmd docker kind
require_cluster

# BuildKit 을 명시한다. Dockerfile 이 캐시 마운트(--mount=type=cache)를 쓰는데
# 레거시 빌더로 돌면 그 줄에서 파싱 오류가 난다.
log "이미지 빌드: ${IMAGE}"
DOCKER_BUILDKIT=1 docker build -t "${IMAGE}" "${BACKEND_DIR}"

log "kind 노드에 적재: ${CLUSTER_NAME}"
kind load docker-image "${IMAGE}" --name "${CLUSTER_NAME}"

ok "빌드·적재 완료 — 배포는 ./deploy/bin/deploy.sh"
