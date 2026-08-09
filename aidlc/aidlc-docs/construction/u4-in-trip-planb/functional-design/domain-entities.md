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

**INV-U4-05**: `status`가 `APPLIED`가 되기 전에는 `itinerary`·`visit_slot`에 **어떤 쓰기도 발생하지 않는다**. `i18` [취소]는 세션만 `CANCELED`로 닫는다.

**INV-U4-06**: 한 여행에 `COLLECTING`/`SOLVING`/`DRAFT` 세션은 **최대 1개**. 새 재계획 진입은 기존 열린 세션을 `CANCELED`로 닫고 시작한다.

### 3.3 `actual_route_point` — 실제 경로 (US-PLANB-13)

| 필드 | 비고 |
|---|---|
| `tripId` · `recordedAt` · `lat` · `lng` · `accuracyM` | 앱을 켜 둔 구간만(DEC-U4-7) |

**INV-U4-07**: 위치 동의가 없으면 행이 생기지 않는다. 동의 철회 시 이후 기록이 멈추고, 화면은 실제 경로 레이어를 **비활성 + 사유 표기**한다.
**INV-U4-08**: 누적 실제 이동 거리는 이 점열에서 파생한다. **걸음 수는 저장하지도 표시하지도 않는다**(DEC-U4-8).

> 소유는 §3.1과 같이 U5로 이관 예정(G-U4-5).

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

---

## 5. 이벤트

| 이벤트 | 발행 | 구독 | 비고 |
|---|---|---|---|
| `PlanBTriggered` | C9 (`shouldReplan=true`) | 클라 배너·칩 / 로컬 알림 / (후속) U6 알림 | 자동 변경 금지 — **제안까지만** |
| `VisitChecked` | **U4 C10**(DEC-U4-10) | C9(`DELAY` 체류 초과 입력) · **U5 C12**(기록 적재) | 인셉션은 C12 발행으로 적었으나 U4가 먼저 필요 → 발행자를 U4로 두고 U5가 구독·승계 |
| `ItineraryRecalculated` | C10 (`APPLIED`) | change-log · U5 기록 · (후속) 알림 | `before`/`after` 스냅숏 동반 |

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
