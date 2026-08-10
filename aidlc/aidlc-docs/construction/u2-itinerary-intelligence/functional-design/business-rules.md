# U2 Itinerary Intelligence / Solver — Business Rules (드리프트 결정표)

> **이 문서의 역할 (Q1=A · Q5=A · 2026-08-07 사용자 결정)**: `ai/docs/backend-ai-정합성-점검.md`가 남긴 **미결 드리프트를 결정으로 종결**한다. 티켓(TRIP-280·281·282)은 여기서 내린 결정을 **반영하는 작업**만 수행한다. 경계 계약은 두 팀 공유물이라 티켓 하나에 묻히면 반대편이 모르기 때문이다.
> **솔버 내부 규칙(HC1~HC4 정의·DL-1~6·결정론·PBT)은 재서술하지 않는다** — 정본은 `ai/aidlc-docs/construction/u2-solver/functional-design/business-rules.md`.

---

## 0. 규칙 적용 순서 (충돌 해소 규칙)

| 순위 | 규칙 |
|---|---|
| 1 | **실장이 이긴다** (Q2=A) — aidlc 설계 정본과 실제 코드가 다르면 코드가 정본. 문서를 코드에 맞춰 개정하고 차이는 `G-U2-*`로 기록 |
| 2 | **양쪽 실장이 서로 다르면 이 문서가 결정한다** — backend와 AI가 각각 다르게 구현한 지점은 "실장 우선"으로 자동 판정 불가. 아래 BR이 결정 |
| 3 | **불변식(INV-1~4)은 개정 대상이 아니다** — 위반이 발견되면 문서가 아니라 코드를 고친다. 현재 양쪽 실측 위반 0 |

---

## 1. 경계 스키마 결정

### BR-U2-01 · `Violation` 스키마 통일 (P4 잔여)

**결정**: 경계 `Violation = { code, slotKey, detail }`.

| 항목 | 값 |
|---|---|
| `code` | `HC1` \| `HC2` \| `HC3` \| `HC4` — 자유 문자열 금지 |
| `slotKey` | BR-U2-04 키 규약. 슬롯 특정 불가 시 `null` |
| `detail` | 사람이 읽는 설명 (표시 문구 아님) |

- **근거**: AI 쪽 `code: HC1~HC4`(`ai/src/trippilot/domain/itinerary.py`)가 BR-U2-02(HC 어휘 승격)와 정합. backend의 `(type, dayIndex, slotIndex)`는 편집 중 슬롯 이동 시 인덱스가 흔들려 지시가 깨진다.
- **영향**: backend `ScheduleAgentPort.kt` `Violation` 변경(`type`→`code`, `dayIndex`/`slotIndex`→`slotKey`). AI는 `slot_ref`(PoiId) → `slot_key`로 확장.

### BR-U2-02 · 실현가능성 검증 어휘 = HC1~HC4 (Q6=A)

**결정**: `HC1`(영업시간) · `HC2`(이동 버퍼) · `HC3`(고정 블록 불변) · `HC4`(day window·자정 귀속)를 **정본 어휘로 승격**한다. 정본 `component-methods.md` §3의 5메서드 표기(`checkTimeWindows`·`checkTravelBuffer`·`checkAnchors`·`checkMustVisitInclusion`·`isFeasible`)는 **폐기**하고 매핑표만 남긴다.

| 폐기되는 정본 표기 | HC 코드 |
|---|---|
| `checkTimeWindows` | HC1 |
| `checkTravelBuffer` | HC2 |
| `checkAnchors` + `checkMustVisitInclusion` | HC3 (고정 블록 = 앵커 + 시각 고정 필수 방문지) |
| (정본에 대응 없음) | HC4 |
| `isFeasible` | `check_all` |

- **근거**: HC 어휘가 이미 backend 포트 주석·AI 구현·PBT·테스트 전반에 퍼져 있다. 개명 비용이 문서 정정 비용보다 크다.
- **주의**: 정본 `checkMustVisitInclusion`(필수 방문지 **누락 없음**)은 HC3(고정 블록 시각 불변)과 **완전히 같지 않다** — `INCLUDE_ONLY` 필수 방문지가 아예 배치되지 않는 경우를 HC 코드가 표현하지 못한다. → **미결 O-U2-1**(§6).

### BR-U2-03 · `SolveMode` 매핑 (N2 종결)

**결정**: AI 4종(엔진 축) → 경계 3종 + `isFallback`(품질 축). 매핑은 **단사** — 정보 손실 0, 역매핑 가능.

| AI `SolveMode` | 경계 `solveMode` | `isFallback` |
|---|---|---|
| `OR_TOOLS` | `DETERMINISTIC` | `false` |
| `LLM` | `FULL_AI` | `false` |
| `RULE_FALLBACK` | `DETERMINISTIC` | **`true`** |
| `MINIMAL` | `MINIMAL` | `true` |

- **금지 조합**: `(FULL_AI, true)` · `(MINIMAL, false)` — 발생 시 계약 위반.
- **근거**: 경계 3종은 "사용자에게 어떤 성격의 해인가"(표시·저장 축), AI 4종은 "어느 엔진이 풀었나"(엔진 축). `RULE_FALLBACK`은 결정론이지만 강등이므로 `DETERMINISTIC + isFallback`이 정확한 사영이다. 미정이던 `RULE_FALLBACK` 목적지가 이로써 확정된다.

### BR-U2-04 · `slotKey` 키 규약 (N3 종결)

**결정**: `slotKey = "{date(ISO-8601)}#{poiId}"` — 예: `2026-09-14#7b0c…`.

- `explanations`의 키, `Violation.slotKey`가 **같은 규약**을 쓴다.
- **제약**: 같은 날 같은 POI를 두 슬롯에 배치하지 않는다(키 충돌 방지). 필요해지면 `#{ordinal}` 접미로 확장한다.
- **근거**: DB 저장 전(생성 응답 시점)에 AI가 부여할 수 있어야 하고, 편집으로 순서가 바뀌어도 안정해야 한다. 인덱스 기반 키는 둘 다 실패한다.
- **영속**: `explanations`는 현재 **저장 경로가 없어 유실**된다(`GenerateItineraryService`에서 도메인 변환 시 탈락). `visit_slot`에 `placement_reason` 컬럼 추가 필요 → backend 마이그레이션 사안(티켓 필요).

### BR-U2-05 · `candidatesSummary` 신설 (N4 종결)

**결정**: 경계 응답에 추가한다.

```
CandidatesSummary { level: HIGH | MEDIUM | LOW, poolSize: Int, shortfallCategories: [String] }
```

- **임계는 AI 소유** — backend는 `level`만 신뢰하고 자체 판정하지 않는다.
- **용도**: `LOW`면 "일부 추천이 빠졌어요" 안내(US-SCHED-09 폴백 체인의 `PARTIAL_PLACE_DATA` 자리).
- **근거**: AI `agent-io-contracts.md` §1.2에 필드는 있으나 backend 포트에 대응이 없고, **타입 정의도 AI 코드에 없다**(미구현). 신설 = 양쪽 동시.

### BR-U2-06 · `FreshnessMeta` 스키마 (N5 종결)

**결정**: 경계는 **집계형** `{ generatedAt, degraded }` — backend 실장 유지. AI의 per-source `{source, fetched_at, cache_hit, ttl_sec, stale}`는 **AI 내부 관측용**이며 경계로 올리지 않는다.

- `degraded = true` 조건: 사용한 소스 중 하나라도 `stale`이거나 폴백 데이터로 대체된 경우.
- **근거**: 사용자 표시에 필요한 건 "지금 이 일정이 신선한가" 한 비트다. 소스별 상세는 관측 시스템의 몫이고, 경계에 실으면 backend가 해석 책임을 떠안는다.

### BR-U2-07 · `FallbackMode` enum 폐기 → 3축 표현

**결정**: 정본 `FallbackMode`(NONE / DETERMINISTIC_ONLY / PARTIAL_PLACE_DATA / STRAIGHT_LINE_DISTANCE / MINIMAL_ANCHORS_ONLY) 5종을 **폐기**하고 아래 3축으로 대체한다.

| 정본 enum 값 | 대체 표현 |
|---|---|
| `NONE` | `isFallback = false` |
| `DETERMINISTIC_ONLY` | `solveMode=DETERMINISTIC, isFallback=true` (BR-U2-03) |
| `PARTIAL_PLACE_DATA` | `candidatesSummary.level = LOW` (BR-U2-05) |
| `STRAIGHT_LINE_DISTANCE` | `distanceRange` 문자열의 "추정" 표기 (BR-U2-08) |
| `MINIMAL_ANCHORS_ONLY` | `solveMode = MINIMAL` |

- **근거**: 실장에 없고(=Q2 규칙 1), 하나의 enum이 서로 독립인 세 가지 강등(엔진·후보·거리)을 한 축에 욱여넣는다. 동시 발생 시 표현 불가.

### BR-U2-08 · 이동 거리 경계 표현 (INV-3 유지)

**결정**: 경계는 `distanceRange: String?` 표시 문자열(예: `"약 1.2km · 도보 추정"`)만 싣는다. 정본 `DistanceEstimate{meters, mode, basis}` 구조체는 경계에 올리지 않는다.

- **`basis`(도로/직선) 정보는 문자열의 "추정" 표기로 전달**한다.
- **INV-3 재확인**: 양쪽 실측 통과 — AI는 직렬화 경로 분리로 `internal_minutes` 차단, backend `VisitSlotDisplay`에 duration 필드 부재. **경계에 소요시간 필드를 추가하는 변경은 어떤 이유로도 금지**한다.

### BR-U2-09 · `explanations` 문구 제약 (INV-2·INV-3 우회 차단)

**결정**: `explanations` 텍스트에 **시각·소요시간을 언급하지 않는다**("오후 2시에 방문하면", "30분 거리라" 등 금지). 배치 이유(취향 적합·동선·카테고리 균형)만 서술한다.

- **근거**: LLM 생성 텍스트가 시각을 말하는 순간 사용자에게 **검증되지 않은 시각**이 노출된다(INV-2 우회). 소요시간 언급은 INV-3 우회다.
- **집행**: AI C1 설명 워커의 프롬프트·후처리 책임. 경계 검증은 하지 않는다(문자열 검사는 취약).

---

## 2. 절차 규칙

### BR-U2-10 · 경계 변경 절차 (결정 4 이행)

**결정**: 경계 스키마 변경은 **`openapi.yaml` 단일 정본을 먼저 고치고 양쪽(Kotlin·Python) 코드를 생성**한다. 한쪽 코드만 고치는 경계 변경은 금지한다.

- 현재 `openapi.yaml`에 `/ai/*`·`/internal/pois*` 경로가 **0건**이다(G-U2-06) → 이 규칙은 TRIP-282 반영 후 발효.
- 그 전까지의 임시 정본 = `backend/docs/design/ai-backend-경계-계약-초안.md` + 본 문서.

### BR-U2-11 · `deadlineMs` 소유 = 호출자 (DL-6 이행)

**결정**: 지연 예산은 **backend(호출자)가 소유**하고 요청마다 전달한다. AI는 경로별 값을 모른다. 기준값 — day1 5,000ms · Plan-B 10,000ms · 재생성/백그라운드 관대.

### BR-U2-12 · `validate`는 차단하지 않는다

**결정**: `validate`는 **위반 표기만** 한다. 사용자의 편집을 거부하거나 자동 수정하지 않는다. `repair`는 사용자가 명시적으로 요청할 때만 호출한다(US-SCHED-07).

---

## 3. O-SOLVER — 품질 관측과 재평가 트리거 (Q4=B)

> **임계값 숫자는 이 문서에서 정하지 않는다.** 실데이터 없이 정한 숫자는 근거 없는 게이트가 된다. 여기서 확정하는 것은 **무엇을·어디서·얼마 동안 보고 → 언제 판정 회의를 여는가**뿐이다.

### BR-U2-13 · 관측 지표 4종과 소유

| 지표 | 소유 | 출처 |
|---|---|---|
| `QualityScore.composite` 분포 | AI | `c2/quality.py` — 현 산식 `0.4·preference_fit + 0.4·constraint_satisfaction + 0.2·route_efficiency` (초기값, 캘리브레이션 미실시) |
| 강등 비율 (`isFallback=true`, `solveMode=MINIMAL`) | AI 텔레메트리 + backend 저장분 | `FallbackEvent` · `solve_mode` |
| 생성 후 사용자 **수동 편집률** | backend·frontend | 편집 API 호출 / 생성 건수 |
| **재생성 요청률** | backend·frontend | `regenerate` 호출 / 생성 건수 |

- **`QualityScore`는 경계로 넘기지 않는다.** AI 내부 텔레메트리로만 관측한다. 사용자 행동 지표(편집률·재생성률)는 backend/frontend에만 있으므로, **판정 회의에서 두 계열을 합친다.** 경계에 품질 필드를 추가하면 backend가 해석·저장 책임을 지게 되는데 그 책임의 소비자가 아직 없다.

### BR-U2-14 · 판정 회의 트리거

**결정**: 아래 중 **먼저 도달한 시점**에 1차 판정 회의를 연다.

- 실사용 일정 생성 누적 **유의미 표본 도달**(초기 제안: 200건 — 운영 조정 가능), **또는**
- 출시 후 **4주 경과**, **또는**
- 강등 비율·재생성률이 **직전 관측 창 대비 뚜렷이 악화**(상대 변화 기준 — 절대 임계 아님)

**회의 산출은 셋 중 하나**: ① 유지 ② 파라미터 튜닝(가중치 캘리브레이션·후보풀 조정) ③ 엔진 교체(BR-U2-15).

### BR-U2-15 · 임계값 하드코딩 금지

**결정**: 판정 임계 숫자를 코드나 설계 문서에 **하드코딩하지 않는다.** 필요해지면 설정값으로만 둔다. 산식 가중치(0.4/0.4/0.2)도 **초기값**임을 명시한 채 유지한다.

---

## 4. FR-SOLVER 재정의 (Q7 — `ai/` 조사 결과 반영)

### BR-U2-16 · "Bedrock AgentCore 교체" 전제 폐기 → 벤더 중립 "2차 엔진 교체"

**조사 결과**: `ai/aidlc-docs/inception/design-artifacts/ai-adr.md` **AI-D06 (2026-07-21)** — LLM 벤더는 **Anthropic API 직접**(`api.anthropic.com`)으로 확정됐고 **AWS Bedrock 경유가 아니다**(회사 결제 승인이 Anthropic 직접 경로로 진행). 같은 ADR이 *"문서 내 'Bedrock' 표기 → 'LLM API(Anthropic)'로 읽는다. **'Bedrock 2차 솔버'도 동일 — Anthropic API 호출로 구현**"* 이라고 명시한다. 실제로 ai 소스 전체에 Bedrock/AgentCore 참조 **0건**이며, 2차 솔버는 `c2/llm_solver.py`(Anthropic 어댑터 경유)로 구현돼 있다.

**결정**:

| 정본 조항 | 재정의 |
|---|---|
| FR-SOLVER-02 "Bedrock AgentCore 에이전트로 교체" | **벤더 중립 "일정 지능 엔진 교체"**로 읽는다. 특정 벤더를 지목하지 않는다 |
| `components.md` §3.1 `BedrockAgentSolverAdapter` | 명칭 폐기. 교체 지점 = ① AI 내부 `SolverPort` 구현체 ② 굵은 경계(`POST /ai/schedule`) 뒤 전체 — **둘 다 어댑터 교체로 대체 가능**(경계가 굵어 backend 변경 0) |
| FR-SOLVER-03 (옵션 B — 규칙 완화) | **유효하되 트리거 미도래.** 완화 후보(생성 시각 노출 금지·INV-3 소요시간 미표시 등)는 교체 결정 시점에 재검토 |
| FR-SOLVER-04 (실현가능성 = 결정론 컴포넌트 소유) | **불변 유지 — 이미 준수.** 현 체인은 LLM 2차 해도 `check_all`(HC1~HC4) 통과 후에만 반환한다 |

- **교체 가능성 확인 결론**: 경계가 **1호출로 굵게** 잡혀 있어 엔진 교체 시 backend 변경이 필요 없다. FR-SOLVER-02의 구조적 전제는 **충족돼 있다** — 별도 설계 없이 판정만 남았다.
- FR-SOLVER-02·03의 "Bedrock" 문구는 **인셉션 요구사항 본문**(`requirements.md`)에 있다 → 개정은 별도 승인 사안(갭 `G-U2-02`).

---

## 5. PBT / 게이트 배치

**AI 소유(인용 — 이미 CI 게이트)**: `U5-P1`(HC 위반 0 + oracle 대조) · `U5-P2`(warm-start 멱등) · `U5-P3`(결정론) · `U5-P4`(이동 추정 + `internal_minutes` 미노출) · `U5-P6`(예산 가중치 단조성) · `DL-P1/P2`(시한) · `GATE-P`(closed-set 적대적 제안 드롭).

**경계 신설 제안 (backend 소유 · 이 문서에서 신규)**:

| ID | 속성 |
|---|---|
| `PBT-U2-B1` | **직렬화 왕복** — 임의 `ScheduleAgentOutput`에 대해 camelCase↔snake_case 변환 왕복이 항등 |
| `PBT-U2-B2` | **SolveMode 매핑 단사성**(BR-U2-03) — AI 4종 → (경계 3종, isFallback) 매핑이 단사이고 역매핑이 원값 복원. 금지 조합 미발생 |
| `PBT-U2-B3` | **slotKey 왕복**(BR-U2-04) — 임의 (date, poiId)에서 키 생성·파싱 왕복 항등, 같은 날 중복 POI 없음 |

---

## 6. 미결

| ID | 내용 | 판단 위치 |
|---|---|---|
| **O-U2-1** | `INCLUDE_ONLY` 필수 방문지 **미배치**를 표현하는 코드가 HC1~HC4에 없다(BR-U2-02 주의). 별도 코드 신설(`HC5`?) vs `excluded` 목록으로 표현 | U3(생성 화면이 "못 담은 곳"을 어떻게 보여줄지 확정될 때) |
| **O-U2-2** | `explanations` 영속 컬럼(`visit_slot.placement_reason`) 마이그레이션 | backend 티켓 |
| ~~**O-U2-3**~~ | `proposeSlotCandidates` → **종결 (2026-08-07 · U3 DEC-U3-5)**: 완전 AI·같이 고르기 공통 경계로 개통, `ScheduleAgentPort`는 4메서드(§business-logic-model 7.1). `recalculate` → **종결 (2026-08-09 · U4 DEC-U4-5)**: `replan`으로 개통, 어댑터가 ai `regenerate(problem, locked_slots)`로 매핑(§business-logic-model 7.2). `ScheduleAgentPort`는 **5메서드** | 종결 |
| **O-SOLVER** | 엔진 교체 판정 임계 | 운영(BR-U2-14 트리거 도달 시) |
