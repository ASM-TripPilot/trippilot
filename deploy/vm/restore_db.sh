#!/usr/bin/env bash
# VM 에서(migrate.sh restore 가 부른다): backups/migrate/ 의 운영 덤프로 trippilot · ai_kb 를 **새로** 만든다.
# 롤·권한·DB 단위 설정은 운영 정본 deploy/eks/bootstrap.sql 을 복원 뒤에 다시 돌려 맞춘다.
set -euo pipefail
cd "$(dirname "$0")"
M=/backups/migrate
dc() { docker compose "$@"; }
sql() { dc exec -T db psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

# 썸네일 주소를 바꿀 호스트 — 복원을 시작하기 전에 본다(뒤에서 멈추면 반쯤 복원된 DB 가 남는다).
img_host=$(sed -n 's/^IMG_HOST=//p' .env | tr -d '\r')
# 빈 값·따옴표가 들어가도 https:// 로 시작해 CHECK 를 통과한다 — 그러면 썸네일이 전부 조용히 깨진다.
[[ "$img_host" =~ ^[a-z0-9.-]+$ ]] || { echo "IMG_HOST 가 호스트명이 아니다: '$img_host'" >&2; exit 1; }

dc up -d --wait db
# 이미 서비스 중인 DB 를 덮으면 그 사이 사용자 데이터가 사라진다 — 전환 뒤에는 FORCE=1 없이는 멈춘다.
if [ "$(sql -d trippilot -At -c "SELECT to_regnamespace('app') IS NOT NULL")" = t ] && [ "${FORCE:-}" != 1 ]; then
  echo "VM DB 에 이미 app 스키마가 있다. 리허설 데이터를 덮어써도 되면 FORCE=1 로 다시." >&2; exit 1
fi
dc stop backend ai >/dev/null 2>&1 || true

sql -d postgres <<'SQL'
DROP DATABASE IF EXISTS trippilot WITH (FORCE);
DROP DATABASE IF EXISTS ai_kb WITH (FORCE);
CREATE DATABASE trippilot;
CREATE DATABASE ai_kb;
DO $$ BEGIN
  -- 덤프의 소유자·권한이 가리키는 롤. trippilot_admin 은 RDS 마스터(운영에서 ai_kb·확장 소유) — 로그인은 막는다.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_migrate') THEN CREATE ROLE app_migrate LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_user') THEN CREATE ROLE ai_user LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trippilot_admin') THEN CREATE ROLE trippilot_admin NOLOGIN; END IF;
END $$;
SQL

# RDS 전용 롤(rds_superuser·rdsadmin)에 대한 GRANT 는 여기 없어 오류로 남는다 — 그 외 오류가 있는지 아래에서 본다.
for db in trippilot ai_kb; do
  dc exec -T db pg_restore -U postgres -d "$db" "$M/$db.dump" 2> "backups/migrate/$db.restore.log" || true
  other=$(grep 'error:' "backups/migrate/$db.restore.log" | grep -cvE 'role "rds[a-z_]*" does not exist' || true)
  echo "$db 복원: 오류 $(grep -c 'error:' "backups/migrate/$db.restore.log" || true)건 (RDS 롤 외 ${other}건)"
  [ "$other" = 0 ] || { grep 'error:' "backups/migrate/$db.restore.log" | grep -vE 'role "rds[a-z_]*" does not exist' | head -20; exit 1; }
done

dc exec -T -e PGOPTIONS=--client-min-messages=warning db psql -U postgres -v ON_ERROR_STOP=1 -q -d trippilot -f "$M/bootstrap.sql"

# 썸네일 주소: CloudFront(대여 계정) → 이 VM 의 IMG_HOST. 경로(poi/w940/…)는 그대로다.
echo "썸네일 주소 교체: $(sql -d trippilot -At -c "WITH u AS (UPDATE app.poi SET image_thumb_url = replace(image_thumb_url, 'https://dzgm4cyksbzp9.cloudfront.net/', 'https://$img_host/') WHERE image_thumb_url LIKE 'https://dzgm4cyksbzp9.cloudfront.net/%' RETURNING 1) SELECT count(*) FROM u")곳"

sql -d trippilot -At -v schema=app -f "$M/counts.sql" > "backups/migrate/counts.trippilot.vm"
sql -d ai_kb -At -v schema=public -f "$M/counts.sql" > "backups/migrate/counts.ai_kb.vm"
dc up -d --wait
# nginx 는 Docker DNS 로 backend 를 다시 풀지만(nginx.conf), 혹시 모를 옛 연결까지 끊는다.
dc restart gateway >/dev/null
