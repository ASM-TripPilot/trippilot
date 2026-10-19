# U4 In-trip & Plan-B — Domain Entities

> 기술 중립 도메인 모델. 물리 스키마(Flyway)는 `backend/app/src/main/resources/db/migration/` 이 정본이고, 이 문서는 **무엇을 저장해야 하는가**만 정한다.
> **INV-3 재확인**: 어느 엔티티에도 소요시간(duration) 필드를 두지 않는다. 실제 체류(`dwell_minutes`)는 **사후 실적**이지 예측 표시값이 아니다 — §3.1 주석.

---

## 1. 기존 자산 — 재사용 (신설 금지)

| 엔티티 | 실재 | U4의 사용 |
|---|---|---|
| `itinerary` / `itinerary_day` / `visit_slot` | V2.7·V2.8·V2.12 | 재계획 대상. **U4는 컬럼을 추가하지 않는다** — 진행 상태는 §3 `visit_check`가 따로 갖는다 |
| `change_log_entry` | V2.11 (append-only, `source_type` 4종에 `PLAN_B` 포함) | 확정 시 1행 append. **신설 없음**(DEC-U4-11) |
| `trip` / `trip_base_day` | V2.3·V2.4 | 여행 구간·당일 앵커(숙소) 조회 |
| `poi` / `poi_snapshot` | V2.0·V2.5·V2.6 | 후보·영업시간 정본(C7, U1 소유) |
| `itinerary_revision` | **U3 설계 신설 — 마이그레이션 미작성** | Plan-B 확정도 리비전을 남긴다(`h36` 되돌리기 대상). U3 산출물과 **같은 테이블을 쓴다** |

> **[개정 · 2026-10-12] 표 갱신.** `itinerary_revision`은 **V2.14**(`V2.14__itinerary_revision.sql`)로 마이그레이션됐다 — "마이그레이션 미작성"은 낡은 서술이다.

> **slotKey 규약**: `"{date}#{poiId}"` (BR-U2-04). U4의 모든 신규 엔티티는 `visit_slot_id`(물리 키)가 아니라 **`slotKey`(경계 키)** 로 슬롯을 가리킨다 — 재계획으로 슬롯 행이 갈려도 참조가 끊기지 않게.

---

## 2. C9 Plan-B Detection

### 2.1 `plan_b_trigger` — 감지 기록

판정 결과를 남긴다. **발화하지 않은 판정도 기록**한다(무발화의 근거가 관측에 남아야 "왜 알림이 안 왔나"를 답할 수 있다).

| 필드 | 타입 | 비고 |
|---|---|---|
| `triggerId` | uuid | |
| `tripId` / `itineraryId` | uuid | |
| `kind` | enum | **`WEATHER` \| `CLOSURE` \| `DELAY` \| `MANUAL`** — ai `TriggerKind` 그대로(DEC-U4-4) |
| `affectedDate` | date | ai `TriggerParams.affected_date` |
| `slotKey` | string? | 영향받는 슬롯. 날짜 전체 영향이면 null |
| `payload` | json | 직렬화 가능 원시값만(ai 규약). 예: `{"pop":70,"issuedAt":"…"}` · `{"delayMin":18}` |
| `shouldReplan` | boolean | ai `TriggerEvalResult.should_replan` |
| `scope` | enum? | `FULL_DAY` \| `PARTIAL_SLOTS` \| `NONE` |
| `reason` | string | 사용자 노출 문구의 근거 (`비 예보 70%`) |
| `state` | enum | `ACTIVE` \| `SUPPRESSED` \| `CONSUMED`(재계획 확정에 쓰임) \| `EXPIRED`(대상 슬롯이 지남) |
| `detectedAt` | timestamptz | |

**INV-U4-01**: `shouldReplan=false`인 판정은 사용자에게 **어떤 형태로도 노출되지 않는다**(배너·칩·알림 전부).

> **[개정 · 2026-10-19 · situation-awareness FD]** §2.1 `plan_b_trigger` · INV-U4-01
> 심각도·알린 최고 심각도·푸시 시각·버전 열이 붙고, `ACTIVE` 유니크에 `affected_date` 가 들어간다(V2.18 `ux_plan_b_trigger_active` 는 날짜가 없다). `payload` 는 한 키 한 뜻(`variant`·`detector`·`dataSource`)이고 상태값은 늘리지 않는다(해제·만료 모두 `EXPIRED`). 감시 상태 `plan_b_watch`(여행 × 출처)가 신설된다. 무발화 기록은 유지하되 같은 무발화가 매시 쌓이지 않게 날짜·변형당 1번만 남긴다. INV-U4-01 은 그대로다 — 알림 없이 배너만 띄우는 조용한 발화도 `should_replan=true` 인 `ACTIVE` 다.
> → [INV-SA-4](../../situation-awareness/functional-design/domain-entities.md) · [BR-SA-05·08·13](../../situation-awareness/functional-design/business-rules.md) · [DEC-SA-3](../../situation-awareness/functional-design/business-logic-model.md)

### 2.2 `plan_b_suppression` — 억제 상태

"그대로 둘게요" / `i10`의 `[끄기]`.

| 필드 | 비고 |
|---|---|
| `tripId` · `kind` · `slotKey?` | 억제 대상 조합 |
| `scopeType` | `SLOT`(동일 사유×동일 방문지) \| `DAY` \| `TRIP` |
| `suppressedAt` · `expiresAt?` | 만료 없으면 여행 종료까지 |
| `sensitivity` | `LOW`(적게) \| `NORMAL`(보통) \| `HIGH`(많이) — **사용자 설정, 여행 단위가 아니라 계정 단위** |

**INV-U4-02**: 억제는 **감지 단계에서 적용**된다 — 억제된 조합은 `plan_b_trigger`를 `SUPPRESSED`로 남기되 발화하지 않는다. 화면 단계에서 거르지 않는다(거르면 알림은 이미 나간 뒤다).

> 민감도는 계정 단위 설정이라 물리적으로는 `profile` 쪽에 붙는 게 자연스럽다. 소유 결정은 U6(설정) 설계와 함께 — **G-U4-6**.

> **[개정 · 2026-10-12] 민감도 물리 소유 — 별도 테이블로 실재.** `plan_b_sensitivity(account_id PK, sensitivity LOW|NORMAL|HIGH, updated_at)`가 **V2.18**(`V2.18__plan_b_detection.sql`)에 있고 행이 없으면 `NORMAL`로 본다. API는 `backend/modules/planb-detection/src/main/kotlin/com/trippilot/planbdetection/adapter/in/web/SensitivityController.kt`. `profile`·U6 `account_setting`(V2.42)으로 옮기지 않았다.

> **[개정 · 2026-10-19 · situation-awareness FD]** §2.2 `plan_b_suppression` · INV-U4-02
> 억제에 날짜(`affected_date`)와 최대 심각도(`max_severity`, null = 전부 — 옛 행 동작)가 붙어 덮는 범위를 좁힌다. 감지 단계 집행은 그대로이고, 민감도 상한은 푸시만 묶는다.
> → [BR-SA-09·10](../../situation-awareness/functional-design/business-rules.md)

---

## 3. C10 Itinerary Recalculation

### 3.1 `visit_check` — 방문 실적 (DEC-U4-10)

`plan`(=`visit_slot`)과 구분되는 **`actual` 계층의 첫 조각**이다.

| 필드 | 비고 |
|---|---|
| `visitCheckId` | uuid |
| `tripId` · `slotKey` · `poiId` | |
| `arrivedAt` | timestamptz? — 도착 체크 |
| `completedAt` | timestamptz? — 방문 완료 |
| `source` | `AUTO_GEOFENCE` \| `MANUAL` (DEC-U4-6) |
| `dwellMinutes` | int? — **`completedAt − arrivedAt` 파생 실적**. 예측이 아니다 |

**INV-U4-03**: `dwellMinutes`는 사용자 화면에 **체류 시간으로 표시되지 않는다** — `DELAY` 트리거의 입력과 U5 기록의 재료로만 쓴다. (INV-3은 *예측 소요시간*의 표시 금지이고 사후 실적은 U5 기록 소관이나, U4 화면에서는 노출하지 않아 경계를 흐리지 않는다.)

**INV-U4-04**: 완료(`completedAt≠null`)된 슬롯은 재계획에서 **불변**이다 — 항상 `lockedSlotKeys`에 들어간다.

> **소유 이관 예고(G-U4-5)**: `visit_check`는 U5 C12 Travel Archive의 `actual` 계층에 속한다. U4가 최소 형태로 정의하고, 사진·메모·GPS 기록이 붙는 확장은 U5가 승계한다. **U4는 이 테이블에 사진·메모 컬럼을 만들지 않는다.**
>
> **[U5 설계 결정 · 2026-08-22] 이관 확정 — 단, `actual_route_point`와 갈렸다.** `visit_check`는 예고대로 **U5로 이관**한다(U5 DEC-U5-2 · Q1=A): 테이블·openapi 경로·스키마는 그대로 두고 코드 4파일 + 테스트 3만 `itinerary-recalculation` → 신설 `archive` 모듈로 옮긴다. 이관 후 U4의 잠금 판정(INV-U4-04)은 **`ArchiveFacade.getCompletedSlots(tripId)`** 로 읽는다(U5 DEC-U5-3). `VisitChecked` **발행 주체도 U4→U5로 바뀐다**(페이로드·구독자 불변). 반면 **`actual_route_point`는 U4 소유로 남는다** — §3.3 참조. 위 문장의 "GPS 기록이 붙는 확장은 U5가 승계한다"는 이 결정으로 **`visit_check`에만 해당**한다.

> **[이연 · 2026-10-12 → U10] `source = AUTO_GEOFENCE`.** 컬럼 값은 V2.21 CHECK에 남아 있으나 지오펜스 자동 도착을 만드는 클라 경로는 없다(`frontend/src/shared/location/geofence.ts` degrade 스텁). 자동 도착·이탈은 U10 소관이고, 현행 방문 체크는 `MANUAL`뿐이다.

> **[개정 · 2026-10-12 · U10 FD] §3.1 `visit_check` 확장(소유는 U5 archive).** `source`는 **도착 출처**로 의미를 좁혀 읽고, **`completion_source`**(`AUTO_GEOFENCE_EXIT`·`AUTO_NEXT_ARRIVAL`·`MANUAL`, 완료가 있을 때만 필수)와 자동 되돌림 표식 **`auto_suppressed_at`**을 더한다. 기존 완료 행은 `MANUAL`로 백필한다(지금까지 자동 경로가 0이었다). `dwellMinutes`는 여전히 파생·비표시(INV-U4-03)이고, `AUTO_NEXT_ARRIVAL` 완료의 체류는 `DELAY` 입력에서 빠진다. 상세 `construction/u10-gps-location-automation/functional-design/domain-entities.md` §2.

### 3.2 `replan_session` — 재계획 세션

`i10` 제출 ~ `i18` 확정/취소까지의 수명.

| 필드 | 비고 |
|---|---|
| `sessionId` | uuid |
| `tripId` · `itineraryId` | |
| `triggerId` | uuid? — 자동 진입이면 동반, 수동이면 null |
| `scope` | `PARTIAL_SLOTS` \| `FULL_DAY` (DEC-U4-3) |
| `fromInstant` | timestamptz — '현재 시각 이후'의 기준점 |
| `originLocation` | geo? + `originKind` = `GPS` \| `MANUAL` \| `LAST_VISIT` \| `STAY_ANCHOR` (§5 사다리) |
| `reasons` | string[] — `i10` '왜' 다중 |
| `directives` | string[] — `i10` '어떻게' 다중 |
| `freeText` | string? |
| `excludedPoiIds` | uuid[] — '건너뛰기'가 채운다 |
| `status` | `COLLECTING` \| `SOLVING` \| `DRAFT` \| `APPLIED` \| `CANCELED` \| `FAILED` \| `NO_SOLUTION` |
| `draft` | json? — 산출된 단일 재계획안(확정 전 원 일정에 반영 금지) |
| `createdAt` · `closedAt` | |

> **[개정 · 2026-10-12] `replan_session` 실장 차이.** ① `originKind`에 **`PURGED`**가 추가됐다 — 위치 동의 철회 시 기준점 좌표를 지우고 "파기됨"을 값으로 남긴다(TRIP-992, `V2.56__replan_origin_purged.sql`). ② **`target_date`**(재계획 대상 일자, NOT NULL 백필)가 추가돼 오늘 외의 날도 다시 짤 수 있다(TRIP-1182, `V2.60__replan_session_target_date.sql`). 본 테이블은 `V2.17__replan_session.sql`.

**INV-U4-05**: `status`가 `APPLIED`가 되기 전에는 `itinerary`·`visit_slot`에 **어떤 쓰기도 발생하지 않는다**. `i18` [취소]는 세션만 `CANCELED`로 닫는다.
  - **개정(2026-10-14, 사용자 결정)** — 일정 화면의 **[다시 짜기] 원탭**은 누르는 행위가 확인이다: 클라이언트가 초안(`DRAFT`)이 나오는 즉시 `apply` 를 불러 반영하고 추천안 화면으로 간다(사유·칩 모달·i13 검토 없음). 쓰기는 여전히 `APPLIED` 에서만 일어나고(이 불변식 유지), 되돌리기는 적용 전 복원 지점(`ensureRestorePoint`)으로 한다. **단, 확정(`CONFIRMED`) 일정은 지금 복원이 409(`ItineraryRevisionService.requireRestorable`)라 되돌릴 수 없다 — 여행 중 일정은 대개 확정 상태다. 확정 일정의 재계획 되돌리기·적용 뒤 제외 항목 표면은 TRIP-1412(BE)·TRIP-1413(FE).** 사유를 고르는 명시적 재계획(허브 AI 재계획·트리거·알림·어시스턴트)은 종전대로 검토 후 적용.

**INV-U4-06**: 한 여행에 `COLLECTING`/`SOLVING`/`DRAFT` 세션은 **최대 1개**. 새 재계획 진입은 기존 열린 세션을 `CANCELED`로 닫고 시작한다.

> **[개정 · 2026-10-19 · situation-awareness FD]** §3.2 `replan_session` · INV-U4-05·06
> - `initiated_by`(`USER`|`SYSTEM`) 열이 붙는다 — `SYSTEM` 은 트리거가 필수이고 트리거당 1개다(재배달 멱등의 마지막 방어선). → [DEC-SA-4](../../situation-awareness/functional-design/business-logic-model.md)
> - **INV-U4-05** 는 그대로 성립한다 — SYSTEM 세션은 초안까지만 가고 적용은 사용자 [적용]뿐이며, 원탭 '바로 적용'(2026-10-14 개정 주)을 트리거 경로에 쓰지 않는다. → [INV-SA-1](../../situation-awareness/functional-design/domain-entities.md) · [BR-SA-20](../../situation-awareness/functional-design/business-rules.md)
> - **INV-U4-06 개정(공존)**: 여행당 열린 세션 1개는 그대로다. 선계산은 30분 안에 열린 USER 세션을 닫지 않고 건너뛴다. → [INV-SA-6](../../situation-awareness/functional-design/domain-entities.md) · [BR-SA-18](../../situation-awareness/functional-design/business-rules.md)
> - 낡은 SYSTEM 초안의 적용 거절은 U4 에 새 INV 번호를 두지 않고 INV-SA-7 로 둔다(낡음은 시간 창이 아니라 사실로 판정, 409). → [INV-SA-7](../../situation-awareness/functional-design/domain-entities.md) · [BR-SA-19](../../situation-awareness/functional-design/business-rules.md)

### 3.3 `actual_route_point` — 실제 경로 (US-PLANB-13)

| 필드 | 비고 |
|---|---|
| `tripId` · `recordedAt` · `lat` · `lng` · `accuracyM` | 앱을 켜 둔 구간만(DEC-U4-7) |

**INV-U4-07**: 위치 동의가 없으면 행이 생기지 않는다. 동의 철회 시 이후 기록이 멈추고, 화면은 실제 경로 레이어를 **비활성 + 사유 표기**한다.
**INV-U4-08**: 누적 실제 이동 거리는 이 점열에서 파생한다. **걸음 수는 저장하지도 표시하지도 않는다**(DEC-U4-8).

> ~~소유는 §3.1과 같이 U5로 이관 예정(G-U4-5).~~
>
> **[U5 설계 결정 · 2026-08-22] 이관 철회 — `actual_route_point`는 U4 소유로 남는다**(U5 DEC-U5-6 · Q5=B). §3.1의 `visit_check`와 **갈렸다**: 실적 체크는 U5로 가고, 실제 경로 점열은 Plan-B 기준점 계산의 1차 소비자가 U4라 여기 남는다. U5는 **읽기만** 한다.
> ⚠ **이 테이블은 아직 실장되지 않았다**(2026-08-22 실측 — V2.14~V2.27에 없다). 그 결과 U5의 회고·요약 stats가 **실제 이동 거리를 서버에서 산출할 수 없어**, 1차는 방문점 연결선 근사(`distanceSource: VISIT_LINE`)로 운용하고 이 테이블이 실장되면 `ROUTE`로 승격한다(U5 DEC-U5-12 · G-U5-5). **U4 실장 시 U5 stats 계약을 함께 확인할 것.**

> **[이연 · 2026-10-12 → U10] §3.3 `actual_route_point` 전체.** 2026-10-12 현재도 마이그레이션에 없다(최신 V2.62까지). 실제 경로 기록·레이어·토글(US-PLANB-13)은 신설 유닛 **U10 "GPS·위치 자동화"**(미구현, 사용자 결정 2026-10-12)로 넘긴다. U5 stats의 `VISIT_LINE` 근사는 U10 실장 전까지 유지된다.

> **[개정 · 2026-10-12 · U10 FD] §3.3 — 점열 모델 폐기, 소유 이동.** `actual_route_point`(서버 원시 점열)는 **만들지 않는다**(Q4=C — 원시 좌표는 기기 밖으로 나가지 않는다). 대신 **`archive` 모듈 소유 `actual_route_day`**(여행·날짜당 1행 — 다운샘플 인코딩 폴리라인 세그먼트 · 거리 · 점 수)를 신설한다(Q5=A — U5 DEC-U5-6 개정). INV-U4-07(동의 없으면 행 없음 · 철회 시 비활성)은 "**철회 시 전량 파기 + `PURGE(ACTUAL_ROUTE)`**"로 강화되고(Q7=A), INV-U4-08(걸음 수 없음)은 그대로다. 근거 `construction/u10-gps-location-automation/functional-design/domain-entities.md` §3·§8.

---

## 4. C11 Weather & Context

### 4.1 `weather_snapshot` — 조회 캐시

| 필드 | 비고 |
|---|---|
| `gridKey` | 격자 좌표(기상청 nx·ny) 또는 지역 키 |
| `baseAt` | 발표 시각 |
| `precipProbability` | int (%) |
| `warning` | string? — 특보 |
| `fetchedAt` · `expiresAt` | |

**INV-U4-09**: 조회 실패 시 **행을 만들지 않는다**. 만료된 스냅숏으로 트리거를 발화하지 않는다(허위 알림 금지 — 만료분은 `i09`에 "확인 불가"로만 쓰인다).

> **[개정 · 2026-10-19 · situation-awareness FD]** §4.1 · INV-U4-09
> 격자 시간별 예보 캐시 `weather_grid_forecast`(격자당 1행, weather-context 소유)가 신설되고, `weather_snapshot` 은 기존 강수확률 경로에 남는다. 특보·대기질은 새 테이블 없이 감지기가 읽는다. INV-U4-09 는 두 캐시 모두에 성립하고(실패·`NO_DATA`·게이트웨이 오류는 저장하지 않음, 받은 값도 신선해야 씀), 모름은 발화도 해제도 아니다.
> → [INV-SA-2](../../situation-awareness/functional-design/domain-entities.md) · [BR-SA-15·16](../../situation-awareness/functional-design/business-rules.md)

---

## 5. 이벤트

| 이벤트 | 발행 | 구독 | 비고 |
|---|---|---|---|
| `PlanBTriggered` | C9 (`shouldReplan=true`) | 클라 배너·칩 / 로컬 알림 / (후속) U6 알림 | 자동 변경 금지 — **제안까지만** |
| `VisitChecked` | **U4 C10**(DEC-U4-10) | C9(`DELAY` 체류 초과 입력) · **U5 C12**(기록 적재) | 인셉션은 C12 발행으로 적었으나 U4가 먼저 필요 → 발행자를 U4로 두고 U5가 구독·승계 |
| `ItineraryRecalculated` | C10 (`APPLIED`) | change-log · U5 기록 · (후속) 알림 | `before`/`after` 스냅숏 동반 |

> **[개정 · 2026-10-19 · situation-awareness FD]** §5 이벤트
> - `planb.PlanBTriggered` 끝에 기본값 null 선택 필드(`affectedDate`·`scope`·`severity`·`variant`·`push`·`others`·`dateRisks`)가 붙고, 의미가 트리거마다 1건에서 여행·회차당 1건(대표)으로 바뀐다. 구독자에 itinerary-recalculation(선계산)이 더해진다. → [DEC-SA-4](../../situation-awareness/functional-design/business-logic-model.md) · [BR-SA-10](../../situation-awareness/functional-design/business-rules.md) · [INV-SA-3](../../situation-awareness/functional-design/domain-entities.md)
> - `recalculation.ItineraryRecalculated` 에 `triggerId`·`targetDate` 가 붙고, planb-detection 이 구독해 트리거 날짜와 같을 때만 `CONSUMED` 로 닫는다. → [BR-SA-14](../../situation-awareness/functional-design/business-rules.md)

---

## 6. 소유 경계 요약

| 관심사 | 소유 | 근거 |
|---|---|---|
| 트리거 판정·임계·억제 | **U4 C9** | G-U4-2 |
| 트리거 종류 taxonomy | **ai/**(`TriggerKind`) | DEC-U4-4 — 백엔드는 따른다 |
| 재계획 산출(warm-start) | **ai/**(`regenerate`) | DEC-U4-5 |
| 슬롯 후보 산출 | **U3 계약 재사용**(`proposeSlotCandidates`) | DEC-U4-1 |
| 방문 실적·실제 경로 | **U4가 정의 → U5가 승계** | G-U4-5 |
| 사진·메모 | **U5** (U4는 버튼만) | DEC-U4-10 |
| 변경 이력 저장 | **기존 change-log 모듈** | DEC-U4-11 |
| 변경 이력 열람·되돌리기 화면 | **U3(`h36`)** | U4는 화면을 만들지 않는다 |
| 날씨 수집 | **U4 C11** | 신규 |
| POI 영업시간·휴무 정본 | **U1 C7** | 조회만 |

> **[개정 · 2026-10-12] 소유 표 갱신.** "재계획 산출(warm-start) = ai `regenerate`" 행 — 실제 산출은 AI `POST /ai/v1/planb/replan`(RAG(KB-3)+지시어 번역+`ScheduleAgent`, `ai/src/trippilot/api/wiring.py` `replan`)이다. "방문 실적·실제 경로" 행 — 방문 실적은 U5 `archive`로 이관 완료, 실제 경로는 **[이연 · 2026-10-12 → U10]**. "변경 이력 열람·되돌리기 화면 = U3 h36" — h36은 FE 미구현이다(U3 `frontend-components.md` §1 개정).

> **[개정 · 2026-10-19 · situation-awareness FD]** §6 소유 경계 — 상황 인지 추가분
> 상황 감시 스윕·감지기 계약·판정·`TriggerVariant` = C9 · 격자 예보·특보·대기질 조회 = C11 · 영업시간 판정·공휴일 달력 = AI(하루 재검증 퍼사드는 itinerary-generation) · 폐업 상태 = C7 · 진행 중 여행 목록(계정 포함) = trip · 선계산·낡음·준비된 대안 조회 = C10. 모듈 의존이 둘 는다(C9 → C7 `api`, C10 → C9 `api` 의 트리거 조회만 — 순환 없음). 종류 4종의 정본이 ai `TriggerKind` 인 행은 그대로다.
> → [DEC-SA-2·3·4](../../situation-awareness/functional-design/business-logic-model.md)
