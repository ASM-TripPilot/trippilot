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

# 볼트 값으로 덮지 **않을** 키. `.env.keep-local` 에 한 줄에 하나씩 키 이름을 적는다(gitignore 됨).
# 사람마다 값이 다른 키가 여기 온다 — 예: ANTHROPIC_API_KEY(팀원은 볼트의 공용 키, 결제자는 자기 키).
# 파일이 없으면 아무것도 안 한다 = 전부 볼트 값. 팀원 대다수는 이 파일이 필요 없다.
keep_local() {
  [ -f .env.keep-local ] && [ -f .env.bak ] || return 0
  while IFS= read -r k; do
    case "$k" in ''|\#*) continue ;; esac
    old=$(sed -n "s/^$k=//p" .env.bak | head -1)
    [ -n "$old" ] || continue
    awk -v k="$k" -v v="$old" '{ if (index($0, k "=") == 1) print k "=" v; else print }' .env > "$tmp.kl" && mv "$tmp.kl" .env
    echo "  · $k 은 로컬 값을 유지했다(.env.keep-local)"
  done < .env.keep-local
}

case "${1:-check}" in
check)
  want=$(rev .env.example || true); have=$(rev .env || true)
  [ "${want:-0}" -gt "${have:-0}" ] || exit 0
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
  keep_local
  echo "✅ .env 갱신 완료 (이전 값은 .env.bak 에 남겨뒀다)"
  ;;
selftest)
  t=$(mktemp)
  printf 'FOO=bar\n' > "$t"; valid "$t"        || { echo "FAIL: 정상 env 를 거부"; exit 1; }
  printf '<html><body>\n' > "$t"; valid "$t"   && { echo "FAIL: HTML 을 통과";     exit 1; }
  : > "$t"; valid "$t"                          && { echo "FAIL: 빈 파일을 통과";   exit 1; }
  rm -f "$t"

  # keep_local: 유지 목록의 키만 로컬 값으로 되돌아오는가
  d=$(mktemp -d)
  ( cd "$d"
    printf 'A=vault\nB=vault\n' > .env
    printf 'A=mine\nB=old\n'    > .env.bak
    printf 'A\n'                 > .env.keep-local
    tmp=$(mktemp)
    keep_local >/dev/null
    grep -q '^A=mine$'  .env || { echo "FAIL: 유지 목록 키가 안 되돌아옴"; exit 1; }
    grep -q '^B=vault$' .env || { echo "FAIL: 목록에 없는 키가 바뀜";     exit 1; }
  ) || { rm -rf "$d"; exit 1; }
  rm -rf "$d"

  echo "selftest ok"
  ;;
*) echo "usage: $0 [check|apply|selftest]" >&2; exit 2 ;;
esac
