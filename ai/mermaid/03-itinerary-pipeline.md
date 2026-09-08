# 일정 생성 파이프라인 (ItineraryOrchestrator.generate → ScheduleAgent.run)

> 코드 구조도 — ⓪·①·①′ 은 `orchestrator/itinerary_orchestrator.py`, ②~⑤ 는 `agents/schedule/agent.py`(ScheduleAgent). 재료는 `ScheduleTask` 봉투로 넘어간다.

```mermaid
flowchart TD
    REQ["GenerateItineraryRequest"] --> V0["⓪ 소유 검증<br/>OwnershipVerifier.verify_ownership<br/>(fail-closed, TRIP-333)"]
    V0 -->|PermissionDeniedError| FAIL["FAILED<br/>(permission_denied)"]
    V0 -->|통과| S1["① 정보 수집 1회<br/>InfoCollector.collect(GENERATE_SCHEDULE)<br/>PLACE·WEATHER·PERSONA·EVENT"]
    S1 --> POOL{"풀 확보?<br/>(PLACE→poi_curation, INV-1 유일 출처)"}
    POOL -->|없음| FAILP["FAILED<br/>(pool_unavailable)"]
    POOL -->|확보| S1D["①′ 패킷 소화<br/>날씨→daily_rain · 행사→event_bonus<br/>(미보정 시 None, 실패는 prior_degradations)"]
    S1D --> TASK["ScheduleTask 발행<br/>(풀·페르소나·보정값·budget·started_ms)"]
    subgraph AGENT["ScheduleAgent.run (agents/schedule/agent.py)"]
    S2["② 게이트웨이 선호 점수<br/>PreferenceScoringWorker.score<br/>(전 일자 공용 1회)"]
    S2 -->|실패·시한부족·페르소나 없음| S2F["규칙 점수 폴백<br/>scorer.build_rule_score<br/>(ScoringMode.RULE)"]
    S2 -->|성공| S3
    S2F --> S3["③ ItineraryProblem 조립<br/>(candidates = 풀 유래만)"]
    S3 --> S4["④ 어셈블리 solve<br/>AssemblyProvider.for_pool → HybridAssemblyFacade.solve<br/>(잔여 시간 전부, TRIP-376)"]
    S4 -->|AssemblyConflictError| FAIL2["FAILED<br/>(assembly_conflict, d08)"]
    S4 -->|해 산출| S5["⑤ 설명 부착 (선택)<br/>ExplanationWorker.explain<br/>(미배선·시한부족 시 생략)"]
    S5 --> OUT["GenerationOutcome<br/>(SUCCESS / DEGRADED)"]
    end
    TASK --> S2
```
