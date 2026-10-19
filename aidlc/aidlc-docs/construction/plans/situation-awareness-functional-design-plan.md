# Plan-B 상황 자가 인지(situation-awareness) — Functional Design Plan

> **기능**: 여행 중(과 여행 전날) 일정을 막거나 흔드는 상황을 **서버가 먼저 찾는다** — 위험은 푸시로 알리고 대안을 미리 짜 두며, 주의는 앱 안에만 보이고, 기회는 앱 안 카드로만 권한다. 일정은 언제나 사용자의 [적용]으로만 바뀐다(INV-SA-1 — INV-U4-05 승계)
> **위치**: **U4 확장** — 번호 없는 확장 폴더 `construction/situation-awareness/`(O-SA-15). 새 컴포넌트를 만들지 않고 C9·C10·C11·C14 를 넓히며 C6·C7·C8 의 api 를 소비한다(§1.4). 원 문서(U4·U6·U3·U10)에는 새 규칙 본문을 쓰지 않고 `[개정 · 2026-10-19 · situation-awareness FD]` 블록으로 SA ID 를 가리키기만 한다
> **스토리**: 신규 스토리 없음 — US-PLANB-02 (a)(b) 확장 · US-NOTIF-03. 기회 카드는 스토리 후보로 **상신만** 한다(인셉션 사후 개정은 사용자 명시 승인 시 — O-SA-15)
> **발의**: 2026-10-18 사용자 요청 — 중간평가 피드백("자체적으로 변수상황을 판단해서 사용자에게 알리고 재계획을 하게"). 원문은 §5.0
> **범위 주의(SCOPE.md 2026-10-12)**: 설계 문서만 — Code Generation·Build and Test 제외(코드는 팀이 각 패키지에서 개발). SCOPE.md 현행 범위 목록(U0~U6 사후 개정 · U8 · U10)에 새 유닛을 더하지 않는다 — U4 개정 블록 체계 안의 확장이다(O-SA-15)
> **선행**: U3(2026-08-07)·U4(2026-08-09)·U6(2026-08-24)·U10(2026-10-12) 설계 종료 + 팀 구현. U10 의 `DELAY`(체류 초과·이동 지연, TRIP-1407)는 이 기능 밖이다 — 같은 트리거 모델·판정 경로를 나눠 쓸 뿐, 스윕은 `DELAY` 를 만료·해제하지 않는다
> **입력**: 구성요소 설계 8건 → 반박 검토 3종 → 통합 설계 초안(2026-10-18 작성, 10-19 추가 사실 반영) — §4 2번
> **작성**: 2026-10-19 · 실측 기준 `origin/develop` `f52f58cf7`

---

## 실장 우선 순위 (U5·U10 선례 승계)

위가 이긴다. 아래가 위와 다르면 **아래를 정정 대상으로 기록**하고 위를 따른다.

1. **리포 실물** — `backend/modules/*`·Flyway 마이그레이션 · `ai/src/trippilot/*`·`ai/data/*` · `frontend/src/*`·`frontend/app.config.ts` · `deploy/eks/*`
2. **패키지 계약 정본** — `backend/docs/design/openapi.yaml` · `ai/docs/openapi.json` · `frontend/README.md`
3. **라이브 Figma**(화면 정본)
4. **기존 aidlc 산출물** — U3·U4·U6·U10 FD·NFR(상속, 재서술 금지)
5. inception 문서

> **설계 초안과 실물**: 사실은 실물로 확인하고 결정은 초안을 따른다. 둘이 어긋나면 `business-logic-model.md` §9 의 갭(G-SA-\*)으로 남긴다.
> **예외 — 따르지 않고 사용자에게 올린다**: INV-1~4 · INV-U4-05(일정 쓰기는 사용자 [적용]만) · LEGAL-U6-02(알림 경로는 정보성만)와 정면 충돌할 때.

---

## 1. 기능 정의 초안

### 1.1 목적

사용자 요청(§5.0)의 "변수상황 자가 인지" — 사용자가 앱을 열거나 버튼을 누르기 전에, 서버가 진행 중 여행(과 내일 시작하는 여행)의 남은 일정을 정해진 회차마다 다시 본다. 일정을 막는 상황을 찾으면 알리고 대안을 미리 짜 두며, 일정 밖의 좋은 기회는 앱 안에서만 권한다. 판정 재료가 틀릴 수 있는 외부 데이터(예보·휴무 원문·특보)이므로 **모름은 발화도 해제도 아니다**(INV-SA-2 — BR-U4-05·INV-U4-09 승계).

### 1.2 포함 범위 (1차 — Q2 답 전부)

| # | 상황 | `kind` · `payload.variant` | 감지 근거 | 심각도 | 알림 | 규칙 |
|---|---|---|---|---|---|---|
| F1 | 비·눈·강풍·한파 | WEATHER · `RAIN`·`SNOW`·`WIND`·`COLD` | 단기예보 — 남은 **실외** 슬롯의 판정 시각 | 위험 | 푸시 | BR-SA-15 |
| F2 | 폭염 | WEATHER · `HEAT` | 12~17시와 겹치는 실외 슬롯의 TMP·TMX | 33℃ 주의 · 35℃ 위험(O-SA-2) | 위험만 푸시 | BR-SA-15 |
| F3 | 흐림(야경·노을 가림) | WEATHER · `CLOUD` | 야경 슬롯 시각 과반이 흐림 ∧ 강수 없음 | 주의(O-SA-4) | 알림함만 | BR-SA-15 |
| F4 | 기상특보 | WEATHER · 종류별 `RAIN`·`SNOW`·`WIND`·`COLD`·`HEAT`·`DUST` | 특보현황 × 여행 목적지, 오늘만 | 위험 | 푸시 | BR-SA-16 |
| F5 | 미세먼지 | WEATHER · `DUST` | 에어코리아 예보 권역 등급, 오늘·내일 | 나쁨 주의 · 매우나쁨 위험(O-SA-3) | 위험만 푸시 | BR-SA-16 |
| F6 | 정기 휴무 · 영업시간 밖 · 영업시간 불일치 | CLOSURE · `CLOSED_DAY`·`OUT_OF_HOURS`·`HOURS_MISMATCH` | AI validate HC1(하위 코드는 BE·AI 한 PR 뒤 — 그 전엔 `HOURS_MISMATCH` 하나) | 위험 | 푸시 | BR-SA-17 |
| F7 | 공휴일 휴무 | CLOSURE · `HOLIDAY` | 특일 달력 × 휴무 원문의 휴일 규칙 | 위험 | 푸시 | BR-SA-17 |
| F8 | 폐업 | CLOSURE · `PERMANENTLY_CLOSED` | place-data `data_status=CLOSED`(LOST·UNVERIFIED 는 폐업이 아니다) | 위험 | 푸시 | BR-SA-17 |
| F9 | 근처 행사 · 요즘 인기 | **트리거 아님** — 카드 종류 `EVENT_VENUE`·`EVENT_NEARBY`·`TRENDING` | 기간이 겹치는 행사 · '요즘 인기' 태그 × 남은 슬롯 1km 안 **등록 POI** | 기회 | **알림 경로 밖**(앱 안 카드) | DEC-SA-6 · BR-SA-22 |
| F10 | 저녁 '내일' 점검 · 여행 전날(D-1) 점검 | F1~F8 전부 | 20:15·20:40 회차 — 내일 / 내일 시작하는 여행의 첫날 | 변형별 | 변형별 | DEC-SA-7 · BR-SA-01·11·20 |
| F11 | 미리 짜 둔 대안 + 앱 진입 게이트 | — | 위험 대표 사건 | — | — | DEC-SA-4 · BR-SA-18~20·23 |
| F12 | 감시 상태 표면 | — | 출처 묶음별 마지막 확인 | — | — | BR-SA-13 |

'위험' = 푸시 대상(하루 상한 안) · '주의' = 알림함·배너만 · '기회' = 알림 경로 밖(DEC-SA-3·5). 변형은 닫힌 12종(WEATHER 7 · CLOSURE 5)이고 `DELAY` 의 `OVERSTAY`·`TRANSIT` 은 U10 이 같은 enum 에 더한다(DEC-SA-3). 특보·미세먼지·공휴일은 Q3 답으로 1차에 들어오고, 키가 통하기 전에는 그 감지기만 '모름'으로 돈다(BR-SA-04 · O-SA-1).

### 1.3 범위 밖 (명시)

- **이동 지연·체류 초과**(`DELAY`) — U10 소관(TRIP-1407). 스윕은 `DELAY` 트리거를 만료·해제하지 않는다
- `TriggerKind` 추가(DEC-U4-4 유지) · 새 `NotificationKind` · 기회의 알림함·푸시(LEGAL-U6-02)
- 카카오 실재 확인을 판정 근거로 쓰기(2026-09-12 '배제 대신 강등' 결정 유지) · 네이버 블로그 언급 인기 신호(약관 — 2026-09-01 접음)
- 안드로이드 알림 채널 `channelId`(TRIP-860 — 리마인드 푸시까지 바뀐다, 별도)
- **후속**(이 기능의 PR 에 싣지 않는다): 결정론 `include_poi_ids` · 사용자(USER) 세션 낡음 판정 · 홈 경보 줄(Figma 프레임 뒤) · `plan_b_trigger` 보존·정리 · 넓혀 읽은 휴무 강등(O-SA-13) · 계정 삭제 대기 계정의 푸시 토큰 비활성화 · 재계획 산출의 AI 호출을 트랜잭션 밖으로(선계산 동시성 확대의 선행) · iOS 푸시 개통(외부 선행 — G-SA-7 · O-SA-8)

### 1.4 컴포넌트·의존

| 대상 | 이 기능이 넓히는 것 | 근거 |
|---|---|---|
| **C9 Plan-B Detection** (`planb-detection`) | 감시 스윕 · 감지기 계약 하나 · 판정 쓰기 경로 하나(reconcile) · 트리거 생명주기(식별·제자리 갱신·해제·만료·소비) · 감시 상태 · 트리거 상세 조회 · 기회 조회(BE) | DEC-SA-1·2·3·6 · BR-SA-05~07·13·14 |
| **C11 Weather & Context** (`weather-context`) | 시간별 격자 예보(오늘·내일) · 특보 · 대기질 원천 | BR-SA-15·16 |
| C8 Itinerary Generation (`itinerary-generation` api) | 하루치 영업시간 재검증 퍼사드 | BR-SA-17 |
| C7 Place Data (`place-data` api) | POI 생애 상태 조회(ACTIVE · CLOSED · 그 밖) | BR-SA-17 |
| C6 Trip (`trip` api) | 감시 대상 여행 조회(기간·계정) | BR-SA-02 |
| **C10 Itinerary Recalculation** (`itinerary-recalculation`) | 미리 짜 둔 대안(SYSTEM 세션) · 날짜로 찾는 준비된 대안 · 트리거 진입 날짜 강제 · 전날 창 · 낡은 초안 거절 | DEC-SA-4 · BR-SA-18~20 · INV-SA-6·7 |
| **C14 Notification** (`notification`) | 제목 3종 · 사건이 정하는 푸시 여부 · 같은 여행 10분 1회 · PLAN_B 푸시 기본 ON | DEC-SA-5 · BR-SA-21 |
| AI (`ai/`) | HC1 하위 코드 · 공휴일 규칙(BE·AI 한 PR) · 기회 경로(LLM 0회) | BR-SA-17·22 |
| 클라이언트 | 푸시 수신·탭 · 진입 게이트 · 변형 라벨·날짜·출처 · 감시 3상태 · i06 낡음·미포함 안내 · 기회 카드 | BR-SA-12·13·22·23·24 |

의존 방향(R1 — 다른 모듈의 `api` 만): C9 → C6·C7·C8·C11 api(C7 이 새로 붙는다) · C10 → C9 api(트리거 조회 퍼사드 하나 — C9 은 C10 에 의존하지 않아 순환 없음). 이벤트는 타입 문자열로 구독한다(컴파일 의존 없음): C10 ← `planb.PlanBTriggered` · C9 ← `recalculation.ItineraryRecalculated`.

### 1.5 다른 작업과의 경계 (최초 요청 "코드꼬이거나 겹치지 않게 해")

- **재계획 작업과**: 공휴일 규칙을 검증·조립 8곳에 넣는 AI+BE 한 PR 은 재계획 '다시 짜기 1회 수리'(`ai/src/trippilot/agents/schedule/agent.py` · `assembly_engine/fallback_assembler.py` · `agents/planb/composition.py`) 머지 뒤 착수하고, 헬퍼 시그니처를 먼저 합의한다. 그 전의 PR 은 이 파일들을 건드리지 않는다
- 실외 집합은 백엔드 상수 옆 주석으로 AI 정본(`assembly_engine/config.py` `RAIN_OUTDOOR` · `ai/data/replan_directives.yaml` INDOOR·AVOID_OUTDOOR)을 가리키기만 한다 — 거울 테스트·backend-ci 경로 연결을 두지 않는다(재계획 작업이 몰린 파일에 백엔드 게이트를 묶지 않는다)
- 선계산은 AI 재계획 요청 모양을 바꾸지 않는다 — `ReplanRequest.trigger` 는 보내지 않는 키로 남는다(`itinerary-generation/…/contract/AiBoundaryOpenApiTest.kt:257-258`)
- 장소 감지는 validate 포트·와이어·HTTP 어댑터·경계 계약 테스트를 바꾸지 않는다 — validate 의 미검증 슬롯은 POI 상태 조회로 대신하고, 하위 코드(`reason_code`)는 BE·AI 한 PR 에서만 연다
- 행사 원천(`EventType`·`JsonEventStore.upsert(…, covered=)`·`tourapi-` 접두·병합)은 **소비만** 한다. 휴일 규칙 파서는 새 파일에 두고 `poi_curation/sourcing/mapping.py` 는 휴무 어휘 상수 import 만 한다
- U10 `DELAY` 와는 같은 모듈·같은 트리거 모델을 쓰되 락 이름·파일·설정 키를 나눈다. `shedlock` 의존 한 줄은 먼저 들어간 쪽을 따른다
- 마이그레이션 번호는 이름만 정하고 머지 직전 `origin/develop` 최댓값 + 1 로 붙인다(중복은 Flyway 자체 검증이 CI 에서 막는다)

---

## 2. 현재 구현 기준선 (2026-10-19 실측 · `origin/develop` `f52f58cf7`)

경로 표기: `backend/modules/<모듈>/src/main/kotlin/com/trippilot/<패키지>/`(app 은 `backend/app/src/main/kotlin/com/trippilot/app/`)를 `<모듈>/…/` 로 줄인다. 마이그레이션은 `backend/app/src/main/resources/db/migration/`.

### 2.1 있는 것

| 자산 | 경로 | 의미 |
|---|---|---|
| 트리거 모델 | `planb-detection/…/domain/PlanBTrigger.kt:72·75·77` | `TriggerKind{WEATHER, CLOSURE, DELAY, MANUAL}` · `TriggerScope{FULL_DAY, PARTIAL_SLOTS, NONE}` · `TriggerState{ACTIVE, SUPPRESSED, CONSUMED, EXPIRED}`. 심각도·변형 칸은 없고 자유 `payload` 만 있다 |
| 판정(순수) | `planb-detection/…/domain/TriggerEvaluator.kt:49-63` | 무영향 → 같은 kind·slot 발화 중 → 억제 → 하루 상한 → 발화. 날짜·심각도를 보지 않는다 |
| 판정·기록·발행 | `planb-detection/…/application/TriggerService.kt:64-135` | 여행 구간 밖 무동작(:69-73) · 무발화도 행을 남김 · 발화 시 `planb.PlanBTriggered`(6필드 — `api/event/PlanBEvents.kt:14-24`)를 같은 트랜잭션 아웃박스로(:124-133) |
| 날씨 신호원 | `planb-detection/…/application/WeatherTriggerService.kt:42-84` | 사용자 요청 `POST /trips/{tripId}/triggers/weather-check`(`adapter/in/web/TriggerController.kt:52-56`)에서만 돈다 · 오늘 · 첫 목적지 · 강수확률 ≥ 60(:93) · slot 없음·FULL_DAY · 사유 `비 예보 N%` |
| 억제 | `planb-detection/…/application/TriggerService.kt:148-171` · `domain/PlanBTrigger.kt:80-107` | [끄기] → SLOT 또는 DAY 억제(DAY 는 그 날 끝에 만료 — :167). `covers(kind, slotKey)`(:100-101)는 날짜·심각도를 보지 않는다 |
| 하루 상한 | `planb-detection/…/domain/PlanBTrigger.kt:112-114` | 민감도 LOW 2 · NORMAL 5 · HIGH 10(계정 단위, 행 없으면 NORMAL) |
| 트리거 테이블 | `V2.18__plan_b_detection.sql:5-36` | 발화 안 한 판정도 행으로 · `chk_plan_b_trigger_active`·`_scope` · 유니크 `ux_plan_b_trigger_active (trip_id, kind, COALESCE(slot_key,'')) WHERE state='ACTIVE'`(:34-36) — **날짜가 없다** |
| 단기예보 | `weather-context/…/adapter/out/external/KmaWeatherAdapter.kt:109-123` · `KmaWeatherConfiguration.kt:31-33·41` | `getVilageFcst` 1회 = HTTP 1건, 그 날 `POP` 최댓값만 읽는다 · 지역명 → 대표 좌표 → 격자 · 재시도·서킷 없음 · connect 3s·read 5s · `trippilot.weather.mode=kma` 일 때만 실 빈 |
| 계획 슬롯 | `itinerary-generation/…/api/ItineraryPlanFacade.kt:59-90` | `PlannedSlotView` — slotKey·시각·고정·자정 넘김·위반 표시·`violationReason`·이름·카테고리·좌표(확정분은 동결 이름) |
| 위반 문구·재검증 | `itinerary-generation/…/application/ViolationText.kt:38-44` · `Revalidation.kt:38` | HC1 → `영업시간과 맞지 않아요`(type 만 믿고 문구를 소유) · validate 재사용 지점 `Revalidation.attempt` |
| 재계획 산출 | `itinerary-generation/…/application/ReplanFacadeService.kt:71-85·211-219·239-242·302` | readOnly 트랜잭션 안에서 AI `replan`(시한 25s) · FULL_DAY 면 지난 미완료 슬롯을 잠그지 않는다 · apply 에 CONFIRMED 가드 없음(여행 중 반영) |
| 재계획 세션 | `V2.17__replan_session.sql:12·26-27·42-44` · `itinerary-recalculation/…/application/ReplanSessionService.kt:78-148·201-212` | `trigger_id` 칸 · 상태 7종 · 열린 세션 1개 유니크 · 진입은 여행 기간 안만(:82-84) · 열린 세션을 닫고 시작(:104-107) · targetDate 생략 = 오늘(:173) · 미래일은 FULL_DAY 만(:177-181) · apply → `ItineraryRecalculated(tripId, sessionId)`(:210 — `api/event/RecalculationEvents.kt:10-16`) |
| 복원 잠금 | `itinerary-generation/…/application/ItineraryRevisionService.kt:131` | 확정 일정은 리비전 복원이 409 |
| 알림 | `notification/…/adapter/in/event/DomainNotificationSubscribers.kt:66·81·83·86·89-92` · `domain/NotificationToggle.kt:35-42` · `application/NotificationRaiseService.kt:41-75` | 제목 상수 `일정을 다시 짜는 게 좋겠어요` · 본문 = 사유(없으면 `오늘 일정에 영향을 주는 상황이 감지됐어요`) · dedupKey `PLAN_B#{tripId}#{slotKey}` · 액션 `PLANB_REPLAN{tripId, triggerId}` · PLAN_B·SLOT_PRE 푸시 기본 OFF · 인앱 적재 → 푸시(중복은 `source_event_id` UNIQUE 로만) |
| 스케줄링·락 | `app/…/config/AsyncConfig.kt:30` · `ShedLockConfig.kt:20` · `app/…/event/OutboxRelay.kt:83-95` | `@EnableScheduling` · ShedLock(기본 lockAtMostFor PT5M) · 릴레이 락 `outbox-relay` · 같은 이벤트의 구독자는 서로 독립, 하나라도 실패하면 이벤트째 재시도(#1348) |
| 여행 조회 | `trip/…/api/TripFacade.kt:16·22` · `TripOwnerFacade.kt:17` · `V2.37__trip_ended_at.sql:19` | 계정 + 여행 단건 · 여행 → 소유자 단건 · 부분 인덱스 `ix_trip_pending_end`(종료 기록 없음 ∧ 삭제 아님) |
| POI 상태 | `V2.0__place_data.sql:14` · `R__seed_stub_pois.sql:61` | `data_status ∈ {ACTIVE, UNVERIFIED, LOST, CLOSED}` · 시드 폐업 POI `e0000000-0000-4000-8000-0000000000f2` |
| AI 실외 집합·지시 사전 | `ai/src/trippilot/assembly_engine/config.py:96-102` · `ai/data/replan_directives.yaml:55·128` | 실외 = NATURE·NIGHT_VIEW·ACTIVITY, 식당·명소·숙소는 중립 · 지시 키 `INDOOR`·`AVOID_OUTDOOR` |
| AI HC1·위반 | `ai/src/trippilot/assembly_engine/constraints.py:41` · `api/schemas.py:286` · `api/routes.py:202` | `check_hc1` · `ViolationSchema`(하위 코드 칸 없음) · `to_violation` |
| AI 행사 | `ai/src/trippilot/domain/event.py:25` · `background/event_store.py:107-108` · `llm_gateway/gates/event_extraction.py:165` | `EventType.POPUP` · `JsonEventStore.upsert(…, covered=)` · 네이버 추출 행사 id `evx-` · 공식 축제 id `tourapi-<contentid>`(#1333). 신선도·공식 축제 적재는 #1326·#1328·#1333·#1342·#1344·#1345 — 소비만 한다 |
| AI 휴무 어휘 | `ai/src/trippilot/poi_curation/sourcing/mapping.py:292·297` | `_IRREGULAR_REST`·`_HOLIDAY_TAIL` |
| 프런트 트리거 표면 | `frontend/src/features/planb/model/triggerLabel.ts:25-30` · `pages/live/live-itinerary/model/triggerWatchlist.ts:17-18·53` · `features/planb/config/watchLabels.ts` · `frontend/app/trips/[tripId]/planb/index.tsx` | kind 라벨 4종(WEATHER = `비 예보`) · 감시 행 3개 — 발화가 없으면 `정상` · 상태 2종(활성·정상) · i04 라우트가 `triggerId`·`targetDate` 를 받는다 |
| 프런트 알림함 | `frontend/src/pages/settings/notification-inbox/ui/NotificationInboxPage.tsx:35` · `model/notificationKind.ts:27-29` | 모르는 kind → `KIND_META[kind]` 가 undefined 인 채 구조분해 |
| 배포·스위치 | `deploy/eks/runtime_secrets.py:203-207` · `deploy/eks/chart/templates/backend.yaml:96-98·102` · `infra/scripts/workflow_config.py:66-69` · `app/…/observability/RuntimeModeSummary.kt:76` · `profile/…/application/BootstrapProperties.kt:12` | 허용목록 밖 시크릿 키 → 배포 거부 · EKS 에서 OTel exporter `none` · 시크릿 env 목록 한 줄 · 개발 대상 푸시 강제 off · 기동 로그 모드 요약 · `minSupportedVersion` |

### 2.2 없는 것

| 빈자리 | 실측 | 채우는 곳 |
|---|---|---|
| 서버 감시 실행 | `TriggerService.evaluate` 호출처 = `WeatherTriggerService.kt:73` 하나 — 사용자 요청 경로뿐. 스케줄러·감지기 계약이 없다 | DEC-SA-1·2 · BR-SA-01~04 |
| 트리거 닫기 | `PlanBTrigger.consumed()`(:62)·`expired()`(:65) 호출처 0 — ACTIVE 는 [끄기]로만 닫히는데 FE 는 dismiss 를 부르지 않는다(생성 클라이언트에만 있다) · `ItineraryRecalculated` 에 트리거·날짜가 없다 | BR-SA-07·14 |
| 날짜 포함 식별 | 유니크에 `affected_date` 가 없어 같은 여행의 오늘·내일 날씨 트리거(slot 없음)가 함께 ACTIVE 일 수 없다 | BR-SA-05 · INV-SA-4 |
| 심각도·변형 | 트리거·API·이벤트에 심각도·변형이 없다 | DEC-SA-3 |
| 시간별 예보·특보·대기질·특일 | 단기예보는 POP 최댓값 하나만 읽는다. 특보·에어코리아·특일 어댑터가 없다 | BR-SA-15·16·17 |
| 확정 일정 재점검 | 영업시간·폐업을 다시 보는 경로가 없다(위반 표시는 저장 시점 값) | BR-SA-17 |
| 미리 짜 둔 대안 | 세션에 진입 주체 칸이 없고, 준비된 대안 조회가 없으며, 트리거 진입 날짜 강제가 없다(targetDate 생략 = 오늘 — 내일 트리거로 오늘을 다시 짠다) | DEC-SA-4 · BR-SA-18~20 |
| 알림 정책 | 같은 일정 10분 1회(BR-U6-09) 집행이 없다(`dedup_key` 저장만) · 사건이 푸시 여부를 정할 수 없다 | DEC-SA-5 · BR-SA-10·21 · G-SA-2 |
| 감시 상태 | '확인 불가' 표면이 없다 — 신호원이 없는 DELAY·CLOSURE 도 `정상` | BR-SA-13 · G-SA-1 |
| 푸시 수신·탭 | 앱에 수신·탭 리스너 0 · iOS 빌드가 `aps-environment` 를 지운다(`frontend/app.config.ts:223-245`) · 개발 대상 푸시 강제 off | G-SA-7 · O-SA-8(기기 도달 선결) |
| 기회 | `openapi.yaml` 에 `/opportunities` 없음 · AI 경로 없음 | DEC-SA-6 · BR-SA-22 |
| 스케줄러 풀 | `application.yml` 에 `spring.task.scheduling` 없음 → 기본 1스레드를 기존 `@Scheduled` 전부가 나눈다 | NFR 계획 Q2 |

---

## 3. 정본 간 충돌·드리프트 — 처리 위치

새 번호를 만들지 않는다 — 각 행은 그것을 정하는 SA ID 와, 정본·코드가 비어 있는 곳이면 `business-logic-model.md` §9 의 갭(G-SA-\*)을 가리킨다. 원 문서 쪽은 `[개정 · 2026-10-19 · situation-awareness FD]` 블록이 같은 SA ID 를 가리킨다.

| # | 어긋남 | 근거 | 처리 |
|---|---|---|---|
| 1 | **감지 실행 주체** — U4 DEC-U4-6 "서버 스케줄러 없음"(U10 이 `DELAY` 에 한해 폐기) · `ai/aidlc-docs/inception/design-artifacts/ai-architecture.md` §6.2 "날씨 = 서버 폴링(1시간) · 휴무 = 서버 배치(당일 아침)" · 코드(날씨는 사용자 요청에서만) | 셋이 다르다 | DEC-SA-1 · G-SA-4 — 서버 감시 스윕이 날씨·장소·D-1 을 맡는다(DEC-U4-6 확장, `DELAY` 는 U10). §6.2 의 주기·빈도 값은 근거로 쓰지 않는다 |
| 2 | **감지 구간** — BR-U4-02(여행 구간 안에서만, `TriggerService.kt:69-73`) · 저녁 '내일'·D-1 점검 | 전날 저녁에 다음 날을 본다 | BR-SA-11 — 허용 날짜 {오늘, 내일} ∩ [시작, 종료], 내일·시작 전날은 지평이 허락할 때만(DEC-SA-7) |
| 3 | **식별** — BR-U4-07(같은 kind × slot 1회) · 유니크에 날짜 없음(`V2.18:34-36`) | 오늘 것이 내일 것을 막는다 | BR-SA-05 · INV-SA-4 — 대상 = kind × affectedDate × slotKey, ACTIVE 동안 제자리 갱신 |
| 4 | **종류** — BR-U4-01·DEC-U4-4(4종, 늘리지 않음) · 새 상황 12가지 | — | DEC-SA-3 — 4종 유지 + `payload.variant` 닫힌 12종 + 심각도 RISK·CAUTION |
| 5 | **닫기** — U4 `domain-entities.md` §2.1 상태(CONSUMED = 재계획 확정에 쓰임 · EXPIRED = 대상이 지남) · 코드 경로 0(§2.2) | 정본은 있고 집행이 없다 | BR-SA-07(만료 4원인, WEATHER·CLOSURE 만) · BR-SA-14(날짜가 같을 때만 소비) |
| 6 | **억제** — BR-U4-15([끄기] = 억제 행) · `covers` 가 날짜·심각도를 보지 않음 | 주의를 끈 것이 위험 격상을, 오늘을 끈 것이 내일을 막는다 | BR-SA-09 |
| 7 | **하루 상한 3벌** — 코드 LOW 2·NORMAL 5·HIGH 10(`PlanBTrigger.kt:112-114`) · U4 `nfr-design/nfr-design-patterns.md:38` LOW 1·NORMAL 3·HIGH 6 · ai-architecture §6.2 시간당 2·하루 8 | — | BR-SA-10(상한 = 위험 푸시 사건 수, 넘어도 사건은 남는다) · G-SA-3 · 값은 O-SA-9 |
| 8 | **강수 임계의 층** — 백엔드 발화 60(`WeatherTriggerService.kt:93`, G-U4-2) · AI 내부 80(ai-architecture §6.2 註) | 층이 다르다 | BR-SA-15 — 발화 60 유지, AI 80 과 맞추지 않는다 |
| 9 | **'정상' 표면** — US-PLANB-02 예외(외부 무응답 → 침묵) · INV-U4-09 · 허브 감시 행이 발화 없으면 `정상`(`triggerWatchlist.ts:17-18·53`) | 확인하지 못한 것을 정상이라 말한다 | INV-SA-2 · BR-SA-13(CHECKED · UNKNOWN · OFF) · G-SA-1 |
| 10 | **재계획 시작** — US-PLANB-02 정상 절·BR-U4-09 "사용자가 [대안 보기]를 눌러야 재계획이 시작된다" · Q1 답 | 인셉션·U4 문면 | DEC-SA-4 — 서버가 초안을 미리 산출하되 일정 쓰기는 사용자 [적용]만(INV-SA-1). 인셉션은 상신만(G-SA-8 · O-SA-15) |
| 11 | **열린 세션 1개** — INV-U4-06(새 진입은 열린 세션을 닫고 시작) · 서버 선계산 | 선계산이 사용자가 보던 세션을 닫을 수 있다 | INV-SA-6 · BR-SA-18 — 30분 안 USER 세션은 닫지 않는다 |
| 12 | **확정 잠금** — BR-U3-28·INV-U3-04(여행 시작 전 CONFIRMED 변경 거부) · D-1 첫날 반영 | U3 정본 · 적용 경로에 여행 전 가드 없음(`ReplanFacadeService.kt:239-242`) | BR-SA-20(전날 창 · 여행 전 반영 가드) · G-SA-6 — U3 개정 승인 전에는 `pre-trip` 을 켜지 않는다(O-SA-6) |
| 13 | **문구** — DEC-U4-9(시각 재추정 금지) · 알림함에 남는 문구의 상대 날짜어(`DomainNotificationSubscribers.kt:83` 기본 본문 `오늘 일정에…`) | 저장된 문구가 다음 날 틀린 말이 된다 | BR-SA-12(계획된 '시'·예보 시간대는 허용, 상대 날짜어·소요시간·좌표 금지) · BR-SA-21 |
| 14 | **푸시 기본값** — BR-U6-18(PLAN_B 푸시 OFF · `NotificationToggle.kt:35-42`) · Q4 답 | U6 정본·코드 | DEC-SA-5 — PLAN_B 푸시 기본 ON, 위험만 푸시 · 저장된 토글 행은 존중(O-SA-14) |
| 15 | **10분 1회** — BR-U6-09 · `dedup_key` 저장만 | 정본은 있고 집행이 없다 | BR-SA-21(같은 여행 10분 1회 — 첫 집행) · G-SA-2 |
| 16 | **야간** — O-U6-4(조용시간 미결) · LEGAL-U6-01(조용시간 없음) | 위험 푸시가 밤에 나갈 수 있는가 | INV-SA-5 — 21:00~06:59 스윕 없음 · 20:58 이후 쓰기·발행 0 → O-U6-4 종결. U10 `DELAY` 는 이 창에 묶이지 않는다 |
| 17 | **기회의 성격** — 최초 요청("요즘 뜨는 핫이슈" · "알람 보내거나") · LEGAL-U6-02(알림 경로는 정보성만) | 법무 경계 | DEC-SA-5·6 — 기회는 트리거·알림이 아닌 조회형 카드 |
| 18 | **자유입력 장소명** — BR-U4-13("텍스트에서 뽑은 장소를 후보로 승격하지 않는다") · 코드(등록 이름 대조·지도 실재·그날 영업을 통과한 **등록 POI** 를 필수 방문으로 합류 — `ai/src/trippilot/agents/planb/request_verification.py` · `api/wiring.py:2316-2329`) | 기회 카드의 [넣어서 다시 짜기]가 이 경로에 기댄다 | BR-SA-22 · G-SA-5 — 검증을 통과한 등록 POI 만(INV-1 유지). 결정론 `include_poi_ids` 는 후속 |
| 19 | **U10 과 같은 판정 경로** — BR-U10-27(억제·민감도·상한은 기존 `TriggerService` 그대로) · reconcile 의 의미 변화(날짜 포함 식별 · 여행·회차당 사건 1건) | U10 정본 | BR-SA-07(스윕은 `DELAY` 를 닫지 않는다) · BR-SA-10(날씨 확인·U10 경로는 대표 1건짜리 사건) — U10 FD 개정 블록 |
| 20 | **백엔드가 부르는 AI 경로의 정본** — 루트 `CLAUDE.md` "`HttpScheduleAgentAdapter.CALLED_PATHS`" · 다른 모듈 어댑터(`assistant/…/HttpDialogueInterpreter.kt:66-67` · `notification/…/HttpReminderCopyAdapter.kt:91` · `reflection/…/ReflectionAgentWire.kt:81`) | 문서가 실물보다 좁다 | G-SA-9 — 기회 경로를 여는 구현 PR 이 같은 문장을 모듈별 목록으로 고친다(DEC-SA-6 · `docs/conventions/anti-patterns.md` '받는 쪽의 그 문장까지 같이 고칠 것') |

---

## 4. 실행 계획

- [x] 1. 기능 컨텍스트 — 사용자 최초 요청(2026-10-18, §5.0) · 인셉션 US-PLANB-02 (a)(b) · US-NOTIF-03 · `components.md` C6·C7·C8·C9·C10·C11·C14 · `component-dependency.md` 이벤트 카탈로그(`planb.PlanBTriggered` → notification · `recalculation.ItineraryRecalculated` → notification)
- [x] 1b. **기존 자산 실측** — §2 기준선(backend planb-detection·weather-context·itinerary-recalculation·itinerary-generation·notification·trip·place-data · 마이그레이션 V2.0·V2.17·V2.18·V2.37 · ai 조립·지시 사전·행사 저장소·휴무 어휘 · frontend planb·알림함·`app.config.ts` · deploy 허용목록·차트)
- [x] 1c. **상속 설계 대조** — U4 FD(DEC-U4-4·6·9 · BR-U4-01~09·15·35 · INV-U4-01·02·05·06·09 · G-U4-2) · U4 NFR(PERF-U4-01 · COST-U4-03 · OBS-U4-01~05 · tech-stack 델타 5 · `nfr-design-patterns.md`) · U6 FD·NFR(BR-U6-08·09·18 · LEGAL-U6-01~03 · O-U6-4) · U3 FD(BR-U3-28 · INV-U3-04) · U10 FD·NFR(BR-U10-23~28 · G-U10-3 · PERF-U10-06) · ai-architecture §6.2 → 충돌 §3
- [x] 1d. **사용자 결정 수집** — 선택지 질문 4개(2026-10-18, §5 Q1~Q4 원문 그대로) + 활용신청 후속 메시지 2건
- [x] 2. **설계 초안** — 구성요소 설계 8건(D1 감시 스윕·생명주기 · D2 날씨 · D3 장소 · D4 미리 짜 둔 대안 · D5 알림 · D6 기회 카드 · D7 프런트엔드 · D8 정본·배포) → 반박 검토 3종(정본·불변식 / 운영·런타임 / 충돌·범위·UX) 반영 → 통합 초안. 구성요소 간 충돌(감지기 계약 3벌 · 변형 어휘 5벌 · `payload.source` 세 뜻 · 초안 연결 방식 둘 · D-1 켜기 장치 넷 · 플래그 이름 10개 등)은 하나로 정해 DEC-SA-2·3·4·7·8 과 BR-SA-06·24 로 옮긴다
- [x] 2b. **초안의 코드 근거 재대조**(`origin/develop` `f52f58cf7`) — 초안이 인용한 경로·줄(`ReplanFacadeService.kt:71-85·211-219·239-242` · `NotificationInboxPage.tsx:35` · `app.config.ts:223-245` · `runtime_secrets.py:203-207` · `backend.yaml:102` · 최신 마이그레이션 V2.72)과 선행 PR(#1326·#1328·#1333·#1342·#1344·#1345·#1348·#1358·#1359)이 develop 과 맞다 — 갭(G-SA)으로 올릴 초안↔코드 차이는 찾지 못했다
- [x] 3. **미결 → O-SA-1~15**(§5 Q5~Q19) — 설계 초안의 미결 15건(UQ1~UQ15)을 옮겼다. 2026-10-19 사용자 지시("하던거 마저해")로 O-SA-2~15 는 초안 기본값 채택(정본 승인 때 확인), O-SA-1 은 사용자 확인 중 — 그동안 해당 감지기는 관찰 전용으로 출발하므로 진행을 막지 않는다. 모호한 답 없음 → 명확화 파일 불필요
- [x] 4. `business-logic-model.md` — **DEC-SA-1~8** · 전체 흐름(스케줄러 → 대상 → 감지기 → 판정 reconcile → 아웃박스 → 알림·미리 짜 둔 대안 → 앱 진입 게이트 → 사용자 [적용] → 소비) · 기회 카드 흐름 · 신호원 표 · 플래그와 켜는 순서 · 원 문서 개정 블록 목록(§8) · 갭 **G-SA-\***(§9 — 인셉션 정정 상신은 G-SA-8) · 미결 O-SA-1~15(§10)
- [x] 5. `domain-entities.md` — 트리거(심각도·알린 최고 심각도·푸시 시각·버전 · 날짜 포함 유니크) · 억제(날짜·최대 심각도) · 감시 상태 · 격자 예보 · 재계획 세션 진입 주체 · `TriggerVariant`·`TriggerSeverity` · 이벤트 필드(`PlanBTriggered` · `ItineraryRecalculated`) · **INV-SA-1~7** · 소유 경계표
- [x] 6. `business-rules.md` — **BR-SA-01~24** · **PBT-SA-01~22**(설계 초안 테스트 표의 PBT 행 순서 그대로) · 미결 **O-SA-1~15**
- [x] 7. `frontend-components.md` — 푸시 수신·탭 라우팅 · 진입 게이트 판정표(BR-SA-23) · 변형 라벨·날짜 표기·출처(BR-SA-12·24) · 감시 3상태(BR-SA-13) · i06 낡음·미포함 안내 · 기회 카드(BR-SA-22) · 6-b 실기 전용 항목(푸시 탭·포그라운드 배너는 jest 의 사각)
- [x] 8. **정합 검증** — U4·U6·U3·U10 정본(FD·NFR)에 `[개정 · 2026-10-19 · situation-awareness FD]` 블록 추가(append-only — SA ID 를 가리키기만 한다) · 인셉션은 상신 목록만(G-SA-8 — US-PLANB-02 정상 절·(a)(b) · US-NOTIF-03 · 기회 카드 스토리 후보 · C9·C14 · 이벤트 카탈로그 구독 2건)
- [ ] 9. 완료 메시지(표준 2-option) → **사용자 승인 게이트** → `audit.md`(사용자 원문 그대로)·`aidlc-state.md` 기록
- [ ] 10. (다음 단계) NFR Requirements — `situation-awareness-nfr-requirements-plan.md`

**전제(질문 아님)** — 이견 있으면 알려 주세요:
- 산출물 **4종 풀세트**(business-logic-model · domain-entities · business-rules · frontend-components) — 백엔드 7모듈·AI·FE 에 걸친다
- 일정 쓰기는 사용자 [적용]뿐이다(INV-SA-1) — Q1 답으로 정해졌고, 원탭 '바로 적용'은 트리거 경로에 쓰지 않는다
- 새 `NotificationKind` 를 만들지 않는다 — 구 앱 알림함이 모르는 kind 에서 죽는다(`NotificationInboxPage.tsx:35`)
- 화면 정본(Figma)에 새로 그릴 상태 — 감시 '확인 불가' 행 · 주의 톤 · 기회 카드(홈 경보 줄은 후속). 작도는 구현 착수 전 FE 팀원과 하고, FD 는 상태·문구·판정만 정한다

---

## 5. 사용자 원문 · 질문과 답

> Q1~Q4 는 2026-10-18 사용자에게 실제로 물은 선택지 질문과 답이다 — 질문 문면·선택지 이름·답을 **원문 그대로** 옮긴다(요약하지 않는다). `X) Other` 는 질문 도구의 자유 입력 칸이다. Q5~Q19 는 설계 초안의 미결 15건을 O-SA-1~15 로 옮긴 것이다. 답을 바꾸려면 `[Answer]:` 칸을 고쳐 주세요 — 정본 승인 때 함께 확인한다.

### 5.0 최초 요청 (2026-10-18, 원문)

```text
그리고 planB관련해서 다른 세션에서 작업중인데, 코드꼬이거나 겹치지
  않게 해.  중간평가 피드백중에서 자체적으로 변수상황을 판단해서
  사용자에게 알리고 재계획을 하게 하라는게 있었거든. 그거 만들자. 그런
  변수상황 자가 인지를 할 수 있게 만들어!!!! 그런 방법들을 다 생각을
  해봐. 예를들면 날씨가 안좋아졌으면 실내 위주로 다시 일정만들게
  하거나 알람 보내거나 하고, 가려던 곳이 문을 닫은것을 미리 파악하거나
  아니면 해당 지역에 요즘 뜨는 핫이슈가 있다거나 등등이 있을거 같아.
  여기에 더해서 더 너가 어떤 경우들이 있을지 생각해서 추가해!!!!!
```

> 반영: '겹치지 않게' → §1.5 · 날씨(실내 위주 재계획·알림) → F1~F5 · 문 닫은 곳 미리 파악 → F6~F8 · 요즘 뜨는 핫이슈 → F9(알림이 아닌 앱 안 카드 — §3 17행) · '더 생각해서 추가' → 흐림·폭염·한파·강풍·미세먼지·특보·공휴일·폐업·D-1 점검(F2~F8·F10).

### A. 사용자 결정 — 2026-10-18 선택지 질문 4개

#### Q1. 변수를 감지한 뒤 '재계획'은 어떻게 할까요?

A) 미리 짜 둔 대안 (Recommended)

B) 한 번 탭 재계획

C) 자동 적용

X) Other (please describe after [Answer]: tag below)

[Answer]: 미리 짜 둔 대안 (Recommended)

> 반영: DEC-SA-4 · INV-SA-1(일정은 사용자 [적용]으로만 — INV-U4-05 승계) · INV-SA-6·7 · BR-SA-18~20·23.

#### Q2. 이번에 바로 만들 범위를 골라 주세요. (체류 초과·이동 지연은 백엔드 팀원 티켓이라 제외)

*복수 선택*

A) 날씨 확장 (Recommended)

B) 휴무·영업시간·폐업 (Recommended)

C) 지역 행사·인기 장소

D) 여행 전날(D-1) 점검

X) Other (please describe after [Answer]: tag below)

[Answer]: 날씨 확장 (Recommended), 휴무·영업시간·폐업 (Recommended), 지역 행사·인기 장소, 여행 전날(D-1) 점검

> 반영: §1.2 F1~F12 전부 1차. 날씨 → BR-SA-15·16 · 장소 → BR-SA-17 · 행사·인기 → DEC-SA-6 · BR-SA-22(알림이 아닌 앱 안 카드 — LEGAL-U6-02) · D-1 → DEC-SA-7 · BR-SA-20(켜기는 O-SA-6 승인 뒤). 체류 초과·이동 지연은 U10(TRIP-1407).

#### Q3. 기상특보·미세먼지·공휴일은 공공데이터포털에서 날씨 키 계정으로 '활용신청'을 해야 합니다(대부분 자동승인). 제가 대신 할 수 없는데 어떻게 할까요?

A) 신청할게 (Recommended)

B) 나중에

X) Other (please describe after [Answer]: tag below)

[Answer]: 신청할게. 너가 사이트도 띄어주라 지

이어진 사용자 메시지(원문): "다 신청했어" → "승인도 받았어"

> 반영: 특보·미세먼지·공휴일을 1차로 당긴다(설계 초안의 '활용신청 승인 뒤 2차'는 비었다 — F4·F5·F7). 2026-10-19 10:12 실측: 같은 `WEATHER_API` 키로 세 API 가 returnReasonCode 30(`SERVICE_KEY_IS_NOT_REGISTERED`), 같은 키의 단기예보는 정상 → 그 출처만 '모름'(INV-SA-2) · 관찰 전용으로 출발(BR-SA-04 · DEC-SA-8) · 키 계정 확인은 O-SA-1(Q5).

#### Q4. Plan-B 알림의 푸시 기본값은 지금 OFF(사용자가 설정에서 켜야 옴)입니다. 어떻게 할까요? (운영 서버의 푸시 발송 자체가 켜져 있는지는 코드로 확인 불가)

A) 위험 알림만 기본 ON (Recommended)

B) 지금처럼 OFF

X) Other (please describe after [Answer]: tag below)

[Answer]: 위험 알림만 기본 ON (Recommended)

> 반영: DEC-SA-5 · BR-SA-08·21 — PLAN_B 토글 푸시 기본 ON(행 없는 계정), 위험만 푸시 · 주의는 알림함만 · 기회는 알림 경로 밖. BR-U6-18 개정 블록. 저장된 토글 행은 존중(O-SA-14). 기기 도달은 별도 선결(O-SA-8).

### B. 미결 → 기본값 채택 (O-SA-1~15)

사용자 원문(2026-10-19): "하던거 마저해"

> 위 지시로 O-SA-2~15 는 설계 초안 기본값(각 질문의 A)을 채택하고 진행한다 — 정본 승인 때 함께 확인받는다. O-SA-1 은 사용자가 포털에서 확인 중이다.

#### Q5. 특보·미세먼지·특일 활용신청 계정이 `WEATHER_API` 키 계정과 같은가 (O-SA-1)

2026-10-19 10:12 실측: `WEATHER_API` 키로 특보현황(`getPwnStatus`)·대기질 예보통보(`getMinuDustFrcstDspth`)·특일(`getRestDeInfo`)을 부르면 returnReasonCode 30, 같은 키의 단기예보(`getVilageFcst`)는 정상이다. 사용자는 Q3 뒤 "다 신청했어" · "승인도 받았어"라고 했다.

A) 같은 계정 — 같은 키를 쓴다. 30 은 등록 반영 지연으로 보고 관찰 전용으로 출발, 해소되면 관찰 전용 목록에서 빼는 커밋이 '켜기'다

B) 다른 계정 — 키 env 하나를 더한다(배선 1세트: 시크릿 허용목록·차트·compose·`.env.example`·모드 요약)

X) Other (please describe after [Answer]: tag below)

> 추천 근거: Q3 의 신청 안내가 날씨 키 계정 기준이었다. 계정이 다른지와 반영이 늦는지는 코드로 가를 수 없지만, 어느 쪽이든 세 감지기는 '모름'으로 안전하게 돌고(INV-SA-2) 관찰 전용으로 출발하므로(BR-SA-04) 진행을 막지 않는다. B 여도 배선 1세트만 더한다.

[Answer]: 사용자 확인 중(포털 활용신청 계정 = WEATHER_API 키 계정인지)

#### Q6. 폭염의 심각도 (O-SA-2)

판정 = 12~17시와 겹치는 실외 슬롯의 TMP·TMX 최고값. 기상청 특보 기준의 근사이지 특보 판정이 아니다 — 문구에 '주의보·경보'를 쓰지 않는다(BR-SA-12·15).

A) 2단계 — 33℃ 주의(알림함만) · 35℃ 위험(푸시)

B) 33℃부터 위험(푸시)

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 33℃ 낮은 한여름에 드물지 않다 — 위험(푸시)으로 두면 더위가 시작되는 날마다 울린다(연일 반복 억제 O-SA-11 도 첫날은 막지 않는다). 35℃ 이상만 일정을 막는 쪽으로 읽힌다.

[Answer]: 추천안: A(2단계 — 33℃ 주의 · 35℃ 위험) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q7. 미세먼지 '매우나쁨'을 위험(푸시)으로 (O-SA-3)

판정 = 목적지 예보 권역의 PM10·PM25 중 나쁜 쪽 등급. 보통 이하 → 확인(`checked`).

A) 매우나쁨 = 위험(푸시) · 나쁨 = 주의(알림함만)

B) 매우나쁨도 주의(알림함만)

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 원천의 두 단계를 주의·위험에 그대로 대응시켜 등급을 바꾸지 않는다(공공누리 3유형 — 변경금지, BR-SA-24). 실외 일정을 막는 쪽은 '매우나쁨'이다.

[Answer]: 추천안: A(매우나쁨 = 위험) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q8. 흐림(야경·노을 가림)을 1차에 넣을지 (O-SA-4)

판정 = 야경 슬롯 시각 과반이 흐림 ∧ 강수 없음. 도시 야경은 흐려도 보여 정밀도가 낮다.

A) 주의로 넣는다 — 알림함·배너만, 선계산·재계획 시드 없음

B) 1차에서 뺀다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 흐림은 노을·야경 슬롯의 체험을 직접 가린다. 다만 정밀도가 낮으니 푸시 없는 주의로만 두고, 시드도 두지 않는다 — 흐림에 날씨 사유를 넣으면 AI 가 실내·이동 줄이기를 얹어 일정을 과하게 바꾼다(BR-SA-23).

[Answer]: 추천안: A(주의로 넣음) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q9. 실외 명소(궁궐·해변 명소 등)도 날씨 대상에 넣을지 (O-SA-5)

재계획 지시 INDOOR·AVOID_OUTDOOR 와 우천 보정이 바꾸는 실외 집합은 자연·야경·액티비티다(`ai/src/trippilot/assembly_engine/config.py:96-102`). 명소는 실내외가 섞인 중립 칸이라 재계획이 그 칸을 바꾸지 않는다.

A) 제외 — 날씨 대상 = 재계획이 바꾸는 집합

B) 포함

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 경보 대상이 재계획 대상과 같아야 '알림은 왔는데 대안은 그대로'가 생기지 않는다. 집합은 AI 정본을 주석으로 가리킨다(§1.5).

[Answer]: 추천안: A(제외) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q10. 여행 전날(D-1) 첫날 반영을 허용할지 (O-SA-6)

U3 는 여행 시작 전 CONFIRMED 슬롯 변경을 거부한다(BR-U3-28 · INV-U3-04). 확정 일정은 리비전 복원이 409 라(`ItineraryRevisionService.kt:131`) 반영을 되돌릴 수 없다.

A) 허용 — BR-U3-28·INV-U3-04 의 예외(전날 · 첫날 · FULL_DAY · 트리거 진입 · 사용자 [적용]만), U3 정본 개정 승인 뒤 `pre-trip` 을 켠다

B) 불허 — D-1 은 알림·초안 보기까지

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 전날 저녁이 첫날 아침보다 대안을 받아들이기 쉽다. 되돌릴 수 없으니 예외의 폭을 좁힌다(BR-SA-20). 개정 승인 전에는 스위치가 막는다(DEC-SA-7 — 점검과 진입을 같은 지평 스위치가 연다).

[Answer]: 추천안: A(허용 — 정본 승인 뒤 `pre-trip`) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q11. 운영 켜기 전 `minSupportedVersion` 상향 (O-SA-7)

OTA 가 없다(`frontend/package.json` 에 `expo-updates` 없음). 구 앱은 새 라벨·진입 게이트를 받지 못해 폭염도 `비 예보`로 보이고(`triggerLabel.ts:25-30`), 알림함 항목을 누르면 게이트 없이 i04(`/trips/{tripId}/planb?triggerId=` — `notificationAction.ts:38-41`)로 간다. 서버 `trippilot.bootstrap.minSupportedVersion`(`BootstrapProperties.kt:12`)이 있다.

A) 상향 — FE 수신·탭·게이트·라벨이 스토어에 보급된 뒤, 운영 `on` 전에

B) 상향 없이 켠다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 날짜는 서버 진입 강제(BR-SA-20)가 지키지만 라벨은 서버가 고칠 수 없다. 변형별 허용목록 설정을 두는 것보다 켜는 순서로 막는 쪽이 설정·코드를 늘리지 않는다.

[Answer]: 추천안: A(상향) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q12. iOS 푸시 개통 전 'Android 만 푸시, iOS 는 알림함'으로 출발 (O-SA-8)

iOS 빌드가 `aps-environment` 를 지우고(`frontend/app.config.ts:223-245`) 앱에 수신·탭 리스너가 없다. iOS 개통은 외부 선행(번들 ID Push 권한 · APNs 키 · 재빌드 · 심사)이다.

A) 출발 — 그동안 iOS 는 알림함·허브 알약이 표면

B) iOS 개통까지 운영 켜기를 보류

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 알림함·허브 알약이 같은 정보를 준다. 외부 일정에 기능 전체를 묶지 않고, Android 로 위험 푸시의 효과를 먼저 잴 수 있다.

[Answer]: 추천안: A(출발) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q13. 하루 푸시 상한 값 (O-SA-9)

상한 = 여행·KST 하루의 **위험 푸시 사건 수**다 — 넘어도 사건은 알림함·배너에 남는다(BR-SA-10). 정본 3벌은 §3 7행.

A) 코드값 유지 — LOW 2 · NORMAL 5 · HIGH 10

B) U4 NFR 값 — LOW 1 · NORMAL 3 · HIGH 6

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 코드값은 민감도 설정(`SensitivityController`)과 함께 이미 동작한다. U4 NFR 의 1·3·6 은 '근거 없는 초기값'이었고, 여행·회차당 사건 1건(INV-SA-3)이 다건을 먼저 묶으므로 낮출 압력이 작다. 정본 3벌은 개정 블록으로 하나로 맞춘다.

[Answer]: 추천안: A(코드값 유지) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q14. 선계산 상한 — 여행당 하루 3 · 전체 하루 100 (O-SA-10)

선계산 1건 = 재계획 1회분 LLM 호출이다. 실제로 연 세션만 센다 — 실행 자원이 없어 건너뛴 것(BUSY)·열린 세션 때문에 건너뛴 것은 세지 않는다(BR-SA-18).

A) 승인 — 여행 3 · 전체 100 / 일

B) 다른 값

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 상한은 비용 천장 구실만 한다 — 넘으면 앱이 i04 실시간 계산으로 떨어질 뿐 기능이 막히지 않는다(BR-SA-23). 값은 운영 관측으로 조정한다(규칙 개정이 아니다).

[Answer]: 추천안: A(여행 3 · 전체 100 / 일) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q15. 같은 위험이 연일 반복될 때 (O-SA-11)

장마·폭염·흐린 밤처럼 같은 kind·변형·심각도가 날마다 이어지는 경우(날짜 전체 신호).

A) 둘째 날부터 조용히 — 푸시·알림함 없이 배너만

B) 날마다 알린다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 같은 푸시가 날마다 오면 알림 전체를 끈다. 이미 알린 상황이라 정보 손실이 없다 — 배너는 남고, 심각도가 오르면 다시 알린다(BR-SA-08).

[Answer]: 추천안: A(조용히) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q16. 네이버 추출 행사(`evx-`)를 기회 카드에 표시할지 (O-SA-12)

행사 원천은 둘이다 — 네이버 검색 결과에서 LLM 이 뽑은 행사(`evx-`, `llm_gateway/gates/event_extraction.py:165`)와 공식 축제(`tourapi-<contentid>`, 기간·좌표가 원천에서 온다).

A) 표시 안 함 — 공식(`tourapi-`)·수동 큐레이션 행사만

B) 표시

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 추출 행사를 화면에 표시하면 약관 노출 면적이 커진다(2026 특약 2차 보도 — 원문 미확인). 공식 축제와 큐레이션만으로 카드가 성립한다. 병합 행의 id 규칙은 구현 때 develop 으로 확인한다.

[Answer]: 추천안: A(표시 안 함) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q17. 넓혀 읽은 휴무(월 n회 → 매주)를 주의로 강등할지 (O-SA-13)

휴무 원문 파서가 '매월 둘째·넷째 월요일'을 매주로 넓혀 읽는다 — 열린 날에 위험 푸시가 갈 수 있다. 강등하려면 어느 원문이 넓혀 읽혔는지 AI 쪽 표시가 필요한데, 그 파일(`poi_curation/sourcing/mapping.py`)은 장소 데이터 작업이 몰린 곳이다.

A) dry-run 실측 뒤 결정 — 그 전엔 위험으로 두되 단정하지 않는 문구(`~로 나와요`)

B) 지금 주의로 강등

C) 강등하지 않는다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 오탐 비율을 모르고 정하면 어느 쪽이든 추측이다. 개발·운영 `dry-run` 단계(NFR 계획 Q7 의 ①·③)가 쓰기 없이 휴무 오탐 표본을 준다. 이 항목은 채택 뒤에도 미결로 남는다.

[Answer]: 추천안: A(dry-run 실측 뒤 결정) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q18. 인앱만 바꾼 PLAN_B 토글 행에 굳은 푸시 OFF (O-SA-14)

기본값 변경(Q4)은 토글 행이 없는 계정에만 닿는다. 인앱만 바꾼 계정도 그때의 기본값(푸시 OFF)이 행으로 저장됐다(`notification/…/application/NotificationToggleService.kt:45-53`) — 사용자가 고른 OFF 와 구분되지 않는다.

A) 그대로 둔다 — 분포를 측정(`SELECT push_enabled, in_app_enabled, count(*) FROM notification_toggle WHERE kind='PLAN_B' GROUP BY 1,2`)한 뒤 재논의

B) 일괄 ON 으로 바꾼다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 일괄 ON 은 사용자가 고른 OFF 를 뒤집을 수 있다. 행 수를 먼저 재면 문제의 크기를 안다.

[Answer]: 추천안: A(그대로 — 측정 후 재논의) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

#### Q19. 정본의 위치 (O-SA-15)

A) 번호 없는 확장 폴더 `construction/situation-awareness/` — 원 문서(U4·U6·U3·U10)에는 개정 블록만, 인셉션은 상신 목록만(사후 개정은 사용자 명시 승인 시에만)

B) 새 번호 유닛으로 승격 — `SCOPE.md`·unit-of-work 3종 개정

C) U4 정본 본문에 직접 쓴다

X) Other (please describe after [Answer]: tag below)

> 추천 근거: 이 기능은 U4 의 감지·재계획을 넓히는 것이라 U10 이 U4 를 개정한 방식(원문 보존 + 개정 블록)을 그대로 쓴다. B 는 범위 문서와 유닛 분해 3종이 따라 바뀌고, C 는 승인된 U4 본문을 고쳐 원문 보존 규칙을 어긴다.

[Answer]: 추천안: A(확장 폴더, 인셉션은 상신만) — 2026-10-19 사용자 지시("하던거 마저해")로 기본값 채택, 정본 승인 때 확인

---

## 다음 단계

답 확정(O-SA-1 확인 중 — 관찰 전용 출발) → 산출물 4종(§4 4~7) → 원 문서 개정 블록·인셉션 상신 목록(§4 8) → **완료 메시지·사용자 승인 게이트** → `audit.md`(사용자 원문 그대로)·`aidlc-state.md` 기록 → NFR Requirements(`situation-awareness-nfr-requirements-plan.md`).
