#!/usr/bin/env bash
# VM 에서 GitHub Actions 가 부르는 유일한 명령 — 배포 전용 키의 authorized_keys 에 command= 로 묶인다(README "배포 키").
# 키가 새도 이 두 가지 말고는 못 한다. 요청은 SSH_ORIGINAL_COMMAND 로 온다:
#   app <sha>   stdin 첫 줄 = GHCR 읽기 토큰(잡 동안만 유효한 GITHUB_TOKEN). ghcr.io/asm-trippilot/trippilot-{backend,ai}:vm-<sha>
#               를 받아 current 로 바꾸고 backend·ai 를 다시 띄운다. 직전 current 는 previous 로 남긴다(되돌리기 — README).
#   web         stdin = 웹 산출물(dist) tar. 해시 자산 → html → 옛 자산 정리 순서로 web/ 에 맞춘다(S3 배포와 같은 계약).
set -euo pipefail
cd "$(dirname "$0")"
read -r mode arg <<<"${SSH_ORIGINAL_COMMAND:-}"

case "$mode" in
  app)
    [[ "${arg:-}" =~ ^[0-9a-f]{12}$ ]] || { echo "sha(12자리 16진수)가 아니다: '${arg:-}'" >&2; exit 1; }
    read -r token
    # 토큰을 VM 에 남기지 않는다 — 이 실행 동안만 쓰는 임시 docker 설정에 로그인한다.
    DOCKER_CONFIG=$(mktemp -d); export DOCKER_CONFIG
    trap 'rm -rf "$DOCKER_CONFIG"' EXIT
    docker login ghcr.io -u deploy --password-stdin <<<"$token" >/dev/null
    # 둘 다 받은 뒤에 태그를 바꾼다 — 하나만 바뀐 채 멈추면 다음 up 이 짝이 안 맞는 버전을 띄운다.
    for c in backend ai; do docker pull -q "ghcr.io/asm-trippilot/trippilot-$c:vm-$arg" >/dev/null; done
    for c in backend ai; do
      docker tag "trippilot/$c:current" "trippilot/$c:previous" 2>/dev/null || true
      docker tag "ghcr.io/asm-trippilot/trippilot-$c:vm-$arg" "trippilot/$c:current"
    done
    # 롤링이 없다 — 재시작 동안(약 1분) API 가 멈춘다.
    docker compose up -d --wait backend ai
    docker image prune -f >/dev/null
    docker compose ps --format "table {{.Service}}\t{{.Image}}\t{{.Status}}"
    ;;
  web)
    rm -rf .web-incoming && mkdir .web-incoming
    tar -C .web-incoming -xf -
    [ -f .web-incoming/index.html ] || { echo "산출물에 index.html 이 없다" >&2; exit 1; }
    mkdir -p web
    # caddy 는 web/ 디렉터리를 bind mount 한다 — 디렉터리를 바꿔 끼우면 컨테이너가 옛 것을 계속 본다. 안에서 맞춘다.
    # html 이 먼저 바뀌면 아직 없는 번들을 가리키는 순간이 생긴다 → 해시 자산 먼저, 옛 자산 정리는 맨 끝.
    for d in _expo assets; do
      if [ -d ".web-incoming/$d" ]; then rsync -a ".web-incoming/$d/" "web/$d/"; fi
    done
    rsync -a --delete --exclude /_expo --exclude /assets .web-incoming/ web/
    rsync -a --delete .web-incoming/ web/
    rm -rf .web-incoming
    echo "web: $(find web -type f | wc -l)개"
    ;;
  *)
    echo "허용된 요청은 'app <sha>' · 'web' 뿐이다: '${SSH_ORIGINAL_COMMAND:-}'" >&2; exit 1 ;;
esac
