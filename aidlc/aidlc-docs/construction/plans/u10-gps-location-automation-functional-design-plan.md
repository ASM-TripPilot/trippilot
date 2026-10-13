# U10 GPS·위치 자동화 — Functional Design Plan

> **유닛**: U10 GPS·위치 자동화 — **신설(2026-10-12 사용자 결정)**. 새 컴포넌트를 만들지 않고 기존 컴포넌트의 *위치 자동화 부분*을 확장한다(정확한 컴포넌트 집합은 Q20 — 아래 D-U10-3 참조).
> **스토리**: **신규 스토리 없음 — 부분 이관**(`unit-of-work-story-map.md` 2026-10-12 개정 블록). US-ONTRIP-01(자동 도착·이탈) · US-PLANB-13(실제 경로·토글 전체) · US-REC-03(GPS 방문 기록 전체) · US-REC-08(요약의 GPS 경로 부분) + U4 NFR MOBILE-U4-01/02(백그라운드 위치·`expo-task-manager`)
> **범위 주의(SCOPE.md 2026-10-12)**: 설계 문서 4단계(FD → NFR Req → NFR Design → Infra 증분)까지. 코드는 팀이 각 패키지에서 직접 개발한다
> **선행**: U0~U6 설계 종료(2026-08-24) + 팀 구현. U10은 **U0·U4·U5의 api·이벤트만 소비**하고 역방향 의존을 만들지 않는다 — 수동 체크인 경로는 U10 없이도 지금처럼 동작해야 한다(INV-4 폴백, `unit-of-work-dependency.md` 개정 블록)
> **작성**: 2026-10-12 · 이 문서는 **질문 게이트**다. FD 산출물은 아직 만들지 않는다

---

## 실장 우선 순위 (U5 선례 승계)

위가 이긴다. 아래가 위와 다르면 **아래를 정정 대상으로 기록**하고 위를 따른다.

1. **리포 실물** — `backend/modules/*`·Flyway 마이그레이션 · `frontend/src/*`·`frontend/app.config.ts` · `ai/src/trippilot/*`
2. **패키지 계약 정본** — `backend/docs/design/openapi.yaml` · `ai/docs/openapi.json` · `frontend/README.md`
3. **라이브 Figma**(화면 정본, 캔버스 `1228:1045`)
4. **기존 aidlc 산출물** — U0~U6 FD·NFR (상속, 재서술 금지)
5. inception 문서

> **예외 — 따르지 않고 사용자에게 올린다**: INV-1~4 · 위치 법정 로그 append-only · 위치정보법(LEGAL-01) · 앱스토어 심사 결정(TRIP-936)과 정면 충돌할 때.

---

## 1. 유닛 정의 초안

### 1.1 목적

여행 중 **앱을 열지 않아도** 방문 실적과 실제 동선이 쌓이게 한다(제품 원칙 2026-08-27: "여행 중 앱 상호작용 최소화 — happy path = 앱 안 열기"). 동시에 **위치 권한이 없거나 낮아도 아무 기능도 막히지 않는다**(MOBILE-U4-03 · BR-U4-36 — 수동 체크인·수동 위치 입력이 언제나 바닥이다).

### 1.2 포함 범위 (원 유닛 → U10 이관분)

| # | 기능 | 출처 스토리·규칙 | 원 유닛 | 현재 상태 |
|---|---|---|---|---|
| F1 | 지오펜스 **진입 → 자동 도착** | US-ONTRIP-01 정상 · BR-U4-36 | U4 | 계약·순수 매핑만, 네이티브 미배선(스텁) |
| F2 | 지오펜스 **이탈 → 자동 완료** | 제품 원칙(2026-08-27) — **정본(수동 [방문 완료])과 충돌** | U4 | 미설계(Q2) |
| F3 | 백그라운드('항상 허용') 위치 권한 + `expo-task-manager` | MOBILE-U4-01/02 | U4 NFR | 미구현 + TRIP-936 이 명시적으로 끔 |
| F4 | 실제 경로(GPS 발자취) 기록 + 계획 대비 토글 | US-PLANB-13 · BR-U4-41/42 · INV-U4-07/08 | U4 | 테이블 미실장 · 프런트 훅 삭제됨 |
| F5 | GPS 방문 기록 자동 저장 | US-REC-03 | U5 | 미구현(방문 체크 자체는 수동으로 실재) |
| F6 | 여행 요약의 "동의 구간 GPS 경로" | US-REC-08 일부 · BR-U5-43/55 | U5 | `distanceSource` 항상 `VISIT_LINE`(근사) |
| F7 | 위치 법정 로그 확장(새 수집·이용 경로) | LEGAL-01 · LEGAL-U4-01~05 · INV-L4 | U0 | 파사드는 `PHOTO_EXIF`·`REPLAN_ORIGIN`만 |
| F8 | GPS 의존 Plan-B 신호원(체류 초과·이동 지연) | US-PLANB-02 (c)(d) · US-ONTRIP-01 · BR-U4-37 | U4 | **신호원 0** — `DELAY`를 만드는 경로가 없다(Q10) |

### 1.3 범위 밖 (명시)

- 오프라인 방문 기록·동기화 충돌 UI — 2026-09-11 보류 결정 유지(단, 자동 이벤트의 짧은 재전송은 Q18에서 묻는다)
- 걸음 수 — DEC-U4-8 상속(US-PLANB-13 문면의 "걸음 수"는 U4에서 이미 뺐다. 재질문하지 않는다)
- 즉석 방문(계획에 없는 장소) 자동 감지 — Q19
- 위치 기반 추천(현위치 주변) — 이미 포그라운드 단발 위치로 동작, U10 대상 아님

### 1.4 컴포넌트·의존 (초안)

| 대상 | U10이 확장하는 것 | 근거 |
|---|---|---|
| **클라이언트 위치 계층** (`frontend/src/shared/location/`) | 지오펜스 등록·해제, 백그라운드 태스크, 권한 단계 상태, 경로 샘플링·다운샘플 | 본체. 판정 대부분이 기기에서 일어난다(Q11) |
| **C12 Travel Archive** (`backend/modules/archive`) | 자동 도착/완료 수용(`source`), 실제 경로 저장(Q4·Q5), 요약 `ROUTE` 승격 | `visit_check` 실소유 모듈 |
| **C9 Plan-B Detection** (`backend/modules/planb-detection`) | `DELAY`(체류 초과·이동 지연) 신호원 | Q10 |
| **C1 Auth** (`backend/modules/auth` — 위치 동의 3층·법정 로그) | `LocationCollectionSource`·`LocationPurgeScope` 확장, 철회 시 경로 파기 | ⚠ `unit-of-work.md` 개정 블록은 **C2**라고 적었으나 위치 동의는 C1(auth 모듈)에 있다 → Q20 |
| C14 Notification (U6) | 이탈/완료 제안·강등 알림이 필요할 때만 구독 | 선택 의존(◆) |
| C10 Itinerary Recalculation (U4) | `actual_route_point` 소유를 유지할지 여부만(Q5) | DEC-U5-6 |

의존: **U0 ●**(동의·법정 로그·권한 프레임) · **U4 ●**(방문 체크 흐름·트리거) · **U5 ●**(경로·기록·요약) · **U6 ◆**(알림, 필요 시) · U8 무관 → U0~U6 이후 U8과 병렬.

---

## 2. 현재 구현 기준선 (2026-10-12 실측)

### 2.1 있는 것

| 자산 | 경로 | 의미 |
|---|---|---|
| 지오펜스 **계약 + 순수 매핑** | `frontend/src/shared/location/geofence.ts` | `buildGeofenceRegions(slots, date)`(좌표 있는 슬롯만) · `geofenceArriveRequest`(항상 `source: AUTO_GEOFENCE`) · **`registerGeofences` → `{armed:false, reason:'native-geofencing-not-wired'}` 스텁** · `clearGeofences` no-op. 반경 `DEFAULT_RADIUS_M = 120`은 **정본 근거 없는 자리값**(주석 명시). 호출처 = 테스트뿐(화면 배선 0) |
| 포그라운드 단발 측위 | `frontend/src/shared/location/readDevicePosition.ts` | 권한 **조회만**(팝업 안 띄움) → 5분 이내 lastKnown → current, 5초 한도, 실패는 `null`. 재계획 GPS 기준점(`pages/live/planb-request/model/useReplanGpsOrigin.ts`)이 사용 |
| 권한 요청 | `frontend/src/pages/onboarding/onboarding-location/ui/LocationPage.tsx` (라우트 `frontend/app/(onboarding)/location.tsx`) | `requestForegroundPermissionsAsync`만. **백그라운드 요청 코드 0** |
| 위치 동의 토글 | `frontend/src/shared/location/consentPutBody.ts` · `useLocationConsent.ts` · `pages/settings/settings-location` | **토글 하나가 L2·L3를 같은 값으로**(BR-U6-29). L1(OS 권한)은 미러 |
| 수동 도착·완료 | `frontend/src/pages/live/live-itinerary/ui/LiveItineraryPage.tsx` | `visitCheck.arrive({... source: MANUAL})` · `visitCheck.complete(id)` |
| 방문 체크 서버 | `backend/modules/archive/.../domain/VisitCheck.kt` · `VisitCheckService.kt` · openapi `/trips/{tripId}/visits*`(arrive · complete · skip · skip-planned · PATCH 시각 보정 · photos) | `CheckSource { AUTO_GEOFENCE, MANUAL }` 이미 존재 — **단 도착에만 붙는다**(완료 출처 필드 없음). 체류 = `completedAt − arrivedAt` 파생. `VisitChecked` 이벤트 발행 |
| 위치 동의 3층 + 법정 로그 | `V1.3__auth_location.sql`(`location_consent_state` L1 미러·L2 `legal_consent`·L3 `gps_recording_opt_in` · `location_legal_log` append-only, `event_type` 6종) · `V2.49`(6개월 만료 정리 SECURITY DEFINER 함수) | |
| 법정 로그 파사드 | `backend/modules/auth/.../api/LocationLegalLogFacade.kt` | `recordCollection`·`recordPurge`만. 출처 `PHOTO_EXIF`·`REPLAN_ORIGIN`, 파기 범위 동 2종. 주석: **"좌표를 쓰거나 내보내는 기능이 생기면 그 기능과 같은 PR에서 대응 메서드를 연다"** |
| 철회 시 단발 좌표 파기 (TRIP-992) | `V2.56__replan_origin_purged.sql` · `LocationConsentService` · `itinerary-recalculation/.../LocationLegalConsentRevokedSubscriber.kt` · `ReplanApiIT`·`ReplanOriginPurgeIT` | **TRIP-992 완료** — 동의 없으면 GPS 기준점 버리고 사다리 강등, 동의 시 수집 로그, 철회 시 `PURGED` + 파기 로그 |
| 사진 EXIF 좌표 게이팅 | `V2.33__visit_photo_meta.sql` · `archive/.../VisitRecordService.kt` | L3 없으면 받지도 저장하지도 않음 + `COLLECTION`/`PURGE` 로그 |
| Plan-B 트리거 모델 | `planb-detection/.../domain/PlanBTrigger.kt` | `TriggerKind { WEATHER, CLOSURE, DELAY, MANUAL }` — "체류 초과는 DELAY 의 payload 변형" |
| 요약 거리 출처 라벨 | `frontend/src/features/reflection/model/summaryView.ts` | `ROUTE`→"경로" / `VISIT_LINE`→"근사" — 1차는 늘 `VISIT_LINE` |

### 2.2 없는 것

| 빈자리 | 실측 |
|---|---|
| `expo-task-manager` | `frontend/package.json` 에 없음 (MOBILE-U4-01 미이행) |
| 'always' 권한 설정 | `frontend/app.config.ts` `expo-location` 플러그인: `locationAlwaysPermission: false` · `locationAlwaysAndWhenInUsePermission: false` — 주석 "'항상 허용' 위치는 쓰지 않는다(**TRIP-936**)". 커밋 `895694c4a`(출시 빌드 설정 — 권한 문구 정리) · 묶음 PR #686(TRIP-935 App Store 첫 심사 블로커) |
| Android 백그라운드 위치 | `android` 블록에 권한 선언 없음 |
| `actual_route_point`(실제 경로) | 마이그레이션 없음(최신 V2.62까지 부재). U4 FD §3.3에만 설계. 선재 dbml은 `gps_track(polyline·distance_m·steps)` — 모델이 다르다 |
| 프런트 실제 경로 훅 | `features/execution/model/useActualRoute.ts`·`actualDistance.ts` 는 TRIP-746(i01 지도 허브 재작성, `e7f7392fd`)에서 **삭제** |
| `DELAY` 신호원 | `TriggerService.evaluate` 호출처 = `WeatherTriggerService` 하나뿐. `TriggerController` 는 `GET`·`weather-check`·`dismiss` 만. `VisitChecked` 구독자 0 → **BR-U4-37(체류→DELAY 입력)이 배선돼 있지 않다** |
| 완료 출처 | `visit_check` 에 완료 출처 칸 없음 — 자동 완료를 수동과 구분할 수 없다 |
| AI 위치 사용 | `ai/docs/openapi.json` 에 기준점·현위치 필드 없음 — 좌표가 AI로 나가는 경로 0(파사드 주석 2026-09-14 실측과 일치). U10이 이것을 바꾸지 않는 한 `PROVISION` 로그 불필요 |

---

## 3. 정본 간 충돌·드리프트 (D-U10-\*)

| ID | 내용 | 처리 |
|---|---|---|
| **D-U10-1** ★ | **자동 완료 vs 수동 완료 정본.** 제품 원칙(2026-08-27)은 이탈 자동 완료를 지향하는데, U4 정본은 i04 흡수 후 i01 `[방문 완료]` 버튼을 기능화해 완료를 수동으로 못박았다(`frontend-components.md` TRIP-396 소급 기록 · `business-logic-model.md` §방문 완료) | **Q2** |
| **D-U10-2** ★ | **'항상 허용'이 심사 결정으로 꺼져 있다.** MOBILE-U4-02는 켜라고 했고, TRIP-936은 출시 빌드에서 껐다. 제품 원칙(앱 안 열기)은 백그라운드 없이는 성립하지 않는다 | **Q1·Q13·Q14** |
| **D-U10-3** | `unit-of-work.md` 개정 블록의 컴포넌트 **"C9·C12·C2"** — C2는 User Profile이고 위치 동의·법정 로그는 **C1 Auth(auth 모듈)** 에 있다 | **Q20** (정정 상신) |
| **D-U10-4** | `actual_route_point` **소유 U4 확정(DEC-U5-6)** 이지만 미실장이고, 그 1차 근거("Plan-B 기준점 계산")는 TRIP-992에서 단발 좌표(`replan_session.origin`)로 이미 해결됐다(LEGAL-U4-05: 일회성 위치는 경로에 적재 금지) | **Q5** |
| **D-U10-5** | **DELAY 트리거 신호원 0.** US-PLANB-02 (c)(d)·BR-U4-37·C9 책임표에 있지만 코드 경로가 없다 — U6 BR-U6-11(철회 시 이동 지연 알림 중단)은 존재하지 않는 알림을 끈다 | **Q10** |
| **D-U10-6** | 지오펜스 반경 **120m는 근거 없는 자리값**(스텁 주석 자인). 정본 어디에도 반경·정확도 임계가 없다 | **Q7** |
| **D-U10-7** | **DEC-U4-7·MOBILE-U4-05("연속 위치 추적 없음 · 앱을 켜 둔 구간만")** 과 제품 원칙이 충돌 — 앱을 안 열면 경로가 거의 비게 된다 | **Q3** |
| **D-U10-8** | 2026-09-11 오프라인 기록 보류 ↔ 지오펜스 이벤트는 회선이 없을 때도 발생한다 | **Q18** |
| **D-U10-9** | 법정 로그 파사드는 `COLLECTION`만 덮는다. 지오펜스 판정은 서버에 좌표를 안 보내더라도 **기기에서의 위치 "이용"** 이다 — 로그 대상 여부가 정본에 없다 | **Q12** |
| **D-U10-10** | iOS privacy manifest `PreciseLocation` 목적은 `AppFunctionality` 1종. 백그라운드 도입 시 App Privacy 답변·`NSLocationAlwaysAndWhenInUseUsageDescription` 문구가 새로 필요(지금은 플러그인이 일부러 지움) | NFR Req 단계 + Q14 |
| **D-U10-11** | O-U4-1(리전 상한 초과 시 선택 정책) 미결 상태로 남아 있다 | **Q9** |
| **D-U10-12** | `CheckSource` 가 도착에만 붙어 완료 출처를 기록할 수 없다 | **Q6** |

---

## 4. 실행 계획

- [x] 1. 유닛 컨텍스트 — `unit-of-work.md`·`unit-of-work-story-map.md`·`unit-of-work-dependency.md` 2026-10-12 개정 블록 · `stories.md` 에픽 F·G·H(US-ONTRIP-01 · US-PLANB-02/03/10/13 · US-REC-01/03/08) · `requirements.md` LEGAL-01·FR-ONBOARD-02·FR-NOTIF-01·NFR-DATA-03 · `components.md` C1·C2·C9·C12
- [x] 1b. **기존 자산 실측** — §2 기준선(프런트 위치 계층·권한·app.config · 백엔드 archive·auth·planb-detection · 마이그레이션 V1.3/V2.21/V2.33/V2.49/V2.56 · ai openapi)
- [x] 1c. **상속 설계 대조** — U4 FD(BR-U4-36~42 · INV-U4-07/08 · DEC-U4-7/8 · O-U4-1) · U4 NFR(MOBILE-U4-01~07 · LEGAL-U4-01~05) · U5 FD(DEC-U5-6/12 · BR-U5-12/43/53/55 · O-U5-8) · U6 FD(BR-U6-11/29~31) → 드리프트 **D-U10-1~12**
- [x] 1d. **라이브 Figma 대조** — i 밴드(i01 허브 지도·방문 카드, 재번호 i01~i10 — 옛 코드로 찾지 말 것), j01 `manual-checkin`, l06 위치 동의(permission-denied 포함). 권한 승격 프리프롬프트·강등 배너·자동 기록 출처 표시의 **프레임 유무**만 확인(새 프레임 작도는 Q21 답 이후 `figma-build` 소관)
- [x] 2. **질문 Q1~Q22 답변 수집**(아래 §5) — 모호한 답이 있으면 `u10-gps-location-automation-functional-design-clarification-questions.md` 생성 후 재확인
- [x] 3. `business-logic-model.md` — **DEC-U10-\*** · 자동화 단계 상태기계(권한 없음 → 포그라운드 → 백그라운드, 강등 전이 포함) · 지오펜스 생애주기(무장·리전 선택·해제) · 도착/완료 판정 흐름(진입·체류·이탈) · 경로 샘플링→다운샘플→업로드 흐름 · DELAY 신호 판정 흐름 · 동의 철회 파기 흐름 · 갭 **G-U10-\***
- [x] 4. `domain-entities.md` — `visit_check` 확장(완료 출처) · 실제 경로 엔티티(Q4 결과: 점열 or 일 단위 폴리라인) · 보존·파기 규칙 · `LocationCollectionSource`/`LocationPurgeScope` 확장 · 이벤트(`GeofenceArrived`? 신설 여부 포함) · **INV-U10-\*** · 소유 경계표(U4↔U5↔U10↔U0)
- [x] 5. `business-rules.md` — **BR-U10-\***(반경·정확도·체류·이탈·리전 상한·강등·오탐 정정·법정 로그) + **PBT-U10-\***(예: 동의 없으면 경로 행 0 · 자동 완료 시각 ≥ 도착 시각 · 리전 수 ≤ 상한 · 강등 후 무장 0) + 미결 **O-U10-\***
- [x] 6. `frontend-components.md` — 위치 계층 모듈(`shared/location`) 확장 · 백그라운드 태스크 등록 위치(FSD 층 — 태스크는 모듈 최상위 `defineTask` 필요) · 권한 승격 프리프롬프트 · i01·j 화면 변경점 · testID · 6-b 실기 전용 항목(지오펜스 발화는 jest 원리적 사각)
- [x] 7. 정합 검증 — U4 사후 정정(BR-U4-36/37/41 · DEC-U4-7 · MOBILE-U4-01/02/05 · O-U4-1) · U5 사후 정정(DEC-U5-6 · BR-U5-55) · U6(BR-U6-11) · `unit-of-work.md` C2→C1 · 인셉션 정정 상신 목록
  - 1d 결과(2026-10-12, `get_metadata` 읽기 전용): 승격 설명·"자동 기록" 표시·강등 1줄·실제 경로 레이어/토글 **프레임 0**, j01 `manual-checkin` 문구는 U10 MANUAL과 일치, l06 사용처에 자동 기록·경로 없음 → FD `business-logic-model.md` §14
  - 2: 명확화 파일 불필요 — Q1=B·Q3=B 직접 선택, 나머지 추천안. Q8의 "Q2=C 보조 규칙 병행" 부분 질문은 미답 → 설계자 판단으로 채택(DEC-U10-2 · O-U10-3)
  - 7: U4(FD 4종·NFR 2종)·U5(FD 2종)·U6(FD 1종)에 `[개정 · 2026-10-12 · U10 FD]` 블록 추가(append-only). `unit-of-work.md` C2→C1은 이미 반영돼 있었다(D-U10-3 해소). 인셉션 정정 상신 목록 = FD `business-logic-model.md` §15
- [ ] 8. 완료 메시지 → **승인 게이트** → `audit.md`·`aidlc-state.md`
- [ ] 9. (후속 단계) NFR Requirements — 배터리·심사(2.5.4·5.1.1·5.1.5)·Android Play 백그라운드 위치 신고·privacy manifest/App Privacy · NFR Design · Infra 증분(`shared-infrastructure.md` — 신규 인프라가 없으면 "변경 없음" 기록)

---

## 5. 질문 — `[Answer]:` 칸을 채워 주세요

> `Q1=C Q2=A ...` 처럼 한 줄로 답해도 됩니다. **추천안으로 전부 밀어도 됩니다.** 모르면 `Qn=니가 판단해` — 근거를 대고 정한 뒤 미결(O-U10-\*)로 남깁니다.

### A. 비즈니스 로직

#### Q1. 자동화를 어디까지 하나 — 백그라운드 위치를 쓰나 (★ 핵심 · D-U10-2)

제품 원칙(앱 안 열기)은 백그라운드 위치 없이는 성립하지 않는다. iOS 지오펜스(region monitoring)는 앱이 꺼져 있을 때 깨우려면 '항상 허용'이 필요하고, `expo-location` 의 `startGeofencingAsync` 도 백그라운드 권한을 요구한다. 그런데 TRIP-936은 첫 심사를 위해 '항상 허용'을 껐다.

A) **포그라운드 전용** — '항상 허용' 없이, 앱이 열려 있는 동안만 다음 예정지 근접을 판정해 자동 도착을 찍는다. 새 권한·심사 위험 0. 대신 원칙("앱 안 열기")은 달성하지 못한다

B) **백그라운드 지오펜스 전면 도입** — 'always' 를 정식 요청하고, 거부하면 수동으로 강등. 원칙에 가장 가깝지만 다음 심사 빌드에 위험이 그대로 실린다

C) **단계형(추천)** — 기본은 A(when-in-use, 지금 앱 그대로). 사용자가 여행 중 자동 기록을 켜는 시점에만 'always' 로 승격을 요청하고(Q13), 승인되면 백그라운드 지오펜스·경로를 켠다. 거부·미요청이면 A로 동작

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 권한 없는 사용자의 경험이 지금과 같아(역방향 의존 0 · INV-4), 심사 위험을 "기능을 실제로 쓰는 사람"에게만 국한할 수 있다. 심사 노트에 "사용자가 켠 기능에서만 요청"을 쓸 수 있어 2.5.4·5.1.5 정당화가 쉬워진다.

[Answer]: B

#### Q2. 방문 완료를 자동으로 찍나 — 지오펜스 이탈 (★ 핵심 · D-U10-1)

현재 정본은 i01 `[방문 완료]` 수동 버튼이다. 제품 원칙은 이탈 자동 완료를 지향한다. 지나가기만 해도 도착·완료가 찍히는 오탐이 가장 큰 위험이다.

A) **이탈 → 자동 완료(추천)** — 최소 체류(Q8)를 채운 뒤 리전을 벗어나면 `completedAt = 이탈 시각` 으로 확정한다. 화면엔 "자동 기록" 표시 + 사후 수정·되돌리기(Q17). 수동 버튼은 폴백으로 남긴다. U4 정본(BR-U4-37 주변·frontend-components)을 사후 개정한다

B) **이탈 → 완료 제안 알림** — 이탈 시 로컬 알림 "○○ 방문 완료로 기록할까요?" 를 띄우고 탭 1회로 확정. 오탐은 막지만 원칙(앱 안 열기)에 반 걸음 못 미친다

C) **다음 장소 도착 시 직전 장소 자동 완료** — 이탈 감지 없이, 다음 슬롯에 자동 도착하면 직전 미완료 슬롯을 그 시각 기준으로 완료 처리. 구현이 단순하지만 마지막 장소는 영원히 수동이고 체류 시간이 이동 시간까지 먹는다

D) **현 정본 유지(수동 완료만)** — 자동은 도착만

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 원칙을 정면으로 따르고, 오탐은 최소 체류 + 사후 정정으로 흡수한다. 완료 시각은 기록(US-REC-01 "수정 가능")이라 틀려도 되돌릴 수 있다. C는 A가 이탈을 놓쳤을 때의 **보조 규칙**으로 같이 쓸 수 있다(Q8에서 함께 확정).

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

#### Q3. 실제 경로를 어떻게 모으나 — 연속 추적 여부 (D-U10-7)

DEC-U4-7·MOBILE-U4-05는 "연속 위치 추적 없음 · 앱을 켜 둔 구간만"이다. 원칙대로 앱을 안 열면 경로가 거의 비게 된다.

A) **포그라운드 구간만**(U4 정본 그대로) — 배터리·심사 부담 0, 경로는 성기다. 화면에 한계 각주(BR-U4-41)

B) **백그라운드 저전력 연속 기록** — 'always' 승인 + L3 동의 + 여행 기간 안에서만, 저정확도(수십~100m)·이동 거리 필터·지연 일괄 전달로 모은다. iOS 상태바 위치 표시가 여행 내내 뜬다

C) **단계형(추천)** — Q1=C 와 짝. 'always' 승인 시 B, 아니면 A. 어느 쪽이든 지오펜스 도착/이탈 지점은 경로에 포함

D) **경로 미도입** — 방문점만 남기고 US-PLANB-13·US-REC-03의 "이동 경로"는 계속 degrade(BR-U5-55)

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 경로는 "기록"이라 정밀도보다 존재가 중요하고, 저전력 모드로 배터리 예산을 지킬 수 있다. B 단독은 'always' 를 거부한 사람에게 아무것도 안 주므로 C. MOBILE-U4-05·DEC-U4-7은 사후 개정 대상.

[Answer]: B

### B. 도메인 모델

#### Q4. 실제 경로의 저장 모델 — 어디에, 어떤 모양으로 (★ 핵심 · 프라이버시)

U4 설계는 서버 `actual_route_point(tripId·recordedAt·lat·lng·accuracyM)` 점열, 선재 dbml은 `gps_track(polyline·distance_m)`. 사진은 이미 "기기 로컬 + 서버 메타만" 모델이다(NFR-DATA-03).

A) **서버 원시 점열** — U4 §3.3 그대로. 서버가 거리·폴리라인을 모두 계산. 하루 수백~수천 행, 파기 대상이 가장 크다

B) **기기 로컬 전용** — 서버엔 경로를 안 보낸다. 거리 숫자만 요약에 올린다. 재설치·기기 변경 시 경로 유실(사진과 같은 트레이드오프)

C) **기기에서 다운샘플한 일 단위 폴리라인 + 거리만 서버 저장(추천)** — 원시 점은 기기에서 다운샘플 후 폐기. 서버 행은 (여행, 날짜)당 1~수 행

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 요약(US-REC-08)·기록 화면이 서버 데이터로 그려지는 지금 구조와 맞고(B는 요약 생성 경로를 둘로 쪼갠다), 원시 좌표를 서버에 쌓지 않아 파기·유출 면적이 작다. PERF-U4-04(표시 전 다운샘플)를 저장 시점으로 당기는 것뿐이다. `distanceSource: ROUTE` 승격(BR-U5-43)의 원천이 된다.

[Answer]: C *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

#### Q5. 실제 경로의 소유 모듈 (D-U10-4)

DEC-U5-6은 "Plan-B 기준점 계산의 1차 소비자가 U4"라서 U4(`itinerary-recalculation`) 소유로 남겼다. 그런데 기준점은 TRIP-992에서 단발 좌표로 해결됐고, LEGAL-U4-05는 일회성 위치를 경로에 적재하지 말라고 한다. 지금 경로를 읽을 곳은 기록·요약(U5)뿐이다.

A) **`archive`(C12) 소유(추천)** — 방문 체크·사진 메타·EXIF 파기와 같은 모듈. DEC-U5-6 을 사후 개정

B) **`itinerary-recalculation`(U4) 유지** — 결정 그대로, U5는 파사드로 읽기

C) **`location` 모듈 신설** — 지오펜스 규칙·경로·위치 법정 로그 소비를 한곳에

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 소비자·파기 흐름(동의 철회 → `PHOTO_EXIF` 파기)이 이미 archive 에 있다. C는 "컴포넌트 신설 없음" 이라는 유닛 정의와 어긋나고 모듈 하나를 더 만든다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

#### Q6. 자동 기록의 출처를 어디까지 남기나 (D-U10-12)

`CheckSource { AUTO_GEOFENCE, MANUAL }` 는 도착에만 붙는다.

A) **완료 출처 칸 추가(추천)** — `visit_check` 에 완료 출처(`AUTO_GEOFENCE_EXIT` · `AUTO_NEXT_ARRIVAL` · `MANUAL`) 칸. 사용자가 시각을 고치면 출처는 그대로 두고 수정 사실만 남긴다(기존 `updatedAt`)

B) **기존 `source` 하나로 충분** — 도착이 자동이면 완료도 자동으로 간주

C) **출처를 남기지 않는다** — 화면 "자동 기록" 표시는 클라이언트 상태로만

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 체류 = 완료 − 도착이 DELAY 판정 입력(BR-U4-37)이라 완료가 추정인지 실측인지 서버가 알아야 한다. 오탐 정정(Q17)과 품질 지표("자동 완료가 몇 % 수정됐나")의 근거도 이 칸이다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

#### Q7. 보존 기간·파기 (프라이버시)

A) **여행 기록과 같은 수명 + 철회 시 즉시 파기(추천)** — 여행/계정 삭제 시 CASCADE, L3 철회 시 해당 계정 경로 전량 파기 + `PURGE` 로그(`LocationPurgeScope` 에 경로 범위 추가). 기존 `PHOTO_EXIF`·`REPLAN_ORIGIN` 과 같은 패턴

B) **여행 종료 후 N일(예: 90일) 뒤 폴리라인 파기, 거리 숫자만 영구**

C) **여행 종료 즉시 파기** — 기록 화면은 근사선으로 되돌아감

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 경로의 수집 목적이 "여행 기록 보관"이라 목적 달성 시점이 여행 기록 삭제 시점이다(위치정보법 목적 달성 후 파기 — LEGAL-01은 출시 전 법무 확인 대상으로 남긴다). 파기 경로를 새로 만들지 않고 TRIP-992 패턴을 그대로 쓴다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### C. 업무 규칙

#### Q8. 도착·완료 판정 임계 — 반경·정확도·최소 체류 (D-U10-6)

정본 값이 없다. iOS 지오펜스는 셀·와이파이 기반이라 실효 반경이 100m 안쪽으로는 잘 안 내려가고, 발화가 수십 초~수 분 늦을 수 있다.

A) **반경 150m · 정확도 100m 초과 시 자동 보류 · 도착은 진입 후 3분 체류로 확정(도착 시각은 진입 시각으로 소급) · 완료는 최소 체류 10분 + 이탈(추천)**

B) **반경 100m · 진입 즉시 도착 · 완료는 이탈 즉시** — 반응은 빠르나 지나가기 오탐이 많다

C) **POI 카테고리별 반경**(공원·시장 넓게, 카페 좁게) — 데이터 근거(POI 면적)가 없어 결국 값을 지어내게 된다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 값 자체는 실측 조정 대상(O-U10-\*로 남김)이고, 지금 정할 것은 **규칙의 모양**(정확도 미달 보류 · 도착 체류 확정 · 완료 최소 체류)이다. 120m 자리값은 이 답으로 대체한다. Q2=C(다음 도착 시 직전 완료)를 보조 규칙으로 함께 쓸지도 이 답에 적어 주세요.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

#### Q9. 지오펜스 리전 상한 정책 (O-U4-1 해소)

iOS는 앱당 20개, Android는 100개.

A) **당일 남은 슬롯 중 다음 N개(최대 10) — 도착/완료/건너뛰기마다 다시 고른다(추천)**

B) **다음 1개만** — 단순하지만 순서를 바꿔 방문하면 놓친다

C) **당일 전체** — 하루 슬롯이 20을 넘기 어려워 당장은 안 걸리지만 상한 규칙이 없다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 순서가 바뀌어도(현장에서 흔함) 잡히고, 상한의 절반으로 다른 앱·숙소 리전 여유를 남긴다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

#### Q10. 체류 초과·이동 지연(DELAY) 신호를 누가 만드나 (D-U10-5)

`DELAY` 를 만드는 코드 경로가 없다. `VisitChecked` 를 구독하는 곳도 없다.

A) **서버 판정 — 방문 체크 시각만으로(추천)** — planb-detection 이 `VisitChecked`(도착·완료)를 구독해 계획 시각과 비교한다. "체류 초과" = 완료가 계획 종료 + 임계 초과로 다음 고정 일정 위협, "이동 지연" = 다음 슬롯 계획 시각 + 15분(US-PLANB-02 기본) 지나도 도착 없음(스케줄러). 좌표를 서버로 보내지 않는다

B) **클라이언트 판정 후 신호 POST** — 기기가 지연을 계산해 서버에 신호를 올린다. 기기가 꺼져 있으면 아무 일도 없다

C) **U10 범위 밖** — U4 후속으로 남긴다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 좌표 없이 시각만 쓰므로 위치 법정 로그·동의 축이 늘지 않고, 자동 도착/완료(F1·F2)가 들어오는 순간 입력 품질이 올라간다. 다만 "이동 지연" 을 "도착 기록 없음" 으로 판정하면 수동 사용자에게 허위 알림이 될 수 있어, **자동 도착이 무장된 여행에만** 켤지 함께 정해야 한다(U6 BR-U6-11과 정합).

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### D. 데이터 흐름

#### Q11. 지오펜스 판정을 어디서 하나 (★ 프라이버시)

A) **기기에서 판정, 서버엔 결과만(추천)** — 리전은 기기가 이미 받은 일정 좌표로 만든다(`buildGeofenceRegions`). 서버로는 `arrive`/`complete`(출처 = 자동)만 간다 — 좌표 0

B) **기기가 좌표를 주기 보고, 서버가 판정**

C) **혼합** — 기기 판정 + 판정 당시 좌표·정확도를 증적으로 함께 전송

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 서버가 좌표를 받지 않으면 "수집" 면적이 경로(Q4)로만 한정된다. 기존 계약(`ArriveRequest.source=AUTO_GEOFENCE`)이 이미 이 모양이라 API 변경이 최소다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

#### Q12. 위치 법정 로그를 어디까지 남기나 (D-U10-9)

A) **경로 수집 세션 시작·종료에 `COLLECTION` 1건씩(LEGAL-U4-02 그대로) + 지오펜스 무장 구간 시작·종료에 `USE` 1건씩(추천)** — 원시 좌표 금지(LEGAL-U4-03), 자동 도착 1건마다 남기지 않는다

B) **자동 도착/완료 1건마다 `USE`**

C) **서버가 좌표를 받는 경우(경로)만 `COLLECTION`** — 기기 내 판정은 로그 대상 아님

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 기기 내 판정도 위치정보 "이용"으로 볼 여지가 있어 보수적으로 남기되, 행 폭증 없이 구간 단위로. 파사드 주석("좌표를 쓰는 기능이 생기면 같은 PR에서 대응 메서드를 연다")에 따라 `USE` 메서드를 이 유닛에서 연다. **최종 해석은 LEGAL-01 법무 확인 대상**으로 O-U10에 남긴다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### E. 통합 지점 (OS · 앱스토어)

#### Q13. '항상 허용' 권한을 언제·어떻게 요청하나

iOS는 when-in-use를 먼저 받아야 always 승격을 물을 수 있고, Android 10+는 백그라운드 위치를 별도 요청(설정 화면 이동)해야 한다.

A) **여행 중 첫 진입 시 기능 설명 프리프롬프트 → 승격 요청(추천)** — 온보딩은 지금처럼 when-in-use만. 여행 기간에 i01 허브에 처음 들어올 때 "앱을 닫아도 방문을 자동으로 기록해요" 프리프롬프트 1장, 동의하면 OS 승격 요청. 거절은 정상 경로(MOBILE-U4-03)

B) **온보딩에서 바로 always 요청**

C) **설정 화면(l06) 토글에서만** — 사용자가 찾아 들어가야 한다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 필요한 순간에 맥락과 함께 묻는 것이 승인율·심사 양쪽에 유리하다(5.1.1 — 목적을 설명한 뒤 요청). B는 TRIP-936이 피한 바로 그 형태다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

#### Q14. 앱스토어 심사 위험을 어떻게 다루나 (★ TRIP-936)

TRIP-936은 첫 심사에서 always 를 껐다. 다시 켜면 심사에서 2.5.4(백그라운드 위치는 목적에 맞게만), 5.1.1(데이터 수집 정당화·용도 문구), 5.1.5(위치는 기능과 직접 관련될 때만)를 근거로 반려될 수 있다.

A) **별도 업데이트 버전으로 분리 출시(추천)** — 백그라운드 기능을 기능 플래그 뒤에 두고, 켜는 빌드는 심사 노트(사용 시나리오 · 사용자가 켜는 지점 · 끄는 방법) + 시연 영상 + 용도 문구 정비 + App Privacy·privacy manifest 갱신을 함께 제출. 반려돼도 Q1=C 의 포그라운드 경로가 그대로 남는다

B) **다음 정기 빌드에 바로 포함** — 별도 준비 없이

C) **iOS는 포그라운드만, 백그라운드는 Android 먼저**

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 반려가 다른 기능 출시를 막지 않게 격리한다. 플래그가 꺼진 빌드는 지금 앱과 권한 표면이 같다. (참고: Android 출시 시 Play Console 백그라운드 위치 신고·시연 영상이 별도로 필요 — NFR Req에서 다룬다)

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

#### Q15. 동의 축을 늘리나

지금은 l06 토글 하나가 L2(법정)·L3(GPS 옵트인)를 같이 움직인다(BR-U6-29). LEGAL-U4-01은 "실제 경로는 L3에 걸고 새 축을 만들지 않는다"고 했다.

A) **축 신설 없음 — L3 + OS 권한 단계가 곧 스위치(추천)** — 앱 토글 ON + when-in-use = 포그라운드 자동, + always = 백그라운드 자동·경로. 동의 고지 문구에 "백그라운드 자동 방문 기록·이동 경로" 를 추가

B) **'백그라운드 자동 기록' 앱 토글 신설(L4)** — OS 권한과 별개로 앱에서 끌 수 있게

C) **경로 기록만 별도 토글** — 자동 도착은 L3, 경로는 L4

X) Other (please describe after [Answer]: tag below)

> 추천 근거: OS 설정이 이미 끄는 방법을 준다(심사관도 이 경로를 본다). 축을 늘리면 BR-U6-29의 "하나의 토글" 결정과 l06 화면을 다시 열어야 한다. 다만 O-U5-8(EXIF가 L3 목적 범위에 맞나)처럼 **목적 범위가 넓어지는 것**은 법무 확인 대상으로 함께 올린다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### F. 오류 처리

#### Q16. 권한이 강등되면 (always → when-in-use, 정밀 → 대략 위치, 앱 토글 OFF)

A) **즉시 무장 해제 + 수동 강등 + 여행 중 화면 1줄 안내(추천)** — 지오펜스·경로 즉시 중지, i01 에 "자동 기록이 꺼졌어요 · 설정 열기" 1줄. iOS 대략 위치(정밀 끔)는 정확도 임계(Q8) 미달로 자동 보류. 푸시는 보내지 않는다

B) **조용히 강등** — 화면 표시 없음

C) **푸시로 알림** — 앱을 안 연 사람에게도 도달

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 침묵 실패 금지(INV-4) — 자동이 꺼진 줄 모르면 "기록됐겠지" 하고 넘어간다. 푸시는 권한 조작에 대한 과잉 반응이고, 다음에 앱을 열 때 보이면 충분하다. 철회 시 기존 데이터 파기는 Q7을 따른다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

#### Q17. 자동 기록이 틀렸을 때 (오탐 정정)

현재 API: `PATCH /visits/{id}`(시각 보정) · `/skip`. 도착 기록 자체를 지우는 경로는 없다.

A) **사후 정정 — 시각 보정 + 자동 기록 되돌리기(추천)** — 자동으로 생긴 체크만 되돌릴 수 있게(삭제 또는 "미방문" 복귀). 수동 체크는 지금처럼

B) **확정 후 수정 불가** — 자동 기록을 그대로 믿는다

C) **자동 기록은 "제안" 상태** — 사용자가 확인해야 확정(Q2=B 와 짝)

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 자동이 틀릴 수 있다는 걸 인정하는 가장 싼 방법이다. 되돌리기는 자동 출처(Q6)에만 열어 수동 기록 계약을 건드리지 않는다. 완료가 확정된 슬롯은 재계획 잠금(INV-U4-04) 대상이라, 되돌리면 잠금도 풀린다는 점을 FD에 명시한다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### G. 업무 시나리오

#### Q18. 회선이 없을 때 발생한 지오펜스 이벤트 (D-U10-8)

2026-09-11 결정: 오프라인 방문 기록·충돌 해소 화면은 만들지 않는다.

A) **자동 이벤트만 기기에 당일 한정 보관 → 재연결 시 재전송(추천)** — 시각을 담아 보내고 `(trip_id, slot_key)` 유니크로 멱등. 서버에 이미 기록이 있으면 서버 값 우선(충돌 UI 없음). 사용자 입력 오프라인 기록은 여전히 범위 밖

B) **버린다** — 회선이 없으면 자동 기록도 없음, 수동 폴백

C) **오프라인 기록 보류를 해제하고 전체 설계** — j01 offline·sync-conflict 프레임 복원부터

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 산·섬·지하처럼 회선이 약한 곳이 바로 자동 기록이 필요한 곳이다. 사람이 입력하지 않는 이벤트라 충돌 해소 UI가 필요 없어 09-11 결정의 이유(무거운 충돌 UI)에 걸리지 않는다. 백엔드 `OfflineReplayPropertyTest`(archive)가 재생 멱등을 이미 다루고 있어 재사용 여지가 있다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

#### Q19. 계획에 없는 장소(즉석 방문)도 자동으로 잡나

A) **계획 슬롯만 자동(추천)** — 즉석 방문은 지금처럼 수동 추가

B) **오래 머문 곳을 즉석 방문으로 자동 제안** — 연속 위치 + 체류 탐지 + POI 역조회가 필요해 Q3=B 이상과 장소 데이터 조회가 전제

X) Other (please describe after [Answer]: tag below)

> 추천 근거: B는 "어디에 머물렀나"를 서버/기기가 해석하는 새 기능이라 이 유닛의 범위를 크게 넓힌다. 후속 후보로 남긴다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### H. 범위·컴포넌트 정정

#### Q20. 유닛의 컴포넌트 집합 정정 (D-U10-3)

A) **C1(auth — 동의·법정 로그) · C9 · C12 + 클라이언트 위치 계층으로 정정(추천)** — `unit-of-work.md` 개정 블록의 "C2" 를 C1로. Q5=B 면 C10 추가

B) **C2 유지** — 위치 동의를 개념상 프로필 설정으로 본다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: `location_consent_state`·`location_legal_log`·`LocationConsentFacade`·`LocationLegalLogFacade` 가 전부 auth 모듈에 있다(V1.3). C2(User Profile)에는 위치 관련 책임이 없다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

### I. 프런트엔드 컴포넌트

#### Q21. 화면 — 새로 그릴 것과 고칠 것

A) **새 화면 없음 + 최소 추가(추천)** — ① 권한 승격 프리프롬프트 1장 신설(Q13) ② i01 방문 카드에 "자동 기록" 표시·되돌리기(Q17) ③ i01 강등 안내 1줄(Q16) ④ l06 고지 문구 보강(Q15) ⑤ 실제 경로 레이어·토글(i01 지도 · j 요약 지도, BR-U5-55 degrade 해제). **Figma 먼저**(`figma-build`), 코드는 그 뒤

B) **'자동 기록 설정' 전용 화면 신설** — 상태·권한 단계·최근 자동 기록을 한 화면에

C) **Figma 없이 코드 우선**

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 원칙상 여행 중 화면은 늘리지 않는다. Figma가 화면 정본이라 새 상태는 먼저 그려야 한다. 지오펜스 발화·백그라운드 태스크는 jest가 원리적으로 못 보는 영역이라 FD의 테스트 전략에 **6-b 실기 전용 항목**을 따로 적는다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

#### Q22. 이번 유닛의 산출물 범위

SCOPE.md(2026-10-12)는 U10에 4단계 설계를 지시했다.

A) **SCOPE대로 4단계(추천)** — FD 4종(`business-logic-model`·`domain-entities`·`business-rules`·`frontend-components`) → NFR Requirements(배터리·심사·Android 신고·privacy manifest·법정 로그) → NFR Design → Infra 증분(`shared-infrastructure.md` 증분, 신규 인프라 없으면 "변경 없음" 기록)

B) **FD 4종 + NFR Requirements까지** — NFR Design·Infra는 SKIP 기록(U3 선례)

C) **FD 3종**(`frontend-components` 제외)

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 이 유닛은 NFR(배터리·심사·OS 제약)이 본체에 가깝다. U4가 NFR 단계를 돌린 주된 이유(MOBILE-U4-\*)가 그대로 이 유닛으로 왔다.

[Answer]: A *(미입력 → 추천안 적용, 2026-10-12 사용자 지시 "확인하고 입력안한거는 다 추천으로")*

---

## 다음 단계

Q1~Q22 답변 수집 → (모호 시 명확화 파일) → 1d Figma 대조 → Step 3~7 산출물 → **완료 메시지·승인 게이트** → `audit.md`·`aidlc-state.md` 기록.
