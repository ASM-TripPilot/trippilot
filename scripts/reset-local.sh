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
# Xcode 26/27 에는 Simulator.app 이 없어 `expo run:ios` 가 "Can't determine id of
# Simulator app" 으로 죽는다 → xcodebuild + simctl 로 헤드리스 빌드·설치·실행.
#  - IPHONEOS_DEPLOYMENT_TARGET=18.0: 앱 타깃 15.1 < Expo pod 최소 17.0
#  - SENTRY_CLI_EXECUTABLE: dSYM 업로드 페이즈가 pnpm 레이아웃에서 sentry-cli 를 못 찾는다
echo "== 앱 재설치 =="
cd frontend
BUNDLE_ID=com.trippilot.travel
UDID=$(xcrun simctl list devices booted | grep -Eo '[0-9A-F-]{36}' | head -1)
[ -n "$UDID" ] || { echo "부팅된 시뮬레이터 없음 — xcrun simctl boot <udid>"; exit 1; }

lsof -ti :8081 >/dev/null || { LANG=en_US.UTF-8 nohup pnpm start >/tmp/trippilot-metro.log 2>&1 & echo "Metro 기동 (로그: /tmp/trippilot-metro.log)"; }

export SENTRY_DISABLE_AUTO_UPLOAD=true
SENTRY_CLI_EXECUTABLE=$(ls -d "$PWD"/node_modules/.pnpm/@sentry+cli@*/node_modules/@sentry/cli/bin/sentry-cli | head -1)
export SENTRY_CLI_EXECUTABLE
LANG=en_US.UTF-8 xcodebuild -quiet -workspace ios/TripPilot.xcworkspace -scheme TripPilot \
  -configuration Debug -sdk iphonesimulator -destination "id=$UDID" \
  -derivedDataPath ios/build IPHONEOS_DEPLOYMENT_TARGET=18.0 build

xcrun simctl uninstall "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" ios/build/Build/Products/Debug-iphonesimulator/TripPilot.app
until curl -sf -m 2 http://localhost:8081/status | grep -q running; do sleep 2; done
xcrun simctl launch "$UDID" "$BUNDLE_ID"
