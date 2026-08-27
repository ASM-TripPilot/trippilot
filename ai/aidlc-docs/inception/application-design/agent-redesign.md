# Agent 재설계 — 업무 기준 (멘토 피드백 반영)

> **피드백 1**: "서브에이전트가 업무 단위로 나뉘어져야 한다. 어떤 tool만 쓰는 게 아니라, 비서처럼 특정 일에 특화되어 end-to-end로 처리할 줄 알아야 한다."
> **피드백 2**: "간단한 task 요청은 Orchestrator가 직접 처리해서 신속성을 확보해라. 매번 에이전트한테 위임하면 오버헤드가 생긴다."

---

## 문제: 현재 설계 (tool/feature 기준)

```
라우터(INTENT) → PreferenceScoringWorker   ← "점수 매기기" 도구 1개
              → ExplanationWorker          ← "설명 생성" 도구 1개
              → ReflectionWorker           ← "회고 생성" 도구 1개
              → PlaceExtractionWorker      ← "웹 텍스트 구조화" 도구 1개
              → ConversationWorker         ← "대화 응답" 도구 1개
```

- 각 워커가 **LLM feature 1개 = 함수 1개**만 호출
- 업무의 맥락을 모르고, 자기 tool만 실행하고 끝
- 복합 업무(일정 추천, Plan-B 대안 생성)는 **오케스트레이터가 직접 조립**해야 함
- 워커는 "비서"가 아니라 "도구 래퍼"에 불과

---

## 해결: 업무 기준 에이전트 재설계

### 핵심 원칙

1. **에이전트 = 업무 전담 비서** — "일정 추천해줘", "Plan-B 만들어줘" 같은 업무를 맡으면 필요한 도구를 스스로 조합해서 end-to-end로 처리
2. **에이전트는 여러 도구를 사용** — LLM 호출, M7 조회, 솔버 검증, 웹 소싱 등을 필요에 따라 조합
3. **에이전트는 판단한다** — 폴백 시점, 추가 정보 필요 여부, 사용자 확인 필요 여부를 스스로 결정
4. **솔버(C2)는 여전히 에이전트가 아니다** — 시각·순서 확정은 결정론 컴포넌트 (INV-2 유지)

---

## 새로운 에이전트 구조

```
사용자 입력 (자연어 또는 이벤트)
        |
        v
+------------------+
|  Orchestrator    |  ← 의도 파악 + 복잡도 판단 + 실행 계획 수립
+------------------+
        |
        | 간단? ──YES──> 직접 처리 (Fast Path)
        |
        | 복잡? ──YES──> 실행 계획(Execution Plan) 생성
        v
+------------------+
|  Execution Plan  |  ← 어떤 에이전트를 어떤 순서/병렬로 실행할지
+------------------+
        |
        | 병렬 가능한 작업은 동시에 디스패치
        v
+-----------------------------------------------------------+
| ScheduleAgent    | PlanBAgent   | ReflectAgent | EditAgent |
|   (async)        |   (async)    |   (async)    |  (async)  |
+-----------------------------------------------------------+
        |
        | 필요한 도구 자유롭게 사용
        v
+-----------------------------------------------------------+
| [도구풀]                                                   |
| - LLM(점수매기기, 설명생성, 사유해석, 텍스트추출)          |
| - M7(후보조회, 엔티티해소, 웹소싱)                         |
| - C2 Solver(배치, 검증, 수리)                             |
| - 외부API(날씨, 지도)                                      |
+-----------------------------------------------------------+
```

### 병렬 실행 (Parallel Dispatch)

> **피드백 3**: "서브에이전트들이 병렬로 일하게 만들어라. Orchestrator가 여러 에이전트에게 동시에 일을 줄 수 있어야 한다."

Orchestrator는 실행 계획을 세울 때 **의존 관계가 없는 작업은 병렬로** 디스패치한다.

#### 병렬 실행 예시

**예시 1: 일정 생성 시 (ScheduleAgent 내부 병렬)**
```
ScheduleAgent가 내부적으로:
  [병렬] LLM 선호점수 매기기 + M7 웹소싱(부족 시)
  [대기] 둘 다 완료
  [순차] C2 솔버 배치 (점수 필요)
  [순차] LLM 설명 생성 (배치 결과 필요)
```

**예시 2: 복합 요청 — "일정 바꾸고 회고도 써줘" (에이전트 간 병렬)**
```
Orchestrator 실행 계획:
  [병렬] EditAgent("일정 바꿔줘") + ReflectAgent("회고 써줘")
  [대기] 둘 다 완료
  [조립] 결과 합쳐서 응답
```

**예시 3: Plan-B 제안 시 (PlanBAgent 내부 병렬)**
```
PlanBAgent가 내부적으로:
  [순차] 사유 해석 (영향 범위 파악 필요)
  [병렬] 대안 A 솔버 배치 + 대안 B 솔버 배치 + 대안 C 솔버 배치
  [대기] 전부 완료 (또는 10초 초과 시 완료된 것만)
  [순차] 전/후 비교 조립
```

#### 병렬 실행 규칙

| 규칙 | 설명 |
|---|---|
| **독립성** | 에이전트 A의 출력이 에이전트 B의 입력이 아니면 병렬 가능 |
| **에이전트 간 병렬** | Orchestrator가 여러 에이전트를 동시 디스패치 (asyncio.gather) |
| **에이전트 내부 병렬** | 각 에이전트가 자기 흐름 안에서 독립된 도구 호출을 동시 실행 |
| **타임아웃** | 병렬 작업 중 하나가 초과해도 나머지 결과로 응답 가능 (부분 완료) |
| **실패 격리** | 병렬 중 하나가 실패해도 나머지는 정상 진행 (각자 폴백 소유) |

#### Orchestrator 실행 계획 구조

```python
@dataclass
class ExecutionPlan:
    steps: list[ExecutionStep]

@dataclass
class ExecutionStep:
    agents: list[AgentCall]     # 이 step 안의 agent들은 병렬 실행
    timeout_sec: float

    # step 내 agents는 모두 병렬 (asyncio.gather)
    # step 간은 순차 (이전 step 완료 후 다음 step)

# 예: "일정 바꾸고 회고도 써줘"
plan = ExecutionPlan(steps=[
    ExecutionStep(agents=[EditAgent(...), ReflectAgent(...)], timeout=15),
])

# 예: "일정 만들고 나서 공유해줘" (의존 있음 → 순차)
plan = ExecutionPlan(steps=[
    ExecutionStep(agents=[ScheduleAgent(...)], timeout=20),
    ExecutionStep(agents=[ShareAgent(...)], timeout=5),   # 생성 결과 필요
])
```

---

## 업무 기준 에이전트 4종

> **Tool 제한 원칙**: 각 에이전트에는 업무에 필요한 tool만 할당한다. 불필요한 tool을 LLM context에 넣지 않아 토큰을 절감하고, 엉뚱한 tool 호출을 구조적으로 방지한다.

### 1. ScheduleAgent — "일정 추천 비서"

| 항목 | 내용 |
|---|---|
| **업무** | 여행 일정을 처음부터 끝까지 만들어주는 것 |
| **트리거** | "일정 만들어줘", "여행 계획 짜줘", 일정 생성 버튼 |
| **end-to-end 흐름** | ① 여행 조건 파악 → ② M7에서 후보 풀 가져오기 → ③ 후보 부족하면 웹 소싱 판단 → ④ LLM으로 선호 점수 매기기 → ⑤ 솔버에 배치 요청 → ⑥ 결과 설명 생성 → ⑦ 응답 조립 |
| **할당 Tool** | `m7.get_candidates`, `m7.source_web`, `llm.score_preferences`, `llm.explain_slot`, `solver.solve`, `solver.validate` |
| **미할당 Tool** | `llm.generate_reflection`, `llm.interpret_reason`, `kb.retrieve_*` (RAG 계열) |
| **판단하는 것** | 후보 충분한지, LLM 실패 시 규칙 폴백 전환, 시간 예산 내 설명 생략 여부 |
| **폴백** | LLM 실패→규칙점수, 전체 실패→최소일정. 침묵 실패 금지 |

### 2. PlanBAgent — "재계획 비서" (RAG 기반, 별도 설계)

| 항목 | 내용 |
|---|---|
| **업무** | 여행 중 변수(날씨·휴무·지연)에 대한 대안 일정을 만들어주는 것 |
| **트리거** | Plan-B 제안 수락, "비 와서 실내로 바꿔줘", 자동 트리거(날씨·지연) |
| **패턴** | **RAG** — Retrieve(기존 일정+페르소나+상황) → Augment → Generate → Validate |
| **할당 Tool** | `kb.retrieve_schedule`, `kb.retrieve_persona`, `kb.retrieve_situation`, `m7.get_candidates`, `llm.select_alternatives`, `solver.solve`, `solver.validate` |
| **미할당 Tool** | `llm.score_preferences`, `llm.explain_slot`, `llm.generate_reflection`, `m7.source_web`, `m7.resolve_entity` |
| **판단하는 것** | 재계획 범위(전체 날 vs 일부 슬롯), 후보 0개 시 휴식모드 제안, 확인 필요 여부 |
| **폴백** | 벡터검색 실패→M7 필터만, LLM 실패→규칙점수, 솔버 전멸→휴식모드/수동편집 |
| **상세 설계** | → `planb-rag-design.md` 참조 |

### 3. ReflectAgent — "회고 비서" (1차: 단순 LLM Generation, 추후: Multi-step 확장)

| 항목 | 내용 |
|---|---|
| **업무** | 여행 기록을 분석해서 회고·요약·스타일 분석을 만들어주는 것 |
| **트리거** | 일자 경계(당일 회고), 여행 종료(전체 요약), 누적 10곳(스타일 분석) |
| **1차 패턴 (A)** | **단순 LLM Generation** — DB에서 방문 기록 조회 → 프롬프트에 주입 → Bedrock 1회 호출 → 회고 텍스트 |
| **추후 확장 (C)** | **Multi-step** — 통계 집계(규칙) → 하이라이트 추출(규칙) → LLM 서술 → 스타일 분류(LLM, 조건부) |
| **1차 흐름** | ① 방문 기록 DB 조회 → ② 충분성 판단(0건→스킵) → ③ LLM 회고 생성(Bedrock 1회) → ④ 결과 반환 |
| **1차 할당 Tool** | `db.get_visit_history`, `llm.generate_reflection` **(2개만 — 가장 가벼운 에이전트)** |
| **추후 추가 Tool** | `llm.analyze_style` (C 확장 시, 7축 택소노미 분류) |
| **미할당 Tool** | `solver.*` 전부, `m7.*` 전부, `kb.*` 전부, `llm.score_preferences`, `llm.parse_intent` |
| **판단하는 것** | 방문 기록 충분한지(0건→스킵), 재생성 시 덮어쓰기 확인 |
| **폴백** | LLM 실패 → FallbackCard(통계 기본 카드: 방문 N곳·이동 Nkm·사진 N장) |
| **상세 설계** | → `reflect-agent-design.md` 참조 |

### 4. EditAgent — "편집 비서"

| 항목 | 내용 |
|---|---|
| **업무** | 사용자의 일정 수정 요청을 해석하고 실행하는 것 |
| **트리거** | "저녁 맛집 하나 넣어줘", "이 POI 빼줘", "순서 바꿔줘" |
| **end-to-end 흐름** | ① 편집 의도 해석(추가/삭제/이동/교체) → ② 엔티티 해소(POI명 매칭) → ③ 편집 명령 구성 → ④ 솔버 검증 → ⑤ 반영 모드 결정(자동/확인) → ⑥ 적용 또는 미리보기 |
| **할당 Tool** | `llm.parse_intent`, `m7.resolve_entity`, `m7.get_candidates`, `solver.validate`, `solver.repair` |
| **미할당 Tool** | `llm.generate_reflection`, `llm.score_preferences`, `kb.retrieve_*`, `m7.source_web` |
| **판단하는 것** | 파괴적 편집 여부(삭제·대규모→확인 필수), 엔티티 애매하면 확인 요청, 검증 실패 시 미리보기 강등 |
| **폴백** | 의도 해석 실패→"직접 편집으로 진행" 안내, 검증 실패→위반 사유+미리보기 |

---

## 에이전트별 Tool 할당 요약

| Tool | Schedule | PlanB | Reflect | Edit | Orchestrator |
|---|---|---|---|---|---|
| `m7.get_candidates` | O | O | - | O | - |
| `m7.source_web` | O | - | - | - | - |
| `m7.resolve_entity` | - | - | - | O | - |
| `llm.score_preferences` | O | - | - | - | - |
| `llm.explain_slot` | O | - | - | - | - |
| `llm.parse_intent` | - | - | - | O | - |
| `llm.generate_reflection` | - | - | O | - | - |
| `llm.analyze_style` | - | - | (추후) | - | - |
| `llm.select_alternatives` | - | O | - | - | - |
| `kb.retrieve_schedule` | - | O | - | - | - |
| `kb.retrieve_persona` | - | O | - | - | - |
| `kb.retrieve_situation` | - | O | - | - | - |
| `solver.solve` | O | O | - | - | - |
| `solver.validate` | O | O | - | O | O (Fast Path) |
| `solver.repair` | - | - | - | O | - |
| `db.get_visit_history` | - | - | O | - | - |
| `db.get_current_schedule` | - | - | - | - | O (Fast Path) |

**토큰 절감 효과**: 전체 tool 17개 중 각 에이전트는 3~7개만 할당 → LLM 호출당 tool 정의 토큰 50~60% 절감

---

## Before vs After 비교

| 관점 | Before (tool 기준) | After (업무 기준) |
|---|---|---|
| 분류 기준 | LLM feature 1개 = 워커 1개 | 사용자 업무 1개 = 에이전트 1개 |
| 도구 사용 | 각 워커가 도구 1개만 사용 | 각 에이전트가 여러 도구 조합 |
| 판단 | 오케스트레이터가 모든 판단 | 에이전트가 업무 내 판단 자율 |
| 폴백 | 오케스트레이터가 폴백 분기 | 에이전트가 자기 업무의 폴백 소유 |
| 확장 | 새 feature 추가 = 새 워커 | 새 업무 추가 = 새 에이전트 |
| 복잡도 | 오케스트레이터 비대 | 오케스트레이터는 디스패치만 |

---

## Orchestrator 역할 변경

| Before | After |
|---|---|
| 라우터(의도 파악) + 워커 조립 + 폴백 판단 + 결과 조합 | 의도 파악 → **복잡도 판단** → 간단하면 직접 처리 / 복잡하면 에이전트 위임 |

### Orchestrator의 3가지 모드

| 모드 | 조건 | 처리 방식 |
|---|---|---|
| **Fast Path** | 도구 1~2개로 끝나는 간단한 task | Orchestrator가 직접 처리 (위임 오버헤드 제거) |
| **Delegate** | 다단계 판단이 필요한 복잡한 업무 | 적절한 에이전트에 위임 → 결과 수신 |
| **Fallback** | 의도 파악 자체가 실패 | 기본 응답 + 수동 편집 경로 안내 |

### Fast Path 직접 처리 대상

| 유형 | 예시 | Orchestrator 처리 |
|---|---|---|
| 정보 조회 | "다음 일정 뭐야", "내일 첫 POI는?" | DB 조회 → 포맷 → 즉시 응답 |
| 상태 확인 | "지금 일정 보여줘", "몇 시에 출발?" | 현재 일정 읽기 → 응답 |
| 단일 조회 | "이 POI 영업시간 알려줘" | M7 조회 → 응답 |
| 확인/취소 | "이거 적용할까?" "취소" "되돌리기" | 상태 전이 → 응답 |

### 복잡도 판단 기준

```
SIMPLE (직접 처리):
  - 도구 1~2개로 완료
  - 판단/분기 불필요
  - 폴백 계단 불필요

COMPLEX (에이전트 위임):
  - 도구 3개 이상 조합
  - 중간 판단 필요 (폴백 시점, 확인 여부 등)
  - 다단계 흐름
```

### 신속성 효과

| 측면 | 에이전트 위임 | Orchestrator 직접 |
|---|---|---|
| 응답 지연 | +300~500ms (컨텍스트 전달 + 초기화) | 즉시 (< 100ms) |
| LLM 호출 | 에이전트가 추가 의도 파악 가능 | 불필요 (이미 파악됨) |
| 적합 대상 | "일정 만들어줘" | "다음 일정 뭐야" |

---

## 불변식 유지 확인

| 불변식 | 유지 방법 |
|---|---|
| INV-1 (closed-set) | 모든 에이전트가 M7 화이트리스트 + C1 게이트 경유 (도구 레벨에서 강제) |
| INV-2 (솔버 검증값만) | 모든 에이전트의 최종 출력은 C2.validate() 통과 필수 (에이전트 공통 규칙) |
| INV-3 (소요시간 미표시) | VisitSlotDisplay 타입 레벨 보장 (에이전트와 무관) |
| INV-4 (결정론 폴백) | 각 에이전트가 자기 폴백 계단 소유 + 침묵 실패 금지 |

---

## 도구 풀 (Toolbox) — 에이전트가 공유하는 도구

| 도구 | 설명 | 제공자 |
|---|---|---|
| `llm.score_preferences` | 후보 POI에 선호 점수 부여 | C1 (경량) |
| `llm.explain_slot` | 슬롯별 추천 이유 생성 | C1 (상위) |
| `llm.interpret_reason` | 사유 해석 (재계획 범위 결정) | C1 (경량) |
| `llm.generate_reflection` | 회고/요약 서술 생성 | C1 (상위) |
| `llm.extract_places` | 웹 텍스트 → 구조화 POI | C1 (상위) |
| `llm.parse_intent` | 자연어 → 의도+슬롯 추출 | C1 (경량) |
| `m7.get_candidates` | closed-set 후보 풀 조회 | M7 |
| `m7.resolve_entity` | 엔티티 해소 (fuzzy match) | M7 |
| `m7.source_web` | 웹 후보 소싱 + 수집 게이트 | M7 |
| `solver.solve` | OPTW 배치 최적화 | C2 |
| `solver.validate` | 하드 제약 검증 | C2 |
| `solver.repair` | 최소 변경 수리 | C2 |
| `solver.estimate_travel` | 이동시간 추정 (내부용) | C2 |

---

## C2 Solver — 하이브리드 전략 (OR-Tools + Bedrock 폴백)

> **읽기 규칙·실태 註 (2026-08-25, TRIP-530)** — 본 절의 "Bedrock" 표기 전부(제목 포함)에 적용:
> 1. **벤더**: AI-D06 표기 규칙에 따라 "Bedrock" = **"LLM API(Anthropic 직접)"** 로 읽는다.
>    AWS Bedrock 경유가 아니다. `BedrockSolver`/`bedrock_port`/`_solve_with_bedrock` 같은 식별자도 같다 —
>    실제 구현명은 `solver_engine/llm_solver.py::LlmSolver` 다.
> 2. **`is_bedrock` 플래그는 코드에 없다**. 어느 층이 해를 냈는지는
>    `domain/itinerary.py::SolveMode`(`OR_TOOLS`·`LLM`·`RULE_FALLBACK`·`MINIMAL`)가 기록한다 —
>    종전 `SolveMode.BEDROCK` 은 `LLM` 로 **개명 완료**(TRIP-256).
> 3. **2차 단계는 현재 미배선이다** (TRIP-529): 실가동 체인은 `OR-Tools → 규칙 폴백` **2단**이고,
>    `api/wiring.py` 가 `LlmSolver` 를 조립하지 않는다("솔버 프롬프트 정본·모델 설정이 아직 없다").
>    아래 "2차 진입 트리거"·"출력 처리" 절차는 **배선 시점의 목표 상태**다.

### 설계 원칙

Solver 내부 구현을 **OR-Tools 1차 → Bedrock LLM 2차** 하이브리드로 구성한다.
에이전트는 `SolverFacade` 인터페이스만 보므로 내부 전략 변경에 무영향.

### 실행 흐름

```
에이전트 → SolverFacade.solve(problem)
                |
                v
        +---------------+
        | OR-Tools 시도 |  ← 1차: 결정론 OPTW 휴리스틱 (3초 제한)
        +---------------+
                |
          성공? ─YES─> HC 검증 통과 → 반환
                |
               NO (타임아웃 / 해 없음 / 품질 미달)
                |
                v
        +---------------+
        | Bedrock 시도  |  ← 2차: LLM 기반 배치 제안
        +---------------+
                |
                v
        +---------------+
        | HC 검증+보정  |  ← Bedrock 출력을 OR-Tools/규칙으로 검증·수리
        +---------------+
                |
          통과? ─YES─> 반환
                |
               NO
                |
                v
        +---------------+
        | 규칙 폴백     |  ← 최후: 결정론 규칙 점수로 최소 일정
        +---------------+
                |
                v
            반환 (MINIMAL 모드)
```

### 계층별 역할

| 계층 | 구현 | 역할 | 특성 |
|---|---|---|---|
| **1차: OR-Tools** | Google OR-Tools Routing (VRPTW) | 결정론 최적화. HC1~HC4 네이티브 보장 | 빠름, 결정론, 해 품질 안정 |
| **2차: Bedrock** | AWS Bedrock (Claude 등) | 복잡한 제약 상황에서 창의적 배치 제안 | 비결정론이지만, 유연한 해 탐색 |
| **검증: HC Checker** | 자체 구현 (ConstraintChecker) | Bedrock 출력의 HC1~HC4 위반 검증 + 자동 수리 | Bedrock 환각 방어 |
| **최후: 규칙 폴백** | FallbackScorer | 전부 실패 시 결정론 최소 일정 | INV-4 보장 |

### Bedrock 사용 조건 (2차 진입 트리거)

| 조건 | 설명 |
|---|---|
| OR-Tools 해 없음 | 제약이 빡빡해서 해를 못 찾을 때 (고정 블록 많음 등) |
| OR-Tools 타임아웃 | 3초 내 충분한 품질의 해를 못 찾을 때 |
| OR-Tools 품질 미달 | 해를 찾았지만 빈 슬롯이 과다 (후보 30개인데 3개만 배치) |

### Bedrock 출력 처리 — 반드시 검증 경유

```python
def _solve_with_bedrock(self, problem: ItineraryProblem) -> ItinerarySolution | None:
    # Bedrock에게 배치 제안 요청
    raw_proposal = self.bedrock_port.propose_schedule(problem)

    # HC 검증 (Bedrock은 시각을 틀릴 수 있음)
    violations = self.constraints.check_all(raw_proposal, problem)

    if not violations:
        return raw_proposal  # 깨끗하게 통과

    # 위반 있으면 자동 수리 시도
    repaired = self.repair.fix(raw_proposal, violations, problem)
    if repaired:
        return repaired

    return None  # 수리 불가 → 규칙 폴백으로 넘김
```

### 불변식 유지

| 불변식 | 하이브리드에서 유지 방법 |
|---|---|
| INV-2 (솔버 검증값만) | Bedrock 출력이라도 반드시 ConstraintChecker 통과 후에만 반환 |
| INV-4 (결정론 폴백) | OR-Tools 실패 + Bedrock 실패 → 규칙 폴백으로 최소 일정 보장 |
| 결정론 | OR-Tools 단독 성공 시 결정론 유지. Bedrock 경유 시 `is_bedrock=True` 플래그 |

### Port 인터페이스

```python
class SolverPort(Protocol):
    """Solver 내부 전략을 교체 가능하게 하는 Port"""
    def solve(self, problem: ItineraryProblem) -> ItinerarySolution | None: ...

class OrToolsSolver(SolverPort): ...     # 1차
class BedrockSolver(SolverPort): ...     # 2차
class RuleFallbackSolver(SolverPort): ... # 최후

class HybridSolverFacade:
    """OR-Tools → Bedrock → 규칙 폴백 체인"""
    def __init__(self, solvers: list[SolverPort]):
        self._chain = solvers  # [OrTools, Bedrock, RuleFallback]

    def solve(self, problem: ItineraryProblem) -> ItinerarySolution:
        for solver in self._chain:
            result = solver.solve(problem)
            if result and self._quality_ok(result):
                return result
        # 여기 도달 불가 — RuleFallback은 항상 해를 반환 (INV-4)
```

---

## 다음 단계

- [ ] 기존 설계 문서(ai-architecture.md, ai-implementation-design.md) 내 워커 구조를 에이전트 구조로 반영
- [ ] component-methods.md의 Worker 섹션을 Agent 섹션으로 교체
- [ ] services.md의 오케스트레이션 흐름을 에이전트 위임 구조로 업데이트
- [ ] PBT 속성 재매핑 (에이전트별 폴백·검증 속성)
