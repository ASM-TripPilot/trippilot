#!/usr/bin/env bash
# cron(setup.sh 가 건다): 두 DB 의 논리 덤프를 backups/ 에 7일치 남긴다.
set -euo pipefail
cd "$(dirname "$0")"
day=$(date -u +%F)
for db in trippilot ai_kb; do
  docker compose exec -T db pg_dump -U postgres -Fc "$db" > "backups/$db-$day.dump.tmp"
  mv "backups/$db-$day.dump.tmp" "backups/$db-$day.dump"
done
find backups -maxdepth 1 -name '*-20??-??-??.dump' -mtime +7 -delete
echo "$(date -u +%FT%TZ) ok $(du -ch backups/*-"$day".dump | tail -1)"
