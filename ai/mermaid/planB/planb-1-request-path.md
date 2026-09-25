# Plan-B ① 요청이 지나는 길

> 코드 구조도 — FE 재계획 시트에서 AI `alternatives` 경계까지. 슬롯 교체 후보(h08)
> 경로이며, AI 미도달 시 백엔드 로컬 후보풀 degraded 분기를 함께 그린다.
> 기준: origin/develop (a9648b7e), 2026-09-26.

```mermaid
flowchart LR
  FE["FE<br/>재계획 시트"] -->|"사유·지시·자유입력"| BE

  subgraph BE["백엔드"]
    direction TB
    SVC["SlotCandidateService<br/>예산 25s"] --> ADP["HttpScheduleAgentAdapter<br/>proposeSlotCandidates"]
  end

  ADP -->|"POST /ai/v1/itinerary/alternatives"| RT

  subgraph AI["AI 서비스"]
    direction TB
    RT["routes.alternatives"] --> WIR["wiring.alternatives<br/>InfoCollector.collect(REPLAN 요구표)"]
    WIR --> AG["PlanBAgent.run"]
  end

  WIR -.->|"PLACE·WEATHER 수집<br/>(PERSONA·TRANSIT 은 와이어 필드 대기)"| POOL[("후보 풀<br/>closed-set")]
  AG --> OUT["대안 ≤3<br/>+ fallback_level"]
  OUT -->|"UUID 파싱 → ground()"| ADP
  ADP -.->|"AI 미도달"| LOCAL["로컬 후보풀<br/>degraded=true"]

  classDef ai fill:#e7f2f1,stroke:#12595f,color:#0d3f43
  classDef be fill:#f1f0ec,stroke:#767c83,color:#2b2f33
  classDef warn fill:#fdf4e3,stroke:#a8660c,color:#6d4308
  class RT,WIR,AG,OUT ai
  class SVC,ADP,FE be
  class LOCAL warn
```

수집이 `InfoCollector` 경유인 것은 2026-09-16 부터다 — 종전에는 풀 빌더를 직접 불러
`INFO_REQUIREMENTS[REPLAN]` 이 있는데도 날씨를 안 봤다(팀 결정: "replan 은 무조건
날씨를 본다"). 표 4종 중 지금 채워지는 것은 PLACE·WEATHER 둘이고, PERSONA·TRANSIT 은
와이어에 필드가 없어 백엔드가 보내주기 전에는 수집할 수 없다(`wiring.alternatives`
docstring 이 정본).
