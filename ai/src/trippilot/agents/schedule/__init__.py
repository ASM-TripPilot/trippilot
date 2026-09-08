"""ScheduleAgent — 일정 생성 (Generation 패턴, agent-foundation FD §1·§6 · agent-structure-v2 §3 배선 실태 註).

오케스트레이터(`orchestrator/itinerary_orchestrator.py`)가 소유 검증·시한 배분·정보
수집을 끝내고 재료를 `ScheduleTask` 에 담아 넘기면, 이 에이전트가 게이트웨이 선호
점수 → 문제 조립 → 어셈블리 solve → 설명 부착을 소유한다. 어셈블리 엔진 자체는
`assembly_engine/` 의 독립 층 — 여기서는 `solve()` 를 **부를** 뿐이다.

모듈 구성 (re-export 없음 — 소비 측은 전체 경로로 import, planb/ 선례):
- `agent.py`   : `ScheduleAgent.run(ScheduleTask) -> GenerationOutcome` + 요청·태스크 타입
- `outcome.py` : `GenerationOutcome`·`GenerationStatus`·`Degradation`·`CandidatesReport`
- `budget.py`  : `OrchestratorConfig`·`DeadlineBudget`·`allocate` (시한 배분 정책)

경계 (BR-AF-10): 형제 agents import 금지(L-2), LlmPort 직접 import 금지(L-3 — LLM 은
게이트웨이 `GatewayFacade` 경유만), providers import 금지(L-4), orchestrator import
금지(L-6 — 에이전트는 호출받는 쪽, 재료는 태스크로만 받는다).
"""
