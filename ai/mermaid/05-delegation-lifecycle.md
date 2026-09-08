# 위임 봉투 생명주기

> 코드 구조도 — `domain/delegation.py`(AgentTask/AgentResult/spawn), `agents/base.py`(Agent Protocol).
>
> ⚠️ 이 봉투(AgentTask/spawn/AgentResult)를 실제로 타는 에이전트는 아직 없다. ScheduleAgent(2026-09-09)는
> 오케스트레이터→에이전트 재료 봉투 `ScheduleTask`(`agents/schedule/agent.py`)로 재료를 받고 `GenerationOutcome` 을
> 돌려준다 — 아래 게이트웨이·어셈블리 호출 순서(점수 → solve)는 ScheduleAgent 가 그대로 실현한다.

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant A as Agent (Protocol · handle)
    participant C1 as GatewayFacade (C1)
    participant C2 as HybridAssemblyFacade (C2)

    O->>O: IntentRouter.route(발화) → IntentMatch
    O->>A: AgentTask (deadline_ms>0, intent, slots)
    A->>A: AgentTask.spawn() 자식 봉투<br/>(deadline = 부모 − 경과, 소진 시 DeadlineExhaustedError)
    A->>C1: GatewayFacade.call(feature, vars, ...)
    C1-->>A: TypedResult (value 또는 is_fallback)
    A->>C2: solve(problem, remaining_ms, trace_id)
    C2-->>A: ItinerarySolution
    A-->>O: AgentResult (status, payload, metrics)
```
