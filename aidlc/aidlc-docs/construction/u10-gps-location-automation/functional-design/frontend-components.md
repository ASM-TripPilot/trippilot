# U10 GPS·위치 자동화 — Frontend Components

> **아키텍처 정본 = `frontend/README.md`, 현재 배치의 사실 정본 = `frontend/docs/structure.md`(+ 리포).** 층 규약을 옮겨 적지 않는다. 이 문서가 정하는 것은 **어느 슬라이스에 무엇이 들어가고, 무엇을 기기가 판정하고, 무엇을 서버에 보내지 않는가**이다.
> **화면 정본**: 라이브 Figma(캔버스 `1228:1045`). U10이 추가하는 다섯 표면은 **아직 프레임이 없다**(`business-logic-model.md` §14) — `figma-build`로 먼저 그리고 코드는 그 뒤다(DEC-U10-19). 아래 화면 서술은 **프레임 작도용 스펙**이지 픽셀 정본이 아니다.
> **리포 기준**(2026-10-12 실측): 라우트는 리포 루트 `frontend/app/`, FSD app 층은 `frontend/src/app/`. 위치 계층 `frontend/src/shared/location/`(`geofence.ts` 스텁 · `readDevicePosition.ts` · `LocationPreprompt.tsx` · `useLocationConsent.ts` · `revokeImpact.ts` · `consentPutBody.ts`). `expo-location ~19.0.8` 설치, `expo-task-manager` 없음.

---

## 0. 원칙

| 원칙 | 내용 |
|---|---|
| **위치 수집의 단일 소유 = `shared/location/`** | 권한 요청·지오펜스·백그라운드 태스크·표본·다운샘플·자동 결과 큐 전부 여기. 화면(page)은 상태를 읽고 사용자 행위를 넘길 뿐이다(U4 frontend-components §5 승계) |
| **판정은 순수 함수** | 무장 판정·리전 선택·슬롯 판정·다운샘플·날짜 전환은 전부 `model` 성격의 **순수 함수**로 두고 fast-check PBT로 잠근다. 네이티브 호출(태스크·권한·OS 등록)은 얇은 어댑터에 가둔다 — jest가 네이티브 발화를 원리적으로 못 보기 때문이다(G-U10-14) |
| **화면은 재판정하지 않는다** | "자동 기록" 표시·되돌리기 가능 여부는 서버 `VisitCheck`의 출처 필드에서 파생한다. 기기 판정 상태를 화면에 직접 그리지 않는다 |
| **플래그 OFF면 코드 경로 0** | 플래그가 꺼진 빌드에서 태스크 정의·권한 요청·설명 화면 진입이 **한 줄도 실행되지 않는다**(BR-U10-07) |
| **INV-3** | 어떤 새 UI에도 소요시간·이동 시간·속도·체류 시간·걸음 수가 없다. 경로는 거리만 |

---

## 1. 네이티브 설정 (`frontend/app.config.ts`) — 플래그 게이트

| 항목 | 플래그 OFF(현행 그대로) | 플래그 ON |
|---|---|---|
| `expo-location` 플러그인 | `locationAlwaysPermission: false` · `locationAlwaysAndWhenInUsePermission: false`(TRIP-936) | always 용도 문구(한국어) 설정 · `isIosBackgroundLocationEnabled: true` · `isAndroidBackgroundLocationEnabled: true` · `isAndroidForegroundServiceEnabled: true` |
| iOS `UIBackgroundModes` | 없음 | `location` |
| Android 권한 | 없음 | `ACCESS_BACKGROUND_LOCATION` · `FOREGROUND_SERVICE` · `FOREGROUND_SERVICE_LOCATION` |
| `privacyManifests` | `PreciseLocation` 목적 `AppFunctionality` | 같은 항목 유지 + App Store Connect App Privacy 답변 동기화(주석 규약: 둘 중 하나를 바꾸면 다른 쪽도) — 목적 추가 여부는 NFR Req |
| `extra` | — | `locationAutomation: true` — JS는 `expo-constants`로만 읽는다 |
| 의존 | — | **`expo-task-manager` 추가**(MOBILE-U4-01) — 네이티브 모듈이라 **재빌드 필수**, OTA 불가(MOBILE-U4-02) |

- 플래그 원천은 빌드 환경 변수 1개(이름은 구현 PR). `EXPO_PUBLIC_*`로 두지 않는다 — JS 노출은 `extra` 한 곳으로 모아 "네이티브 표면과 JS 동작이 같은 값"을 보장한다(G-U10-6).
- ⚠️ 리포 함정(`repo-traps.md` 지도 절)과 같은 계열: 코드만 머지하고 재빌드를 안 하면 기존 dev build에는 태스크가 없다.

---

## 2. `shared/location/` 확장

### 2.1 순수 모델

| 파일(제안) | 책임 | 규칙 | PBT |
|---|---|---|---|
| `geofence.ts`(기존 확장) | `buildGeofenceRegions` 유지(반경을 설정값으로) · **`selectRegions(slots, visits, suppressed, date, limit)`** 신설 — 진행 중 전부 + 남은 슬롯 순번, 합계 ≤10 | BR-U10-09·11·13 | F2 |
| `automation/arming.ts` | **`resolveArming(input) → { state: 'ARMED' \| 'MANUAL' \| 'EXPLAINER', reason }`** — 입력 = OS 권한(fg/bg/정확도) · 앱 토글 · 여행 구간 · 플래그 · 설명 이력 | BR-U10-02~05 | F1 |
| `automation/visitJudge.ts` | **슬롯 판정 리듀서** `judge(state, event, now, config) → { state, emit[] }` — 이벤트 = 진입·이탈·표본·wake. `business-logic-model.md` §5.1 상태기계 | BR-U10-12·14~19 | F3 |
| `automation/autoEventQueue.ts` | 큐 적재·`dropStale(queue, tripLocalDate)`(당일 한정)·배치 조립·항목 결과 반영 | BR-U10-20·22 | F4 |
| `automation/routeDownsample.ts` | 원시 표본 → 정확도 필터 → 세그먼트 분할 → 다운샘플(허용 오차·점 상한) → 인코딩 | BR-U10-34·36·37 | F5 |
| `automation/routeDistance.ts` | 세그먼트별 하버사인 누적(공백 제외) — **걸음 수 함수를 두지 않는다** | BR-U10-38·40 | F5 |
| `automation/config.ts` | 임계 기본값(150m · 100m · 3분 · 10분 · 3분 · 10개) — 한 곳에서만 정의 | DEC-U10-22 · O-U10-2 | — |

> 거리 계산이 기록·요약(`features/reflection`) 쪽에서도 필요해지면 `shared/geo/`로 승격한다(U5 G-U5-14 — `features → features` import 금지). 지금은 위치 계층 안 1곳이다.

### 2.2 네이티브 어댑터 (jest 사각 — 6-b 전용)

| 파일(제안) | 책임 |
|---|---|
| `automation/tasks.ts` | **`TaskManager.defineTask(GEOFENCE_TASK, …)` · `defineTask(ROUTE_TASK, …)`를 모듈 최상위에서** 정의한다(태스크는 렌더 트리 밖, 앱이 백그라운드로 깨어나 JS 번들만 로드됐을 때도 정의돼 있어야 한다). 본문은 순수 모델 + `shared/api` 생성 함수만 부른다 — React·page·feature를 import하지 않는다 |
| `automation/nativeGeofence.ts` | `registerGeofences(regions)` 실배선(`Location.startGeofencingAsync`) · `clearGeofences()`(`stopGeofencingAsync`). **스텁의 `{armed:false, reason:'native-geofencing-not-wired'}` 반환 계약을 유지**해 실패도 같은 모양으로 돌려준다(등록 실패 = MANUAL 폴백) |
| `automation/nativeRoute.ts` | `Location.startLocationUpdatesAsync(ROUTE_TASK, { 저전력 정확도 · distanceInterval · deferredUpdatesInterval/Distance · showsBackgroundLocationIndicator: true · pausesUpdatesAutomatically · Android foregroundService 알림 문구 })` / stop. 값은 NFR |
| `automation/localStore.ts` | 원시 표본·판정 상태·큐·열린 구간 id 저장. 백그라운드 태스크에서 접근 가능해야 한다(라이브러리 = G-U10-5) |
| `backgroundPermission.ts` | `requestAlwaysPermission()` — iOS는 when-in-use 선행 확인 후 `requestBackgroundPermissionsAsync`, Android 11+은 설정 화면 이동이 뜬다. 결과를 `'granted' \| 'denied' \| 'blocked'`로 접는다. **팝업 실패를 오류로 다루지 않는다**(BR-U10-06 · LocationPage 선례) |

**태스크 정의 위치(FSD)**: 정의는 `shared/location/automation/tasks.ts`, **등록(import로 실행)은 FSD app 층 엔트리**(`frontend/src/app/entrypoint/` — `initSentry.ts`와 같은 자리)에서 플래그 ON일 때만 1회. 루트 레이아웃(`frontend/app/_layout.tsx`)이 그 엔트리를 이미 거치는지는 6-b에서 "앱 종료 상태 wake"로 확인한다(백그라운드 실행 시 라우트 트리가 아직 안 그려질 수 있다).

### 2.3 훅·UI

| 파일(제안) | 종류 | 책임 |
|---|---|---|
| `automation/useLocationAutomation.ts` | 훅 | 포그라운드에서 `AppState` 변화마다 `resolveArming` 재계산 → 무장/해제 실행 · 구간 START/END 보고 · 미전송 큐 flush · 전날 경로 업로드. 결과 `{ state, reason, droppedCount }`를 노출 |
| `LocationAlwaysExplainer.tsx` | UI(props만) | 승격 설명 1장 — 무엇을(앱을 닫아도 방문·이동 경로를 자동 기록) · 언제만(여행 날짜 동안만) · 보이는 것(상태바 위치 표시) · 끄는 법(설정·l06) · [켜기] [나중에]. `LocationPreprompt.tsx`와 같은 층·같은 톤. 소비처 2(i01 허브 · l06 "켜기") |
| `revokeImpact.ts`(기존 수정) | 순수 | `stops`에 **"자동 방문 기록·이동 경로(저장된 경로 삭제)"** 추가(BR-U6-30 개정 · G-U10-8). 플래그 OFF 빌드에서는 넣지 않는다 |

---

## 3. 화면별 변경 (Figma 먼저)

| 화면(라이브 코드) | 슬라이스 | 변경 | 근거 |
|---|---|---|---|
| **i01 허브** | `src/pages/live/live-itinerary/`(`LiveItineraryPage` → `LiveHubView`) | ① 페이지가 `useLocationAutomation` 결과로 **설명 시트를 1회** 띄운다(판정은 페이지에서 1회) ② 강등·보내지 못한 건수 **안내 1줄**(시트 헤더 위, `설정 열기` 링크) ③ 지도에 **실제 경로 레이어 + 계획｜실제 토글**(`MapSheetShell`이 소유한 `MapView`의 `NaverMapPathOverlay` — 점선은 이미 지원) | DEC-U10-11·14·19 |
| **i01 방문 카드** | `src/entities/itinerary-slot/ui/SlotProgressCard.tsx`(표시) + `features/check-visit`(동작) | **"자동 기록" 표식**(도착 또는 완료 출처가 `AUTO_*`) · 메뉴/길게 누르기로 **[자동 기록 되돌리기]** + 잠금 해제 고지 1줄. 시각은 서버 값 그대로 · 체류 미표시 | BR-U10-29~32 |
| **j01 방문 기록** | `src/pages/record/trip-records/`(`TripRecordsView` · `VisitRecordCard`) | 같은 "자동 기록" 표식 · 풀 지도에 그날 실제 경로 레이어 · `manual-checkin` 상태 문구는 **현행 유지**(라이브 Figma와 U10 MANUAL 의미 일치) | BR-U10-41 |
| **j 요약** | `src/pages/record/trip-summary/` | 날짜별 거리 출처 라벨(`summaryView.ts` 기존 `ROUTE`→"경로"·`VISIT_LINE`→"근사"를 **날짜 카드 단위**로) · 지도 히어로 배선 뒤 경로 레이어(G-U10-7) | BR-U10-39 |
| **l06 위치정보 동의** | `src/pages/settings/settings-location/`(`LocationConsentScreen`) | 사용처 행에 **"자동 방문 기록 · 이동 경로"** 추가 · **자동 기록 상태 행**(켜짐 / 꺼짐 · 사유 · `설정 열기` 또는 [켜기] → 설명) · 철회 다이얼로그(`RevokeConfirmDialog`) 중단 목록에 경로 삭제 | DEC-U10-13 · G-U10-8 |
| 온보딩 위치(c) | `src/pages/onboarding/onboarding-location/` | **변경 없음** — when-in-use만(DEC-U10-11) | TRIP-936 형태 회피 |

- **새 라우트 없음.** 설명은 i01 위 시트(또는 오버레이)다. 리포 함정: `@gorhom/bottom-sheet` 목은 열림·딤을 못 본다, 라이브러리 없는 오버레이 다이얼로그도 jest 사각이다(`repo-traps.md` 바텀시트 절) — 설명 화면의 실제 열림·버튼 동작은 6-b 항목이다.
- **두 `useVisitCheck`**(`features/check-visit/model/` · `pages/live/live-itinerary/model/`)가 있다(G-U10-15). 되돌리기 뮤테이션은 `features/check-visit`에 한 번만 두고 i01·j01이 같은 것을 쓴다 — 착수 티켓에서 i01 쪽 사본을 정리할지 정한다.
- 자동 도착이 서버에 반영되면 i01·j01 캐시(`getGetTripsTripIdVisitsDaysDayQueryKey`)는 **포그라운드 복귀 시 무효화**로 따라잡는다 — 백그라운드 태스크가 React Query 캐시를 직접 만지지 않는다.

---

## 4. 상호작용 흐름

```
[여행 중 i01 첫 진입]
  page: resolveArming -> EXPLAINER ?
    yes -> LocationAlwaysExplainer
             [켜기]   -> requestAlwaysPermission -> granted+precise -> ARMED (등록·구간 START·기록 시작)
                                                 -> denied/blocked/approx -> MANUAL (+ l06 상태 "꺼짐")
             [나중에] -> MANUAL (이 여행에서 다시 묻지 않음)
    no  -> 현재 상태 유지

[앱 닫힘 · 진입/이탈/표본 wake]
  task: 판정 리듀서 -> 큐 적재 -> 배치 1회 전송 -> 리전 재선택(필요 시) -> 종료

[포그라운드 복귀]
  hook: 무장 재계산(강등 감지 -> 해제 + 안내 1줄) -> 큐 flush -> 전날 경로 업로드 -> 방문 캐시 무효화

[카드 '자동 기록 되돌리기']
  확인 1줄(잠금 해제 고지) -> POST revert-auto -> 성공: 카드 갱신 + 그 슬롯 리전 제외 / 409 미디어: 안내
```

---

## 5. testID (규약 `{feature}-{screen}-{role}` · 기존 접두 승계)

```
location-explainer-root · -title · -indicator-note · -enable · -later
execution-live-automation-notice · -automation-notice-settings · -automation-dropped-count
execution-live-route-toggle-plan · -route-toggle-actual · -route-disabled-reason
execution-live-slot-auto-badge-{slotKey} · execution-live-slot-auto-revert-{slotKey}
execution-live-slot-auto-revert-confirm · -auto-revert-cancel · -auto-revert-media-notice
record-visit-auto-badge-{visitCheckId} · record-visit-auto-revert-{visitCheckId}
record-map-route-layer · record-map-route-disabled
summary-day-distance-source-{date}
settings-location-automation-row · -automation-status · -automation-enable · -automation-open-settings
settings-location-usage-row-automation
```

> **[공백]** 제안값이다. `SlotProgressCard`의 `execution-live-slot-{role}-{slotKey}` 조립 함수(`fieldId`)를 그대로 쓰면 위 슬롯 계열 이름이 자연히 나온다. 구현이 다른 값을 확정하면 이 절에 소급 기록한다.

---

## 6. 폼·입력 검증 (UX 사본 — 권위는 서버)

| 대상 | 규칙 |
|---|---|
| 자동 결과 배치 | 기기는 `occurredAt`을 그대로 싣고 범위 판정은 서버(BR-U10-21). 기기는 날짜 전환 폐기만 한다 |
| 경로 업로드 | 점 상한·허용 오차는 기기가 지키되 클램프는 서버(BR-U10-38). 서버 응답의 `distanceM`을 화면 값으로 쓴다(기기 값으로 덮지 않는다) |
| 되돌리기 | 가능 여부는 서버 `VisitCheck` 출처에서 파생, 최종 거절은 서버 409 |

---

## 7. PBT (기기 순수 함수 · fast-check)

| ID | 대상 | 성질 |
|---|---|---|
| **PBT-U10-F1** | `arming.ts` | 임의의 (OS 권한 · 정확도 · 토글 · 날짜 · 플래그 · 설명 이력) 조합에서 `ARMED`는 **다섯 조건이 모두 참일 때만**이고, 토글 OFF면 `EXPLAINER`가 나오지 않는다 · 강등 입력 직후 `ARMED`가 0 |
| **PBT-U10-F2** | `geofence.ts selectRegions` | 임의 일정·실적에서 결과 수 ≤ 10 · 진행 중 슬롯 전부 포함 · 좌표 없는 슬롯·되돌린 슬롯·완료/건너뜀 슬롯 0 |
| **PBT-U10-F3** | `visitJudge.ts` | 임의 진입/이탈/표본 시퀀스에서 ① 3분 미만 체류는 도착을 내지 않는다 ② 도착 시각 = 진입 시각 ③ 완료 시각 ≥ 도착 시각 + 10분이거나 완료 없음 ④ 정확도 > 100m 표본만 있는 창에서는 아무것도 내지 않는다 ⑤ 같은 시퀀스 → 같은 출력(결정론) |
| **PBT-U10-F4** | `autoEventQueue.ts` | 임의 큐에서 날짜 전환 후 남은 항목의 날짜는 전부 당일 · 버린 수 + 남은 수 = 원래 수 · 같은 `eventId` 중복 적재 없음 |
| **PBT-U10-F5** | `routeDownsample.ts` · `routeDistance.ts` | 출력 점 수 ≤ 상한 · 모든 원시 점이 허용 오차 안(점 상한에 걸리지 않은 경우) · 세그먼트 간 연결선 없음(공백 경계 보존) · 거리 ≥ 출력 폴리라인 길이 · 출력에 속도·시간·걸음 수 필드 없음 |
| **PBT-U10-F6** | 자동 결과 직렬화 | 임의 이벤트의 요청 본문에 좌표로 해석될 키가 없다(PBT-U10-4의 기기 측) |

---

## 8. 6-b 실기 전용 항목 (jest 원리적 사각)

| # | 확인 | 방법 |
|---|---|---|
| 1 | 플래그 OFF 빌드 Info.plist·AndroidManifest가 TRIP-936 이후와 같다 | 빌드 산출물 비교 |
| 2 | 설명 → [켜기] → iOS always 승격 대화상자 · Android 설정 이동 | 실기 |
| 3 | **앱 종료 상태**에서 지오펜스 진입이 앱을 깨우고 태스크가 정의돼 있다 | 실기 이동 또는 시뮬레이터 위치 경로(GPX) |
| 4 | 진입 3분 체류 → 도착 기록(진입 시각) · 3분 내 이탈 → 기록 없음 | 〃 |
| 5 | 10분 체류 후 이탈 → 자동 완료(이탈 시각) · 3분 내 재진입 → 완료 취소 | 〃 |
| 6 | 상태바 위치 표시가 여행 중 뜨고, 여행 구간 밖·강등 후 사라진다 | 실기 |
| 7 | 설정에서 always → when-in-use / 정확 → 대략 전환 후 복귀 시 즉시 해제 + i01 1줄 | 실기 |
| 8 | 비행기 모드에서 자동 결과 → 재연결 시 전송 · 날짜 넘기면 폐기 + 1줄 | 실기 |
| 9 | 하루 경로 업로드 후 기기 원시 표본 삭제 · l06 토글 OFF 시 기기·서버 경로 삭제 | 실기 + 서버 조회 |
| 10 | 배터리 소모(여행 하루 기준) | NFR Requirements의 예산 대비 측정 |
| 11 | 지도 경로 레이어가 세그먼트 공백을 잇지 않는다 | 실기 육안 |

---

## 9. 다른 유닛 FE 문서와의 관계

- U4 `frontend-components.md` §3의 `useActualRoute.ts`·`actualDistance.ts`(이미 리포에서 삭제, TRIP-746)는 **되살리지 않는다** — 위치 계층 `automation/route*.ts`가 대체한다. 실제 경로 레이어는 `features/execution`이 아니라 페이지(`live-itinerary`·`trip-records`)가 `GET /trips/{tripId}/routes` 훅을 소비해 그린다.
- U4 §1 "i07 푸시 = 지오펜스가 깨웠을 때의 로컬 알림"은 **만들지 않는다** — wake 판정을 서버로 보내지 않으므로(DEC-U10-9) 지연 알림은 서버 `PlanBTriggered` → U6 푸시 경로 하나다. 라이브 Figma의 `i09-[알림] 푸시 알림`이 그 표면이다.
- U5 `frontend-components.md` G-U5-14(`shared/geo` 승격)는 거리 함수의 두 번째 소비자가 생길 때 다시 연다.

---

> **[개정 · 2026-10-12 · U10 FE 구현] (TRIP-1330 서브 1331~1345, 브랜치 `feat/U10-FE-gps`)** — 원문은 그대로 두고, FE 구현이 이 문서와 다르게 간 곳만 코드 근거와 함께 적는다(FE 구현 우선 — 사용자 결정 2026-10-12). 서버(§12 초안 엔드포인트)는 미구현이라 `shared/location/automation/sink.ts`의 `FakeAutomationSink`가 답하고, BE 개통 시 `setAutomationSink` 한 곳에서 교체한다.
>
> 1. **§2.1 파일 배치** — 제안대로 `shared/location/automation/`에 `arming`·`config`·`visitJudge`·`autoEventQueue`·`routeDistance`·`routeDownsample`을 두고, 추가로 `polyline.ts`(인코딩/디코딩) · `routeLayer.ts`(RouteDay→지도 세그먼트) · `distanceSource.ts`(날짜별 출처) · `noticeCopy.ts` · `statusView.ts` · `engine.ts`(훅·태스크 공용 오케스트레이션)를 더했다. `selectRegions`는 `geofence.ts`에 두었다.
> 2. **무장 입력(§2.1 arming)** — NFR 델타 4 킬 스위치를 `serverEnabled` 입력으로 넣었다(무장 조건 6개). 설명(EXPLAINER)은 `onHub`·`backgroundCanAskAgain` 입력으로 BR-U10-05를 판정한다. 무장에 성공한 여행은 '설명 이력 있음'으로 기록한다(설정에서 직접 always 를 준 뒤 철회한 사용자에게 설명을 다시 띄우지 않는다). 코드: `automation/arming.ts`·`engine.ts arm()`.
> 3. **정밀/대략 위치(iOS)** — expo-location 19 는 iOS accuracy authorization 을 노출하지 않는다. iOS 는 `precise=true`로 두고 대략 위치의 거친 표본(수 km)은 `visitJudge`의 정확도 게이트(≤100m)가 보류시킨다. Android 는 `android.accuracy === 'fine'`. 코드: `automation/permission.ts`.
> 4. **판정 리듀서(§2.1 visitJudge)** — 슬롯 단위가 아니라 **하루 단위 다중 슬롯 상태**(계획 순번 보유)다 — 보조 규칙(BR-U10-18)·겹침(BR-U10-19)이 슬롯을 가로지르기 때문. 정확도 게이트는 "진입 이후 ≤100m 표본 1개 이상"이고 없으면 `HELD`(기록 없음). 보조 규칙은 이탈을 이미 잡은 슬롯(`LEFT`·`EXIT_PENDING`)에는 적용하지 않는다. 서버 실적은 `external` 이벤트로 반영(서버 우선).
> 5. **다운샘플(§2.1 · NFR P-PRIV-U10-1)** — RDP 가 지그재그에서 O(n²)(20,000점 2분 실측)이라 512점 조각 단위로 단순화한다(ε 보장 유지). 거리 정수화는 올림. 코드: `automation/routeDownsample.ts`.
> 6. **로컬 저장소(G-U10-5)** — NFR 델타 2(expo-file-system, 캐시 U10 폴더) 그대로. A/B 세대 슬롯·잠금 wake 쓰기 금지는 구현, NFR `wakeBudget`(F8)·`BackgroundTransport`·킬 스위치 탐침·소유자 확인(P-STORE-U10-4)은 **미구현**(서버 부재 — BE 개통 칸). 구간 보고 실패는 재시도 없이 버린다(서버 스위퍼 의존).
> 7. **빌드 플래그(§1)** — 원천 `TRIPPILOT_LOCATION_AUTOMATION=1`, `eas.json` `production-automation` 프로필. **expo-task-manager 는 설치만으로 prebuild 레거시 자동 플러그인이 붙어 플래그 OFF 에도 `UIBackgroundModes=[fetch]`를 넣는다** — `app.config.ts`가 결과에서 지운다(OFF=키 없음, ON=`[location]`). 앱 엔트리는 NFR LC-U10-1 대로 리포 루트 `index.ts`(`package.json main`)에서 `src/app/entrypoint/registerBackgroundTasks` → `expo-router/entry`.
> 8. **점선(§3 i01)** — "NaverMapPathOverlay — 점선은 이미 지원"은 사실과 다르다. PathOverlay 는 `patternImage`(이미지 반복)만, **`NaverMapPolylineOverlay`가 `pattern`(대시 배열)** 을 지원한다 — 실제 경로는 PolylineOverlay `[6,5]`·빨강·외곽선 없음, 켜졌을 때 계획 연결선은 muted-soft 1.5. 코드: `shared/map/MapView.tsx` `actualRoute`.
> 9. **두 `useVisitCheck`(G-U10-15)** — 합치지 않았다(범위 밖 리팩터). 되돌리기만 `features/check-visit/model/useRevertAutoVisit.ts` 한 곳에 두고 i01·j01이 같이 쓴다. '자동 기록' 판정은 현재 계약에 `completion_source`가 없어 도착 출처(`source=AUTO_GEOFENCE`)만 본다 — 완료가 있으면 되돌릴 부분=완료로 추정, 최종 판정은 서버 409.
> 10. **설명·다이얼로그 표면** — gorhom 시트가 아니라 라이브러리 없는 오버레이(딤+카드). 강등 안내 띠는 Figma 작도에서 한 줄이 아니라 2줄(제목+`설정 열기` / 사유). `⋯` 버튼이 길게 누르기 메뉴를 대신한다.
> 11. **testID(§5)** — 토글은 공용 `RouteToggle` 접두로 `execution-live-route-*`·`record-map-route-*`(-toggle-plan/-toggle-actual/-disabled-reason/-distance), 레이어는 `map-route-segment`. `execution-live-automation-dropped-count` 대신 같은 띠 `execution-live-automation-notice`에 건수를 싣는다. 되돌리기 다이얼로그는 `{접두}-dialog/-confirm/-cancel/-media-notice`.
> 12. **요약(§3 j 요약)** — `summaryView.ts`는 `features/reflection/model/summaryView.ts`로 이사해 있다. 날짜별 출처는 서버 `DayHighlight.distanceSource`(§12.5) 미개통이라 `GET routes` 목록으로 FE 파생(`distanceSourceByDate`) — 플래그 ON 에서만. 요약 지도 히어로 경로는 G-U10-7 그대로 미구현.
> 13. **경로 조회 훅** — `useTripRoutes`는 Query 캐시 대신 effect(플래그 OFF 화면·QueryClient 없는 기존 목 테스트에 새 의존을 만들지 않으려고). BE 개통 때 orval 훅으로 교체.
> 14. **Figma** — DEC-U10-19 ①~⑤를 캔버스 1228:1045 **U10 검토 밴드**(라벨 4854:2795, y=19950)에 9프레임으로 작도(정본 in-place 수정 없음, figma-qa 9/9 PASS). 정본 이식은 사람 검토 뒤.

> **[개정 · 2026-10-20 · TRIP-1486 — 여행별 일시 중지 스위치 구현]** (커밋 `90c545781` BE `USER_PAUSE` · `6524f3983` FE) 원문은 그대로 두고, 이 기능이 더한 표면만 적는다. 근거: TRIP-1486 구현 결정(사용자 인터뷰 2026-10-20) — **요구사항 근거로 인용하지 않는다.** 규칙은 `business-rules.md` 의 같은 날짜 개정 블록(BR-U10-49~52).
>
> 1. **i01 스위치 줄(§3 i01 허브)** — 안내 띠 아래에 *자동 기록 상태 줄 + 스위치* 한 줄을 더한다. **노출 = 플래그 ON ∧ (ARMED ∨ paused)**; 다른 MANUAL 사유·EXPLAINER 에서는 줄이 없다. **안내 띠(강등 안내)와 둘 다 보일 수 있고 안내 위·스위치 아래**다. 카피: 제목 「자동 기록」 **고정**(상태가 바뀌어도 제목은 안 바뀐다), 부제만 바뀐다 — 켜짐 「여행 날짜 동안 방문과 다닌 길을 기록해요」 / 일시 중지 「일시 중지했어요 · [도착]으로 직접 남겨요」. **줄 전체가 하나의 스위치로 눌린다**(터치 영역 보강). 스위치는 공용 `shared/ui/Toggle`. 일시 중지는 강등이 아니므로 안내 띠를 만들지 않는다.
> 2. **testID(§5 추가)** — `execution-live-automation-switch-row` · `-switch-title` · `-switch-detail` · `execution-live-automation-switch`(공용 `Toggle` 의 testID, 손잡이는 `-thumb`).
> 3. **l06 'paused' 얼굴(§3 l06)** — 상태 알약 문구 「일시 중지」(꺼짐과 같은 회색 `bg-surface-strong text-muted`, 글자만 다름), 사유 줄 「이 여행은 일시 중지했어요」. `statusView` 의 `status:'paused'` 는 꺼짐으로 접히지 않는다.
> 4. **프리뷰 키** — `u10-switch-on` · `u10-switch-paused` · `u10-l06-paused`(`app/_dev/preview.tsx`). 통과형 시트 목 위의 스위치 줄은 jest 에서 항상 렌더되므로 실제 터치·덮임은 6-b 전용.
> 5. **Figma** — U10 검토 밴드: u10f 스위치 줄 켜짐 `4985:3306` · 일시 중지 `4987:3327`, u10d l06 일시 중지 변형 `4990:3348`(figma-qa 3회 PASS, 정본 무변경 단언 PASS). 비주얼 픽셀 대조는 구현 단계에서 못 했고 시뮬 스모크에서 육안으로 확인했다.
> 6. **코드 위치** — `shared/location/automation/arming.ts`(`tripPaused`) · `store.ts`(`pausedTrips`) · `engine.ts`(`setTripPaused`, `endReasonOf` 의 `'paused'→'USER_PAUSE'`) · `noticeCopy.ts`(`automationSwitchCopy`) · `statusView.ts` · `useLocationAutomation.ts`(`setPaused`: 동기 잠금 + 낙관적 표시) · `pages/live/live-itinerary/ui/LiveHubView.tsx`.
> 7. **§8 6-b 표에 더하는 행(표 원문은 수정하지 않는다)** — 12. **일시 중지 끄기** → 지오펜스·경로 해제, 열린 구간마다 END(`USER_PAUSE`) 보고(지오펜스+경로 두 구간이면 **2건**), 상태바 위치 화살표 사라짐, 부제 변경 · 13. **일시 중지 켜기** → 설명·권한 요청 없이 새 구간 START(**2건**) · 재무장 · 14. 스위치 줄을 누르든 안쪽 토글을 누르든 `setPaused` 가 **1회**만 불린다(중첩 Pressable 이중 호출은 jest 사각) · 15. 앱을 닫은 채 백그라운드 wake 가 와도 일시 중지가 되살아나지 않는다. 방법은 기존 표와 같다(실기/시뮬 + 서버 조회).
> 8. **알려진 한계(관측)** — 켜기 직후 OS 권한이 풀려 있으면 스위치가 잠깐 켜졌다 되돌아간다(낙관적 표시). 일시 중지 이전에 모은 원시 표본은 지우지 않아 다음 날 포그라운드 업로드에 실려 갈 수 있다.

> **[개정 · 2026-10-21 · TRIP-1520·TRIP-1521 — 토글·일시 중지 스위치 제거]** 규칙은 `business-rules.md` 의 같은 날짜 개정 블록. 원문·앞 개정 블록은 그대로 두고 이 블록이 우선한다.
>
> 1. **§3 i01 ③·j 풀 지도** — 「계획｜실제 토글」이 없다. 페이지가 동의 ∧ 그날 경로 있음일 때 `actualRoute` 를 `MapSheetShell`/`MapView` 에 늘 넘기고, `MapView` 는 기존대로 계획선을 흐리고 실제 점선을 얹는다. NFR PERF-U10-07 의 "토글 로컬 전환" 문장도 같은 날짜 개정으로 무효. 공용 `shared/map/RouteToggle`·`actualDistanceLabel` 은 삭제.
> 2. **§5 testID 폐기** — `execution-live-route-toggle-plan`·`-route-toggle-actual`·`-route-disabled-reason`·`-route-distance`, `record-map-route-*` 같은 접미. 2026-10-12 개정 11번의 토글 testID 줄은 무효.
> 3. **2026-10-20 개정 블록(TRIP-1486 일시 중지 스위치) 전체 무효** — 스위치 줄·testID·l06 paused 얼굴·프리뷰 키 `u10-switch-on`·`u10-switch-paused`·`u10-l06-paused`·§8 6-b 추가 행 12~15 모두 없다. FE 커밋 `6524f3983` 은 되돌렸다.
> 4. **Figma** — U10 검토 밴드에서 u10f 스위치 줄 2장(`4985:3306`·`4987:3327`)·u10d 일시 중지 변형(`4990:3348`)·u10e 「경로 없음」(`4862:3628`) 삭제. u10e `4862:2897`(허브)·`4862:3807`(기록 풀 지도)은 토글 줄을 걷고 「계획 동선 + 실제 경로 함께」로 이름을 바꿨다.
