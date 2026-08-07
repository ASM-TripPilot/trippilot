#!/usr/bin/env bash
# Gradle 이 만든 bootJar 를 Bazel 이 집어갈 수 있는 자리로 옮긴다.
#
# 왜 복사하는가: backend/*/build 는 .bazelignore 에 있어 Bazel 이 보지 못한다.
# 그 디렉토리를 Bazel 에 열어주면 Gradle 산출물 수만 개를 매 빌드마다 스캔한다.

source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

SRC_DIR="backend/app/build/libs"
DEST_DIR="deploy/artifacts/backend"

shopt -s nullglob
jars=("$SRC_DIR"/*.jar)
shopt -u nullglob

if [[ ${#jars[@]} -eq 0 ]]; then
  die "bootJar 가 없습니다 ($SRC_DIR). 먼저 'just backend-build' 를 실행하세요."
fi
if [[ ${#jars[@]} -gt 1 ]]; then
  # app 모듈은 plain jar 를 끄도록 설정돼 있어 정상 상태에서는 하나뿐이다.
  # 둘 이상이면 어느 것을 담을지 추측하지 않고 멈춘다.
  die "jar 가 여러 개입니다 (${jars[*]}). 'just backend-clean' 후 다시 빌드하세요."
fi

mkdir -p "$DEST_DIR"
cp -f "${jars[0]}" "$DEST_DIR/app.jar"
ok "스테이징: ${jars[0]} → $DEST_DIR/app.jar"
