# 변수 상황 자가 인지(situation-awareness) — Domain Entities

> U4 In-trip & Plan-B 의 번호 없는 확장(O-SA-15). 기술 중립 도메인 모델이다. 물리 스키마 정본은 `backend/app/src/main/resources/db/migration/`(기준선 `origin/develop` `f52f58cf7` 최신 **V2.72**)이고, 이 문서는 **무엇을 저장하는가 / 무엇을 저장하지 않는가**와 모듈 경계를 정한다. "현행" 표기는 기준선 실장 기술이고 나머지는 설계다.
> 원 문서(U4 `domain-entities.md` §2·§3.2·§4·§5·§6, U10 `domain-entities.md` §7)에는 규칙 본문을 다시 쓰지 않는다 — `[개정 · 2026-10-19 · situation-awareness FD]` 블록이 이 문서의 ID 를 가리킨다.
> **INV-3 재확인**: 어느 엔티티·이벤트·응답에도 소요시간·지연 분·이동 시간이 없다. 감지가 읽는 좌표는 **POI 좌표(C7)뿐**이고 사용자 위치는 읽지 않는다 — 위치 법정 로그 대상이 아니다.

---

## 1. 소유 경계표

| 엔티티·값 | 물리 | 소유 | SA 의 관계 | 근거 |
|---|---|---|---|---|
| `plan_b_trigger` | V2.18 | planb-detection(C9) | **확장** — 열 4 · 활성 유일 키에 날짜 | DEC-SA-3 · BR-SA-05·08·10 |
| `plan_b_suppression` | V2.18 | C9 | **확장** — 열 2 | BR-SA-09 |
| `plan_b_watch` | **신설** | C9 | 판정 회차가 쓰고 `GET /triggers` 가 읽는다 | BR-SA-13 |
| `plan_b_sensitivity` | V2.18 | C9 | 읽기 — 값의 **뜻**이 바뀐다(§3.7) | BR-SA-10 · O-SA-9 |
| `weather_grid_forecast` | **신설** | weather-context(C11) | 읽기-통과 캐시 | DEC-SA-1 · BR-SA-15 |
| `weather_snapshot` | V2.19 | C11 | 무관 — 목적지 이름 경로·표시용으로 남는다 | U4 §4.1 |
| `replan_session` | V2.17·V2.56·V2.60 | itinerary-recalculation(C10) | **확장** — `initiated_by` | DEC-SA-4 · BR-SA-18·19 |
| `poi.data_status` | V2.0 | place-data(C7) | 읽기 — `CLOSED` 만 폐업 | BR-SA-17 |
| `visit_slot.has_violation`·`violation_reason` | V2.7·V2.15 | itinerary-generation(C8) | 읽기 — 이미 본 영업시간 경고 판별 | BR-SA-17 |
| `notification`·`notification_toggle` | V2.31·V2.35 | notification(C14) | 스키마 무관 — `PLAN_B` 푸시 기본값(코드)만 바뀐다 | DEC-SA-5 · O-SA-14 |
| 행사 저장소·POI 태그 | AI 공유본 | AI | 읽기 — 기회 산출 재료 | DEC-SA-6 |

> 쓰기 경로는 **판정 하나**(`TriggerService.reconcile`, 여행 1개 = 트랜잭션 1개)다. 감지기는 저장·이벤트를 하지 않는다(DEC-SA-2). 새 `TriggerKind`·새 트리거 상태값·새 `NotificationKind` 는 없다(DEC-SA-3·5).

---

## 2. 값 어휘 — `TriggerVariant` · `TriggerSeverity` (DEC-SA-3)

종류(`TriggerKind`)는 4종 그대로다(BR-U4-01 · DEC-U4-4). 상황의 구분은 `payload.variant` — **C9 소유 닫힌 enum** 이고 openapi enum → FE codegen 으로 이어진다.

| variant | kind | 근거(감지기) | 심각도 | 비고 |
|---|---|---|---|---|
| `RAIN` | WEATHER | `kma-forecast` · `kma-warning`(호우) | RISK | |
| `SNOW` | WEATHER | `kma-forecast` · `kma-warning`(대설) | RISK | |
| `WIND` | WEATHER | `kma-forecast` · `kma-warning`(강풍·태풍) | RISK | |
| `HEAT` | WEATHER | `kma-forecast` · `kma-warning`(폭염) | 예보 ≥33℃ CAUTION / ≥35℃ RISK, 특보 RISK | O-SA-2 |
| `COLD` | WEATHER | `kma-forecast` · `kma-warning`(한파) | RISK | |
| `CLOUD` | WEATHER | `kma-forecast`(야경 슬롯) | CAUTION | O-SA-4 |
| `DUST` | WEATHER | `airkorea` · `kma-warning`(황사) | 나쁨 CAUTION / 매우나쁨 RISK, 특보 RISK | O-SA-3 |
| `CLOSED_DAY` | CLOSURE | `place`(HC1 하위 코드) | RISK | |
| `OUT_OF_HOURS` | CLOSURE | `place`(HC1 하위 코드) | RISK | |
| `HOURS_MISMATCH` | CLOSURE | `place`(HC1, 하위 코드 없음) | RISK | 하위 코드를 모를 때의 자리 |
| `HOLIDAY` | CLOSURE | `place`(HC1 `HOLIDAY`) | RISK | `HOLIDAY_CLOSURE_MODE=on` 일 때만 생긴다. 감지기가 해제하지 않는다 |
| `PERMANENTLY_CLOSED` | CLOSURE | `place`(`data_status=CLOSED`) | RISK | 영업시간보다 우선 |

- 특보는 따로 변형을 두지 않고 위 변형으로 사상한다(호우 RAIN · 대설 SNOW · 강풍·태풍 WIND · 한파 COLD · 폭염 HEAT · 황사 DUST). 특보로 생긴 신호는 모두 RISK 다(BR-SA-16).
- `DELAY` 의 `OVERSTAY`·`TRANSIT` 은 U10 이 같은 enum 에 더한다(BR-U10-27).
- 저장된 값이 enum 에 없으면 응답 `variant` 는 null 이고 앱은 kind 라벨로 떨어진다 — 옛 행·되돌린 서버에 무해.
- **`TriggerSeverity`** = `RISK`(일정을 막는다 — 푸시 대상) · `CAUTION`(앱 안에만). 기회는 심각도가 아니라 **트리거 밖**이다(DEC-SA-6). 심각도는 트리거 열 하나에만 둔다 — payload 에 다시 적지 않는다.
- `severity` 를 모르는 행(옛 행·U10 `DELAY`)은 RISK 로 읽는다(열 기본값) — DELAY 는 푸시 대상이다.

---

## 3. `plan_b_trigger` 확장

### 3.1 현행 (V2.18 · 실장 기술)

`trigger_id` · `trip_id`(CASCADE) · `itinerary_id`(FK 없음 — 재생성에도 이력 보존) · `kind` · `affected_date` · `slot_key?` · `payload`(jsonb) · `should_replan` · `scope?` · `reason`(≤200) · `state`(`ACTIVE`·`SUPPRESSED`·`CONSUMED`·`EXPIRED`) · `detected_at`. CHECK `chk_plan_b_trigger_active`(ACTIVE ⇒ should_replan) · `chk_plan_b_trigger_scope`. 활성 유일 키 `ux_plan_b_trigger_active (trip_id, kind, COALESCE(slot_key,'')) WHERE state='ACTIVE'`(`V2.18__plan_b_detection.sql:34-36`). 도메인 `backend/modules/planb-detection/src/main/kotlin/com/trippilot/planbdetection/domain/PlanBTrigger.kt`.

### 3.2 추가 열

| 열 | 타입 | 뜻 |
|---|---|---|
| `severity` | varchar(7) NOT NULL DEFAULT `'RISK'` · CHECK `RISK`·`CAUTION` | 이 행의 심각도(§2) |
| `alerted_severity` | varchar(7) NULL | 이 행을 실은 **알림 사건**의 최고 심각도. NULL = 사건 없이 조용히 발화했거나 발화하지 않았다. "그 대상에 알린 최고 심각도"(BR-SA-08)의 재료 |
| `pushed_at` | timestamptz NULL | 이 행이 `push=true` 사건의 **대표**였던 시각 — 여행·KST 하루 푸시 상한의 집계 단위(BR-SA-10) |
| `version` | bigint NOT NULL DEFAULT 0 | 제자리 갱신·해제·소비·[끄기]의 낙관적 잠금. 충돌한 쪽은 다음 회차가 다시 판정한다 |

### 3.3 활성 유일 키 재생성 (INV-SA-4)

`ux_plan_b_trigger_active (trip_id, kind, affected_date, COALESCE(slot_key,'')) WHERE state='ACTIVE'`. **대상 = `kind × affectedDate × slotKey`**(BR-SA-05). 날짜가 키에 들어가는 이유: 날씨는 날짜 단위 신호(slotKey null)라 오늘 위험과 내일 위험이 동시에 ACTIVE 여야 한다. 유일 위반은 새 트랜잭션으로 1회 재시도한다.

### 3.4 `payload` 키 — 한 키 한 뜻

| 키 | 뜻 | 소비 |
|---|---|---|
| `detector` | 이 행을 **해제할 자격**이 있는 감지기 — §6 `source` 와 같은 어휘 | BR-SA-06. 키가 없는 옛 행은 감지기가 해제하지 않는다(시간·일정 만료로만 닫힌다) |
| `dataSource` | 원천 — 단기예보 `KMA_VILAGE`, 장소 `AI_VALIDATE`·`PLACE_STATUS` 같은 원천 상수 하나 | 응답 `attribution` 사영의 입력 |
| `variant` | §2 | 응답 `variant` |
| `variants`·`coverage`·`slotKeys`·`poiIds` | 날씨 — 그 날 관측한 변형들 · 영향 범위(`MOST`·`SOME`) · 영향 슬롯·POI | 선계산 재료(DEC-SA-4) |
| `poiId` | 장소 — 대상 POI | 선계산 제외 재료 |
| `baseAt` · 근거값 | 발표 시각, 판정에 쓴 수치(POP·WSD·TMP 등) | 되짚기 |

- **표시 문구 `attribution` 은 저장하지 않는다** — 응답이 `dataSource` 에서 만든다(BR-SA-24).
- payload 는 직렬화 가능 원시값만(현행 규약)이고 좌표를 싣지 않는다. 날씨 확인 경로의 `pop` 은 그대로 남는다.

### 3.5 상태와 전이 — 상태값은 늘리지 않는다

| 전이 | 일어나는 때 | 주체 |
|---|---|---|
| (신규) → `ACTIVE` | 발화 — 알림 사건을 싣거나(발화 + 알림) 조용히(배너만) | 판정(BR-SA-08) |
| (신규) → `SUPPRESSED` · `EXPIRED` | 억제 · 무영향. 무발화 행은 날짜·변형당 1번만 남긴다(행 증식 방지) | 판정 |
| `ACTIVE` → `ACTIVE` | 변형·심각도·문구·payload 가 바뀜 — **제자리 갱신**(triggerId 유지, `version`+1) | 판정(BR-SA-05) |
| `ACTIVE` → `EXPIRED` | 해제(BR-SA-06) 또는 만료 4원인(BR-SA-07). 원인은 요약 로그에만 | 판정 |
| `ACTIVE` → `SUPPRESSED` | [끄기](현행 `TriggerService.dismiss`) | 사용자 |
| `ACTIVE`·`EXPIRED` → `CONSUMED` | 반영 이벤트의 `targetDate == affectedDate`(BR-SA-14). 날짜가 다르면 무시 | `ReplanAppliedSubscriber` |

- triggerId 를 바꾸지 않는 것이 제자리 갱신의 요점이다 — 새 id 는 준비된 대안·알림 탭을 끊는다. 해제 뒤 다시 성립하면 새 행이고, 옛 id 로 들어온 앱은 상세의 `currentTriggerId` 로 잇는다(BR-SA-23).
- `DELAY`·`MANUAL` 행은 스윕이 만료·해제하지 않는다(U10 소관).
- 소비된 대상도 같은 판정표를 다시 탄다 — 적용 뒤에도 위험이 남으면 배너가 조용히 되살아난다(BR-SA-08).

### 3.6 채움

`should_replan = true` 인 기존 행에 `alerted_severity='RISK'`, `pushed_at=detected_at`. 기준선의 하루 상한 집계(`PlanBDetectionPersistence.kt:55-70` — `should_replan` 만 센다)와 같은 집합이라 이관 순간 상한이 끊기지 않는다. [끄기]로 `should_replan` 이 거짓이 된 행(`TriggerService.kt:170`)은 채움에서 빠지지만 기준선도 세지 않던 행이고, 그 대상은 억제가 덮는다.

### 3.7 `Sensitivity.dailyCap` 의 뜻

`PlanBTrigger.kt:111-114` 의 `LOW(2)·NORMAL(5)·HIGH(10)` 은 **"하루 새 발화 수" → "여행·KST 하루 푸시 대상 사건 수(위험만)"** 로 뜻이 바뀐다. 값은 그대로다(O-SA-9 · G-SA-3). 상한을 넘은 위험도 사건은 남고(`push=false`) 배너·알림함은 숨지 않는다.

---

## 4. `plan_b_suppression` 확장 (BR-SA-09)

| 열 | 타입 | 뜻 |
|---|---|---|
| `affected_date` | date NULL | DAY 범위 억제의 날짜 — [끄기]한 트리거의 `affectedDate` |
| `max_severity` | varchar(7) NULL · 어휘는 `severity` 와 같다 | 이 심각도 **이하**만 덮는다 — [끄기]한 트리거의 `severity`. NULL = 전부(옛 행 동작) |

- `covers(kind, slotKey, affectedDate, severity)` = 같은 kind ∧ (SLOT: 같은 slotKey / DAY: 같은 `affected_date` — 열이 NULL 인 옛 행은 날짜를 가리지 않는다 / TRIP: 전부) ∧ (`max_severity` NULL ∨ 신호 심각도 ≤ `max_severity`). 주의를 끈 억제는 같은 대상의 위험 격상을, 오늘을 끈 DAY 억제는 내일 대상을 덮지 않는다(PBT-SA-06).
- DAY 억제의 그날 만료(`TriggerService.kt:165-167`)는 그대로 둔다 — 날짜는 `affected_date` 가 가리고, 만료는 롤링 창의 옛 파드가 같은 결과를 내게 한다.

---

## 5. `plan_b_watch` — 감시 상태 (신설 · BR-SA-13 · G-SA-1)

| 열 | 타입 | 뜻 |
|---|---|---|
| `trip_id` | uuid FK → `trip` · ON DELETE CASCADE | |
| `source` | varchar | 감지기 출처(§6 닫힌 집합) |
| `status` | varchar(7) · CHECK `CHECKED`·`UNKNOWN` | 그 출처가 마지막 회차에 그 여행을 확인했는가 |
| `checked_at` | timestamptz | 그 상태를 기록한 회차 시각 |

PK `(trip_id, source)`.

- 판정이 그 회차에 부른 출처마다 1행을 덮어쓴다. 관찰 전용 출처·`dry-run` 은 쓰지 않는다(BR-SA-04).
- **`OFF` 는 저장하지 않는다** — 스윕 모드·출처 목록·live 여부에서 응답 시점에 만든다.
- 응답 `TriggerList.watch` = 출처 묶음(`weather` = `kma-forecast` · `closure` = `place` · `delay`)별 `CHECKED | UNKNOWN | OFF` + `checkedAt?`. `CHECKED` 는 마지막 확인이 신선 창(날씨 2시간·장소 14시간) 안이고 상태가 `CHECKED` 일 때만, 그 밖은 `UNKNOWN`, `delay` 는 늘 `OFF` 다.
- 감지기가 모름이거나 예산으로 못 본 여행은 행이 갱신되지 않아 시간이 지나면 `UNKNOWN` 이 된다 — 거짓 '정상'을 만들지 않는다(INV-SA-2).
- 모름은 `plan_b_trigger` 행을 만들지 않는다(INV-U4-09 승계) — 이 표와 요약 로그에만 남는다.

---

## 6. 감지기 계약 — 값 객체 (저장 없음 · DEC-SA-2)

### 6.1 `SituationDetector` (planb-detection `application`)

| 구성 | 뜻 |
|---|---|
| `source` | 닫힌 집합 `kma-forecast` · `kma-warning` · `airkorea` · `place`. payload `detector` · 감시 상태 `source` 와 같은 어휘 |
| `kind` | `kma-*`·`airkorea` = WEATHER, `place` = CLOSURE |
| `wants(phase, dayOffset)` | 그 회차·날짜를 볼지(기본 참). 장소 = 아침 오늘·저녁 내일, 특보 = 오늘만(BR-SA-01) |
| `isLive()` | 거짓이면 부르지 않는다 = 모름. 외부 API 감지기는 `WEATHER_MODE=kma` 일 때만 참 |
| `detect(target) → Detection` | **저장·이벤트를 하지 않는다**(캐시 외 부작용 없음) |

### 6.2 `SweepTarget` · `SweepPhase` · `WatchedTrip`

| 값 | 필드 | 비고 |
|---|---|---|
| `SweepTarget` | `tripId` · `accountId` · `date` · `phase` · `now` · `slots` · `active` | `slots` = 그 날 끝나지 않은 계획 슬롯(`PlannedSlotView` — 이름·카테고리·좌표·고정·위반 표시를 이미 싣는다, `ItineraryPlanFacade.kt:59-90`). `active` = 이 출처가 그 날 띄운 ACTIVE 트리거 |
| `SweepPhase` | `MORNING`(07:15) · `DAYTIME`(08:15~19:15) · `EVENING`(20:15·20:40) | 회차별로 보는 날짜는 BR-SA-01 |
| `WatchedTrip` | `tripId` · `accountId` · `startDate` · `endDate` | trip api `TripWatchFacade.findOverlapping(from, to, after, limit)`(신설 좁은 퍼사드). 키셋 순회(`after` = 마지막 tripId)라 회차 시작 키를 돌릴 수 있다(BR-SA-03) |

- 대상 여행은 삭제·종료가 아니고 현재 일정이 `CONFIRMED` 인 것(BR-SA-02) — 일정 상태는 `ItineraryRef.status`(`ItineraryFacade.kt:29`)로 읽는다. 끝나지 않은 슬롯이 없는 (여행, 날짜)는 감지기를 부르지 않는다.
- `WatchedTrip.accountId` 는 스케줄러 경로에 요청 계정이 없어서다 — U10 G-U10-3 과 같은 구멍을 이 값으로 닫는다. `TripFacade` 에 얹지 않는 이유는 구현·대역이 많은 퍼사드에 메서드 하나를 더하면 그 전부가 흔들려서다.

### 6.3 `Detection` · `DetectionSignal`

| 값 | 뜻 |
|---|---|
| `Detection.Checked(checked, signals)` | `checked: Set<slotKey 또는 null>` = 신호가 없다고 **확인한** 대상(null = 날짜 전체 — 확인 근거는 아래). `signals` = 발화 임계를 넘은 신호 |
| `Detection.Unknown(why)` | 모름 — 그 출처의 그 (여행, 날짜) 대상은 발화도 해제도 하지 않는다(INV-SA-2). 예외·회로 차단·키 미등록도 여기로 접힌다 |
| `DetectionSignal`(현행 `TriggerService.kt:28-39`) + 기본값 필드 | `severity`(기본 RISK) · `variant`(기본 null) · `dataSource`(기본 null) · `poiIds`(기본 빈). 날씨 확인·U10 호출자는 그대로 성립한다 |

- `checked` 는 '신호 없음'과 다르다 — 확인 근거가 있을 때만 넣는다. 날씨는 판정 시각 값이 다 있고 해제 임계 아래일 때(두 임계 사이 값은 신호도 `checked` 도 만들지 않는다 — 이력 현상이라 상태 저장이 필요 없다, BR-SA-06·15), 장소는 상태 `ACTIVE` ∧ 판정 `OK` ∧ 그 슬롯의 ACTIVE 가 `HOLIDAY` 가 아닐 때(BR-SA-17).
- 감지기 출력의 범위(scope)는 판정이 교정한다 — 오늘 = `PARTIAL_SLOTS`, 미래일 = `FULL_DAY`(BR-SA-11).

---

## 7. 장소 판정 값 — `DayCheck` · `CheckedSlot` · `HoursVerdict` · `PoiLifeStatus`

### 7.1 `DayCheck` (itinerary-generation api `ItineraryDayCheckFacade.checkDay(accountId, tripId, date): DayCheck?`)

- null = 소유 아님 · 일정 없음 · 그 날 없음. 외부 호출을 포함하므로 **트랜잭션 밖**에서 부른다.
- 그 날 하루만 검증한다(기존 `Revalidation.attempt`, `Revalidation.kt:38`) — 같은 장소의 다른 날 위반이 섞이지 않게. `judged=false` = 판정 보류(불통·5xx·시한).

| `CheckedSlot` 필드 | 뜻 |
|---|---|
| `slotKey` · `poiId` · `nameKo?` · `startAt` | 계획값. 확정 슬롯의 이름은 동결값(INV-U1-03) |
| `hours: HoursVerdict` | `VIOLATED` · `OK` · `UNKNOWN`(AI 모드가 http 가 아님 · 보류 · 영업시간 원문 없음) |
| `reasonCode?` | HC1 하위 코드 `CLOSED_DAY`·`OUT_OF_HOURS`·`HOLIDAY` — AI 가 싣지 않으면 null |
| `hoursWarnedBefore` | 그 슬롯이 이미 영업시간 위반 표시를 달고 있었는가 = `has_violation` ∧ `violation_reason` 이 HC1 문구(`영업시간과 맞지 않아요`, `ViolationText.kt:39`)를 담음. 문구의 주인은 `ViolationText` 한 곳 — HC2 문구·보류 중 중립 문구(`Revalidation.kt:79`)는 거짓 |

- 백엔드는 영업시간 원문도 위반 `detail` 도 파싱하지 않는다 — 해석은 AI 한 곳(BR-SA-17).
- 변형 사상: `reasonCode` 가 있으면 그 변형, 없거나 모르면 `HOURS_MISMATCH`. 이미 본 경고(`hoursWarnedBefore`)는 다시 알리지 않는다 — 폐업은 예외(편집 때 볼 수 없었다).

> **[개정 · 2026-10-20 — 구현 반영]** §7.1 — 하루 점검 계약의 구현 세부(#1401·#1410 · 규칙은 `business-rules.md` BR-SA-17 개정 블록).
> - 시그니처에 선택 인자가 더해졌다 — `checkDay(accountId, tripId, date, judgeHours = true): DayCheck?`(`backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration/api/ItineraryDayCheckFacade.kt:22`). `judgeHours=false` 면 AI 를 부르지 않는다 — 영업시간은 전부 `UNKNOWN`, 이름·`hoursWarnedBefore` 는 그대로. 장소 감지의 회차 회로가 쓴다.
> - **`judged=false` 는 보류뿐**(AI 를 불렀는데 예외 — 불통·5xx·시한). AI 를 부르지 않은 날(AI 모드 ≠ http · `judgeHours=false` · 영업시간을 아는 슬롯 없음)은 `judged=true` 이고 그 슬롯들이 `UNKNOWN` 이다 — 회로가 보류만 세려고 둘을 가른다(`ItineraryDayCheckFacade.kt:25-30` · `ItineraryDayCheckService.kt:57-61,69`). 볼 슬롯이 없는 날은 AI 0회로 `judged=true` · 빈 슬롯이다.
> - `hours = UNKNOWN` 의 원인에 '`judgeHours=false`'가 더해진다(`ItineraryDayCheckFacade.kt:51-52`).
> - `reasonCode` 는 #1410 부터 실제로 실린다 — 그 날 HC1 위반 가운데 위치가 있는 것의 `reason_code`(`ItineraryDayCheckService.kt:64-67,82`).
> - `hoursWarnedBefore` 의 'HC1 문구'에는 2026-09-28(TRIP-1030) 이전 저장분의 꼴(`영업시간 밖`·`요일 휴무`)도 든다(`ViolationText.kt:41-50`).

> **[개정 · 2026-10-22 — 구현 반영]** §7.1 — 미판정 장소(줄 번호 기준 커밋 `45288d752`(#1539) · 규칙은 `business-rules.md` BR-SA-17 개정 블록).
> - `hours = UNKNOWN` 의 원인에 **'AI 가 그 장소를 판정하지 못했다고 답함'**(검증 응답 `unverified_slots` 의 모든 사유 — 영업 창 모름 `HOURS_UNKNOWN`(원문 해석 실패 포함) · 미등록 `NOT_REGISTERED` · 매핑 실패 `UNMAPPABLE`)이 더해진다. `OK` 는 AI 가 그 장소의 영업시간을 실제로 보고 위반이 없다고 한 것이다(`backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration/api/ItineraryDayCheckFacade.kt:59-64`).
> - **`DayCheck.answered`**(신설) — AI 를 불러 답을 받았는가. 슬롯이 전부 `UNKNOWN` 이어도 참일 수 있다(그 날 장소를 하나도 판정하지 못했다는 답). 장소 감지의 회차 회로가 0 으로 돌아가는 근거다. `judged` 와 다르다 — `judged` 는 AI 를 부르지 않은 날도 참이고, `answered` 는 불러서 답을 받은 날에만 참이다. 기본값은 종전 추론(판정 있는 슬롯이 있으면 답한 것)이다(`:25-38`).
> - 하루 점검은 미판정 목록까지 돌려주는 포트 메서드로 검증한다 — 그 메서드의 기본 구현은 '못 본 장소 없음'이고 실 어댑터(`HttpScheduleAgentAdapter`)만 재정의한다(`backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration/domain/ScheduleAgentPort.kt:20-27`). 포트를 감싸는 데코레이터나 새 실 어댑터가 재정의를 빠뜨리면 미판정이 조용히 '확인'으로 돌아간다 — 열린 항목(검토 지적: 추상으로 두고 대역이 명시적으로 재정의하는 쪽이 안전하다).

### 7.2 `PoiLifeStatus` (place-data api `PoiStatusFacade.statusOf(poiIds): Map<UUID, PoiLifeStatus>`)

`ACTIVE` · `CLOSED` · `OTHER`. place-data `DataStatus` 4종(`Poi.kt:47`)을 접는다 — `LOST`·`UNVERIFIED` 는 `OTHER` = **폐업 아님·모름**. 없는 id 는 결과에서 빠진다. 상태 무관 조회(`Ports.kt:70-71` `findByIds`)를 쓴다 — ACTIVE 만 주는 조회로는 폐업을 볼 수 없다(PBT-SA-13). `PoiSurfaceFacade` 에 얹지 않는다(§6.2 와 같은 이유).

---

## 8. 날씨 원천

### 8.1 `weather_grid_forecast` — `GridForecast` (신설 · C11)

| 열 | 타입 | 뜻 |
|---|---|---|
| `grid_key` | varchar PK | 기상청 격자 `"nx,ny"`(예 제주 `"53,38"`) |
| `base_at` | timestamptz | 발표 시각 |
| `hourly` | jsonb | 예보 시각별 `POP`·`PTY`·`SKY`·`TMP`·`WSD`(오늘·내일 — 자정을 넘긴 내일 슬롯 몫으로 모레 시각까지) |
| `daily` | jsonb | 날짜별 `TMN`·`TMX` |
| `fetched_at` | timestamptz | |
| `expires_at` | timestamptz · CHECK `expires_at > base_at` | 발표 + 3시간 + 10분 |

- 격자당 1행(덮어쓰기). **정상 결과(코드 00)만 저장**한다 — 실패·NO_DATA 는 행을 만들지 않는다(INV-U4-09 승계).
- 읽기-통과 캐시: 신선하면 원천을 부르지 않고, 받아 온 값도 신선해야 쓴다. HTTP 는 트랜잭션 밖. jsonb 수는 읽을 때 수로 정규화한다.
- 공개 계약 `HourlyForecastFacade { isLive(); gridKeyOf(lat, lng): String?; forecastForTrigger(lat, lng, at): PointForecast? }` — null = 모름(자료 없음 · 상한 · 낡음 · live 아님). 출처의 고장은 `HourlyForecastUnavailable` 로 던진다 — 원인 코드가 있으면 게이트웨이 거절(그 출처 전체), 없으면 시한·5xx·형식 깨짐(그 격자). `gridKeyOf` 는 회차 안 실패 격자 기억의 키다(RES-SA-02·04). `PointForecast` = 그 격자 발표분의 시각별 `POP`·`PTY`·`SKY`·`TMP`·`WSD` + 날짜별 `TMN`·`TMX` + 발표 시각. `ContextFacade` 와 분리한다(구현 대역 보호).
- 파드당 하루 호출 상한(3,000)은 **이 격자 경로만** 센다 — 이름 경로·도우미 날씨 카드는 세지 않는다.

> **[개정 · 2026-10-22 — 구현 반영]** §8.1 — 날짜별 `TMN`·`TMX` 를 더 쓰지 않는다(사용자 결정 25번 (다)의 정리 · 줄 번호 기준 커밋 `b9c1cb52e`(#1540)). 기온 판정이 시간별 `TMP` 만 보게 되자 그 값을 읽는 곳이 없어졌다(`business-rules.md` BR-SA-15 개정 블록).
> - **`daily` 열** — 코드가 매핑하지 않는다(어댑터는 받지 않고, 저장·읽기에 싣지 않는다). DB 칸은 남기고 기본값 `'{}'` 만 둔다 — 확장형 마이그레이션 `V2.NN__weather_grid_forecast_daily_default.sql` 이 §16 표에 하나 더해진다(번호는 머지 직전 `origin/develop` 최댓값 + 1). NOT NULL 은 풀지 않는다 — 롤링 창의 옛 파드는 이 칸을 null 아닌 맵으로 읽는다(`backend/modules/weather-context/src/main/kotlin/com/trippilot/weathercontext/adapter/out/persistence/GridForecastPersistence.kt:17-35`).
> - 롤링 창 동안 새 파드가 처음 만든 행은 `daily = '{}'` 이고, 옛 파드가 쓴 행을 새 파드가 덮으면(UPDATE) 그 칸에 옛 값이 남는다 — 옛 파드만 읽는 칸이라 창이 닫히면 읽는 곳이 없다.
> - **칸 삭제(DROP COLUMN)는 후속**이다 — 이 칸을 쓰는 옛 파드가 남지 않은 다음 배포에서 한다. 추적하는 곳이 마이그레이션 머리말뿐이라 백로그 항목이 필요하다(`business-logic-model.md` §9 개정 블록).
> - **`PointForecast`** = 그 격자 발표분의 시각별 `POP`·`PTY`·`SKY`·`TMP`·`WSD` + 발표 시각이다 — 위 공개 계약 줄의 '+ 날짜별 `TMN`·`TMX`'는 없다(`backend/modules/weather-context/src/main/kotlin/com/trippilot/weathercontext/api/HourlyForecastFacade.kt:39-50`).

### 8.2 경보 읽기값 (저장 없음)

`WeatherAlertFacade { isLive(); warnings(at): AlertRead<List<ActiveWarning>>; airGrades(date, at): AlertRead<Map<AirRegion, AirGrade>> }`, `AlertRead = Ok(value) | Unknown(cause)`.

| 값 | 뜻 |
|---|---|
| `ActiveWarning` | 발효 중 특보의 종류·구역. 형식은 실응답 표본으로 고정한다 |
| `AirGrade` | 에어코리아 등급 문자열 **그대로**(변경 금지 — BR-SA-24) |
| `AirRegion` | 목적지 `regionCode` → 예보 권역. 코드가 없는 목적지(`TripFacade.kt:62-70` 이 정상이라 적는다)는 권역을 모른다 = Unknown |
| `Unknown(cause)` | 게이트웨이 오류(HTTP 401·403, `returnReasonCode` 20·22·30·31·32 — JSON 요청에도 XML 본문으로 온다)·시한·형식 깨짐. 키 미등록(30)도 여기다(O-SA-1) |

- 캐시는 메모리뿐이다 — 특보는 파드 메모리 20분(같은 발표면 다시 파싱하지 않는다), 대기질은 발표 단위. 원문을 DB 에 남기지 않는다.
- 한 출처의 Unknown 은 다른 출처의 발화·해제를 막지 않는다 — 감지기가 출처별이라서다(DEC-SA-2).

---

## 9. `replan_session` 확장 — `initiatedBy` · 낡음

| 추가 | 타입 | 뜻 |
|---|---|---|
| `initiated_by` | varchar(6) NOT NULL DEFAULT `'USER'` · CHECK `USER`·`SYSTEM` | `SYSTEM` = 위험 알림 사건으로 서버가 미리 연 세션(DEC-SA-4) |
| CHECK | `initiated_by <> 'SYSTEM' OR trigger_id IS NOT NULL` | SYSTEM 은 근거 트리거가 있다 |
| 부분 유일 | `(trigger_id) WHERE initiated_by = 'SYSTEM'` | 트리거당 SYSTEM 세션 1개 — 아웃박스 재배달 멱등의 마지막 방어선 |

- `isOpen`·`ux_replan_session_open` 은 그대로다 — INV-U4-06(여행당 열린 세션 ≤1)은 SYSTEM 까지 센다. 공존 규칙은 INV-SA-6 · BR-SA-18.
- SYSTEM 세션의 입력은 이벤트 `dateRisks` 에서 C10 이 만든다(사유·지시·제외 매핑은 C10 소유 — DEC-SA-4). `freeText` 는 비운다. 기준점은 서버 사다리(마지막 방문지·숙소)뿐이라 기기 좌표도 수집 로그도 없다(`ReplanSessionService.kt:135-140` 규칙 그대로).
- **낡음**(SYSTEM 만 · 사실 기준 · BR-SA-19): ① `targetDate` < 오늘 → EXPIRED ② 오늘이고 초안이 바꾸는 슬롯 중 계획 시작이 지난 것 → EXPIRED ③ 그 날 완료 방문이 초안에 없음 → STALE ④ 새 선계산에 대체돼 `CANCELED` → STALE. `isStaleAt` 은 시간에 단조(한 번 낡으면 계속 낡음)이고 USER 는 늘 거짓이다(PBT-SA-16). 적용 거절은 409 + `ErrorCode.EXPIRED`·`STALE`(`ErrorCode.kt:39-40`) — 시각을 다시 추정해 옮기지 않는다(DEC-U4-9). INV-SA-7.
- 응답 `ReplanSession` 에 `initiatedBy?`·`stale?`. `COLLECTING`·`SOLVING` 이 2분을 넘으면 `stale=true`(파드 재시작 고착 — 앱이 같은 입력으로 다시 요청한다).
- 조회 `GET /trips/{tripId}/replan-sessions/prepared?date=` = 그 날짜의 가장 최근 SYSTEM 세션(`CANCELED` 포함, `stale` 계산 포함) | 404(없음·타 계정 은닉). 트리거에는 세션 필드를 두지 않는다 — C9 는 C10 상태를 모르고, 날짜 키라 트리거 id 가 바뀌어도 이어진다.
- 선계산 결과 `Prepared = Opened | Skipped(DUPLICATE·TRIP_CAP·GLOBAL_CAP·INVALID·OPEN_SESSION·EARLIER_OPEN·BUSY)` 는 저장하지 않는다(요약 로그). 상한은 실제로 연 세션만 센다 — `BUSY` 는 세션이 없다(O-SA-10).

> **[개정 · 2026-10-20 — 구현 반영]** §9 — 위 '낡음' 줄과 `stale=true` 줄은 `business-rules.md` BR-SA-19 개정 블록대로 읽는다: `CANCELED` 는 닫힌 까닭과 무관하게 `STALE` · `APPLIED` 는 낡음 없음 · `NO_SOLUTION`·`FAILED` 는 날짜만 · 2분은 생성 시각(선계산은 실행 자리 대기 포함) 기준 · '시간에 단조'는 같은 상태 안의 말이다 — 2분 `stale` 은 산출이 끝나 상태가 바뀌면 다시 판정돼 풀릴 수 있다(`backend/modules/itinerary-recalculation/src/main/kotlin/com/trippilot/recalculation/domain/ReplanSession.kt:102-121`). 열린 세션 조회(`findOpenByTripForUpdate`)와 확정·취소의 세션 조회(`findByIdForUpdate`)는 행 잠금이다(BR-SA-18 개정 블록).

---

## 10. 이벤트

| 이벤트 | 발행 | 추가 필드(모두 기본값 null) | 구독 | 의미 변화 |
|---|---|---|---|---|
| `planb.PlanBTriggered` | planb-detection | `affectedDate`(yyyy-MM-dd KST) · `scope` · `severity` · `variant` · `push` · `others` · `dateRisks[{kind, variant, poiIds}]` | notification `PlanBTriggeredSubscriber`(기존 — `kind`·`push`·`others` 를 읽는다) · **itinerary-recalculation `PlanBTriggeredPrepareSubscriber`(신규)** | 트리거마다 1건 → **여행·판정 회차당 ≤1건**(대표). `aggregateId`·`kind`·`slotKey`·`reason` 은 대표의 것(INV-SA-3) |
| `recalculation.ItineraryRecalculated` | itinerary-recalculation(`APPLIED`) | `triggerId` · `targetDate` | notification `ItineraryRecalculatedSubscriber`(기존) · **planb-detection `ReplanAppliedSubscriber`(신규)** | 소비 재료(BR-SA-14) |

- **대표** = 위험 → 이른 날짜 → 이른 슬롯. `others` = 같은 사건에 실린 나머지 대상 수. `dateRisks` = 대표 날짜의 ACTIVE 위험 전부(이번 것 포함). `push` = 대표가 위험 ∧ 그 여행의 KST 오늘 `pushed_at` 수 < 상한(BR-SA-10).
- 날씨 확인(`POST …/triggers/weather-check`)·U10 `DELAY` 경로의 사건은 호출당 대표 1건짜리다.
- 위치 인자 6개 생성(`PlanBEvents.kt:14-21`)은 그대로 성립하고, 구독자는 JSON 트리로 읽는다 — 옛 행·옛 구독자 호환.
- 선계산 구독자는 `severity=RISK` ∧ 새 필드가 있을 때만 움직인다. 계약 위반·파싱 실패는 삼키고 일시 오류는 던져 재배달받는다 — 릴레이는 구독자를 서로 독립으로 돌린다.
- 멱등: 알림 `source_event_id` UNIQUE(`V2.31__notification.sql:22`) · SYSTEM 세션 부분 유일(§9) · 소비는 같은 전이를 두 번 해도 결과가 같다.
- **이벤트 고리가 없다**: `PlanBTriggered` → 선계산은 초안까지만이고(INV-SA-1), `ItineraryRecalculated` 는 사용자 [적용]에서만 나오며, 그 구독(소비)은 이벤트를 내지 않는다.
- 인셉션 이벤트 표(`component-dependency.md:66-67`)는 두 이벤트의 구독자를 notification 하나로 적는다 — 고치지 않고 상신 목록에 올린다(G-SA-8 · O-SA-15). U10 FD domain-entities §7 의 `PlanBTriggered` "변경 없음"은 개정 블록이 이 절을 가리킨다.

> **[개정 · 2026-10-20 — 구현 반영]** §10 — `planb.PlanBTriggered` 의 `dateRisks` 항목에 `coverage`(`MOST`·`SOME` — 날씨만, 기본값 null)가 더해졌다 — `dateRisks[{kind, variant, poiIds, coverage}]`(#1405 · `backend/modules/planb-detection/src/main/kotlin/com/trippilot/planbdetection/api/event/PlanBEvents.kt:45`). 판정이 그 트리거 payload 의 `coverage`(§3.4)를 옮기고(`TriggerService.kt:388`) 선계산 구독자가 읽는다(`PlanBTriggeredPrepareSubscriber.kt:73`). 선택 필드라 옛 구독자(알림)에 무해하다. G-SA-11 해소(§17 개정 블록).

---

## 11. 기회 — `Opportunity` (값 객체 · 저장 없음 · DEC-SA-6)

| 필드 | 뜻 |
|---|---|
| `key` | 결정론 순위·기기 숨김의 키 |
| `kind` | `EVENT_VENUE` · `EVENT_NEARBY` · `TRENDING` |
| `eventName?` · `start?` · `end?` | 행사 이름·기간 — **일 단위**(시각 필드 없음) |
| `poiId` · `poiName` | 등록 POI(INV-1 — 행사 자체는 후보가 아니다) |
| `nearSlotKey` | 가까운 남은 슬롯 |
| `distanceLabel` | 동선에서의 거리 표시 문자열(INV-3 — 거리만) |

- BE 포트 `OpportunityPort`(fun interface) → AI `POST /ai/v1/planb/opportunities`(LLM 0회). 응답 ≤3. AI 무응답·계약 위반 → 빈 목록.
- **트리거도 알림도 상태도 아니다** — 스케줄러·마이그레이션·야간 규칙이 없고 알림 경로를 타지 않는다(LEGAL-U6-02).
- 표시 원천: 공식(`tourapi-`)·수동 큐레이션 행사, `TRENDING` = POI 태그 `요즘 인기`(AI `domain/poi.py:21`). 네이버 추출 행사(`evx-`)는 표시하지 않는다(O-SA-12).

> **[개정 · 2026-10-20 — 사용자 결정 25~31]** §11 — 선택 필드 `eventType?` 를 더한다(사용자 결정 27번 (나) — `business-rules.md` BR-SA-22 개정 블록). 행사 카드(`EVENT_*`)의 행사 유형이다 — `FESTIVAL`(축제) · `PERFORMANCE`(공연) · `EXHIBITION`(전시) · `POPUP`(팝업). 분류 불가 `OTHER` 행사는 카드에 오르지 않는다(BR-SA-22 ②). AI 응답의 `event_type` 을 백엔드가 옮긴다. 쓰임 — 날씨 위험·반영 날 백엔드는 야외 축제(`FESTIVAL`·유형 모름)를 빼고, 앱은 날씨 위험 날 그 카드만 숨긴다. 값이 없거나 모르는 값이면 유형 모름이다.

> **[개정 · 2026-10-22 — 구현 반영]** §11 — `eventType?` 의 구현(줄 번호 기준 커밋 `df092009a`(#1541)). `TRENDING` 은 늘 null 이고, 행사 카드인데 null 이면 유형 모름(옛 AI · 모르는 값)이다. 백엔드는 모르는 `kind` 와 달리 모르는 유형 하나로 답 전체를 버리지 않는다 — 그 카드는 그대로 그릴 수 있고 날씨 위험 날 축제처럼 빠질 뿐이다(`backend/modules/planb-detection/src/main/kotlin/com/trippilot/planbdetection/domain/Opportunity.kt:18-34` · `adapter/out/external/HttpOpportunityAdapter.kt:91-105`). 앱 문장(`frontend-components.md` §4.2 템플릿)은 이 값으로 바뀌지 않는다. 필드 목록·와이어는 `business-rules.md` BR-SA-22 개정 블록.

---

## 12. 알림 쪽 값 (C14 · 스키마 무관)

| 값 | 내용 |
|---|---|
| `NotificationKind` | **늘리지 않는다** — 구 앱 알림함이 모르는 kind 를 구조분해하다 죽는다(`NotificationInboxPage.tsx:35`). DEC-SA-5 |
| `NotificationToggle.defaultFor(PLAN_B)` | 푸시 기본 ON(행 없는 계정만). 저장된 행은 존중한다(O-SA-14). `SLOT_PRE` 는 OFF 유지(`NotificationToggle.kt:40-43`) |
| `PushPolicy` | `Always` · `InAppOnly` · `OncePer(dedupPrefix, window)`. 사건 `push=false` → InAppOnly, `push=true`·필드 없음 → `OncePer("PLAN_B#{tripId}#", 10분)` — BR-U6-09 10분 창의 첫 구현(G-SA-2). 판정은 적재 성공 **뒤**(재배달이 두 번 세지 않게). BR-SA-21 |
| 억제 사유 | `IN_APP_ONLY`·`COALESCED` 를 기존 지표에 더한다 |
| 액션 | `PLANB_REPLAN {tripId, triggerId}` 그대로 — 세션 id·날짜를 싣지 않는다(앱이 탭 시점에 조회 — BR-SA-23) |

---

## 13. 불변식 (INV-SA-\*)

| ID | 불변식 | 지키는 곳 | PBT |
|---|---|---|---|
| **INV-SA-1** | 일정 쓰기는 사용자 [적용]만이다 — 감지·선계산은 초안까지(INV-U4-05 승계) | `ReplanSessionService.apply` 만 `ReplanFacade.apply` 를 부른다. SYSTEM 세션도 같은 apply 를 지난다 | PBT-SA-15 |
| **INV-SA-2** | 모름은 발화도 해제도 아니다 | `Detection.Unknown`·관찰 전용·꺼짐·미호출은 대상 상태를 바꾸지 않고 행도 만들지 않는다. 감시 상태는 시간이 지나 `UNKNOWN` | PBT-SA-02 · PBT-SA-09 |
| **INV-SA-3** | 여행·회차당 알림 사건 ≤1 | 판정이 여행 1개 = 트랜잭션 1개 안에서 사건을 1건만 발행한다 | PBT-SA-01 · PBT-SA-04 |
| **INV-SA-4** | 대상(`kind × affectedDate × slotKey`)당 ACTIVE ≤1 | `ux_plan_b_trigger_active`(§3.3) · 제자리 갱신 | PBT-SA-03 |
| **INV-SA-5** | KST 21:00~06:59 에는 쓰기·발행이 0 이고, 회차 안에서도 20:58 이후에는 쓰지 않는다 | cron 창 · 회차 안 시각 컷 | PBT-SA-07 |
| **INV-SA-6** | SYSTEM 선계산은 30분 안에 열린 USER 세션을 닫지 않는다 | 선계산의 열린 세션 정책(BR-SA-18) | PBT-SA-14 |
| **INV-SA-7** | 낡은 SYSTEM 초안은 적용하지 않는다 | apply 의 낡음 검사(409 EXPIRED·STALE, §9) | PBT-SA-16 |

승계: INV-U4-01(`should_replan=false` 행 비노출 — CHECK 유지) · INV-U4-02(억제는 감지 단계) · INV-U4-06(열린 세션 ≤1) · INV-U4-09(조회 실패 시 행 없음) · INV-1(기회는 등록 POI) · INV-3.

---

## 14. 모듈 간 의존 — 순환 없음

| 의존(api 만) | 쓰는 공개 계약 | 모듈 의존 |
|---|---|---|
| C9 planb-detection → C6 trip | `TripFacade`(기존) · `TripWatchFacade`(신설) | 기존(`planb-detection/build.gradle.kts:13`) |
| C9 → C8 itinerary-generation | `ItineraryFacade`(기존) · `ItineraryPlanFacade`(새로 쓴다) · `ItineraryDayCheckFacade`(신설) | 기존(같은 파일 :14) |
| C9 → C11 weather-context | `ContextFacade`(기존) · `HourlyForecastFacade`·`WeatherAlertFacade`(신설) | 기존(같은 파일 :15) |
| **C9 → C7 place-data** | `PoiStatusFacade`(신설) | **새 의존** |
| **C10 itinerary-recalculation → C9 planb-detection** | `TriggerLookupFacade.find(tripId, triggerId): TriggerRef?`(신설 — `kind`·`state`·`affectedDate`·`scope`·`currentTriggerId`) | **새 의존** |

| 이벤트 구독(컴파일 의존 없음 — 이벤트 타입 문자열) | 구독자 |
|---|---|
| C10 ← `planb.PlanBTriggered` | `PlanBTriggeredPrepareSubscriber` |
| C9 ← `recalculation.ItineraryRecalculated` | `ReplanAppliedSubscriber` |

- **순환 없음**: place-data 는 core 에만 의존한다(`place-data/build.gradle.kts:12`) — C9→C7 에는 되돌아오는 길이 없다. planb-detection·itinerary-recalculation 에 의존하는 모듈은 app 뿐이고(`backend/app/build.gradle.kts:21-22`), C9 의 의존(trip·itinerary-generation·weather-context·place-data) 어느 것도 C10 에 닿지 않는다 — C10→C9 는 단방향이다. 이벤트 두 구독은 고리가 사용자 [적용]에서 끊긴다(§10).
- 새 공개 계약은 각 모듈 `api` 패키지에 둔다 — R1(`ArchitectureRulesTest.kt:100-109`).
- `ReplanSessionService.kt:221-223` 주석("C10 은 C9 에 의존하지 않는다")은 이 의존과 어긋난다 — 의존을 여는 변경이 주석을 함께 고친다.
- `TriggerLookupFacade` 는 계정을 받지 않는다 — 호출자(C10 진입 검증·트리거 상세)가 여행 소유를 먼저 확인하고, 트리거는 그 여행 범위로 좁혀 찾는다. 없거나 다른 여행이면 진입 검증은 409, 상세 조회는 404 다(BR-SA-20).

---

## 15. 저장하지 않는 것

- 감시 `OFF`, 만료·해제 원인, 선계산 `Skipped` 사유, 회차 식별자 — 요약 로그뿐.
- 표시 문구 `attribution`(응답 사영), 특보·대기질 원문(파드 메모리 캐시).
- 트리거의 준비 세션 id·재계획 지시 키 — 날짜 키 조회와 C10 매핑이 대신한다(DEC-SA-4).
- 기회 카드와 그 숨김 — 조회형이고 숨김은 기기 로컬이다.
- 새 `TriggerKind`·새 트리거 상태값·새 `NotificationKind`.

---

## 16. 마이그레이션 (이름만 — 번호는 머지 직전 `origin/develop` 최댓값 + 1)

| 이름 | 내용 |
|---|---|
| `V2.NN__plan_b_situation.sql` | `plan_b_trigger` 열 4 · 활성 유일 키 재생성 · 채움(§3.6) / `plan_b_suppression` 열 2 / `plan_b_watch` 신설 |
| `V2.NN__weather_grid_forecast.sql` | `weather_grid_forecast` 신설 |
| `V2.NN__replan_session_initiated_by.sql` | `initiated_by` + CHECK + 부분 유일 |

- 전부 확장형(상수 기본값)이라 롤링 창의 옛 파드에 무해하다. 권한은 기본 권한(`V1.7`)이 덮는다. 엔티티 매핑은 같은 변경에 싣는다(`ddl-auto=validate`).
- 번호를 적지 않는 이유: 다른 작업도 마이그레이션을 계속 낸다 — 중복은 Flyway 검증이 CI 에서 막는다.

---

## 17. 갭 (G-SA-\*)

갭 표의 본체는 `business-logic-model.md` §9(G-SA-1~14)다 — 아래는 그 가운데 엔티티 경계에서 드러난 두 건의 상세다.

| ID | 갭 | 다룰 곳 |
|---|---|---|
| **G-SA-10** | **실외 판정 재료에 태그가 없다.** `SweepTarget.slots`(`PlannedSlotView`)는 카테고리만 싣는데, `액티비티` 에는 실내 나이트라이프(클럽·바)가 태그로 함께 담긴다(AI `domain/poi.py:16-18`). 실외 집합 {자연·야경·액티비티}는 그 슬롯에도 날씨 신호를 낸다. 재계획 회피 집합(`ai/data/replan_directives.yaml:61,131` INDOOR·AVOID_OUTDOOR)도 같은 집합이라 "경보 대상 = 재계획이 바꾸는 대상"은 지켜진다 | 설계의 실외 집합을 유지한다. 바꿀 때는 재계획 회피 집합과 한 번에, 태그를 슬롯 사영에 싣는 것은 C8 계약 변경이다(O-SA-5 와 같은 줄) |
| **G-SA-11** | **`dateRisks` 항목에 영향 범위가 없다.** 선계산 매핑은 날씨 위험의 제외 POI 를 `coverage = SOME` 일 때만 쓰는데(DEC-SA-4), 이벤트 항목은 `{kind, variant, poiIds}` 뿐이라 C10 이 SOME·MOST 를 가를 재료가 없다(`coverage` 는 트리거 payload 에만 있다, §3.4) | 항목에 선택 필드 `coverage`(날씨만)를 더하는 쪽을 권한다 — 사실은 C9 가 싣고 매핑은 C10 이 갖는 분업이 유지된다. 이벤트 선택 필드라 옛 구독자에 무해 |

> **[개정 · 2026-10-20 — 구현 반영]** **G-SA-11 해소** — 권고대로 항목에 선택 필드 `coverage`(날씨만)를 더했다(#1405 · §10 개정 블록). 단기예보는 영향 슬롯 수로 `MOST`·`SOME` 을 가르고 특보·대기질은 늘 `MOST` 다. 사실은 C9 가 싣고 매핑(`SOME` 일 때만 영향 POI 제외)은 C10 이 갖는 분업 그대로다(`backend/modules/itinerary-recalculation/src/main/kotlin/com/trippilot/recalculation/application/ReplanMaterial.kt:60`).
