# U10 위치 자동화 — 시뮬레이터 확인 절차 (TRIP-1344)

> 무엇이 시뮬레이터로 되고 무엇이 6-b(TestFlight 실기)인지 가르는 문서. 판정 로직(무장·리전·도착/완료·큐·다운샘플)은
> jest+fast-check(PBT-U10-F1~F7)가 잠근다 — 여기서는 **배선**만 본다.

## 1. 프리뷰 키 (네트워크·플래그 없이 표면만)

`trippilot://_dev/preview?state=<키>` — 키마다 앱 재기동(traps-shell).

| 키 | 표면 (Figma U10 검토 밴드) |
|---|---|
| `u10-explainer` | 승격 설명 시트 (u10a 4857:2795) |
| `u10-degrade-notice` · `u10-dropped-notice` | i01 강등·폐기 안내 1줄 (u10c 4857:3012) |
| `u10-auto-badge` · `u10-auto-revert-dialog` · `u10-auto-revert-media` | 자동 기록 표식·되돌리기 확인·409 미디어 (u10b) |
| `u10-route-actual` · `u10-route-none` · `u10-route-no-consent` | i01 계획｜실제 (u10e) |
| `u10-records-route` | j01 풀 지도 실제 경로 + 표식 (u10e 4862:3807) |
| `u10-l06-on` · `u10-l06-off` · `u10-l06-blocked` · `u10-l06-revoke-dialog` | l06 상태 행·철회 (u10d) |

## 2. 위치 시나리오 (플래그 ON 빌드 전용)

전제: `TRIPPILOT_LOCATION_AUTOMATION=1 pnpm expo prebuild` → `LANG=en_US.UTF-8 pnpm expo run:ios`(expo-task-manager 네이티브 — 재빌드 필수) ·
설정에서 TripPilot 위치 '항상' + 정확한 위치 · 오늘이 여행 날짜인 여행의 i01 진입(설명 → [자동 기록 켜기]).
서버가 없으므로 결과는 가짜 싱크(`shared/location/automation/sink.ts`)로 간다 — 확인은 Metro 로그·i01 안내·디버거.

```
scripts/u10-sim-location.sh arrive     # 진입 4분 → ARRIVE(진입 시각)
scripts/u10-sim-location.sh pass       # 2분 내 이탈 → 기록 0
scripts/u10-sim-location.sh complete   # 11분 체류 후 이탈 → COMPLETE(이탈 시각)
scripts/u10-sim-location.sh gap        # 공백 12분 → 다음 날 업로드 시 세그먼트 2개
scripts/u10-sim-location.sh clear
```

## 3. 시뮬레이터로 못 보는 것 (6-b — BE 개통 뒤 TestFlight)

앱 종료 상태 wake · 상태바 위치 표시 · 잠금 상태 wake 저장소 · 비행기 모드 재연결 전송 · 배터리 · 재부팅 후 첫 잠금 해제 전 wake ·
플래그 OFF/ON 실제 Info.plist·AndroidManifest 대조 (FD §8 #1~11, NFR #12~20).
