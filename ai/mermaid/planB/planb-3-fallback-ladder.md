# Plan-B ③ 폴백 사다리

> 코드 구조도 — LLM 1차 → 재시도 모델 → 규칙 랭킹 → 빈 결과.
> `fallback_level` 0·1·2 가 어느 실패에서 매겨지는지를 그린다(INV-4, 침묵 실패 금지).
> 기준: origin/develop (a9648b7e), 2026-09-26.

```mermaid
flowchart TB
  START(["LLM 호출"]) --> T1{"1차 응답?"}
  T1 -->|"성공"| L0["fallback_level 0<br/>is_fallback false"]
  T1 -->|"타임아웃"| T2{"재시도 모델<br/>(운영 배정 — TRIPPILOT_LLM_RETRY_MODELS)"}
  T2 -->|"성공"| L0
  T2 -->|"실패"| L1
  T1 -->|"형태 불량 · 빈 결과 · 예외"| L1["fallback_level 1<br/>규칙 랭킹"]
  L1 --> CHK{"후보 있나"}
  CHK -->|"있음"| DONE(["응답 200"])
  CHK -->|"없음"| L2["fallback_level 2<br/>empty_reason"]
  L0 --> DONE
  L2 --> DONE

  classDef ok fill:#e7f2f1,stroke:#12595f,color:#0d3f43
  classDef warn fill:#fdf4e3,stroke:#a8660c,color:#6d4308
  class L0 ok
  class L1,L2 warn
```

재시도 모델은 기능별 운영 배정이다(`TRIPPILOT_LLM_RETRY_MODELS`, 1차와 파서 공유).
"다른 벤더로" 는 opus 시절 근거라 그림에서 뺐다 — 2026-09-12 팀 결정으로 현행은
terra(여유 우선)이고, 배정이 바뀌면 그림이 아니라 env 가 정본이다.
