# U4 In-trip & Plan-B — Business Logic Model

> **유닛**: C9 Plan-B Detection · C10 Itinerary Recalculation · C11 Weather & Context
> **스토리**: US-PLANB-01~13 · US-ONTRIP-01~03 (16)
> **화면 정본**: 라이브 Figma 밴드 `i` (2026-08-09 재관측 27프레임 — 설계 반영 완료분 포함)
> **전제**: U0·U1·U2·U3 설계 종료. U2 경계 계약·BR-U2-01~16, U3 DEC-U3-1~9·BR-U3-01~34을 승계한다.
> **범위**: 설계 문서까지. 코드는 팀이 `backend/`·`frontend/`에서 직접 개발.

---

## 1. 결정 (DEC-U4-*)

| ID | 결정 | 근거 |
|---|---|---|
| **DEC-U4-1** | **대안의 단위는 "단일 재계획안 + 슬롯별 후보 교체"** — 일정 단위 2~3안을 만들지 않는다 | Q1=A. 라이브 `i13`(단일 안 + `다른 후보 4`) · `i14`(슬롯 후보 교체). 인셉션 `proposeAlternatives → List<AlternativeOption>`(2~3개)와 어긋남 → **G-U4-1**로 상신 |
| **DEC-U4-2** | **재계획 지시는 4단 입력** — 범위(2) · 사유(6) · 방향 지시어(7) · 자유 텍스트 | Q2=A. 라이브 `i10` |
| **DEC-U4-3** | **범위는 ai `ReplanScope` 2종에만 매핑** — `지금 이후`=`PARTIAL_SLOTS` · `오늘 전체`=`FULL_DAY`. **다일(多日) 재계획 없음** | Q6. `ai/src/trippilot/domain/trigger.py` `ReplanScope{FULL_DAY, PARTIAL_SLOTS, NONE}`. 라이브에서 `내일까지` 칩 제거 완료 |
| **DEC-U4-4** | **트리거 종류는 ai `TriggerKind` 4종이 정본** — `WEATHER`·`CLOSURE`·`DELAY`·`MANUAL`. **`체류 초과`·`교통`은 신설하지 않는다** | Q6. 같은 파일. 라이브에서 `교통` 항목 제거 완료. US-PLANB-02(d) 체류 초과는 **`DELAY`의 payload 변형**으로 흡수 |
| **DEC-U4-5** | **`recalculate`를 신설하지 않는다** — ai `HybridSolverFacade.regenerate(problem, locked_slots)`가 이미 Plan-B warm-start다 | Q6 + 실측. `regenerate`는 locked 슬롯을 `FixedBlock`으로 승격해 HC3 보호를 받게 하고 나머지만 재배치 — U2가 `RecalculateCommand`로 적으려던 것과 **같은 것에 이름만 다름** → §3.1 |
| **DEC-U4-6** | **감지 실행 = 클라 신호 수집 + 서버 판정.** 앱 켜짐=포그라운드 폴링 / 앱 꺼짐=**지오펜스가 OS를 깨워 그 순간 1회 판정**. 서버 스케줄러·상시 백그라운드 추적 **없음** | Q3·Q4=지오펜스 조합. 임계·억제 상태는 서버가 소유해야 기기 간 일관 |
| **DEC-U4-7** | **연속 위치 추적 없음.** 실제 경로는 **앱을 켜 둔 구간만** 성기게 기록 | 〃. `i03`에 한계 각주 |
| **DEC-U4-8** | **걸음 수 미표시** | Q5=C |
| **DEC-U4-9** | **진행 중 시각 재추정 없음** — 표시 시각은 계획값(또는 재계획 확정값)뿐. 지연은 **배너 문구로만** 알린다 | Q8=C. INV-2 우회 표면을 아예 만들지 않는다 |
| **DEC-U4-10** | **방문 체크·실제 체류 = U4 / 사진·메모 = 버튼만(동작 없음, U5)** | Q7=A. `VisitChecked`가 `DELAY` 트리거 입력이라 U4가 소유할 수밖에 없다 |
| **DEC-U4-11** | **변경 이력은 기존 `change_log_entry`(V2.11)를 그대로 쓴다** — 새 이력 테이블 없음 | 실측: `ChangeSource.PLAN_B`·`reason`·append-only가 이미 있다 |

> **[개정 · 2026-10-12] DEC-U4-5·6·7 — 실장·범위 갱신(원문 보존).**
> - **DEC-U4-5**: "`recalculate` 신설 안 함"은 유지되지만, 재계획 산출은 ai `regenerate(problem, locked_slots)` 직결이 아니다. 백엔드는 **`POST /ai/v1/planb/replan`**(`HttpScheduleAgentAdapter.kt` `REPLAN_PATH`)을 부르고, AI는 **RAG(KB-3 상황·KB-5 장소 지식) + 방향 지시어 번역 + `ScheduleAgent`(페르소나 점수 → 어셈블리 배치)**로 답한다(`ai/src/trippilot/api/wiring.py` `replan`, 1688행 부근).
> - **DEC-U4-6**의 "앱 꺼짐 = 지오펜스 wake 1회 판정"과 **DEC-U4-7**의 실제 경로 기록은 **[이연 · 2026-10-12 → U10]**(신설 유닛 "GPS·위치 자동화", 미구현). 현행은 앱 켜짐 경로(포그라운드 평가)와 수동 경로뿐이다 — 지오펜스는 `frontend/src/shared/location/geofence.ts` degrade 스텁.

> **[개정 · 2026-10-12 · U10 FD] DEC-U4-6·DEC-U4-7 — U10이 이연분을 다시 정했다(원문 보존).**
> - **DEC-U4-6** "앱 꺼짐 = 지오펜스 wake 1회 판정 · 서버 스케줄러 없음"은 **폐기**한다. wake 판정은 기기 좌표를 서버로 보내야 성립하는데 U10 DEC-U10-8(지오펜스 판정은 기기에서, 서버엔 결과만 — Q11=A)이 그것을 막는다. 대신 `DELAY`는 **서버가 방문 체크 시각만으로 파생**하고, 진행 중 체류 초과·이동 지연은 **서버 스케줄러**가 판정한다 — 단 자동 기록이 무장된 여행에만(U10 DEC-U10-9 · BR-U10-23~28). "클라 신호 수집 + 서버 판정" 중 **서버 판정 소유(C9)는 그대로**다.
> - **DEC-U4-7** "연속 위치 추적 없음 · 앱을 켜 둔 구간만"은 **개정**한다(Q3=B 사용자 선택): OS '항상 허용' + 정확한 위치 + 앱 위치 동의(L2·L3) + 여행 날짜 구간 안 + 기능 플래그 ON일 때 **백그라운드 저전력 연속 기록**을 한다. 원시 좌표는 **기기 밖으로 나가지 않고** 하루치 다운샘플 폴리라인 + 거리만 서버(`archive` `actual_route_day`)에 올린다(DEC-U10-3·4). when-in-use 사용자의 포그라운드 구간 경로는 **기록하지 않는다**(Q3=B 문면). 근거: `construction/u10-gps-location-automation/functional-design/business-logic-model.md` §1·§2.

> **[개정 · 2026-10-19 · situation-awareness FD]** DEC-U4-6 — 서버 감시 스윕을 날씨·장소·여행 전날(D-1)로 넓힌다(원문 보존)
> U10 이 `DELAY` 에 대해 연 서버 스케줄러 옆에 같은 모듈의 상황 감시 스윕(KST 매시 :15 + 20:40 보충, 밤 없음, 락 분리)이 선다. 판정 소유(C9)와 `DELAY` 의 U10 소관은 그대로다. AI 설계(`ai/aidlc-docs/inception/design-artifacts/ai-architecture.md` §6.2 — 날씨 서버 폴링·휴무 아침 배치)와 감지 방식이 다시 맞지만, 그 표의 30분·시간당 2회/하루 8회는 근거로 쓰지 않는다.
> → [DEC-SA-1·7](../../situation-awareness/functional-design/business-logic-model.md) · [BR-SA-01](../../situation-awareness/functional-design/business-rules.md)

---

## 2. 트리거 판정 파이프라인 (C9 · US-PLANB-02)

```
[신호 수집 — 클라]                    [판정 — 서버 C9]                 [표시 — 클라]
앱 켜짐: 주기 폴링(활성 일정)  ─┐
앱 꺼짐: 지오펜스 wake        ─┼→ evaluate(itineraryId, signals)
수동 '재계획' 버튼            ─┘     ├ 1. 신호 정규화 → TriggerParams(kind, affectedDate, payload)
                                     ├ 2. 영향 판정 — 남은 일정에 실제로 닿는가
                                     ├ 3. 노이즈 폐기 — 임계 미달·중복·이미 지난 슬롯
                                     ├ 4. 억제 조회 — suppression(동일 kind×slotKey) / 전역 빈도 상한 / 민감도
                                     └ 5. TriggerEvalResult{should_replan, scope, reason}
                                                                  → should_replan=false: 무발화(기록만)
                                                                  → true: PlanBTriggered 이벤트
                                                                          ├ 앱 켜짐 → i01 배너 · i08 칩
                                                                          └ 앱 꺼짐 → 로컬 알림(i07)
```

> **[이연 · 2026-10-12 → U10]** 위 파이프라인의 `앱 꺼짐: 지오펜스 wake` 입력과 `앱 꺼짐 → 로컬 알림(i07)` 분기는 U10 소관이다. 판정 서버 소유(C9 `TriggerEvaluator`, `backend/modules/planb-detection/`)는 실재한다.

**외부 API 실패 = 무발화.** 날씨·영업시간 조회가 실패하면 트리거를 만들지 않는다(US-PLANB-02 예외 — 허위 알림 금지). 실패 사실은 관측에만 남기고 사용자에게는 **수동 경로만** 유지한다.

**`i09 감지된 변화`는 판정 결과의 열람 화면**이다 — 감시 항목 3종(날씨·이동 지연·영업·휴무) 각각의 최신 평가 상태(`활성`/`정상`)를 보여준다. `MANUAL`은 사용자가 만드는 것이라 감시 목록에 없다.

> **[개정 · 2026-10-19 · situation-awareness FD]** §2 — 스윕 경로
> 파이프라인 앞에 스윕 경로가 선다: 스케줄러 → 대상 여행 → 감지기(계약 하나, 저장·이벤트 없음, 결과 = 확인함 | 모름) → 판정 `reconcile`(여행 1개 = 트랜잭션 1개 — 만료·해제·발화·감시 상태·알림 사건 ≤ 1) → 아웃박스. 쓰기 경로는 `reconcile` 하나이고, 날씨 확인·U10 의 `evaluate` 도 같은 수명 규칙을 탄다. "외부 API 실패 = 무발화"는 무해제까지 넓히고, `i09` 감시 항목은 트리거 목록 응답의 감시 상태(확인함·확인 불가·꺼짐)가 맡는다.
> → [DEC-SA-2](../../situation-awareness/functional-design/business-logic-model.md) · [BR-SA-05~08·13](../../situation-awareness/functional-design/business-rules.md) · [INV-SA-2·3](../../situation-awareness/functional-design/domain-entities.md)

### 2.1 신호원 매핑

| `TriggerKind` | 신호원 | 소유 | 실패 시 |
|---|---|---|---|
| `WEATHER` | 기상청 단기예보(강수확률·특보) via **C11 `WeatherPort`** | U4 신규 | 무발화 · `i09` 해당 행 "확인 불가" |
| `CLOSURE` | POI 영업시간·임시 휴무 — **C7 place-data(U1) 정본 조회** | U1 재사용 | 〃 |
| `DELAY` | ① 이동 지연: 현재 위치 ↔ 다음 슬롯 거리 + `TravelEstimatePort` ② **체류 초과: `VisitChecked` 미도착/미완료 경과** | U4(②는 DEC-U4-10) | 위치 없으면 판정 보류(무발화) |
| `MANUAL` | 사용자가 `i01` FAB·`i08` 칩·`i10` 진입 | — | — |

> **G-U4-2**: 기상 특보/강수확률 임계(60%+)와 이동 지연 임계(기본 15분)는 인셉션 스토리 값이다. ai `TriggerParams.payload`가 자유 dict이므로 **임계 판정은 백엔드 C9가 소유**한다 — ai는 임계를 모른다. 임계값 튜닝 지점을 설정으로 뺄지는 NFR 단계 몫.

> **[개정 · 2026-10-19 · situation-awareness FD]** §2.1 신호원 · G-U4-2
> - **WEATHER**: 출처별 감지기 셋 — 기상청 단기예보(격자 시간별)·기상특보현황·에어코리아 대기질 예보. 원천 조회는 C11, 판정은 C9 다. 특보·대기질은 키가 통하지 않으면 그 감지기만 모름이고, 관찰 전용 목록에 든 채 출발한다. → [BR-SA-04·15·16](../../situation-awareness/functional-design/business-rules.md)
> - **CLOSURE**: AI validate 의 HC1(그 날 하루 재검증, LLM 0회)과 place-data 폐업 상태. 영업시간 원문 해석은 AI 한 곳이고 `LOST`·지도 `NOT_FOUND` 는 폐업 근거가 아니다. 공휴일 휴무는 AI 특일 달력으로 판정한다. → [BR-SA-17](../../situation-awareness/functional-design/business-rules.md)
> - **실패 시**: "무발화 · `i09` 확인 불가"는 출처별 무발화·무해제 + 감시 상태 '확인 불가'로 읽는다. → [INV-SA-2](../../situation-awareness/functional-design/domain-entities.md)
> - **G-U4-2**: 임계는 C9 소유이고 발화·해제 두 단이다(이력 현상). 강수 발화 60%(`backend/modules/planb-detection/src/main/kotlin/com/trippilot/planbdetection/application/WeatherTriggerService.kt:93`)는 유지하고 AI 의 80(`ai/src/trippilot/providers/weather.py:38` — 다른 층)과 맞추지 않는다. 임계를 C9 상수로 두는 결정은 U2 BR-U2-15(임계 하드코딩 금지 — 필요하면 설정값)와 어긋나 정본 승인 때 함께 정한다. → [BR-SA-15](../../situation-awareness/functional-design/business-rules.md) · [DEC-SA-2](../../situation-awareness/functional-design/business-logic-model.md)

---

## 3. 재계획 플로우 (C10 · US-PLANB-01·03·04·06·07·12)

```
진입 ── 자동(i01 배너 [대안 보기]) ──┐
    └── 수동(i01 FAB '일정 수정 필요') ─┴→ i10 「AI에게 맡길게요」 시트
                                            ├ 범위: 지금 이후 | 오늘 전체        (ReplanScope)
                                            ├ 감지 배너 + [끄기]                 (→ suppression)
                                            ├ 왜(다중): 임시 휴무·이동 지연·체력 저하·예약 마감·날씨·그냥
                                            │   (예약 마감 ≠ 예약 취소 — 2026-09-12, AI `fully_booked`)
                                            ├ 어떻게(다중): 여유 있게·더 채워서·실내로·가까운 곳으로·맛집 추가·야경 코스·이동 줄이기
                                            └ 직접 말하기(자유 텍스트, 선택)
                                          [AI가 다시 짜기] ────────────────┐
                                          [직접 고르기] → i15 수동 편집     │  (US-PLANB-12 분기)
                                                                            ▼
                          영향 분석 입력 수집 (US-PLANB-03)
                            현재 위치(없으면 i20 수동 입력 → 없으면 마지막 완료 방문지/숙소)
                            현재 시각 · 완료 슬롯 · 시각 고정 슬롯 · 숙소 앵커(변경 불가) · 남은 슬롯
                                                                            ▼
                          ScheduleAgentPort.replan(...)  →  ai regenerate(problem, locked_slots)
                                                                            ▼
                          ┌─ 해 있음 → i12 로딩 → i13 재계획안(단일) ─┬→ [이대로 적용] → i18 비교 → 확정 → i19
                          │                                            ├→ 슬롯 [다른 후보 N] → i14 후보 교체 → i13 갱신
                          │                                            └→ [직접 수정] → i15
                          └─ 해 없음 → i16 「대안 없음」 3옵션
                                        ├ 남은 방문지 1개 건너뛰기 → 제외 후 재시도
                                        ├ 휴식 모드로 전환 → i17
                                        └ 수동으로 일정 수정 → i15
```

> **[개정 · 2026-11-01]** 위 흐름의 「i18 비교 → 확정 → i19」는 화면이 없다 — 비교 화면 `app/trips/[tripId]/planb/diff.tsx`(`src/pages/live/planb-diff`, i18 비교·i19 반영 완료)는 사용자 결정으로 코드째 삭제됐다(앱 안에 들어오는 버튼이 없던 딥링크 전용 화면). 지금은 i13 [이대로 적용]이 바로 확정하고 허브로 돌아가 반영 완료 시트(i08 `ReplanAppliedSheet`)를 띄운다(원문 보존).

**확정 전에는 아무것도 바뀌지 않는다.** `i13`·`i14`는 초안이고, 원 일정에 반영되는 지점은 `i18`의 [확정] 하나뿐이다(US-PLANB-08 '취소=원상복구'가 성립하는 근거).

> **[개정 · 2026-10-19 · situation-awareness FD]** §3 — 자동 진입의 준비된 대안 분기
> 자동 진입(알림 탭·알림함·허브 알약)은 진입 게이트를 먼저 지난다. 게이트는 트리거 상세와 그 트리거 날짜의 준비된 대안을 함께 보고 재계획안·대안 없음(i06 · 옛 i13·i16), 계산 중(i05 · 옛 i12), 허브 안내, 요청 시트(i04 · 옛 i10 — 대상 일자 = 트리거 날짜) 중 하나로 보낸다. 준비된 대안은 C10 이 `planb.PlanBTriggered` 를 구독해 SYSTEM 세션으로 미리 산출한 초안이다 — 확정 전 무변경은 그대로이고 낡은 SYSTEM 초안은 적용하지 않는다.
> → [DEC-SA-4](../../situation-awareness/functional-design/business-logic-model.md) · [BR-SA-18·19·23](../../situation-awareness/functional-design/business-rules.md) · [INV-SA-1·7](../../situation-awareness/functional-design/domain-entities.md)

### 3.1 AI 경계 — `replan` (DEC-U4-5)

ai에 이미 있는 것에 백엔드 포트를 맞춘다. **새 솔버 개념을 만들지 않는다.**

```kotlin
// backend: ScheduleAgentPort 에 추가되는 4번째 메서드
fun replan(input: ReplanInput): ScheduleAgentOutput

data class ReplanInput(
    val tripId: UUID,
    val itineraryId: UUID,
    val scope: ReplanScope,                 // PARTIAL_SLOTS | FULL_DAY  (ai enum 그대로)
    val fromInstant: Instant,               // '현재 시각 이후'의 기준점
    val currentLocation: GeoPoint?,         // null 허용 — 폴백 기준점은 백엔드가 결정(BR-U4-19)
    val lockedSlotKeys: List<String>,       // 완료 + 시각 고정 + 숙소 앵커 → ai locked_slots
    val trigger: TriggerParams?,            // 자동 진입이면 동반, 수동이면 kind=MANUAL
    val reasons: List<String>,              // i10 '왜' 다중 선택
    val directives: List<String>,           // i10 '어떻게' 다중 선택
    val freeText: String?,                  // i10 직접 말하기
    val excludedPoiIds: List<UUID>,         // '건너뛰기'로 제외한 POI
    val requestMeta: RequestMeta,           // 지연 예산 전파(IO-1 승계)
)
```

> **[개정 · 2026-10-12] §3.1 포트 vs 와이어.** 위 `ReplanInput`은 **backend 포트**로 실재한다(`backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration/domain/ScheduleAgentPort.kt` `fun replan(input: ReplanInput): ScheduleAgentOutput`). AI 와이어는 이 모양이 아니고 `ai/docs/openapi.json`의 **`ReplanRequest`**(필수 `trip_id`·`trip_context`·`target_date`·`time_window`·`anchor`·`scope`·`from_instant`·`preference_profile`·`request_meta`, 그 외 `current_slots`·`locked_blocks`·`directives`·`free_text`·`reasons`·`rejections`·`excluded_poi_ids`·`trigger` 등) / **`ReplanResponse`**(`itinerary`·`is_fallback`·`fallback_level`·`resolved_directives`·`unknown_directives`·`retrieved`·`total_distance_km`·`empty_reason`·`notes`)다. "ScheduleAgentOutput"은 포트 반환형 이름이지 와이어가 아니다. `ScheduleAgentPort`에 "4번째 메서드"로 적었으나 현재 포트는 `generate`·`validate`·`repair`·`explanations`·`proposeSlotCandidates`·`replan` 6개를 가진다.

**어댑터 매핑** (`{Vendor}Adapter`가 소유):

| `ReplanInput` | → ai |
|---|---|
| `lockedSlotKeys` | `regenerate(problem, locked_slots=…)` — locked가 `FixedBlock`으로 승격돼 **HC3 보호**를 받는다. `validate`가 보존을 강제하므로 위반 해는 반환 자체가 불가능 |
| `scope=PARTIAL_SLOTS` | `problem.days=[오늘]` + `fromInstant` 이전 슬롯 전부 locked |
| `scope=FULL_DAY` | `problem.days=[오늘]` + 완료·시각 고정만 locked |
| `excludedPoiIds` | `ItineraryProblem.excluded_poi_ids` (TRIP-293 경로 재사용) |
| `reasons`·`directives`·`freeText` | **선호 점수 가중치 입력** — 후보 풀 자체는 U1 closed-set 그대로(INV-1) |
| `trigger` | `TriggerParams{kind, schedule_id, affected_date, payload}` 그대로 직렬화 |

> **[개정 · 2026-10-12] 어댑터 매핑 표 — 대체.** `lockedSlotKeys → regenerate(locked_slots)` 매핑은 실행되지 않았다. 잠금은 와이어 `locked_blocks`(+`current_slots`)로, 범위는 `scope`·`from_instant`·`target_date`(V2.60 `replan_session.target_date`, TRIP-1182 — 오늘 고정 해제)로, 사유·지시어·자유 텍스트는 `reasons`·`directives`·`free_text`로 그대로 실린다. 지시어는 AI가 닫힌 사전(`ai/data/replan_directives.yaml`)으로 해석해 `resolved_directives`/`unknown_directives`로 돌려준다(O-U4-5 종결 — `business-rules.md` §8 개정). INV-1·2·4 서술은 유효하다.

- **INV-1**: 자유 텍스트는 *가중치*만 움직인다. 텍스트에서 뽑은 장소명을 후보로 승격하지 않는다 — 승격하려면 C7 수집 게이트를 통과해 place-data에 등록된 뒤라야 한다.
- **INV-2**: `replan` 반환 시각·순서는 솔버 검증값. 백엔드·클라가 재계산하지 않는다.
- **INV-4**: 호출 실패 시 `ScheduleAgentCallFailed` → 결정론 폴백 = **`i15` 수동 편집으로 전환**(US-PLANB-11). 침묵 실패 없음.

> **G-U4-3**: `ai/main.py`는 **`/health`만 응답하는 스텁**이고 `POST /ai/*` HTTP 표면이 아직 없다(develop 실측). `replan`은 계약만 정의되고 실호출은 어댑터 구현 시점에 열린다 — U3 `generate`와 같은 처지다. 이 유닛의 설계가 막히는 지점은 아니지만, **개발 착수 전에 AI 서비스 HTTP 표면 티켓이 선행**해야 한다.

> **[개정 · 2026-10-12] G-U4-3 해소.** AI HTTP 표면은 열렸다 — `ai/docs/openapi.json` 기준 POST 경로 **11개**(`/ai/v1/itinerary/{generate,validate,repair,explanations,edit}` · `/ai/v1/planb/{alternatives,replan}` · `/ai/v1/notification/copies` · `/ai/v1/reflection/{generate,nudge,share-card}`)와 `/health`가 응답한다. 백엔드는 그중 `/ai/v1/planb/replan`을 실호출한다(`HttpScheduleAgentAdapter.kt` `CALLED_PATHS`). 재계획 시한은 25,000ms(`ReplanFacadeService.kt` `REPLAN_DEADLINE_MS`).

### 3.2 슬롯 후보 교체 — U3 계약 재사용 (DEC-U4-1)

`i14`는 **U3가 신설한 `proposeSlotCandidates`를 그대로 호출**한다. 신규 경계 0.

| `SlotCandidatesInput` | Plan-B에서의 값 |
|---|---|
| `slotKey` | 교체 대상 슬롯 (`"{date}#{poiId}"`, BR-U2-04) |
| `neighborSlotKeys` | 직전·직후 슬롯 — **직전이 '현재 위치'** 인 것이 U3와의 유일한 차이 |
| `radiusM` | null(AI 기본) |
| `concept` | `i10`의 방향 지시어를 이어받는다(예: `실내로` → 실내 컨셉) |
| `excludePoiIds` | 현재 재계획안에 이미 들어간 POI |

`i14`가 표시하는 4정보(US-PLANB-05)의 출처:

| 표시 | 출처 |
|---|---|
| 추천 이유 (`비 예보에도 실내라 그대로 갈 수 있어요`) | `SlotCandidate.rationale` — 시각·소요시간 언급 금지(BR-U2-09) |
| 현재 위치로부터 거리 + 수단 (`지금 위치서 차량 6.4km`) | `SlotCandidate.distanceRange` — 거리만(INV-3) |
| 다음 고정까지 여유 (`17:00 고정까지 여유 1시간 20분`) | **백엔드 합성** — 다음 `isFixed` 슬롯 `startAt` − (현재 시각 + 추정 이동). §4 참조 |
| 배지 (`지금 제안`/`이걸로`) | 현재 재계획안이 채택한 후보 여부 |

> **⚠️ '여유 시간'은 DEC-U4-9의 예외가 아니다.** 여유는 **잔여 시간(duration)이 아니라 두 확정 시각의 차**로 계산해 표시한다 — `17:00 고정까지 여유 1시간 20분`은 "고정 슬롯 시각(솔버값) − 현재 시각"이다. 슬롯의 *도착 예정 시각*을 새로 추정해 노출하는 것과는 다르다(BR-U4-13).

---

## 4. 여행 중 현장 (US-ONTRIP-01~03)

```
i01 여행 중 일정 (일정 | 지도 세그먼트)
  ├ 슬롯 상태: 완료(✓) · 진행 중 · 예정
  ├ 예정 슬롯 표시 = 계획 시각 + 영업시간 + 다음 구간 거리·수단   (DEC-U4-9 — 재추정 없음)
  ├ 지오펜스 진입 또는 수동 [도착] → i04 도착·방문 체크
  │     ├ [방문 완료] → VisitChecked(actual) → 실제 체류 산출 → DELAY 트리거 입력
  │     └ [사진][메모] → 버튼만, 동작 없음 (U5)                    (DEC-U4-10)
  ├ [현재 장소 정보 보기] → i05 현재 장소 상세
  ├ [다음 장소 길찾기] → 외부 지도앱 위임 (ADR-0012)
  └ 지도 탭 → i02 계획 동선 / i03 실제 경로 토글
```

- **`i05`의 '다음 일정까지'** = `여유 있음 · 다음 부산시립미술관` — 여유 시간과 같은 계산(§3.2 주석).
- **`i03` 실제 경로**는 앱을 켜 둔 구간만(DEC-U4-7). 화면에 한계를 명시한다.
- **외부 지도앱이 없으면** 웹 지도 → 그것도 불가면 앱 산출 거리 요약(US-ONTRIP-03 예외).

> **[이연 · 2026-10-12 → U10] §4 위치 자동화 부분.** "지오펜스 진입 → i04"의 자동 경로와 `i03 실제 경로 토글`(US-PLANB-13)은 U10으로 넘어간다. **[개정 · 2026-10-12]** 현행 i01은 수동 [도착]/[방문 완료]가 i01 카드로 흡수된 형태(TRIP-396)이고, 여행 중 허브는 `frontend/src/pages/live/live-itinerary/`(`LiveItineraryPage`·`LiveHubView`)가 그린다. i 코드는 옛 체계다 — 라이브 Figma i 밴드는 **i01~i10**으로 재번호됐다(`frontend/.claude/skills/spec-perception/reference/figma-structure.md`).

> **[개정 · 2026-10-12 · U10 FD] §4 방문 완료 — 자동 완료 추가.** i01 `[방문 완료]` 수동 버튼은 **폴백으로 남고**, 도착이 확정된 슬롯에서 최소 체류 10분 뒤 리전을 벗어나면(3분 재진입 없음) **이탈 시각으로 자동 완료**한다(`completion_source = AUTO_GEOFENCE_EXIT`, Q2=A). 다음 슬롯 자동 도착 시 직전 미완료 슬롯 자동 완료(`AUTO_NEXT_ARRIVAL`)를 보조 규칙으로 둔다. "앱 켜 둔 구간만"이던 `i03` 한계 각주는 U10 경로 기록 조건(무장 + L3)으로 바뀐다. 상세 `construction/u10-gps-location-automation/functional-design/business-logic-model.md` §5 · `business-rules.md` BR-U10-14~19.

---

## 5. 위치 기준점 결정 (US-PLANB-10)

재계획은 기준점 없이는 성립하지 않는다. 다음 순서로 **차단 없이** 결정한다.

| 순위 | 기준점 | 표기 |
|---|---|---|
| 1 | 실측 현재 위치(포그라운드 조회 또는 지오펜스 최근값) | 그대로 |
| 2 | 사용자 수동 입력(`i20` 핀/장소 검색) | "추정 출발지" 명시 |
| 3 | 마지막 완료 방문지 | "마지막 방문한 곳 기준" 명시 |
| 4 | 등록 숙소(당일 앵커) | "숙소 기준" 명시 |

`i21 위치 권한 거부`는 **막다른 화면이 아니다** — 2순위로 이어지는 안내 화면이다.

> **[관측 — 정본 공백, TRIP-442 (기록) 반영, 2026-08-26]** 이 표는 사다리 **순위와 판정 주체**만 정의하고, **i20·i21에 언제 진입하는가**(어느 화면·어느 트리거에서 이 두 화면으로 넘어오는가)는 어디에도 명시돼 있지 않다. TRIP-442 구현은 이 공백을 다음 잠정 결정으로 메웠다 — ① 진입 경로는 이번 사이클 범위 밖(딥링크·`_dev/preview.tsx` 전용으로만 도달), 라이브 세션(i10 재계획 요청 등)에서 실제로 이 두 화면으로 넘어가는 배선은 후속 티켓. ② "이 위치로 계속"(2순위 확정) 및 "건너뛰기"(3·4순위 위임) press 이후의 항법(어디로 이동하는가)도 이 사이클엔 없다 — 두 CTA는 화면에 **존재만** 한다. 요구사항을 새로 만든 것이 아니라, 구현 순서상 먼저 만든 화면 껍데기가 정본에 없는 진입 순서를 잠정으로 채운 것 — 다음 유닛 작업이 실제 진입 배선을 설계할 때 이 잠정 결정을 재확인해야 한다. 근거: `src/pages/live-location/ui/LiveLocationPage.tsx`·`src/app/trips/[tripId]/live/location.tsx` 구현 결정(TRIP-442 03_implementer_notes §1-4·§3-6).

---

## 6. 외부 실패 · 폴백 (US-PLANB-11 · INV-4)

| 실패 | 동작 | 화면 |
|---|---|---|
| 날씨 API 실패/타임아웃 | 트리거 **무발화**. 수동 경로 유지 | `i09` 해당 행 "확인 불가" |
| 영업시간 조회 실패 | 〃 + 슬롯에 "영업시간 미확인"(BR-U3-09 승계) | `i01` |
| 거리/경로 API 실패 | 직선거리 폴백 표기(`FallbackMode.STRAIGHT_LINE_DISTANCE`) | `i01`·`i13` |
| 지도 SDK 실패 | 목록형 폴백 | `i02`·`i03` |
| AI 경계 실패(`ScheduleAgentCallFailed`) | **`i15` 수동 편집으로 전환** + 누락된 외부 데이터 표기 | `i22`(error) |
| 확정 저장 실패 | 원 일정 유지 + 재시도. 부분 반영 금지 | `i18` |
| 위치 불가 | §5 기준점 사다리 | `i20`·`i21` |

**복구 시**: 외부 API가 살아나면 수동 결과를 **유지한 채** 자동 검증·재계획을 다시 활성화한다(US-PLANB-11 복구절). 수동 편집분을 덮어쓰지 않는다.

---

## 7. 변경 이력 (US-PLANB-09 · DEC-U4-11)

확정(`i18` [확정]) 시 `change_log_entry` 1행을 append 한다.

| 컬럼 | Plan-B가 채우는 값 |
|---|---|
| `source_type` | `PLAN_B` (수동 편집 경로 `i15`로 확정하면 `MANUAL`) |
| `reason` | `i10`의 사유·지시어 + 트리거 요약을 한 줄로 (예: `날씨(비 예보 70%) · 실내로`) |
| `before_snapshot` / `after_snapshot` | 확정 직전/직후 `ItinerarySnapshot`(시각·순서만, INV-3) |
| `actor` | 계정 id |

- 이력은 **append-only** — 앱 롤에 UPDATE/DELETE 권한이 없다(V2.11).
- 열람·되돌리기 화면은 **`h36`(U3 소관)** 이다. U4는 쓰기만 하고 화면을 새로 만들지 않는다.

---

## 8. 갭 (G-U4-*)

| ID | 내용 | 처리 |
|---|---|---|
| **G-U4-1** | 인셉션 `RecalculationFacade.proposeAlternatives → List<AlternativeOption>`(2~3개)가 DEC-U4-1과 어긋남 | 인셉션 `component-methods.md` 정정 상신 — 반환은 **단일 초안**, 대안성은 슬롯 후보로 |
| **G-U4-2** | 트리거 임계값(강수 60%·지연 15분)의 소유·설정화 | 백엔드 C9 소유로 확정. 설정 노출 여부는 NFR 단계 |
| **G-U4-3** | `ai/main.py`가 `/health` 스텁 — AI HTTP 표면 부재 | 개발 착수 전 선행 티켓 필요 |
| **G-U4-4** | `SolverPort.recalculate`(인셉션) ↔ ai `regenerate`(실장) 이름 불일치 | DEC-U4-5로 **실장 이름을 정본**으로. 인셉션 문서 정정 상신 |
| **G-U4-5** | 실제 경로(`actual_route_point`)의 소유가 U4/U5 경계에 걸침 | U4가 정의하고 **U5 C12가 승계**(plan/actual/changelog 3계층 소유자). U5 설계에서 확정 |
| **G-U4-6** | Plan-B 민감도(적게/보통/많이) 설정 UI가 `l02`에 신설 필요 | 디자인 반영 요청 전달 완료 |
| **G-U4-7** | `i01 · 기록 없음`에서 **완료 슬롯에 사진·메모 진입점이 없다** | 디자인 확인 — 완료 후 기록을 남길 경로가 사라짐. U5 설계 전 해소 |
| **G-U4-8** | `i13`·`i14`에 `1일차` 칩이 남아 있음 | 범위가 오늘 단위(DEC-U4-3)라 불필요 — 디자인 확인 |
| **G-U4-9** | §5 기준점 사다리에 **i20·i21 진입 트리거·순서**가 정의돼 있지 않음(어느 화면에서 언제 이 두 화면으로 넘어오는가) | TRIP-442가 딥링크·프리뷰 전용 잠정으로 구현(위 §5 관측 참고). 라이브 진입 배선 설계 시 확정 필요 |

> **[개정 · 2026-10-12] 갭 상태 갱신.** **G-U4-3 해소**(§3.1 개정 블록). **G-U4-4** — 이름 문제는 의미를 잃었다(백엔드는 `regenerate`가 아니라 `/ai/v1/planb/replan`을 부른다). **G-U4-5** — `visit_check`는 U5 `archive`로 이관됐고(V2.21), `actual_route_point`는 미실장인 채 **[이연 · 2026-10-12 → U10]**. **G-U4-6** — 민감도는 계정 단위 `plan_b_sensitivity`(V2.18, `SensitivityController`)로 실재한다(U6 `account_setting`과 별개 테이블).

> **[개정 · 2026-10-12] DEC-U4-3 · G-U4-8 — "하루"는 유지, "오늘"은 풀렸다(원문 보존).** 실장 기준 사후 개정이다 — 서버(TRIP-1182 · `replan_session.target_date` V2.60)와 앱(TRIP-1195)이 모두 출하됐고, §3.1 개정 블록과 `domain-entities.md` §3.2 개정 블록이 같은 사실을 이미 적었다. 결정 표의 DEC-U4-3 행과 G-U4-8 이 옛 서술로 남아 있어 맞춘다(`business-rules.md` BR-U4-11 · `frontend-components.md` §i10 에도 같은 날짜의 블록을 달았다).
> - **유지**: 범위 어휘는 2종(`PARTIAL_SLOTS`·`FULL_DAY`)이고 **다일(多日) 재계획은 없다** — 한 세션은 하루만 바꾼다. `내일까지` 칩은 돌아오지 않았다.
> - **개정**: 그 하루가 **오늘일 필요는 없다.** 요청이 `targetDate` 로 다시 짤 일자를 고르고, 생략하면 오늘이다. 그래서 `FULL_DAY` 는 "오늘 전체"가 아니라 **"고른 그 날 전체"**다. 와이어(`ReplanScope`)는 그대로다. §2 흐름도의 "범위: 지금 이후 | 오늘 전체"와 §3.1 원문 표의 `problem.days=[오늘]` 도 "고른 날"로 읽는다.
> - **서버가 지키는 경계**(`ReplanSessionService` — 일자 판정은 `resolveTargetDate`, 기준점은 세션 시작부의 `OriginResolver` 호출): 지난 날 · 여행 기간 밖 · 그 날 일정이 아직 없음(부분 생성) → 409. 오늘이 아닌 날 + `PARTIAL_SLOTS` → 400 — 그 날의 '지금'이 없어 `지금 이후`가 성립하지 않는다. 오늘이 아닌 날에는 요청 위치·마지막 방문 좌표를 기준점으로 쓰지 않고 §5 사다리의 숙소 단으로 내려간다.
> - **앱이 한 것**(TRIP-1195): 날짜를 고르는 입력을 새로 두지 않았다. **허브가 보고 있는 일차**가 오늘 이후의 다른 날이면 그 날짜로 i10 을 열고(`LiveItineraryPage` → `/planb?targetDate=`), 범위 칩을 `{N}일차 전체` 하나로 줄인다(`replanScopeOptions` — 일차를 모르면 `이 날 전체`) — `지금 이후` 칩은 그 날 나오지 않는다. 지난 일차와 여행 시작 전에는 AI 재계획 진입 자체가 없다. 재계획안 페이지의 **대안 없음** 얼굴(i16)에는, 오늘 세션이고 내일이 일정에 있을 때만 [내일 일정 다시 짜기]가 뜬다(`targetDate`=내일 · `FULL_DAY`, `PlanbDraftPage`).
> - **G-U4-8** "`1일차` 칩은 불필요(범위가 오늘 단위)"는 근거가 사라졌다 — 일차 표시는 이제 어느 날을 다시 짜는지 알리는 값이다. 남은 것은 위 앱 동작을 **디자인(Figma)이 추인**하는 일이다.

> **[개정 · 2026-10-19 · situation-awareness FD]** G-U4-2 — 임계 소유·설정화
> 소유는 C9 로 닫혔고, 설정 노출 여부는 §2.1 개정 블록이 다룬다(C9 상수 — U2 BR-U2-15 와의 차이는 정본 승인 때 정한다).
> → [BR-SA-15](../../situation-awareness/functional-design/business-rules.md) · [G-SA-14](../../situation-awareness/functional-design/business-logic-model.md)

> **[개정 · 2026-10-22 · TRIP-1561]** 위 2026-10-12 블록 §4 의 "`[방문 완료]` 수동 버튼은 폴백으로 남고"를 좁혀 읽는다. 원문은 그대로 두고 이 블록이 우선한다. 수동 허브에서는 다음 장소 [도착]을 누르면 앞 장소를 먼저 완료(`MANUAL`)하고 도착을 기록하며(U10 BR-U10-54), [방문 완료] 수동 버튼은 그날 마지막 장소·[도착]이 서지 않는 화면·무장 여행에서 남는다(BR-U10-56). 근거: 사용자 결정 2026-10-22(A안) · `근거: TRIP-1561 구현 결정`(요구사항 근거로 인용 금지).
