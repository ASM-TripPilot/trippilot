#!/usr/bin/env bash
# 맥에서: 설정·시크릿을 VM 에 올리고 기동한다. 다시 돌려도 된다.
#   VM=ubuntu@<IP> bash deploy/vm/ship.sh            설정·시크릿만 올리고 up
#   VM=ubuntu@<IP> AWS_PROFILE=... bash deploy/vm/ship.sh images
#                                                    + 지금 운영 Deployment 가 쓰는 ECR 이미지를 그대로 옮긴다
#   … ship.sh images embedding                       + embedding 이미지도(8GB 장비, docker-compose.embedding.yml 을 켤 때)
# 시크릿(secrets/*.env)은 export_env.py 로 먼저 만든다.
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
KEY=${KEY:-$HOME/.ssh/trippilot-prod.pem}
ssh_vm() { ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "${VM:?VM=ubuntu@<고정IP>}" "$@"; }
for f in backend ai ai-vector db; do [ -f "$DIR/secrets/$f.env" ] || { echo "secrets/$f.env 없음 — export_env.py 먼저" >&2; exit 1; }; done

if [ "${1:-}" = images ]; then
  components="backend ai"; [ "${2:-}" = embedding ] && components="$components embedding"
  for c in $components; do
    img=$(kubectl -n trippilot get deployment "$c" -o jsonpath='{.spec.template.spec.containers[0].image}')
    aws ecr get-login-password --region "${AWS_REGION:-ap-northeast-2}" | docker login -u AWS --password-stdin "${img%%/*}" >/dev/null
    docker pull -q --platform linux/amd64 "$img"
    # current 는 compose 가 쓰는 이름, 원래 태그(sha-…)는 무엇이 떠 있는지 나중에 알기 위해 같이 남긴다.
    docker save "$img" | gzip -1 | ssh_vm "gunzip | docker load -q && docker tag '$img' trippilot/$c:current && docker tag '$img' 'trippilot/$c:${img##*:}'"
  done
fi

tar -C "$DIR" -cf - docker-compose.yml docker-compose.embedding.yml nginx.conf Caddyfile env.example counts.sql restore_db.sh backup.sh secrets \
  | ssh_vm 'mkdir -p trippilot && tar -C trippilot -xf - && chmod 700 trippilot/secrets && chmod 600 trippilot/secrets/*'
# 운영 DB 를 아직 안 옮긴 VM 에서 backend 를 띄우면 Flyway 가 빈 DB 에 스키마를 새로 만든다 — 그러면 restore_db.sh 가
# 덮어쓰기 가드에 걸린다. 그래서 app 스키마가 없으면 db 만 띄운다.
ssh_vm 'cd trippilot && { [ -f .env ] || cp env.example .env; } && docker compose config -q && docker compose up -d --wait db \
  && if [ "$(docker compose exec -T db psql -U postgres -d trippilot -Atc "SELECT to_regnamespace('"'"'app'"'"') IS NOT NULL")" = t ]; then
       docker compose up -d --wait --remove-orphans && docker compose ps --format "table {{.Service}}\t{{.Status}}";
     else echo "DB 가 비어 있다 — db 만 띄웠다. 다음: migrate.sh restore"; fi'
