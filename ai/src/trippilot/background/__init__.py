"""background — 웹소싱 파이프라인 계층 (AI-D03, agent-structure-v2 §2, TRIP-421).

실시간 경로 밖의 새벽 배치 전용: 웹 검색 → C1 추출 워커(LLM) → 게이트 →
행사 저장소 등록·만료 청소. Provider(실시간, LLM 0회)는 이 계층이 채운
저장소를 **읽기만** 한다 — "웹 소싱은 Provider 소속이 아님" (v2 §2).

규칙:
- LLM 호출은 C1 게이트웨이 경유만 (직접 SDK 금지 — 4겹 장치 우회 차단)
- 하위 계층(domain·ports)과 c1만 import — agents·orchestrator·providers 금지 (L-1)
- 실 API 호출은 스케줄/수동 워크플로에서만 (CI·pytest 실 호출 0, D37)
"""
