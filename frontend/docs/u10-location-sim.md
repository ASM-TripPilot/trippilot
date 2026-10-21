# U10 위치 자동화 — 시뮬레이터 확인 절차 (TRIP-1344)

> 무엇이 시뮬레이터로 되고 무엇이 6-b(TestFlight 실기)인지 가르는 문서. 판정 로직(무장·리전·도착/완료·큐·다운샘플)은
> jest+fast-check(PBT-U10-F1~F7)가 잠근다 — 여기서는 **배선**만 본다.

## 1. 프리뷰 키 (네트워크·플래그 없이 표면만)

`trippilot://_dev/preview?state=<키>` — 키마다 앱 재기동(traps-shell).

| 키 | 표면 (Figma U10 검토 밴드) |
|---|---|
| `u10-explainer` | 승격 설명 시트 (u10a 4857:2795) |
| `u10-degrade-notice` · `u10-dropped-notice` | i01 강등·폐기 안내 1줄 (u10c 4857:3012) |
| `u10-route-actual` | i01 계획 동선 + 실제 경로 함께 (u10e, 토글 없음 — TRIP-1520) |
| `u10-records-route` | j01 풀 지도 실제 경로 (u10e 4862:3807) |
| `u10-l06-on` · `u10-l06-off` · `u10-l06-blocked` · `u10-l06-revoke-dialog` | l06 상태 행·철회 (u10d) |

## 2. 위치 시나리오 (플래그 ON 빌드 전용)

전제: `LANG=en_US.UTF-8 TRIPPILOT_LOCATION_AUTOMATION=1 pnpm expo prebuild -p ios --clean`(UTF-8 로케일이 아니면 pod install 에서 죽는다) → 빌드(expo-task-manager 네이티브 — 재빌드 필수) ·
설정에서 TripPilot 위치 '항상' + 정확한 위치(`xcrun simctl privacy booted grant location-always com.trippilot.travel`) ·
l06 위치정보 동의 켜기 · 오늘이 여행 날짜인 여행의 i01 진입(설명 → [자동 기록 켜기], '항상'이면 설명 없이 바로 무장).

- ⚠️ **빌드(xcodebuild·`run:ios`)에도 같은 env 를 준다.** JS 플래그(`extra.locationAutomation`)는 prebuild 가 아니라 빌드 시점 env 로
  `TripPilot.app/EXConstants.bundle/app.config` 에 굽힌다 — prebuild 에만 주면 Info.plist 는 ON, JS 는 OFF 로 갈라진다(l06 에 자동 기록 행이 없으면 이것).
  확인: `grep -o '"locationAutomation":[a-z]*' ios/build/Build/Products/Debug-iphonesimulator/TripPilot.app/EXConstants.bundle/app.config`.
- 플래그 ON 빌드는 앱 시작 때 **실 http 싱크**를 꽂는다(TRIP-1485) — 결과는 `EXPO_PUBLIC_API_BASE_URL` 서버로 간다(`.env.local` 이면 dev-api).
  가짜 싱크는 플래그 OFF·테스트·프리뷰뿐이다. 확인은 서버 방문 기록(i01·j01 카드가 방문 완료로 바뀜 — 「자동 기록」 표식은 TRIP-1523 에서 없앴다)·법정 로그, 기기 쪽은
  `xcrun simctl spawn booted log stream --predicate 'process == "TripPilot"'` 의 `startMonitoringForRegion`·`EXTaskService: Executing task 'trippilot-u10-geofence'`.
- 좌표는 오늘 슬롯 장소로 준다: `scripts/u10-sim-location.sh complete <lat> <lng>`(기본값 부산시립미술관은 일정에 없으면 아무 일도 없다).

```
scripts/u10-sim-location.sh arrive     # 진입 4분 → ARRIVE(진입 시각)
scripts/u10-sim-location.sh pass       # 2분 내 이탈 → 기록 0
scripts/u10-sim-location.sh complete   # 11분 체류 후 이탈 → COMPLETE(이탈 시각)
scripts/u10-sim-location.sh gap        # 공백 12분 → 다음 날 업로드 시 세그먼트 2개
scripts/u10-sim-location.sh downgrade  # '항상'→'사용하는 동안' → MANUAL·안내 1줄·구간 END 기대(시뮬레이터에선 실행 중 앱에 반영 안 됨 — 6-b)
scripts/u10-sim-location.sh restore    # '항상' 복구
scripts/u10-sim-location.sh clear
```

2026-10-20 실측(dev-api, 부산 여행 1일차 옥미아구찜): `complete` 1회 재생 → 서버 자동 완료 반영 · i01 카드 「자동 기록」 표식 · 지도 핀 완료 ✓.
단 이 슬롯은 **수동 도착이 먼저 있던** 곳이라 '수동 도착 + 자동 완료' 경로만 본 것이다 — 자동 도착(`arrive`)·지나가기(`pass`)·공백(`gap`)은 아직 재생하지 않았다.
같은 재생에서 `trippilot-u10-geofence` 태스크가 분당 5천~1만 회 돌았다(재무장 → `startGeofencingAsync` 재등록 → iOS 상태 통지 → 같은 태스크) —
**TRIP-1511 로 해결**: 같은 리전 집합이면 재등록을 건너뛰고, 포그라운드 복귀에서만 기억을 비운다. 수정 뒤 분당 4~5회, 복귀 뒤 60초 0회.
재발 확인: `log stream` 에서 `Executing task 'trippilot-u10-geofence'` 가 사건(진입·이탈) 수준인지 센다.
2026-10-21 실측(TRIP-1517 수정 뒤): `arrive`(2일차 해담 소곱창순대국) — 진입 4분 정지 후 **i01 을 열면** 「자동 기록 · 00:31 도착(진입 시각)」.
수정 전엔 진입 순간 표본이 진입 이벤트보다 먼저 처리돼 근거로 안 잡히고, 정지라 표본이 더 안 와 도착이 끝까지 안 남았다.
- 포그라운드 wake 는 **i01 허브에서만** 들어간다 — 앱이 홈에 있으면 다음 표본·이탈·허브 진입 때 확정된다.
- **자정을 넘기면 무장 리전이 그날 슬롯으로 바뀐다** — 전날 슬롯 좌표로 재생하면 아무 일도 없다(재생 전 i01 의 오늘 일차 확인).
`downgrade` 는 실행 중 앱(같은 PID)에서 포그라운드 복귀로만 봤다 — 콜드 재시작으로는 아직 안 봤으니 "시뮬레이터 한계"로 단정하지 말 것.

## 3. 시뮬레이터로 못 보는 것 (6-b — TestFlight 실기기)

앱 종료 상태 wake · 상태바 위치 표시 · 잠금 상태 wake 저장소 · 비행기 모드 재연결 전송 · 배터리 · 재부팅 후 첫 잠금 해제 전 wake ·
플래그 OFF/ON 실제 Info.plist·AndroidManifest 대조 (FD §8 #1~11, NFR #12~20).
