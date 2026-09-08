# C2 어셈블리 체인 (HybridAssemblyFacade.solve)

> 코드 구조도 — `assembly_engine/facade.py`의 `solve` 체인 로직(ChainStage 순회, DL-2 시한 회계).

```mermaid
flowchart TD
    P["ItineraryProblem + deadline_ms"] --> LOOP{"다음 ChainStage<br/>OrTools → Llm → RuleFallback"}
    LOOP --> CHK{"잔여 하한0 &ge; stage.required_ms ?"}
    CHK -->|No| SKIP["FallbackEvent deadline<br/>→ 다음 단계"]
    SKIP --> LOOP
    CHK -->|Yes| SOLVE["stage.solve(problem, 잔여)"]
    SOLVE -->|None · 해 없음| NOSOL["FallbackEvent no_solution<br/>→ 다음 단계"]
    NOSOL --> LOOP
    SOLVE -->|해| VAL{"check_all 위반 0 ?<br/>INV-2"}
    VAL -->|위반 있음| INV["FallbackEvent invalid<br/>→ 다음 단계"]
    INV --> LOOP
    VAL -->|위반 0| DONE["compute_quality → QualityScore 부착<br/>AssemblyRunRecord emit<br/>→ ItinerarySolution 반환"]
    LOOP -->|모든 단계 소진| CONFLICT["AssemblyConflictError<br/>고정 블록 모순 등"]
```

참고: `RuleFallbackAssembler`(required_ms=0)가 체인 마지막에 있으면 시한과 무관하게 항상 해를 반환하므로, `AssemblyConflictError` 도달은 "시간 부족"이 아니라 "유효 해 자체가 없음"(모순 입력)을 뜻한다(TRIP-291, INV-4).
