# Agent 구조 v2 — 4상자 파이프라인 (도구 배타 원칙)

> **정본.** `agent-hierarchy-design.md`(v1, 2계층 agent-as-tool)를 **대체**한다.
> 개정일: 2026-08-02 · 근거: 멘토 피드백 — "에이전트 간 도구가 겹치면 Orchestrator가 위임 대상을 혼동한다. 도구 겹침 금지."
> v1의 겹침 실태: place_scout 4곳 공유·solver.validate 4곳 공유 등 → 본 개정으로 **겹침 0**.

---

## 1. 용어 규칙 (이 문서로 확정)

| 용어 | 정의 | 개수 |
|---|---|---|
| **Agent** | **LLM으로 판단하는 주체** — 시스템에서 이들만 Agent라 부른다 | 4 (Schedule·PlanB·Reflect·Edit) |
| **Provider** | 데이터를 가져오는 것. LLM 0회. 규칙 로직(폴백 체인·임계 판정)은 가질 수 있음 | 5 (Place·Weather·Transit·Persona·Event) |
| **Solver** | 계산·확정 (C2). 도구가 아니라 **공통 관문** | 1 |
| **Orchestrator** | 지휘 — 의도파악·Fast Path·수집 지시·위임. 판단 최소 | 1 |

> v1의 "정보 에이전트"는 **Provider로 개명** — 수집 전담으로 역할이 정리되어 agent라 부를 이유가 없어짐 (LLM 미사용).

## 2. 구조 — 4상자

```
사용자 입력
    ▼
┌─ 1단 Orchestrator ────────────────────────────────┐
│ 의도파악(질문뱅크 하이브리드) → intent + 의도슬롯      │
│ 단순 조회면 Fast Path 직접 처리 (Provider 1개 호출 가능)│
│ 복잡하면: [InfoCollector] 정보 요구표 조회 → 수집 지시  │
└──────────────┬────────────────────────────────────┘
               │ 병렬 수집
┌─ 2단 Providers (5) ───────────────────────────────┐
│ Place · Weather · Transit · Persona · Event        │
│ LLM 0회 — DB/API 조회 + 규칙 로직만                  │
│ 출력 = 정보 패킷 (데이터 + FreshnessMeta + 상태값)     │
└──────────────┬────────────────────────────────────┘
               │ InfoBundle을 AgentTask 봉투에 담아 위임 (잔여 deadline 동봉)
┌─ 3단 Agents (4) — LLM 판단, 전속 도구 배타 ─────────┐
│ Schedule: score_preferences · explain_slot          │
│ PlanB:   retrieve_schedule · select_alternatives    │
│ Reflect: get_visit_history · generate_reflection    │
│ Edit:    parse_intent · resolve_entity              │
│ 출력 = Proposal(제안 — 시각·순서 없음!)               │
│ 정보 부족 시 NEED_MORE_INFO 반환 (재수집 1회)         │
└──────────────┬────────────────────────────────────┘
               │ 시각·순서가 있는 제안만
┌─ 4단 Solver 공통 관문 (C2) ────────────────────────┐
│ solve(배치) · validate(HC1~4) · repair(수리)         │
│ ※ Reflect(회고 텍스트)는 관문 스킵 — 시각 없음         │
└──────────────┬────────────────────────────────────┘
               ▼
        사용자 (시각·순서는 솔버 검증값만 — INV-2)
```

## 3. 단계별 계약

### 1단 Orchestrator
- **한다**: 의도파악 → 라우팅 테이블(유일 기준 — 도구 목록으로 판단 금지) → Fast Path 또는 위임. 위임 전 InfoCollector로 병렬 수집.
- **안 한다**: 판단(점수·선택·해석) — 전부 3단 몫.
- InfoCollector는 Orchestrator **내부 하위 컴포넌트** (역할 분리, 소유자는 하나 — 겹침 아님).

### 2단 Provider — "수집만"
- 출력 패킷 = 데이터 + `FreshnessMeta`(출처·수집시각·캐시·TTL·stale) + 상태값.
- **실패는 예외가 아니라 상태값**: `NO_CANDIDATES` `WEATHER_UNKNOWN` `COLD_START` 등 — 3단이 보고 자기 폴백 판단 (INV-4).
- 규칙 로직 보유 가능: 어댑터 폴백 체인(카카오→네이버→직선), 충분성 카운트, 강수 80% 임계 판정 — **LLM 판단만 없음**.
- **웹 소싱은 Provider 소속이 아님** — 백그라운드 소싱 파이프라인(U6, AI-D03: Places API→자유 웹→LLM 추출→수집 게이트→M7 등록) 소속. 실시간 경로에서 제외되는 이유: INV-1(게이트 통과분만 후보 자격) + 지연 예산. PlaceProvider는 부족 감지 시 파이프라인에 **신호만** 보낸다.

**정보 요구표** (라우팅 테이블 확장 — intent별 수집 항목):

| intent | 병렬 수집 | 필수 |
|---|---|---|
| GENERATE_SCHEDULE | PlaceProvider(풀) · Weather(기간) · Persona · Event(기간×앵커 반경) | 풀 (없으면 즉시 실패 반환) |
| REPLAN | Weather(force_refresh) · Transit(지연) · Persona · Place(반경·실내) | 풀 |
| REFLECT | (없음) | — |
| EDIT | Place(추가/교체 의도 시) | — |

**InfoBundle**: 소형 패킷(날씨·교통·페르소나)은 직접 포함, 후보 풀(최대 5천)은 **세션 캐시 참조 키**로 (ai-data-design §6 풀 캐싱과 정합).

**행사(Event)의 일정 반영 방식** (TRIP-421 — 2026-08-23 정본 반영): EventProvider는 여행 기간과 겹치고 앵커 반경(≤40km, 관대한 1차 필터) 안인 행사만 수집한다(LLM 0회). 행사는 **후보가 아니라 소프트 가점 항**이다 — 실효 반경·POI 근접 부착·거리 감쇠 보너스 계산은 풀과 페르소나를 함께 아는 호출측(`orchestrator/event_affinity.py`) 소관이고, 결과는 선호 점수에 더해질 뿐 후보 풀에 들어가지 않으므로 **INV-1(closed-set)의 적용 대상이 아니다**. 상태값(IO-7): OK(행사 0건 포함 — "없음"은 실패가 아님) · LOW(저장소 페이지 절단 가능 — 침묵 절단 금지) · UNAVAILABLE(사유 동봉). 행사 데이터 공급은 실시간 Provider 경로가 아니라 웹소싱 새벽 배치가 채우는 event_store다(AI-D03 부기 참조).

### 3단 Agent — "판단만" (전속 도구 배타 — 본 개정의 핵심)

| Agent | InfoBundle에서 | 전속 도구 (서로소 ✅) | 출력 Proposal |
|---|---|---|---|
| Schedule | 풀 참조·날씨·페르소나 | `llm.score_preferences` `llm.explain_slot` | 점수 후보 + 설명 (배치 안 함) |
| PlanB | 상황 패킷·페르소나·풀 참조 | `kb.retrieve_schedule` `llm.select_alternatives` | 대안 세트 2~3 |
| Reflect | — | `db.get_visit_history` `llm.generate_reflection` | 회고 텍스트 + 통계 |
| Edit | 풀 참조(해당 시) | `llm.parse_intent` `m7.resolve_entity` | EditCommand |

- **금지**: Provider 직접 호출(정보는 봉투로만), 시각·순서 확정.
- **NEED_MORE_INFO(항목, 사유)**: Orchestrator가 수집→재위임, **최대 1회**. 이후에도 부족하면 업무 폴백.

### 4단 Solver 공통 관문
- 누구의 도구도 아님 — Schedule 제안→`solve`, PlanB 대안→`solve`×N 병렬, Edit 명령→`validate/repair`.
- **Reflect는 스킵** — INV-2는 "사용자에게 보이는 시각·순서"에 대한 규칙이므로 시각 없는 출력(회고)은 해당 없음 (INV-3 표시 규칙은 적용).
- deadline 상속(DL-4)으로 잔여 시간 전달 → U2의 시한 인지 체인이 그대로 작동 (AI-D07).

## 4. 불변식 유지 확인

| 불변식 | v2에서 |
|---|---|
| INV-1 | 후보 공급 = PlaceProvider→M7 단일 경로. 웹 결과는 게이트 통과 후 M7 등록분만 |
| INV-2 | **구조로 승격** — Agent는 시각을 만들 수 없고(출력이 Proposal), 확정은 관문에서만 |
| INV-3 | 무변 (표시 계층 규칙) |
| INV-4 | Provider 실패=상태값, Agent 폴백 계단 유지, 관문 최후엔 규칙 폴백 |

## 5. v1 → v2 차이 요약

| | v1 (2계층 agent-as-tool) | v2 (4상자 파이프라인) |
|---|---|---|
| 정보 계층 호출자 | 업무 에이전트 각자 (겹침 4곳) | **Orchestrator 전속** (InfoCollector) |
| Solver | 에이전트별 도구 (겹침 4곳) | **공통 관문** |
| 도구 겹침 | 5개 도구 중복 | **0** |
| 명칭 | 정보 "에이전트" | **Provider** (LLM 0회 명시) |
| 에이전트 자율성 | 도구 자유 조합 | 판단 자율 유지 + 정보는 봉투 수령 (+재요청 1회) |

> 트레이드오프 기록: v1 멘토 피드백("에이전트가 도구를 스스로 조합")과 본 피드백("겹침 금지")의 절충 — 판단 자율은 유지, 수집·확정은 중앙화.

## 6. 파급

- 유닛 매핑 무변: Orchestrator+InfoCollector+ScheduleAgent = **U5** · 나머지 Agent·웹소싱 파이프라인 = **U6** · Provider 1차(Place·Weather) = U5, 2차(Transit·Persona) = U6 · **U1~U4 코드 영향 0** (C1·C2·M7은 설비 계층)
- `orchestrator-delegation-design.md`: 라우팅 테이블에 정보 요구 열, AgentTask에 InfoBundle, AgentResult에 NEED_MORE_INFO 상태 추가 (동 문서 §보강 참조)
