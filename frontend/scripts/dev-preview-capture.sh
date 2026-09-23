#!/usr/bin/env bash
# dev-preview-capture.sh — _dev/preview 화면을 키마다 재캡처해 상단 dev 오버레이를 크롭한다.
# TRIP-831 자동 육안 게이트의 "프리뷰 쪽" 절반(Figma 쪽은 get_screenshot → <리포 루트>/_workspace/figma-cache/).
#
# 사용: scripts/dev-preview-capture.sh <키> [<키> ...]
#   예: scripts/dev-preview-capture.sh home-default login-idle
# 출력: $CAPTURE_DIR/<키>.png (기본 <리포 루트>/_workspace/preview-capture/)
#
# 계약 한계(넘겨짚지 마라):
# - 정적 캡처다. 실제 열림·드래그·터치 흡수는 못 본다(바텀시트/지도/드래그 목 사각과 동형).
# - 딥링크는 "매 키 fresh 재기동 후 1회"만 상태를 읽는다(preview.tsx 지연 초기화자 계약,
#   layer-app.md·TRIP-297 04b §5). 그래서 키마다 terminate → openurl 를 반드시 다시 한다.
set -euo pipefail

APP_ID="com.trippilot.app"
SCHEME="trippilot://_dev/preview"
WAIT="${PREVIEW_WAIT:-7}"                       # 렌더·폰트·이미지 안착 대기(초)
CAPTURE_DIR="${CAPTURE_DIR:-$(git rev-parse --show-toplevel)/_workspace/preview-capture}"  # 루트 기준 — cwd(frontend) 상대면 frontend/_workspace가 생겨 산출물 오배치 조건이 된다
CROP_PX="${CROP_PX:-470}"                        # 잘라낼 상단 높이(px). dev 오버레이 2단(밴드+칩)+세이프에어리어 ≈ 156pt @3x ≈ 470px 실측.
                                                 #   ⚠️ 오버레이가 상단 ~156pt를 덮으므로 그 뒤 화면 콘텐츠(홈 인사 헤더 등)도 함께 잘린다 —
                                                 #   이 경로로는 헤더대 대조가 불가하다(오버레이를 지우면 헤더도 지워진다). 시뮬 스케일 바뀌면 이 값만 조정.

if [ "$#" -eq 0 ]; then
  echo "사용: $0 <키> [<키> ...]" >&2
  exit 2
fi

# 사전 점검 — 없으면 실행 불가(FAIL 아님). verify-gates 실기 스모크 §0 와 같은 정신.
xcrun simctl list devices booted | grep -q Booted \
  || { echo "실행 불가: 부팅된 시뮬레이터 없음" >&2; exit 3; }
xcrun simctl listapps booted | grep -q "$APP_ID" \
  || { echo "실행 불가: $APP_ID 미설치" >&2; exit 3; }
curl -s --max-time 3 http://localhost:8081/status | grep -q packager-status:running \
  || { echo "실행 불가: Metro 미기동(pnpm start 후 재시도)" >&2; exit 3; }

mkdir -p "$CAPTURE_DIR"

for key in "$@"; do
  echo "[$key] 재기동 → 진입 → 대기 ${WAIT}s → 캡처"
  xcrun simctl terminate booted "$APP_ID" 2>/dev/null || true
  xcrun simctl openurl booted "${SCHEME}?state=${key}"
  sleep "$WAIT"
  raw="$CAPTURE_DIR/${key}.raw.png"
  out="$CAPTURE_DIR/${key}.png"
  xcrun simctl io booted screenshot "$raw"
  # 상단 dev 오버레이(밴드/칩 2단 + safe-area)를 잘라낸다.
  python3 - "$raw" "$out" "$CROP_PX" <<'PY'
import sys
from PIL import Image
raw, out, crop = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(raw)
w, h = im.size
crop = min(crop, h - 1)
im.crop((0, crop, w, h)).save(out)
print(f"  {out} ({w}x{h} → {w}x{h-crop}, 상단 {crop}px 크롭)")
PY
  rm -f "$raw"
done

echo "완료: $# 키 → $CAPTURE_DIR/"
