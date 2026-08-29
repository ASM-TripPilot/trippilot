#!/usr/bin/env bash
# 로컬 3자 스택 초기화 — 현재 브랜치 소스로 백/AI 이미지 재빌드 → 재기동 →
# 계정·일정 데이터 삭제(시드는 보존) → 시뮬레이터에 앱 재설치.
# 사용: ./scripts/reset-local.sh          (전체)
#       SKIP_BUILD=1 ./scripts/reset-local.sh   (빌드 건너뛰고 재기동만)
#       SKIP_IOS=1   ./scripts/reset-local.sh   (도커만)
set -euo pipefail
cd "$(dirname "$0")/.."

[ -n "${SKIP_BUILD:-}" ] || docker compose --profile full build ai backend
docker compose --profile full up -d --force-recreate backend ai

echo "== 백엔드 기동 대기 =="
for _ in $(seq 1 40); do
  curl -sf -m 3 http://localhost:8080/actuator/health | grep -q '"status":"UP"' && break
  sleep 3
done
curl -sf -m 3 http://localhost:8080/actuator/health | grep -q '"status":"UP"' || { echo "backend 기동 실패"; exit 1; }

# consent_record 는 append-only(app_user 에 DELETE 권한 없음) → postgres 롤로 지운다.
# account CASCADE 가 profile·social_identity·trip·itinerary·saved_* 까지 훑고,
# poi_snapshot 은 CASCADE 대상이 아니라 고아로 남으므로 따로 지운다.
echo "== 계정·일정 데이터 삭제 =="
docker exec -i trippilot-db psql -U postgres -d trippilot -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM app.consent_record;
DELETE FROM app.account;
DELETE FROM app.poi_snapshot;
COMMIT;
select (select count(*) from app.account) accounts, (select count(*) from app.trip) trips,
       (select count(*) from app.itinerary) itins, (select count(*) from app.poi) poi_seed,
       (select count(*) from app.stay) stay_seed;
SQL

[ -n "${SKIP_IOS:-}" ] && exit 0
echo "== 앱 재설치 =="
xcrun simctl uninstall booted com.trippilot.app 2>/dev/null || true
cd frontend && LANG=en_US.UTF-8 pnpm ios
