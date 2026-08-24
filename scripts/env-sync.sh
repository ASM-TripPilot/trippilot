#!/bin/sh
# 팀 볼트(Proton Pass) ↔ 로컬 .env 동기화.
#
# 값은 git 에 없다. 대신 .env.example 의 `# vault-rev: N` 만 보고 "볼트가 바뀌었나"를 판단한다.
# 키를 바꾸거나 추가한 사람이 (1) 볼트 노트를 고치고 (2) 이 숫자를 +1 해서 커밋한다.
# 나머지 팀원은 git pull 할 때 훅이 알려준다.
set -eu
cd "$(git rev-parse --show-toplevel)"

rev() { sed -n 's/^# vault-rev: *\([0-9][0-9]*\).*/\1/p' "$1" 2>/dev/null | head -1; }

# 붙여넣은 게 .env 처럼 생겼는지. 엉뚱한 걸 복사했을 때 .env 를 날리지 않기 위한 유일한 방어선.
valid() { grep -qE '^[A-Za-z_][A-Za-z0-9_]*=' "$1" && ! grep -qi '<html' "$1"; }

case "${1:-check}" in
check)
  want=$(rev .env.example || true); have=$(rev .env || true)
  [ "${want:-0}" = "${have:-0}" ] && exit 0
  cat <<EOF

  ⚠️  팀 볼트에 키 변경/추가가 있습니다 (rev ${have:-없음} → ${want:-0}). 업데이트하시겠습니까?
      1) Proton Pass → TripPilot 볼트 → "trippilot/.env (local dev)" 노트 본문 전체 복사
      2) ./scripts/env-sync.sh apply

EOF
  ;;
apply)
  tmp=$(mktemp)
  pbpaste > "$tmp"
  valid "$tmp" || { rm -f "$tmp"; echo "클립보드가 .env 형식이 아니다. 노트 '본문'을 복사했는지 확인해라." >&2; exit 1; }
  [ -f .env ] && cp .env .env.bak
  { echo "# vault-rev: $(rev .env.example || echo 0)"; grep -v '^# vault-rev:' "$tmp"; } > .env
  rm -f "$tmp"
  echo "✅ .env 갱신 완료 (이전 값은 .env.bak 에 남겨뒀다)"
  ;;
selftest)
  t=$(mktemp)
  printf 'FOO=bar\n' > "$t"; valid "$t"        || { echo "FAIL: 정상 env 를 거부"; exit 1; }
  printf '<html><body>\n' > "$t"; valid "$t"   && { echo "FAIL: HTML 을 통과";     exit 1; }
  : > "$t"; valid "$t"                          && { echo "FAIL: 빈 파일을 통과";   exit 1; }
  rm -f "$t"; echo "selftest ok"
  ;;
*) echo "usage: $0 [check|apply|selftest]" >&2; exit 2 ;;
esac
