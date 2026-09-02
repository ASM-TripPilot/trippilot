# Orchestrator 위임 프로토콜 — 에이전트에게 일을 넘기는 방식

> `agent-redesign.md`의 ExecutionPlan(steps 병렬/순차)을 구체화한다.
> "무엇을 어떤 형태로 넘기고, 무엇을 어떤 형태로 돌려받는가"의 계약.
> 2계층 구조(`agent-hierarchy-design.md`)에서 업무→정보 에이전트 위임에도 **동일한 봉투를 재사용**한다.

---

## 1. 설계 원칙

| # | 원칙 | 이유 |
|---|---|---|
| DL-1 | **봉투(Envelope) 표준화** — 모든 위임은 `AgentTask`로, 모든 회신은 `AgentResult`로 | 에이전트 추가 시 프로토콜 재설계 불필요, 로깅·추적 일원화 |
| DL-2 | **데이터가 아니라 참조를 넘긴다** — 일정·POI·페르소나는 `context_refs`(type+id)로 전달, 에이전트가 요청자 권한으로 재조회 | D31(서버 재조회 컨텍스트 주입) 계승. 위임 봉투 경량화 + 항상 최신 데이터로 작업(최신성 지표와 정합) |
| DL-3 | **의도 해석은 1회** — Orchestrator가 파악한 intent·slots를 봉투에 실어 보내고, 에이전트는 재해석하지 않는다 | 중복 LLM 호출 제거 (위임 오버헤드 최소화) |
| DL-4 | **마감시한 상속** — 부모 task의 deadline에서 경과분을 빼고 전파. 자식이 부모보다 오래 살 수 없다 | 지연 예산(20s/10s/15s) 총량 보장 |
| DL-5 | **회신도 봉투로** — 성공/폴백/실패가 모두 `AgentResult`의 상태값. 예외 던지기 금지 | INV-4 (침묵 실패 금지), 부분 완료 조립 가능 |

---

## 2. 위임 봉투 — AgentTask

```python
@dataclass
class AgentTask:
    # ── 식별·추적 ─────────────────────────────
    task_id: str                    # 이 위임 건의 고유 ID
    trace_id: str                   # 사용자 요청 전체를 관통 (Orchestrator→업무→정보→C1/C2까지 전파)
    parent_task_id: str | None      # 업무→정보 위임 시 부모 task
    issued_by: str                  # orchestrator | schedule_agent | planb_agent | ...

    # ── 무엇을 할 것인가 ──────────────────────
    intent: str                     # 파악된 의도 (예: GENERATE_SCHEDULE, REPLAN, GET_WEATHER)
    slots: dict                     # 의도에서 추출된 파라미터 (예: {"date": "2026-07-17", "scope": "remaining_today"})
    utterance: str | None           # 원문 자연어 (에이전트가 뉘앙스 참고용 — 재해석 금지, DL-3)

    # ── 작업 재료 (참조로) ─────────────────────
    context_refs: list[ContextRef]  # [{type: "trip", id}, {type: "itinerary", id}, {type: "trigger_event", id}]
    requester: Requester            # {user_id, locale} — 재조회 권한 주체 (D31)
    inline_context: dict            # 재조회 불가능한 휘발 데이터만 (현재 위치, 클라 시각) — 최소화

    # ── 제약 ─────────────────────────────────
    deadline_ms: int                # 남은 시간 예산 (부모에서 차감 상속, DL-4)
    priority: str                   # interactive | background  (day1 vs 나머지 day)
    constraints: TaskConstraints    # {max_llm_calls, allow_web_sourcing, apply_mode_ceiling}
    idempotency_key: str            # 재시도 시 중복 실행 방지 (task_id 기반)
```

### ContextRef 타입 목록

| type | id 대상 | 재조회 경로 |
|---|---|---|
| `trip` | trip_id | 백엔드 조회 API |
| `itinerary` | itinerary_id | 〃 (현재 슬롯 포함) |
| `trigger_event` | trigger_event_id | 〃 |
| `replan_session` | replan_session_id | 〃 |
| `visit_history` | trip_id (+day) | 〃 |
| `preference_set` | account_id | 〃 |
| `poi` | poi_id | M7 |

### inline_context에만 허용되는 것

재조회가 불가능하거나 무의미한 **휘발 데이터**만: 현재 GPS 좌표, 클라이언트 현재 시각, 이번 대화 턴의 직전 선택지. 그 외 데이터를 inline으로 넣는 것은 리뷰에서 반려한다 (봉투 비대화 + 신선도 열화 방지).

---

## 3. 회신 봉투 — AgentResult

```python
@dataclass
class AgentResult:
    task_id: str
    trace_id: str
    status: str                     # SUCCESS | FALLBACK | PARTIAL | FAILED | TIMEOUT
    payload: dict | None            # 에이전트별 Output DTO (agent-io-contracts.md)
    fallback_level: int             # 0=정상, 1..n=폴백 계단 몇 번째 (예: Transit 1=네이버, 2=직선)
    freshness: FreshnessMeta | None # 정보 에이전트 필수 (H-5)
    error: TaskError | None         # {code, message, retryable}  — FAILED/TIMEOUT 시
    metrics: TaskMetrics            # {elapsed_ms, llm_calls, tokens_in/out, tools_used[]}
```

### 상태값 의미

| status | 의미 | Orchestrator 처리 |
|---|---|---|
| SUCCESS | 정상 완료 | payload 조립 |
| FALLBACK | 완료했으나 폴백 경로 (INV-4 이행) | payload 조립 + `is_fallback` 사용자 노출 규칙 적용 |
| PARTIAL | deadline 내 일부만 완료 (예: 대안 3개 중 2개) | 있는 것만 조립 (병렬 규칙 "부분 완료" 계승) |
| FAILED | 폴백 계단 소진 | 업무 수준 폴백 or 수동 경로 안내 |
| TIMEOUT | deadline 초과로 중단 | 〃 (결과 폐기, idempotency_key로 중복 방지) |

---

## 4. 위임 시퀀스

### 4.1 표준 흐름 (Delegate 모드)

```
사용자 입력
   |
   v
[Orchestrator]
   1. 의도 파악 (→ intent-matching-design.md 하이브리드 매칭)
   2. 복잡도 판단 (SIMPLE → Fast Path / COMPLEX → 계속)
   3. Execution Plan 수립
        - intent → 담당 에이전트 매핑 (라우팅 테이블 §5)
        - 의존성 분석 → step 분할 (step 내 병렬, step 간 순차)
        - deadline 분배 (전체 예산 - 경과 시간)
   4. AgentTask 발행 (step 내 병렬 asyncio.gather)
   |
   v
[업무 에이전트]
   5. context_refs 재조회 (requester 권한, D31)
   6. 필요 시 정보 에이전트에 재위임
        - 동일한 AgentTask 봉투 (parent_task_id 설정, deadline 차감)
   7. 업무 수행 (LLM/어셈블리 도구 조합)
   8. AgentResult 회신
   |
   v
[Orchestrator]
   9. step 결과 수집 (TIMEOUT/PARTIAL 처리)
  10. 다음 step 진행 or 최종 조립
  11. 응답 반환 (+ trace_id로 전 구간 로그 연결 → llmops)
```

### 4.2 예시 — "비 와서 오후 일정 실내로 바꿔줘"

```python
# Orchestrator가 발행하는 봉투
AgentTask(
    task_id="t-9f2a", trace_id="tr-4c1e", parent_task_id=None,
    issued_by="orchestrator",
    intent="REPLAN",
    slots={"reason": "weather", "scope": "remaining_today", "indoor_only": True},
    utterance="비 와서 오후 일정 실내로 바꿔줘",
    context_refs=[
        {"type": "trip", "id": "trip-123"},
        {"type": "itinerary", "id": "itn-456"},
        {"type": "preference_set", "id": "acc-789"},
    ],
    requester={"user_id": "acc-789", "locale": "ko-KR"},
    inline_context={"current_location": {"lat": 33.49, "lng": 126.5}, "client_now": "2026-07-16T14:20:00+09:00"},
    deadline_ms=10_000,             # Plan-B 예산
    priority="interactive",
    constraints={"max_llm_calls": 3, "allow_web_sourcing": False, "apply_mode_ceiling": "confirm"},
    idempotency_key="t-9f2a",
)

# PlanBAgent가 정보 계층에 재위임 (병렬)
#   → WeatherAgent:   intent=GET_WEATHER,  slots={dates:[오늘], force_refresh:True},  deadline=2000
#   → TransitAgent:   intent=CHECK_DELAY,  slots={...},                               deadline=2000
#   → PersonaAgent:   intent=GET_PERSONA,  slots={purpose:"alternative_sourcing"},    deadline=2500
#   → PlaceScoutAgent: intent=SCOUT_PLACES, slots={indoor_only:True, radius_km:3},    deadline=3000
#   (모두 parent_task_id="t-9f2a", trace_id="tr-4c1e" 상속)
```

### 4.3 constraints의 용도

| 필드 | 의미 | 예 |
|---|---|---|
| `max_llm_calls` | 이 task가 소비할 수 있는 LLM 호출 상한 | Plan-B는 3회 (해석은 이미 끝남) |
| `allow_web_sourcing` | PlaceScout 웹 소싱 허용 여부 | Plan-B(10초 예산)에서는 금지, 일정 생성에서는 허용 |
| `apply_mode_ceiling` | 자동 적용 허용 최고 수위 | 파괴적 편집 감지 시 `confirm`으로 강제 (EditAgent) |

---

## 5. 라우팅 테이블 — intent → 에이전트

| intent | 처리자 | 모드 |
|---|---|---|
| GENERATE_SCHEDULE, REGENERATE | ScheduleAgent | Delegate |
| REPLAN, SUGGEST_ALTERNATIVE | PlanBAgent | Delegate |
| GENERATE_REFLECTION, TRIP_SUMMARY, STYLE_ANALYSIS | ReflectAgent | Delegate |
| EDIT_SCHEDULE (자연어) | EditAgent | Delegate |
| GET_NEXT_SLOT, SHOW_SCHEDULE | — (DB 조회) | Fast Path |
| GET_WEATHER | WeatherAgent 직접 | Fast Path (정보 에이전트 1개, H-4) |
| GET_DISTANCE | TransitAgent 직접 | Fast Path (거리만 응답, INV-3) |
| GET_POI_INFO | PlaceScoutAgent 직접 | Fast Path |
| CONFIRM, CANCEL, UNDO | — (상태 전이) | Fast Path |
| (해석 실패 / OUT_OF_SCOPE) | — | Fallback (기본 응답 + 수동 편집 안내) |

복합 intent(예: "일정 바꾸고 회고도 써줘")는 Execution Plan에서 step 1개에 EditAgent+ReflectAgent 병렬 배치 — 기존 규칙 그대로.

---

## 6. 실패·재시도 정책

| 상황 | 정책 |
|---|---|
| 에이전트 TIMEOUT | 결과 폐기, 업무 폴백 진행. **재시도 없음** (interactive 예산 소진 방지) |
| 정보 에이전트 FAILED | 업무 에이전트가 상태값으로 수신하고 자기 폴백 계단 진행 (재시도는 정보 에이전트 내부 폴백 체인이 이미 수행) |
| background 우선순위 task | 1회 재시도 허용 (idempotency_key로 멱등) |
| step 내 일부만 성공 | PARTIAL 조립 — "완료된 것만으로 응답 가능" 규칙 계승 |
| Orchestrator 자체 실패 | Fallback 모드 — 기본 응답 + 수동 편집 경로 (기존 유지) |

---

## 7. 관측 연결 (→ mlops-llmops-design.md)

- `trace_id`는 Orchestrator → 업무 → 정보 → C1/C2 호출까지 전 구간 전파. LLM 호출 로그·어셈블리 로그·평가 지표가 모두 이 ID로 조인된다.
- `AgentResult.metrics`(elapsed_ms, llm_calls, tokens)는 **신속도 지표의 원천 데이터**, `freshness`는 **최신성 지표의 원천 데이터**다 (→ `evaluation-metrics-design.md`).
- 봉투 발행·회신은 전량 구조화 로그로 남긴다 (프롬프트·응답 본문은 LLMOps 로깅 정책에 따름).

---

## 8. [v2 보강] 도구 배타 구조 반영 (agent-structure-v2.md, 2026-08-02)

- **라우팅 테이블 확장**: intent별 "정보 요구" 열 추가 — Orchestrator(InfoCollector)가 위임 전 병렬 수집할 Provider 목록 (v2 문서 §3 정보 요구표가 정본)
- **AgentTask 확장**: `info: InfoBundle` 필드 — 소형 패킷(날씨·교통·페르소나) 직접 + 후보 풀은 세션 캐시 참조 키. inline_context 규칙과 별개의 정식 필드
- **AgentResult 확장**: status에 `NEED_MORE_INFO` 추가 — payload에 {요청 항목, 사유}. Orchestrator가 수집 후 재위임 (최대 1회, 재요청 초과 시 업무 폴백)
- **라우팅 유일 기준**: 에이전트 선택은 라우팅 테이블만 사용 — 도구 목록 기반 판단 금지 (도구 겹침 혼선 원천 차단)
- Assembly는 위임 대상이 아니라 위임 결과(Proposal)가 통과하는 공통 관문 — 봉투 프로토콜 대상 아님
