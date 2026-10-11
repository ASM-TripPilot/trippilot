#!/bin/zsh
# TRIP-1344 · U10 시뮬레이터 위치 시나리오 (xcrun simctl location). 포그라운드 판정 확인용 — 백그라운드 wake 는 6-b(TestFlight).
# 사용: scripts/u10-sim-location.sh <arrive|pass|complete|gap|clear> [lat lng]
#   기본 장소 = 부산시립미술관(35.1667,129.1370). 리전 반경 150m · 도착 3분 · 이탈 확인 3분 · 최소 체류 10분(config.ts).
# 전제: 플래그 ON dev build(TRIPPILOT_LOCATION_AUTOMATION=1 prebuild+run:ios) · 위치 '항상 허용' · 오늘이 여행 날짜인 여행의 i01 진입.
set -e
DEV=booted
LAT=${2:-35.1667}
LNG=${3:-129.1370}
FAR_LAT=$(python3 -c "print(round($LAT-0.01,6))")   # 약 1.1km 남쪽(리전 밖)
log() { print -- "[u10-sim $(date +%H:%M:%S)] $*"; }
case "$1" in
  arrive)   # 밖 → 진입 → 4분 머묾 → 도착 확정(진입 시각 소급)이 나와야 한다
    xcrun simctl location $DEV set $FAR_LAT,$LNG; log "밖"; sleep 20
    xcrun simctl location $DEV set $LAT,$LNG; log "진입(이 시각이 도착 시각)"; sleep 240
    log "4분 경과 — 앱을 포그라운드로 두면 다음 표본/복귀에서 ARRIVE 가 큐에 실린다" ;;
  pass)     # 진입 후 2분 안 이탈 → 아무것도 기록되지 않아야 한다(지나가기)
    xcrun simctl location $DEV set $FAR_LAT,$LNG; sleep 20
    xcrun simctl location $DEV set $LAT,$LNG; log "진입"; sleep 120
    xcrun simctl location $DEV set $FAR_LAT,$LNG; log "2분 만에 이탈 — 기록 0 기대"; sleep 240 ;;
  complete) # 진입 → 11분 머묾 → 이탈 → 4분 → 자동 완료(이탈 시각)
    xcrun simctl location $DEV set $FAR_LAT,$LNG; sleep 20
    xcrun simctl location $DEV set $LAT,$LNG; log "진입"; sleep 660
    xcrun simctl location $DEV set $FAR_LAT,$LNG; log "이탈(이 시각이 완료 시각)"; sleep 240
    log "COMPLETE(AUTO_GEOFENCE_EXIT) 기대" ;;
  gap)      # 걷기 → 12분 공백(위치 고정 해제) → 다른 곳에서 재개 → 경로 세그먼트 2개
    xcrun simctl location $DEV start --speed=1.4 $FAR_LAT,$LNG $LAT,$LNG; log "걷기 1"; sleep 300
    xcrun simctl location $DEV clear; log "공백 12분"; sleep 720
    xcrun simctl location $DEV start --speed=1.4 $LAT,$LNG $(python3 -c "print(round($LAT+0.008,6))"),$LNG; log "걷기 2"; sleep 300
    log "다음 날 포그라운드에서 업로드 → 세그먼트 2개(잇지 않음) 기대" ;;
  clear) xcrun simctl location $DEV clear; log "해제" ;;
  *) print "usage: $0 <arrive|pass|complete|gap|clear> [lat lng]"; exit 2 ;;
esac
