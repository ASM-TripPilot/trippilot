# U10 GPS·위치 자동화 — Domain Entities

> 기술 중립 도메인 모델. 물리 스키마 정본은 `backend/app/src/main/resources/db/migration/`(2026-10-12 최신 **V2.62**)이고, 이 문서는 **무엇을 저장해야 하는가 / 무엇을 저장하지 않는가**를 정한다.
> 정본 순위: 리포 실물 > 계약 정본 > 라이브 Figma > aidlc 산출물 > 인셉션. `visit_check`·`location_*` 절의 "현행" 열은 **실장 기술**이고 나머지는 **설계**다.
> **INV-3 재확인**: 어느 엔티티에도 소요시간·이동 시간·속도·걸음 수 필드를 두지 않는다. 기록 구간 시각(`recorded_from/to`)은 검증용이며 표시 대상이 아니다.

---

## 1. 소유 경계표

| 엔티티 | 물리 | 소유 | U10의 관계 | 근거 |
|---|---|---|---|---|
| `visit_check` | V2.21 실재 | **archive**(C12, U5) | **확장** — `completion_source` · `auto_suppressed_at` | DEC-U10-6·15 |
| `actual_route_day` | **신설** | **archive**(C12) | 쓰기 | DEC-U10-4·5 (DEC-U5-6 개정) |
| `location_automation_interval` | **신설** | **archive**(C12) | 쓰기 | DEC-U10-10 · §12.4 |
| ~~`actual_route_point`~~ | 미실장 | ~~U4~~ | **만들지 않는다** — 점열 모델 폐기 | Q4=C(원시 좌표 서버 미보관) |
| `location_consent_state` | V1.3 | auth(C1, U0) | 읽기 — 동의 게이트 | DEC-U10-13 |
| `location_legal_log` | V1.3 · V1.7(append-only) · V2.49(6개월 정리) | auth(C1) | 쓰기(파사드 경유) | DEC-U10-10 |
| `replan_session.origin_*` | V2.17 · V2.56 | itinerary-recalculation(U4) | **무관** — 단발 기준점은 경로에 적재하지 않는다 | LEGAL-U4-05 |
| `visit_photo_meta.exif_*` | V2.33 | archive | 무관(같은 철회 구독자에서 함께 파기) | BR-U5-12 |
| `plan_b_trigger` | V2.18 | planb-detection(C9, U4) | 쓰기 경로 추가(`DELAY` 신호원) — 스키마 변경 없음 | DEC-U10-9 |
| `trip_summary` · `reflection` | V2.38 · V2.36/V2.44 | reflection(C13, U5) | stats 재계산 트리거 | §7.2 |
| 기기 로컬 상태(§5) | 기기 | 클라이언트 위치 계층 | 소유 | DEC-U10-4·16 |

> archive가 셋을 갖는 이유: 실제 경로의 **소비자**(기록·요약)와 **파기 흐름**(L3 철회 → `GpsRecordingOptOutSubscriber`)이 이미 archive에 있다. 구간(`location_automation_interval`)은 "자동 방문 기록이 언제 돌았나"라는 **방문 기록의 맥락**이라 같은 모듈에 둔다 — planb-detection은 이것을 `ArchiveFacade`로 읽기만 한다.

---

## 2. `visit_check` 확장

### 2.1 현행 (V2.21 · 실장 기술)

`visit_check_id` · `trip_id`(CASCADE) · `slot_key?`(null = 즉석) · `poi_id` · `arrived_at?` · `completed_at?` · `skipped_at?` · `source`(`AUTO_GEOFENCE`|`MANUAL`, NOT NULL) · `created_at` · `updated_at`. CHECK: 완료는 도착 이후 · 완료·건너뜀 동시 불가. 유니크 `(trip_id, slot_key) WHERE slot_key IS NOT NULL`. 체류는 파생(`VisitCheck.dwellMinutes`). 도메인 `backend/modules/archive/src/main/kotlin/com/trippilot/archive/domain/VisitCheck.kt`.

### 2.2 추가 필드 (설계)

| 필드 | 타입 | 비고 |
|---|---|---|
| `completion_source` | varchar? | `AUTO_GEOFENCE_EXIT` \| `AUTO_NEXT_ARRIVAL` \| `MANUAL`. **완료가 있을 때만 있다**(INV-U10-3) |
| `auto_suppressed_at` | timestamptz? | 자동 도착을 되돌린 시각. 값이 있는 그날(슬롯 날짜) 그 슬롯에 대한 **자동 쓰기를 거절**한다(`SUPPRESSED`). 수동 도착은 이 행을 재사용한다 |

- **`source`는 이름을 바꾸지 않고 "도착 출처"로 의미를 좁혀 읽는다.** 이름을 바꾸면 openapi `VisitCheck.source`·생성 클라이언트·`skipPlanned`(항상 `MANUAL`)가 함께 흔들린다. openapi 설명문만 "도착 감지 방식"으로 고친다.
- **건너뜀(`skipped_at`)에는 출처가 없다** — 지오펜스는 건너뛰기를 만들지 않는다(`VisitCheck.skipPlanned` 주석 승계).
- **INV-U5-01(상태 enum 없음) 유지**: 상태는 타임스탬프에서 파생한다. 되돌림으로 타임스탬프가 전부 빈 행은 `UPCOMING`이고, 목록·집계에서 제외한다(BR-U10-32).
- 도메인 메서드 초안: `VisitCheck.arriveAuto(…, occurredAt)` · `completeAuto(occurredAt, source)` · `revertAuto(at)`. 기존 `complete(at)`는 `MANUAL`을 채운다.

### 2.3 출처 조합표

| 도착 `source` | 완료 `completion_source` | 의미 | 되돌리기 |
|---|---|---|---|
| `MANUAL` | null | 수동 도착, 진행 중 | 불가 |
| `MANUAL` | `MANUAL` | 전부 수동 | 불가 |
| `MANUAL` | `AUTO_GEOFENCE_EXIT` | 수동 도착 후 이탈로 자동 완료 | 완료만 |
| `AUTO_GEOFENCE` | null | 자동 도착, 진행 중 | 도착(미디어 없을 때) |
| `AUTO_GEOFENCE` | `AUTO_GEOFENCE_EXIT` / `AUTO_NEXT_ARRIVAL` | 전부 자동 | 완료 먼저, 그다음 도착 |
| `AUTO_GEOFENCE` | `MANUAL` | 자동 도착 후 수동 완료 | 불가(완료가 수동) — 시각 보정은 가능 |

---

## 3. `actual_route_day` — 하루치 실제 경로 (신설)

| 필드 | 타입 | 비고 |
|---|---|---|
| `route_day_id` | uuid PK | 법정 로그 `subjectId` |
| `trip_id` | uuid FK → `trip` | **ON DELETE CASCADE** |
| `local_date` | date | 여행지 기준 날짜 |
| `segments` | text[] | 다운샘플 후 **인코딩 폴리라인** 배열(정밀도 1e-5). 공백 구간에서 나뉜다(BR-U10-37) |
| `distance_m` | int ≥ 0 | 클램프 후 값(BR-U10-38) |
| `distance_clamped` | boolean | 기기 값을 서버가 고쳤는가 |
| `raw_point_count` · `stored_point_count` | int | 다운샘플 전·후 점 수 — 최소화 증적 |
| `recorded_from` · `recorded_to` | timestamptz | 기록 구간. **검증 전용 — 표시 금지**(INV-U10-7) |
| `created_at` · `updated_at` | timestamptz | 재업로드는 전체 교체 |

- 유니크 `(trip_id, local_date)`.
- **원시 표본·정확도·표본별 시각을 저장하지 않는다**(INV-U10-2).
- **걸음 수 없음**(INV-U10-8 · DEC-U4-8). 선재 dbml `gps_track.steps`와 다르다(G-U10-13).
- 계정 단위 파기는 `TripPurgeScopeFacade.findAllTripIdsOf(accountId)`로 여행 id를 얻어 지운다(`VisitRecordService.purgeExifCoordinates`와 같은 경로).
- 앱 롤에 DELETE가 필요하다(파기 대상) — append-only 회수 대상이 아니다.

---

## 4. `location_automation_interval` — 자동화 구간 (신설)

| 필드 | 타입 | 비고 |
|---|---|---|
| `interval_id` | uuid PK | **클라 생성**(START·END 보고 멱등 키) |
| `trip_id` | uuid FK → `trip` | CASCADE |
| `account_id` | uuid | 법정 로그 대상 |
| `kind` | varchar | `GEOFENCE_ARMED` \| `ROUTE_RECORDING` |
| `started_at` | timestamptz | |
| `ended_at` | timestamptz? | null = 열림 |
| `end_reason` | varchar? | `CLIENT_STOP` \| `PERMISSION_DOWNGRADE` \| `ACCURACY_REDUCED` \| `CONSENT_REVOKED` \| `TRIP_ENDED` \| `SERVER_TIMEOUT` |
| `point_count` | int? | `ROUTE_RECORDING` END에서 |
| `region_count` | int? | `GEOFENCE_ARMED` END에서 |

- CHECK: `ended_at IS NULL OR ended_at >= started_at` · `(ended_at IS NULL) = (end_reason IS NULL)`.
- **좌표 없음.** 이 표는 업무 데이터(무장 여부 판정 · 관측)이고, 법적 사실은 `location_legal_log`에 따로 남는다(두 계층을 섞지 않는다 — P-DATA-U4-1).
- `ArchiveFacade.isAutomationArmed(tripId, at)` = `kind = GEOFENCE_ARMED`인 구간 중 `at`을 포함하는 열린/닫힌 구간이 있는가.

---

## 5. 기기 로컬 상태 (서버 미보관)

| 상태 | 내용 | 수명 | 비고 |
|---|---|---|---|
| **원시 위치 표본** | 위도·경도·정확도·시각 | 당일 + 업로드 재시도(여행 종료 + 1일) · 업로드 ack 즉시 삭제 · 철회 즉시 삭제 | 백그라운드 태스크가 쓴다 — 저장소는 G-U10-5 |
| **슬롯 판정 상태** | `IDLE`·`ENTERED(enterAt)`·`ARRIVED`·`EXIT_PENDING(exitAt)`·`COMPLETED` | 당일 | `business-logic-model.md` §5.1 상태기계 |
| **자동 결과 큐** | `AutoVisitEvent{eventId, kind, slotKey, poiId, occurredAt, completionSource?}` | **여행지 기준 당일** | 날짜가 바뀌면 버리고 건수만 남겨 1줄 안내 |
| **당일 되돌린 슬롯** | slotKey 집합 | 당일 | 리전 선택에서 제외 |
| **열린 구간 id** | `intervalId`(kind별) | 구간 수명 | END 보고 재시도용 |
| **설명 질문 이력** | 여행 id별 "물었음" | 여행 수명(O-U10-9) | 계정·기기 단위 |

**무장 상태(ARMED)는 저장하지 않는다** — 매번 OS 권한·동의·날짜·플래그로 다시 계산한다(BR-U10-02).

---

## 6. 위치 동의·법정 로그 확장 (C1 auth · 파사드)

| 대상 | 현행 | 추가 |
|---|---|---|
| `LocationCollectionSource` | `PHOTO_EXIF` · `REPLAN_ORIGIN` | **`ROUTE_TRACE`** |
| `LocationPurgeScope` | `PHOTO_EXIF` · `REPLAN_ORIGIN` | **`ACTUAL_ROUTE`** |
| `LocationUsePurpose` | 없음 | **신설** — `GEOFENCE_AUTO_VISIT` |
| `LocationLegalLogFacade` | `recordCollection(accountId, source, subjectId)` · `recordPurge(accountId, scope, purgedCount)` | `recordCollectionInterval(accountId, source, intervalId, phase, at, pointCount?)` · `recordUseInterval(accountId, purpose, intervalId, phase, at, regionCount?)` |
| `location_legal_log.event_type` CHECK | `CONSENT_GRANTED·CONSENT_REVOKED·COLLECTION·USE·PROVISION·PURGE` | **변경 없음** — `USE`는 V1.3부터 허용돼 있다 |
| 이벤트 | `GpsRecordingOptOut`(L3) · `LocationLegalConsentRevoked`(L2) | 변경 없음 — archive 구독자가 경로 파기를 덧붙인다 |

- 파사드는 호출자 트랜잭션에 참여한다(현행 규약) — 경로 저장이 롤백되면 `COLLECTION(STORE)`도 사라진다.
- `detail`은 문자열 맵이고 **좌표 금지**(INV-LL1 · LEGAL-U4-03). 6개월 뒤 V2.49 함수가 정리한다.

---

## 7. 이벤트

| 이벤트 | 발행 | 페이로드 | 구독 | 변경 |
|---|---|---|---|---|
| `archive.VisitChecked` | archive | `tripId · accountId · slotKey? · poiId · arrivedAt · completedAt? · arrivalSource · completionSource?` | **planb-detection**(체류 초과 — 신규 구독) · U6(선택) | **도착에도 발행** + 필드 3 추가(G-U10-2·3) |
| `archive.VisitAutoReverted` | archive | `tripId · slotKey · visitCheckId · revertedPart` | planb-detection(해당 슬롯 `DELAY` 재평가) | 신설 |
| `archive.ActualRouteStored` | archive | `tripId · localDate` | reflection(요약·회고 stats 재계산) | 신설 |
| `auth.GpsRecordingOptOut` | auth | `aggregateId=accountId · reason` | archive(EXIF + **경로** 파기, 구간 강제 종료) | 구독 동작 추가 |
| `planb.PlanBTriggered` | planb-detection | 현행 | U6 `PlanBTriggeredSubscriber`(푸시) | 변경 없음 — `DELAY` 발화가 그대로 탄다 |

아웃박스 경유 · at-least-once · 멱등 구독자(U0 스캐폴딩).

> **[개정 · 2026-10-19 · situation-awareness FD]** §7 `planb.PlanBTriggered` — 선택 필드·사건 의미·구독자
> 위 표의 "변경 없음"은 `DELAY` 발화가 같은 이벤트를 탄다는 뜻으로만 남는다. 이벤트 끝에 기본값 null 선택 필드(`affectedDate`·`scope`·`severity`·`variant`·`push`·`others`·`dateRisks`)가 붙고, 사건이 트리거마다 1건에서 판정 1회당 대표 1건으로 바뀌며, 구독자에 itinerary-recalculation(미리 짜 둔 대안)이 더해진다. `severity` 가 없는 `DELAY` 는 위험(푸시 대상)으로 읽힌다.
> → [SA domain-entities §10](../../situation-awareness/functional-design/domain-entities.md) · [BR-SA-10](../../situation-awareness/functional-design/business-rules.md) · [DEC-SA-4](../../situation-awareness/functional-design/business-logic-model.md) · [INV-SA-3](../../situation-awareness/functional-design/domain-entities.md)

---

## 8. 불변식 (INV-U10-\*)

| ID | 불변식 |
|---|---|
| **INV-U10-1** | L3(GPS 옵트인)가 거짓인 계정에는 `actual_route_day` 행이 **생기지 않고**, 철회 처리 뒤에는 **남지 않는다**(PBT-U10-1) |
| **INV-U10-2** | **서버는 원시 좌표를 보관하지 않는다.** 서버가 갖는 위치 형태의 데이터는 다운샘플 폴리라인(`actual_route_day.segments`)뿐이고, 자동 결과·구간·법정 로그에는 좌표가 없다(PBT-U10-4). 방문 실적에 기기 좌표를 붙이지 않는다 — 방문 위치는 POI 좌표(C7)다 |
| **INV-U10-3** | `completion_source IS NULL ⇔ completed_at IS NULL`(PBT-U10-2) |
| **INV-U10-4** | 경로 행이 저장되면 같은 트랜잭션에서 `COLLECTION(STORE)`가 1건 남고, 경로 파기 건수 > 0이면 `PURGE(ACTUAL_ROUTE)`가 1건 남는다 |
| **INV-U10-5** | 자동 결과는 **즉석 방문을 만들지 않는다**(`slot_key` 필수) — INV-U5-02 강화 |
| **INV-U10-6** | 자동 결과는 **이미 있는 기록을 바꾸지 않는다**(서버 우선). 유일한 예외는 수동 도착 + 미완료 행에 자동 완료를 더하는 것(`business-logic-model.md` §5.2) |
| **INV-U10-7** | 소요시간·이동 시간·속도는 저장·전송·표시되지 않는다. `recorded_from/to`는 표시하지 않는다. 개별 체류는 표시하지 않는다(INV-U4-03 승계) |
| **INV-U10-8** | 걸음 수는 저장·표시하지 않는다(INV-U4-08 승계) |
| **INV-U10-9** | 경로 세그먼트는 공백을 가로질러 이어지지 않는다 |
| **INV-U10-10** | `auto_suppressed_at`이 그날 값인 슬롯에는 자동 쓰기가 일어나지 않는다 |
| **INV-U10-11** | `TriggerKind`는 4종 그대로다 — U10은 `DELAY`의 payload 변형만 더한다(BR-U4-01) |

---

## 9. 마이그레이션 제안 (번호 미정 — 머지 시점에 V2.63 이후로 배정)

| 제안 | 내용 |
|---|---|
| **M-U10-a** | `visit_check` ADD `completion_source varchar(20) NULL CHECK (completion_source IN ('AUTO_GEOFENCE_EXIT','AUTO_NEXT_ARRIVAL','MANUAL'))` · 백필 `UPDATE … SET completion_source = 'MANUAL' WHERE completed_at IS NOT NULL`(지금까지 완료는 전부 수동이다 — 자동 경로가 0이었다) · CHECK `(completed_at IS NULL) = (completion_source IS NULL)` · ADD `auto_suppressed_at timestamptz NULL` · `source` 컬럼 COMMENT를 "도착 출처"로 |
| **M-U10-b** | CREATE `actual_route_day`(§3) — FK `trip` CASCADE · UNIQUE `(trip_id, local_date)` · CHECK `distance_m >= 0` · `stored_point_count <= raw_point_count` |
| **M-U10-c** | CREATE `location_automation_interval`(§4) — FK `trip` CASCADE · CHECK 2종 · 인덱스 `(trip_id, kind, started_at)` |

- **`actual_route_point`는 만들지 않는다.** U4 §3.3 점열 설계는 이 결정으로 폐기된다.
- `location_legal_log`의 CHECK·권한은 건드리지 않는다.
- 번호를 적지 않는 이유: 정본이 제안한 번호가 다른 PR에 먼저 쓰인 선례(V2.28 → `outbox_schema_version`, `VisitCheck.kt` 주석)가 있다. 작성 시점 커밋 최신과 **열린 PR·untracked 초안까지** 보고 정한다(V2.56 주석 관례).

---

## 10. 소유 경계 요약 (U0 ↔ U4 ↔ U5 ↔ U10)

| 관심사 | 소유 | 비고 |
|---|---|---|
| 위치 동의 3층 · 법정 로그 저장 | **U0 · auth(C1)** | U10은 파사드에 메서드·enum 값만 더한다 |
| 권한 사다리 · 지오펜스 · 판정 · 경로 수집·다운샘플 | **U10 · 클라이언트 위치 계층** | `frontend/src/shared/location/` 단일 소유 |
| 방문 실적(자동 포함) · 실제 경로 · 자동화 구간 | **U5 archive(C12) — U10이 확장** | DEC-U10-5 |
| `DELAY` 판정·억제·발화 | **U4 planb-detection(C9) — U10이 신호원 추가** | 판정 규칙 소유는 C9 그대로(G-U4-2) |
| 재계획 기준점 단발 좌표 | **U4 itinerary-recalculation** | U10 무관(LEGAL-U4-05) |
| 요약·회고 거리 출처 | **U5 reflection(C13)** | U10은 `ROUTE` 원천만 제공 |
| 지연 푸시 | **U6 notification** | 기존 `PlanBTriggeredSubscriber` 재사용 |
