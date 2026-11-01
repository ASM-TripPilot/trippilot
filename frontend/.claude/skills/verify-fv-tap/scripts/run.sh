#!/bin/sh
# verify-fv-tap — 연타 잠금(guardPress 400ms 창 · 잠금 ref) 검증을 한 번에 돌린다.
#   1) 동기화 확인: 덮는 파일이 sync 커밋 뒤 바뀌었나(바뀌었으면 경고 — 모델을 다시 읽어 대조할 것)
#   2) 적합성(jest node): 모델 GuardAllows · 전역 창 하나 == 실제 pressGuard.ts (fast-check 생성 입력)
#   3) 모델 체크(TLC): 경로 × 속성마다 따로 돌려 성립/깨짐을 기준선과 비교
#   4) 반례 재현(jest integration): 고친 결함 R1~R3 의 반례 경로가 실제 페이지에서 이제 막히나
# 끝에 표 하나. 기준선과 모두 같으면 exit 0, 하나라도 다르면 exit 1.
#
# 옵션: --frontend DIR  (node_modules 가 있는 frontend. 기본 = 이 스킬이 든 frontend)
#       --model DIR     (모델 폴더 대체 — 의도한 변경을 모델 사본에서 시험할 때)
#       --skip-jest | --skip-tlc
set -u

SKILL=$(cd "$(dirname "$0")/.." && pwd)
FRONTEND=${FV_TAP_FRONTEND:-$(cd "$SKILL/../../.." && pwd)}
MODEL=$SKILL/model
DO_JEST=1
DO_TLC=1
while [ $# -gt 0 ]; do
  case $1 in
    --frontend) FRONTEND=$(cd "$2" && pwd); shift 2 ;;
    --model) MODEL=$(cd "$2" && pwd); shift 2 ;;
    --skip-jest) DO_JEST=0; shift ;;
    --skip-tlc) DO_TLC=0; shift ;;
    *) echo "모르는 옵션: $1" >&2; exit 2 ;;
  esac
done

# ── 동기화 기록(SKILL.md 「동기화」와 같은 값) ─────────────────────────────────
SYNC=5afe34d3218d2d58baf400983d2ec513e314be82
COVERED="src/shared/lib/pressGuard.ts
src/pages/home/ui/HomePage.tsx
src/pages/trip/trip-new-step2/ui/TripNewStep2Page.tsx
src/pages/trip/trip-new-step1/ui/TripNewStep1Page.tsx
src/pages/itinerary/itinerary-plan/ui/ItineraryPlanPage.tsx
src/features/edit-itinerary/model/useConfirmItinerary.ts
src/pages/onboarding/onboarding-location/ui/LocationPage.tsx
../backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration/application/ConfirmItineraryService.kt"

# ── 기준선: 경로 속성 → 기대 결과 ───────────────────────────────────────────
#   전부 성립 — FV-TAP-01·02 는 TRIP-1688 에서 고쳤다. 기준선을 바꾸면 SKILL.md 「결과 기준선」도 함께 바꾼다.
BASELINE="nav TypeOK 성립
nav OnceOnly 성립
nav NoFalseFailure 성립
nav NoPassThrough 성립
assign TypeOK 성립
assign OnceOnly 성립
assign NoFalseFailure 성립
assign NoPassThrough 성립
delete TypeOK 성립
delete OnceOnly 성립
delete NoFalseFailure 성립
delete NoPassThrough 성립
confirm TypeOK 성립
confirm OnceOnly 성립
confirm NoFalseFailure 성립
confirm NoPassThrough 성립
allow TypeOK 성립
allow OnceOnly 성립
allow NoFalseFailure 성립
allow NoPassThrough 성립"
REPRO_BASELINE="기대대로"

# TLC 도구 버전 고정(TLC 1.7.4 · Temurin 25 — verify-visit-flow 와 같다). TLA2TOOLS·JAVA 로 바꿔 쓸 수 있다.
TLC_SPEC="http:tla2tools[url=https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar,checksum=sha256:936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88]@1.7.4"
JAVA_SPEC="java@temurin-25"

TMPBASE=${TMPDIR:-/tmp}
TMPBASE=${TMPBASE%/}  # 끝 슬래시가 있으면 jest 경로 패턴이 안 맞는다
WORK=$(mktemp -d "$TMPBASE/verify-fv-tap.XXXXXX") || exit 2
[ -n "${FV_TAP_KEEP:-}" ] || trap 'rm -rf "$WORK"' EXIT
RESULT=$WORK/result.txt
: > "$RESULT"
FAIL=0
row() { printf '%-26s %-8s %-8s %s\n' "$1" "$2" "$3" "$4" >> "$RESULT"; [ "$2" = "$3" ] || FAIL=1; }

echo "== verify-fv-tap"
echo "frontend: $FRONTEND"
echo "model:    $MODEL"

# 1) 동기화 확인 ------------------------------------------------------------
cd "$FRONTEND" || exit 2
if git cat-file -e "$SYNC^{commit}" 2>/dev/null; then
  # shellcheck disable=SC2086
  CHANGED=$(git diff --name-only "$SYNC" -- $COVERED 2>/dev/null)
  if [ -n "$CHANGED" ]; then
    echo "!! 동기화: sync 커밋 ${SYNC%????????????????????????????????} 뒤 덮는 파일이 바뀌었다 — SKILL.md 「의도한 변경일 때」대로 모델과 대조하라:"
    echo "$CHANGED" | sed 's/^/   /'
  else
    echo "동기화: 덮는 파일이 sync 커밋과 같다"
  fi
else
  echo "!! 동기화: sync 커밋 $SYNC 이 이 리포에 없다(fetch 필요) — 변경 여부를 확인하지 못했다"
fi

# 2·4) jest ---------------------------------------------------------------
if [ "$DO_JEST" = 1 ]; then
  if [ ! -d "$FRONTEND/node_modules" ]; then
    echo "!! $FRONTEND/node_modules 가 없다 — pnpm install 한 frontend 를 --frontend 로 넘겨라" >&2
    exit 2
  fi
  # 리포 jest 가 .claude/ 를 안 훑게 검사 파일은 *.check.* 로 두고, 리포 밖에서 .test 이름으로 돌린다.
  mkdir -p "$WORK/jest"
  cp "$SKILL/checks/conformance.check.ts" "$WORK/jest/fv-tap.conformance.test.ts"
  cp "$SKILL/checks/repro.integration.check.tsx" "$WORK/jest/fv-tap.repro.integration.test.tsx"
  ROOTS="--roots $FRONTEND --roots $WORK/jest --modulePaths $FRONTEND/node_modules --no-watchman"

  echo "-- 적합성(jest node)"
  # shellcheck disable=SC2086
  if NODE_OPTIONS=--experimental-vm-modules pnpm exec jest $ROOTS "$WORK/jest/fv-tap.conformance.test.ts" > "$WORK/conformance.log" 2>&1; then
    row "적합성(코드==모델)" "같음" "같음" ""
  else
    row "적합성(코드==모델)" "다름" "같음" "→ 앱 결함 아님: pressGuard.ts 가 모델과 달라졌다. 로그 아래"
    grep -v '^\s*at ' "$WORK/conformance.log" | grep -E '●|Counterexample|갈림|Expected|Received' | head -30
  fi

  echo "-- 반례 재현(jest integration)"
  # shellcheck disable=SC2086
  if pnpm exec jest --config jest.integration.config.js $ROOTS "$WORK/jest/fv-tap.repro.integration.test.tsx" > "$WORK/repro.log" 2>&1; then
    row "반례 재현(R1~R3)" "기대대로" "$REPRO_BASELINE" ""
  else
    row "반례 재현(R1~R3)" "어긋남" "$REPRO_BASELINE" "→ 고친 결함이 되살아났거나 화면·testID 가 바뀜. 로그 아래"
    grep -v '^\s*at ' "$WORK/repro.log" | grep '✓\|✕' | head
  fi
fi

# 3) TLC -------------------------------------------------------------------
if [ "$DO_TLC" = 1 ]; then
  JAR=${TLA2TOOLS:-}
  JAVA_BIN=${JAVA:-}
  if [ -z "$JAR" ] || [ -z "$JAVA_BIN" ]; then
    command -v mise >/dev/null || { echo "!! mise 가 없다(brew install mise) — 또는 TLA2TOOLS·JAVA 를 지정하라" >&2; exit 2; }
    mise install "$JAVA_SPEC" "$TLC_SPEC" >/dev/null 2>&1
    [ -z "$JAR" ] && JAR="$(mise where "$TLC_SPEC")/tla2tools.jar"
    [ -z "$JAVA_BIN" ] && JAVA_BIN=$(mise which java --tool "$JAVA_SPEC")
  fi
  cp "$MODEL"/*.tla "$WORK/"
  # cfg 의 CONSTANTS 중 Path 줄만 경로마다 갈아 끼운다.
  CONSTS=$(sed -n '/^CONSTANTS/,/^SPECIFICATION/p' "$MODEL/MCTapGuard.cfg" | sed '$d' | grep -v 'Path *=')
  echo "-- 모델 체크(TLC 1.7.4)"
  echo "$BASELINE" | while read -r P INV WANT; do
    CFG=$WORK/$P-$INV.cfg
    printf '%s\n  Path = "%s"\nSPECIFICATION Spec\nINVARIANT %s\n' "$CONSTS" "$P" "$INV" > "$CFG"
    # 교착(NoDeadlock)은 경로마다 TypeOK 줄에서 한 번 본다.
    [ "$INV" = TypeOK ] || printf 'CHECK_DEADLOCK FALSE\n' >> "$CFG"
    OUT=$WORK/tlc-$P-$INV.out
    (cd "$WORK" && "$JAVA_BIN" -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers 1 -metadir "$WORK/meta-$P-$INV" -config "$CFG" MCTapGuard > "$OUT" 2>&1)
    if grep -q "Invariant $INV is violated" "$OUT"; then GOT=깨짐
    elif grep -q "Deadlock reached" "$OUT"; then GOT=교착
    elif grep -q "No error has been found" "$OUT"; then GOT=성립
    else GOT=오류; fi
    STATES=$(sed -n 's/.* \([0-9][0-9]*\) distinct states found.*/\1/p' "$OUT" | tail -1)
    printf '%-26s %-8s %-8s %s\n' "$P $INV" "$GOT" "$WANT" "상태 ${STATES:-?}" >> "$RESULT"
    [ "$GOT" = "$WANT" ] || echo x >> "$WORK/tlc-mismatch"
    [ "$GOT" = 오류 ] && tail -20 "$OUT"
  done
  [ -f "$WORK/tlc-mismatch" ] && FAIL=1
fi

echo
printf '%-26s %-8s %-8s %s\n' "검사" "결과" "기준선" "비고"
cat "$RESULT"
echo
if [ "$FAIL" = 0 ]; then
  echo "결론: 기준선과 같다"
else
  echo "결론: 기준선과 다르다 — SKILL.md 「결과 읽기」대로 실제 버그인지 모델 오류인지 가른다"
  echo "      반례 경로·상태도는 /statechart 스킬로 $MODEL/MCTapGuard.tla (view = view.mjs, cfg 의 Path 를 그 경로로) 를 돌려 읽는다"
fi
exit "$FAIL"
