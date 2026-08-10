"""orchestrator — 의도 파악·복잡도 판단·위임 지휘 계층 (agent-foundation FD §1 예약 자리).

현재 채워진 갈래:
- `question_bank`: 의도별 질문뱅크 yaml 적재 (검수 게이트 포함, U6-01/TRIP-242)
- `intent_router`: 3단 매칭(질문뱅크 → 유사질문 투표 → LLM 직접 분류) + 결정론 폴백
- `itinerary_orchestrator`: M7 후보풀 → C1 선호점수 → C2 솔버 조립 + 폴백 계단
  (U5-01/02, TRIP-237·238)

Execution Plan 수립·InfoCollector·AgentTask 발행은 후속 유닛 소관.

경계: LLM 호출은 **C1 게이트웨이(`GatewayFacade`) 경유만** — `ports.llm_port` 직접 import 금지
(L-3과 동일 취지: 4겹 장치 우회 차단). 하위 계층(domain·ports·c1·c2·m7)은 이 패키지를 모른다 (L-1).
"""
