#!/bin/sh
# verify-fv-polling — AI 일정 생성·폴링 순서 검증을 한 번에 돌린다.
#   1) 동기화 확인: 덮는 파일이 sync 커밋 뒤 바뀌었나(바뀌었으면 경고 — 모델을 다시 읽어 대조할 것)
#   2) 적합성(jest integration): 모델 CODE MIRROR 식 == 실제 코드(초안 얼굴·초안 폴링·셸 감시, 조합 전수)
#   3) 모델 체크(TLC): 속성마다 따로 돌려 성립/깨짐을 기준선과 비교(+ 원인 가르기 변형 2개)
#   4) 반례 재현(jest integration): 깨진 속성의 반례가 실제 코드에서 아직 그대로 일어나나(R1~R5)
# 끝에 표 하나. 기준선과 모두 같으면 exit 0, 하나라도 다르면 exit 1.
#
# 옵션: --frontend DIR  (node_modules 가 있는 frontend. 기본 = 이 스킬이 든 frontend)
#       --model DIR     (모델 폴더 대체 — 의도한 변경을 모델 사본에서 시험할 때)
#       --skip-jest | --skip-tlc
set -u

SKILL=$(cd "$(dirname "$0")/.." && pwd)
FRONTEND=${FV_POLLING_FRONTEND:-$(cd "$SKILL/../../.." && pwd)}
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
SYNC=f153fe2458645aff9ac73701a411125505e33999
COVERED="src/pages/itinerary/itinerary-generating/ui/GeneratingPage.tsx
src/pages/itinerary/itinerary-generating/ui/GeneratingScreen.tsx
src/pages/itinerary/itinerary-draft/ui/DraftPage.tsx
src/features/itinerary/model/draftView.ts
src/features/itinerary/model/useGenerationBusy.ts
src/app/model/useGenerationWatch.ts
src/app/model/generationWatch.ts
src/app/entrypoint/AppProviders.tsx
src/shared/api/mutator.ts
src/pages/itinerary/itinerary-mustvisit/ui/MustVisitListPage.tsx
src/pages/trip/trip-new-step2/ui/TripBasesPage.tsx
app/trips/[tripId]/itinerary/generating.tsx
../backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration/application/GenerateItineraryService.kt
../backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration/application/GenerationSessionService.kt
../backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration/application/SecondPhaseGenerator.kt
../backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration/application/StalePartialSweeper.kt"

# ── 기준선: 검사 → 기대 결과 ────────────────────────────────────────────────
#   깨짐 = 알려진 결함(보고됨). 결함을 고치면 여기와 SKILL.md 「결과 기준선」을 함께 바꾼다.
#   이름:상수덮기 — 상수덮기는 cfg 의 값을 바꿔 원인을 가른다(빈칸 = cfg 그대로).
BASELINE="TypeOK - 성립
ResultOnlyAfterComplete - 깨짐
NoStuckProgress - 깨짐
OnePostPerPress - 깨짐
OnePostPerPress 잠금있다면·웹 깨짐
OnePostPerPress 잠금있다면·앱 성립"
REPRO_BASELINE="기대대로"

# TLC 도구 버전 고정(TLC 1.7.4 · Temurin 25). TLA2TOOLS·JAVA 로 바꿔 쓸 수 있다.
TLC_SPEC="http:tla2tools[url=https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar,checksum=sha256:936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88]@1.7.4"
JAVA_SPEC="java@temurin-25"

TMPBASE=${TMPDIR:-/tmp}
TMPBASE=${TMPBASE%/}  # 끝 슬래시가 있으면 jest 경로 패턴이 안 맞는다
WORK=$(mktemp -d "$TMPBASE/verify-fv-polling.XXXXXX") || exit 2
[ -n "${FV_POLLING_KEEP:-}" ] || trap 'rm -rf "$WORK"' EXIT
RESULT=$WORK/result.txt
: > "$RESULT"
FAIL=0
row() { printf '%-36s %-8s %-8s %s\n' "$1" "$2" "$3" "$4" >> "$RESULT"; [ "$2" = "$3" ] || FAIL=1; }

echo "== verify-fv-polling"
echo "frontend: $FRONTEND"
echo "model:    $MODEL"

# 1) 동기화 확인 ------------------------------------------------------------
cd "$FRONTEND" || exit 2
if git cat-file -e "$SYNC^{commit}" 2>/dev/null; then
  # 줄 단위로 쪼개고(공백 없는 경로), 글롭·pathspec 해석을 끈다 — `[tripId]` 가 문자 집합으로 읽히지 않게.
  OLDIFS=$IFS; IFS='
'; set -f
  # shellcheck disable=SC2086
  CHANGED=$(GIT_LITERAL_PATHSPECS=1 git diff --name-only "$SYNC" -- $COVERED 2>/dev/null)
  IFS=$OLDIFS; set +f
  if [ -n "$CHANGED" ]; then
    echo "!! 동기화: sync 커밋 $(echo "$SYNC" | cut -c1-12) 뒤 덮는 파일이 바뀌었다 — SKILL.md 「의도한 변경일 때」대로 모델과 대조하라:"
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
  # 리포 jest 가 .claude/ 를 제외하므로 검사 파일은 *.check.tsx 로 두고, 리포 밖에서 .integration.test 이름으로 돌린다.
  mkdir -p "$WORK/jest"
  cp "$SKILL/checks/conformance.check.tsx" "$WORK/jest/fv-polling.conformance.integration.test.tsx"
  cp "$SKILL/checks/repro.integration.check.tsx" "$WORK/jest/fv-polling.repro.integration.test.tsx"
  ROOTS="--roots $FRONTEND --roots $WORK/jest --modulePaths $FRONTEND/node_modules --no-watchman"

  echo "-- 적합성(jest integration)"
  # shellcheck disable=SC2086
  if pnpm exec jest --config jest.integration.config.js $ROOTS "$WORK/jest/fv-polling.conformance.integration.test.tsx" > "$WORK/conformance.log" 2>&1; then
    row "적합성(코드==모델)" "같음" "같음" ""
  else
    row "적합성(코드==모델)" "다름" "같음" "→ 앱 결함 아님: 코드가 모델과 달라졌다. 로그 아래"
    grep -v '^\s*at ' "$WORK/conformance.log" | grep -E '✕|Expected|Received|^\s+[-+] ' | head -40
  fi

  echo "-- 반례 재현(jest integration)"
  # shellcheck disable=SC2086
  if pnpm exec jest --config jest.integration.config.js $ROOTS "$WORK/jest/fv-polling.repro.integration.test.tsx" > "$WORK/repro.log" 2>&1; then
    row "반례 재현(R1~R5)" "기대대로" "$REPRO_BASELINE" ""
  else
    row "반례 재현(R1~R5)" "어긋남" "$REPRO_BASELINE" "→ 결함이 고쳐졌거나 화면·요청이 바뀜. 로그 아래"
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
  CONSTS=$(sed -n '/^CONSTANTS/,/^SPECIFICATION/p' "$MODEL/MCGenPolling.cfg" | sed '$d')
  echo "-- 모델 체크(TLC 1.7.4)"
  N=0
  echo "$BASELINE" | while read -r INV VARIANT WANT; do
    N=$((N + 1))
    C=$CONSTS
    case $VARIANT in
      잠금있다면·웹) C=$(echo "$C" | sed -e 's/EntryGuarded = FALSE/EntryGuarded = TRUE/' -e 's/RetryGuarded = FALSE/RetryGuarded = TRUE/') ;;
      잠금있다면·앱) C=$(echo "$C" | sed -e 's/EntryGuarded = FALSE/EntryGuarded = TRUE/' -e 's/RetryGuarded = FALSE/RetryGuarded = TRUE/' -e 's/Web = TRUE/Web = FALSE/') ;;
    esac
    CFG=$WORK/run$N.cfg
    printf '%s\nSPECIFICATION Spec\nINVARIANT %s\n' "$C" "$INV" > "$CFG"
    # 교착(NoDeadlock)은 첫 줄(TypeOK)에서 한 번 본다 — StartGet 이 늘 가능해 교착이 없는 것이 정상이다.
    [ "$INV" = TypeOK ] || printf 'CHECK_DEADLOCK FALSE\n' >> "$CFG"
    OUT=$WORK/tlc-$N.out
    (cd "$WORK" && "$JAVA_BIN" -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers auto -metadir "$WORK/meta-$N" -config "$CFG" MCGenPolling > "$OUT" 2>&1)
    if grep -q "Invariant $INV is violated" "$OUT"; then GOT=깨짐
    elif grep -q "Deadlock reached" "$OUT"; then GOT=교착
    elif grep -q "No error has been found" "$OUT"; then GOT=성립
    else GOT=오류; fi
    STATES=$(sed -n 's/.* \([0-9][0-9]*\) distinct states found.*/\1/p' "$OUT" | tail -1)
    NAME=$INV; [ "$VARIANT" = - ] || NAME="$INV($VARIANT)"
    PATHLEN=$(grep -c '^State [0-9]*:' "$OUT")
    NOTE="상태 ${STATES:-?}"; [ "$GOT" = 깨짐 ] && NOTE="$NOTE · 반례 ${PATHLEN}단계"
    printf '%-36s %-8s %-8s %s\n' "$NAME" "$GOT" "$WANT" "$NOTE" >> "$RESULT"
    [ "$GOT" = "$WANT" ] || echo x >> "$WORK/tlc-mismatch"
    [ "$GOT" = 오류 ] && tail -20 "$OUT"
  done
  [ -f "$WORK/tlc-mismatch" ] && FAIL=1
fi

echo
printf '%-36s %-8s %-8s %s\n' "검사" "결과" "기준선" "비고"
cat "$RESULT"
echo
if [ "$FAIL" = 0 ]; then
  echo "결론: 기준선과 같다 (깨짐 = 이미 보고된 결함 — SKILL.md 「결과 기준선」)"
else
  echo "결론: 기준선과 다르다 — SKILL.md 「결과 읽기」대로 실제 버그인지 모델 오류인지 가른다"
  echo "      반례 경로·상태도는 /statechart 스킬로 $MODEL/MCGenPolling.tla (view = view.mjs) 를 돌려 읽는다"
fi
exit "$FAIL"
