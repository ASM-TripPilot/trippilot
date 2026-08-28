#!/usr/bin/env bash
# run.sh — TripPilot 프론트 화면을 빠르게 띄운다 (프리뷰 / 실서비스 한 파일로).
#
#   run.sh build            네이티브 빌드+설치+실행 → 실서비스 첫 화면(스플래시). Metro 를 이 터미널에 띄운 채 둔다.
#   run.sh app              실행 중인 앱을 실서비스 첫 화면(스플래시)으로. (빌드 안 함, 딥링크만)
#   run.sh preview [state]  실행 중인 앱을 프리뷰 화면으로. state 생략 시 splash. 앱 안 버튼으로도 전환 가능.
#   run.sh list [필터]      프리뷰 state 키 목록(라벨 포함). 필터로 걸러본다.
#
# 흐름: 처음 한 번 `run.sh build`(Metro 뜬 채 유지) → 다른 터미널에서 `run.sh preview <state>` / `run.sh app` 로 화면만 갈아끼운다.
# 옵션: --android   안드로이드 대상(기본 ios)
#
# ponytail: preview/app 딥링크는 build 로 앱이 설치·Metro 가 떠 있어야 동작. 더 게으른 대안 = 앱 안 프리뷰의 상태 버튼으로 직접 전환(스크립트 없이).
set -euo pipefail

FE="$(cd "$(dirname "$0")/.." && pwd)"
PREVIEW_SRC="$FE/src/app/_dev/preview.tsx"
SCHEME="trippilot"
PLATFORM="ios"

# --android 플래그 분리
argv=()
for a in "$@"; do
  if [[ "$a" == "--android" ]]; then PLATFORM="android"; else argv+=("$a"); fi
done
CMD="${argv[0]:-help}"
ARG="${argv[1]:-}"

list_states() {
  # key: '...' 다음 줄의 label: '...' 을 짝지어 "key  라벨" 로 출력
  awk '
    match($0, /key: '\''[^'\'']+'\''/)   { k = substr($0, RSTART+6, RLENGTH-7) }
    k != "" && match($0, /label: '\''[^'\'']+'\''/) {
      printf "  %-30s %s\n", k, substr($0, RSTART+8, RLENGTH-9); k = ""
    }
  ' "$PREVIEW_SRC"
}

is_valid_state() { list_states | awk '{print $1}' | grep -qx "$1"; }

open_url() {
  local url="$1"
  if [[ "$PLATFORM" == "android" ]]; then
    adb shell am start -a android.intent.action.VIEW -d "$url" >/dev/null \
      && echo "→ android 딥링크: $url" \
      || { echo "✗ adb 실패 — 에뮬레이터/기기·앱 설치 확인 (먼저 'run.sh build --android')"; exit 1; }
  else
    if ! xcrun simctl list devices | grep -q Booted; then
      echo "✗ 부팅된 시뮬레이터 없음 — 먼저 'run.sh build' 로 앱을 띄워라"; exit 1
    fi
    xcrun simctl openurl booted "$url" >/dev/null && echo "→ ios 딥링크: $url"
  fi
}

case "$CMD" in
  build)
    echo "네이티브 빌드+실행(실서비스 첫 화면 = 스플래시). Metro 는 이 터미널에 뜬 채로 둬라."
    cd "$FE" && LANG=en_US.UTF-8 pnpm "$PLATFORM"   # LANG 없으면 pod install 이 죽는다(리포 함정)
    ;;
  app)
    open_url "$SCHEME:///"
    ;;
  preview)
    STATE="${ARG:-splash}"
    if ! is_valid_state "$STATE"; then
      echo "⚠ '$STATE' 는 알려진 state 아님 — 그래도 열어봄(앱 안에서 전환 가능). 목록: run.sh list"
    fi
    open_url "$SCHEME:///_dev/preview?state=$STATE"
    ;;
  list)
    if [[ -n "$ARG" ]]; then list_states | grep -i "$ARG" || echo "  (일치 없음: $ARG)"; else list_states; fi
    ;;
  *)
    awk 'NR>1 && /^set /{exit} NR>1 && /^#/{sub(/^# ?/,""); print}' "$0"
    echo
    echo "state 총 $(list_states | wc -l | tr -d ' ')개 — 'run.sh list [필터]' 로 확인"
    ;;
esac
