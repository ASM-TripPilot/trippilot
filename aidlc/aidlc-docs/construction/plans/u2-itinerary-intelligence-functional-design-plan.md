# U2 Itinerary Intelligence / Solver — Functional Design Plan

> **유닛**: U2 Itinerary Intelligence / Solver — `SolverPort`+어댑터 · `FeasibilityValidator` · `PreferenceScoringPort`/`LlmGatewayPort` · `TravelEstimatePort`
> **스토리**: **사용자 대면 0** (엔진 유닛). 계약·불변식(INV-1~4)·PBT 게이트로 표현 — `unit-of-work-story-map.md` §U2 주석
> **범위 주의(SCOPE.md 2026-07-17)**: 산출물은 설계 문서까지 — Code Generation 없음. 코드는 팀이 `ai/`·`backend/`에서 직접 개발
> **선행 상태**: U0 설계 종료(2026-07-17) · U1 설계 종료(2026-07-23). 사용자 지시로 U2→U3 착수(2026-08-07)

---

## ⚠️ Step 1 결과 — U2는 **그린필드가 아니다**

U1 착수 시점(코드 0줄)과 근본적으로 다르다. **U2의 실질은 이미 설계·구현·테스트까지 끝나 있다.**

| 자산 | 실재 | U2 관련성 |
|---|---|---|
| `ai/src/trippilot/c2/` | facade·constraints(HC1~HC4)·ortools_solver·llm_solver·fallback_solver·scorer·travel·repair·quality **9모듈** | = `SolverPort`+`FeasibilityValidator`+`TravelEstimatePort` **구현 완료** |
| `ai/src/trippilot/c1/` | gateway·context·prompts + gates 4종 + workers 4종 + anthropic 어댑터 | = `PreferenceScoringPort`/`LlmGatewayPort` **구현 완료** |
| `ai/src/trippilot/ports/` | solver·llm·travel·places·poi_db·cache·vector·embedding·trace **9포트** | 포트 계층 실재 |
| `ai/aidlc-docs/` | **별도 AI-DLC 워크스페이스** — 자체 inception(요구·앱설계·유닛) + construction FD | **U2 기능설계가 이미 존재** (`u2-solver/functional-design/` 3종) |
| `backend/modules/itinerary-generation/` | `ScheduleAgentPort.kt`(경계 포트) · `GenerateItineraryService` 외 서비스 4 · 도메인 3 · 테스트 8 · `V2.7`·`V2.8` 마이그레이션 | **U3(C8)까지 착수됨** |
| `backend/docs/design/ai-backend-경계-계약-초안.md` | PR #76 합의 초안 | 경계 계약 정본 후보 |
| `ai/docs/backend-ai-정합성-점검.md` | 드리프트 감사 P1~P8 + N1~N6(2026-08-06 재감사) | **본 유닛의 실질 미결 목록** |

### 정본 충돌 지도 — 두 워크스페이스의 유닛 번호가 다르다

| aidlc 워크스페이스 (본 문서) | ai 워크스페이스 | 상태 |
|---|---|---|
| **U2** Itinerary Intelligence/Solver | `u1-domain-ports`(2026-07-23 완료) + `u2-solver`(2026-07-29 코어 완료, 76 tests green) + `u4-c1-gateway`(FD 완료·승인 대기) + `agent-foundation` | **거의 전부 선점** |
| U1의 C7 Place Data | `u3-m7-place-data`(2026-07-29 코어 완료) | 소유권 합의 = 백엔드 C7 단일 정본, AI M7은 read-only |
| **U3** AI Itinerary Generation(C8) | (없음 — 백엔드 소유) | backend `itinerary-generation` 모듈로 착수됨, 프런트는 `(tabs)/itinerary.tsx` 셸뿐 |

> 즉 **같은 대상에 대해 설계 문서가 세 곳**(aidlc `component-methods.md` / ai `aidlc-docs` / backend `ai-backend-경계-계약-초안.md`)에 있다. U2 문서를 규칙대로 풀세트로 새로 쓰면 **네 번째 정본**이 생기고 즉시 드리프트한다. 이것이 Q1의 배경이다.

### 드리프트 현황 (`ai/docs/backend-ai-정합성-점검.md` 2026-08-06 재감사)

| # | 지점 | 판정 | 잔여 |
|---|---|---|---|
| P1 | POI 정본·INV-1 이중 소유 | 부분 해소(소유권 합의) | ai `poi_db_port.upsert` 제거 — TRIP-280 |
| P2 | 후보풀 필터 6단계↔2단계 | 부분 해소(결정1 합의) | ai `pool_builder` 미조정 — TRIP-280 |
| P3 | 카테고리 enum 한글8↔영문7 | 부분 해소(백엔드 8종 완료) | ai enum 정합 — TRIP-281 / openapi 누락 — TRIP-282 |
| P4 | SolverPort 계약 형태 | 실질 해소(`ScheduleAgentPort` 실재) | **Violation 스키마 불일치** — TRIP-282 |
| P5 | QualityScore 미구현 | **해소**(TRIP-259·261) | — |
| P6 | 별도 `solver/` 디렉토리 | **미해소** — aidlc `unit-of-work.md §코드조직도`가 실재하지 않는 `solver/`를 그림 | 정본 문서 정리 |
| P7 | CandidatePoolPort 드리프트 | 부분 해소 | openapi에 `/ai/*` 경계 API 0건 — TRIP-282 |
| P8 | 오케스트레이션 소유 그림 충돌 | 해소(굵은 경계 확정) | `ai-implementation-design.md` 구 그림 정정 — TRIP-282 |
| N1 | 자정 넘김 슬롯(HC4) 유실 | **해소 확인** — `V2.8__visit_slot_ends_next_day.sql` + `endsNextDay` | — (TRIP-279 반영됨) |
| N2 | SolveMode 4↔3 매핑표 부재 (`RULE_FALLBACK` 목적지 미정) | 미해소 | TRIP-282 |
| N3 | explanations slot_id 키 해석 불가·영속 유실 | 미해소 | TRIP-282 |
| N4 | `candidates_summary` BE 포트 누락 | 미해소 | TRIP-282 |
| N5 | FreshnessMeta 스키마 상이 | 미해소 | TRIP-282 |
| N6 | validate·repair 계약 문서 부재 | 미해소 | TRIP-282 |

---

## 실행 계획

- [x] 1. 유닛 컨텍스트 분석 — `unit-of-work.md`(U2) · `story-map`(U2 주석) · `components.md` §3 AI/솔버 계약 · `component-methods.md` §1~3 · `requirements.md` FR-SOLVER-01~05
- [x] 1b. **기존 자산 조사** — `ai/` 실장·별도 AI-DLC 워크스페이스 · `backend/modules/itinerary-generation` · 정합성 점검 P1~P8·N1~N6 (위 표)
- [x] 2. 질문 Q1~Q8 답변 수집 (2026-08-07) — **Q1=A · Q2=A · Q3=A · Q4=B · Q5=A · Q6=A · Q7=C(ai 폴더 확인) · Q8=A**. 모호성 0 → 명확화 파일 없음
  - **Q7=C 조사 결과**: `ai-adr.md` **AI-D06(2026-07-21)** — LLM 벤더 = **Anthropic API 직접, Bedrock 아님**(결제 승인 경로). "Bedrock 2차 솔버"도 Anthropic 호출로 구현. ai 소스 전체 Bedrock/AgentCore 참조 **0건**. → FR-SOLVER-02/03의 Bedrock 전제 폐기 → BR-U2-16으로 재정의, 갭 G-U2-02 기록
- [x] 3. **A안 산출물 2종 작성** — `u2-itinerary-intelligence/functional-design/business-logic-model.md`(경계 계약 정본·소유 경계·호출 흐름·불변식 집행점) + `business-rules.md`(BR-U2-01~16 드리프트 결정표 + O-SOLVER 관측 + PBT-U2-B1~B3)
- [x] 4. 정합 검증 — 정본 ↔ 실장 대조, 갭 **G-U2-01~09** 기록(business-logic-model §8), 미결 **O-U2-1~3 + O-SOLVER**(business-rules §6)
- [ ] 5. 완료 메시지 → 사용자 승인 게이트 → `audit.md`·`aidlc-state.md` 반영
- [ ] 6. (승인 후) U3 Functional Design Plan 착수

---

## 질문 (모두 `[Answer]:` 에 답해 주세요)

각 질문의 마지막 선택지는 항상 "Other"입니다. "이건 추천해줘"라고 적으셔도 됩니다 — 근거와 함께 안을 제시하겠습니다.

## Question 1 — U2 산출물의 성격 ★ 가장 중요

U2의 실질(솔버 체인·HC1~HC4·LLM 게이트웨이·품질점수)은 **`ai/`에 설계·구현·테스트까지 완료**돼 있고, 경계 포트도 `ScheduleAgentPort.kt`로 실재합니다. 그런데 정본 문서는 세 곳에 흩어져 있고 실제로 어긋나 있습니다(P1~P8·N2~N6).

A) **경계 접합 문서 (권장)** — U2 산출물을 2종으로: ① `business-logic-model.md` = **backend↔AI 경계 계약 정본**(소유 경계·호출 형태·DTO·폴백 체인·불변식 집행 지점) ② `business-rules.md` = **드리프트 결정표**(N2~N6 등 미결을 결정으로 종결). `ai/`의 FD·구현은 **구현 정본으로 인용만** 하고 재서술하지 않음

B) **규칙대로 풀세트 3종** — `business-logic-model`·`domain-entities`·`business-rules`를 U2 관점에서 새로 작성. 완결성은 높지만 `ai/aidlc-docs/u2-solver/`와 **이중 정본**이 되고 드리프트 재발

C) **U2 스킵** — 실질이 끝났으므로 `aidlc-state.md`에 "실장 선행으로 설계 단계 생략" 기록만 남기고 **U3만 진행**

D) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 2 — 정본 우선순위 (충돌 시 어느 쪽이 이기나)

aidlc `component-methods.md`(설계 정본, 2026-07-12)와 실장(`ScheduleAgentPort.kt`·`ai/src`, 2026-07~08)이 어긋날 때의 규칙입니다. U1에서는 Q1=D("라이브 Figma 우선")를 택했습니다 — 그 선례의 코드판입니다.

A) **실장 우선** — 실제 코드가 정본. aidlc 문서는 실장에 맞춰 개정하고 차이는 드리프트로 기록

B) **설계 정본 우선** — `component-methods.md`가 정본이고 코드가 맞춰야 함(리팩터 요구 발생)

C) **분할 (권장)** — **경계 계약(포트 시그니처·DTO·enum)은 실장 우선**, **불변식(INV-1~4)·품질 판정(QualityScore·O-SOLVER)은 aidlc 정본 우선**. 전자는 이미 합의·구현됐고 후자는 프로젝트 수준 결정이라 코드가 임의로 못 바꿈

D) Other

[Answer]: A

## Question 3 — `SolverPort` 4메서드 ↔ `ScheduleAgentPort` 3메서드

정본은 `generate`·`recalculate`·`validate`·`proposeSlotCandidates` 4개인데, 실장 경계 포트는 `generate`·`validate`·`repair` 3개입니다. `recalculate`(Plan-B 재계산)와 `proposeSlotCandidates`(같이 고르기 슬롯 후보)의 자리가 비어 있습니다.

A) **3메서드로 확정 (권장)** — `recalculate`는 U4(Plan-B) 때 `repair` 확장 또는 별도 경계로 결정, `proposeSlotCandidates`는 U3에서 CO_PLAN(`GenerationMode.CO_PLAN`이 이미 enum에 있음) 설계 시 결정. U2 문서는 "현재 경계 = 3메서드 + 미개통 2건" 으로 명시

B) **4메서드 유지** — 실장에 2개를 지금 추가 요구(설계 부채를 지금 갚음)

C) `proposeSlotCandidates`만 U3에서 신설, `recalculate`는 `repair`로 흡수 확정

D) Other

[Answer]: A

## Question 4 — O-SOLVER (QualityScore 임계·엔진 교체 판정)

인셉션이 CONSTRUCTION으로 명시 이연한 **유일한 열린 항목**입니다(`components.md` §3.7). `QualityScore`는 구현 완료(TRIP-259·261)라 자료구조는 있고, **임계값·판정 프로세스만** 비어 있습니다.

A) 이번 U2 문서에서 composite 산식·임계·판정 프로세스를 **확정**(이연 종결)

B) **관측 지표 + 재평가 트리거만 정의 (권장)** — 임계값은 실데이터 없이 정하면 근거 없는 숫자가 됨. "무엇을 얼마 동안 관측하면 판정 회의를 여는가"만 확정하고 숫자는 운영 결정으로 남김

C) 이연 유지 — 문서에 미결로 언급만

D) Other

[Answer]: B

## Question 5 — 잔여 드리프트(N2~N6 · Violation 스키마)의 결정 위치

TRIP-282가 묶어 추적 중인 5~6건입니다. 문서가 결정하느냐, 티켓이 결정하느냐의 문제입니다.

A) **U2 문서가 결정표로 확정 (권장)** — 티켓은 반영 작업만 수행. 경계 계약은 양팀 공유물이라 티켓 하나에 묻히면 반대편이 모름

B) 티켓에서 결정 — U2 문서는 "TRIP-282 결과를 따른다"고 참조만

C) Other

[Answer]: A

## Question 6 — `FeasibilityValidator` 명명 통일

정본은 5메서드(`checkTimeWindows`·`checkTravelBuffer`·`checkAnchors`·`checkMustVisitInclusion`·`isFeasible`), 실장은 HC1~HC4 `ConstraintChecker`입니다. 실장 어휘(HC1~HC4)가 backend `ScheduleAgentPort` 주석·PBT·테스트 전반에 이미 퍼져 있습니다.

A) **HC1~HC4를 정본 어휘로 승격 (권장)** — 정본 5메서드 표기는 폐기하고 매핑표만 남김

B) 정본 명명 유지 — `ai/`가 개명

C) 양쪽 명명 병존 + 매핑표만 유지

D) Other

[Answer]: A

## Question 7 — FR-SOLVER-02/03 (Bedrock 엔진 교체) 취급 범위

"솔버 품질이 별로면 Bedrock AgentCore로 교체" 결정입니다. 현재 경계가 `POST /ai/generate` 한 호출로 굵게 잡혀 있어 교체 지점은 이미 확보된 상태로 보입니다.

A) **교체 가능성 확인만 (권장)** — "경계가 굵어 어댑터 교체로 대체 가능"을 확인·기록하고 종결. 교체 설계는 실제 교체 결정 시점

B) 교체 설계 초안(어댑터 형태·마이그레이션 순서·규칙 완화 후보 목록)까지 이번에 작성

C) Other ai 폴더 확인

[Answer]: C/ai 폴더 확인

## Question 8 — U3 착수 시 라이브 Figma 대조 여부

U1에서는 라이브 Figma 밴드 d·e·g 대조로 드리프트 13건을 잡아 인셉션을 사후 개정했습니다. U3는 backend는 착수됐지만 **프런트가 `(tabs)/itinerary.tsx` 셸뿐**이라 화면 설계가 통째로 남아 있습니다.

A) **U3에서 밴드 h(일정) 라이브 대조 수행 (권장)** — U1과 동형. 프런트 착수 전이라 지금 잡는 게 가장 쌈

B) 대조 없이 스토리(US-SCHED-01~12) 기준으로만 설계

C) Other

[Answer]: A
