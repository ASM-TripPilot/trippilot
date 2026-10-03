#!/usr/bin/env bash
# test-measure.sh — 테스트 정리(TRIP-1138)의 합격선(README §테스트 전략 D7)을 재는 도구.
#
#   scripts/test-measure.sh <라벨>     예: baseline · after-1144
#
# 두 jest 버킷(node · integration)을 커버리지와 함께 돌리고, 파일마다 두 버킷 중 큰 쪽 covered 를 골라
# "합산 근사 줄 커버리지"를 낸다(실제 합집합은 이 값 이상). 결과는 _workspace/test-measure/<라벨>/ (gitignore).
# 기준선: 2026-09-30 develop 5feef8b0 → 91.64% · 827파일 · 8,072케이스.
#
# int 버킷은 --maxWorkers=4: 계측(파일당 ~3.5배 느림)이 CPU 를 먹어 findBy 기본 1000ms 를 넘기는 간헐 실패(TRIP-1171)를 워커 수로 막는다.
# ponytail: 파일 단위 max 근사 — 두 버킷이 같은 파일의 다른 줄을 덮으면 과소 추정. 정확한 합집합이 필요해지면 istanbul merge 로.
set -uo pipefail
[ $# -eq 1 ] || { echo "사용: $0 <라벨>"; exit 2; }
cd "$(dirname "$0")/.."
OUT="_workspace/test-measure/$1"
mkdir -p "$OUT"
COV=(--coverage --coverageReporters=json-summary
  '--collectCoverageFrom=src/**/*.{ts,tsx}'
  '--collectCoverageFrom=!src/**/*.test.{ts,tsx}'
  '--collectCoverageFrom=!src/**/__tests__/**'
  '--collectCoverageFrom=!src/**/__mocks__/**')

S=$(date +%s)
NODE_OPTIONS=--experimental-vm-modules npx jest --no-watchman --silent "${COV[@]}" --coverageDirectory="$OUT/cov-node" > "$OUT/node.log" 2>&1
echo "node exit $? $(( $(date +%s) - S ))s" > "$OUT/timing.txt"
S=$(date +%s)
npx jest --config jest.integration.config.js --no-watchman --silent --maxWorkers=4 "${COV[@]}" --coverageDirectory="$OUT/cov-int" > "$OUT/int.log" 2>&1
echo "int exit $? $(( $(date +%s) - S ))s" >> "$OUT/timing.txt"

python3 - "$OUT" <<'EOF'
import json, sys
out = sys.argv[1]
a = json.load(open(f'{out}/cov-node/coverage-summary.json'))
b = json.load(open(f'{out}/cov-int/coverage-summary.json'))
zero = {'lines': {'covered': 0}}
total = covered = 0
for f in (set(a) | set(b)) - {'total'}:
    total += (a.get(f) or b[f])['lines']['total']
    covered += max(a.get(f, zero)['lines']['covered'], b.get(f, zero)['lines']['covered'])
pct = round(covered / total * 100, 2)
json.dump({'union_lines_pct': pct}, open(f'{out}/summary.json', 'w'))
print(f'합산 근사 줄 커버리지 {pct}%  (합격선: 기준선 91.64% − 2%p = 89.64% 이상)')
EOF
cat "$OUT/timing.txt"
grep -hE '^Tests:' "$OUT/node.log" "$OUT/int.log"
