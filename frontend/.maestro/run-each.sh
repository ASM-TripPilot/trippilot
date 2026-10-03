#!/bin/bash
# 플로우를 "하나씩" 돌린다 — 디렉토리째 실행하면 iOS 26.5 에서 두 번째 플로우부터 드라이버 포트가
# 죽는다(Maestro 이슈 #3318). 사용: .maestro/run-each.sh [플로우 파일 ...] (기본: flows/M-*.yaml)
# 기본 글롭은 하위 폴더를 안 탄다 — flows/known-bug/(기존 버그로 실패)·flows/opt-in/(데이터를 남김)은 인자로만 돈다.
# 환경: JAVA_HOME(기본 brew openjdk@21), MAESTRO_DEVICE(기본 부팅된 시뮬레이터), OUT(산출 폴더)
set -u
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export MAESTRO_CLI_NO_ANALYTICS=1
OUT="${OUT:-$(mktemp -d)}"; mkdir -p "$OUT"
DEVICE_ARGS=()
[ -n "${MAESTRO_DEVICE:-}" ] && DEVICE_ARGS=(--device "$MAESTRO_DEVICE")
FLOWS=("$@")
[ ${#FLOWS[@]} -eq 0 ] && FLOWS=(flows/M-*.yaml)
fail=0
for f in "${FLOWS[@]}"; do
  name=$(basename "$f" .yaml)
  start=$(date +%s)
  # 실패 세션의 sysdiagnose 지연(#3633) 대비 — 15분이면 끊는다.
  perl -e 'alarm 900; exec @ARGV' maestro ${DEVICE_ARGS[@]+"${DEVICE_ARGS[@]}"} test "$f" \
    --format junit --output "$OUT/$name.junit.xml" --test-output-dir "$OUT/$name" \
    > "$OUT/$name.log" 2>&1
  rc=$?
  secs=$(( $(date +%s) - start ))
  [ $rc -eq 0 ] && r=PASS || { r=FAIL; fail=$((fail + 1)); }
  printf '%s\t%s\t%ss\n' "$name" "$r" "$secs" | tee -a "$OUT/summary.tsv"
done
echo "out: $OUT"
exit $fail
