#!/bin/sh
# verify-fv-consent — 동의 토글(위치 l06 · 개인화)·법적 동의 기록·위치 권한 미러 검증을 한 번에 돌린다.
#   1) 동기화 확인: 덮는 파일이 sync 커밋 뒤 바뀌었나(바뀌었으면 경고 — 모델을 다시 읽어 대조할 것)
#   2) 적합성(jest node): 모델 CODE MIRROR 식 == 실제 훅·함수(fast-check 생성 입력)
#   3) 모델 체크(TLC): 속성마다 따로 돌려 성립/깨짐을 기준선과 비교
#   4) 반례 재현(jest integration): 실제 화면 + MSW 가짜 서버에서 R1~R5(결함)·R6(지켜짐)이 기대대로인가
# 끝에 표 하나. 기준선과 모두 같으면 exit 0, 하나라도 다르면 exit 1.
#
# 옵션: --frontend DIR  (node_modules 가 있는 frontend. 기본 = 이 스킬이 든 frontend)
#       --model DIR     (모델 폴더 대체 — 의도한 변경을 모델 사본에서 시험할 때)
#       --skip-jest | --skip-tlc
set -u

SKILL=$(cd "$(dirname "$0")/.." && pwd)
FRONTEND=${FV_CONSENT_FRONTEND:-$(cd "$SKILL/../../.." && pwd)}
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
COVERED="src/shared/location/useLocationConsent.ts
src/shared/location/consentPutBody.ts
src/pages/settings/settings-location/ui/LocationConsentPage.tsx
src/pages/settings/settings-location/ui/LocationConsentScreen.tsx
src/pages/settings/settings-personalization/model/usePersonalization.ts
src/pages/settings/settings-personalization/ui/PersonalizationScreen.tsx
src/pages/settings/settings/model/settingsSections.ts
src/pages/settings/settings/ui/SettingsPage.tsx
src/shared/api/index.ts
../backend/modules/auth/src/main/kotlin/com/trippilot/auth/application/LocationConsentService.kt
../backend/modules/auth/src/main/kotlin/com/trippilot/auth/application/ConsentService.kt
../backend/modules/auth/src/main/kotlin/com/trippilot/auth/domain/location/LocationConsent.kt"

# ── 기준선: 속성 → 기대 결과 ────────────────────────────────────────────────
#   깨짐 = 알려진 결함(보고됨). 결함을 고치면 여기와 SKILL.md 「결과 기준선」을 함께 바꾼다.
BASELINE="TypeOK 성립
NoDuplicateRecordLoc 성립
NoDuplicateRecordPers 깨짐
ShownMatchesServerLoc 깨짐
ShownMatchesServerPers 깨짐
MirrorFollowsApp 깨짐"
REPRO_BASELINE="기대대로"

# TLC 도구 버전 고정(TLC 1.7.4 · Temurin 25). TLA2TOOLS·JAVA 로 바꿔 쓸 수 있다.
TLC_SPEC="http:tla2tools[url=https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar,checksum=sha256:936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88]@1.7.4"
JAVA_SPEC="java@temurin-25"

TMPBASE=${TMPDIR:-/tmp}
TMPBASE=${TMPBASE%/}  # 끝 슬래시가 있으면 jest 경로 패턴이 안 맞는다
WORK=$(mktemp -d "$TMPBASE/verify-fv-consent.XXXXXX") || exit 2
[ -n "${FV_CONSENT_KEEP:-}" ] || trap 'rm -rf "$WORK"' EXIT
RESULT=$WORK/result.txt
: > "$RESULT"
FAIL=0
row() { printf '%-26s %-8s %-8s %s\n' "$1" "$2" "$3" "$4" >> "$RESULT"; [ "$2" = "$3" ] || FAIL=1; }

echo "== verify-fv-consent"
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
  # 리포 jest 가 .claude/ 를 훑지 않게 검사 파일은 *.check.tsx 로 두고, 리포 밖에서 .test 이름으로 돌린다.
  mkdir -p "$WORK/jest"
  cp "$SKILL/checks/conformance.check.tsx" "$WORK/jest/fv-consent.conformance.test.tsx"
  cp "$SKILL/checks/repro.integration.check.tsx" "$WORK/jest/fv-consent.repro.integration.test.tsx"
  ROOTS="--roots $FRONTEND --roots $WORK/jest --modulePaths $FRONTEND/node_modules --no-watchman"

  echo "-- 적합성(jest node)"
  # shellcheck disable=SC2086
  if NODE_OPTIONS=--experimental-vm-modules pnpm exec jest $ROOTS "$WORK/jest/fv-consent.conformance.test.tsx" > "$WORK/conformance.log" 2>&1; then
    row "적합성(코드==모델)" "같음" "같음" ""
  else
    row "적합성(코드==모델)" "다름" "같음" "→ 앱 결함 아님: 코드가 모델과 달라졌다. 로그 아래"
    grep -v '^\s*at ' "$WORK/conformance.log" | grep -E '●|Counterexample|Expected|Received|^\s+[-+] ' | head -40
  fi

  echo "-- 반례 재현(jest integration)"
  # shellcheck disable=SC2086
  if pnpm exec jest --config jest.integration.config.js $ROOTS "$WORK/jest/fv-consent.repro.integration.test.tsx" > "$WORK/repro.log" 2>&1; then
    row "반례 재현(R1~R6)" "기대대로" "$REPRO_BASELINE" ""
  else
    row "반례 재현(R1~R6)" "어긋남" "$REPRO_BASELINE" "→ 결함이 고쳐졌거나(R1~R5), 지켜지던 것이 깨졌거나(R6), 화면이 바뀜. 로그 아래"
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
  CONSTS=$(sed -n '/^CONSTANTS/,/^SPECIFICATION/p' "$MODEL/MCConsentFlow.cfg" | sed '$d')
  echo "-- 모델 체크(TLC 1.7.4)"
  echo "$BASELINE" | while read -r INV WANT; do
    CFG=$WORK/$INV.cfg
    printf '%s\nSPECIFICATION Spec\nINVARIANT %s\n' "$CONSTS" "$INV" > "$CFG"
    # 교착(NoDeadlock)은 첫 줄(TypeOK)에서 한 번이면 충분하다.
    [ "$INV" = TypeOK ] || printf 'CHECK_DEADLOCK FALSE\n' >> "$CFG"
    OUT=$WORK/tlc-$INV.out
    (cd "$WORK" && "$JAVA_BIN" -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers 4 -metadir "$WORK/meta-$INV" -config "$CFG" MCConsentFlow > "$OUT" 2>&1)
    if grep -q "Invariant $INV is violated" "$OUT"; then GOT=깨짐
    elif grep -q "Deadlock reached" "$OUT"; then GOT=교착
    elif grep -q "No error has been found" "$OUT"; then GOT=성립
    else GOT=오류; fi
    STATES=$(sed -n 's/.* \([0-9][0-9]*\) distinct states found.*/\1/p' "$OUT" | tail -1)
    printf '%-26s %-8s %-8s %s\n' "$INV" "$GOT" "$WANT" "상태 ${STATES:-?}" >> "$RESULT"
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
  echo "결론: 기준선과 같다 (깨짐 = 이미 보고된 결함 — SKILL.md 「결과 기준선」)"
else
  echo "결론: 기준선과 다르다 — SKILL.md 「결과 읽기」대로 실제 버그인지 모델 오류인지 가른다"
  echo "      반례 경로·상태도는 /statechart 스킬로 $MODEL/MCConsentFlow.tla (view = view.mjs) 를 돌려 읽는다"
fi
exit "$FAIL"
