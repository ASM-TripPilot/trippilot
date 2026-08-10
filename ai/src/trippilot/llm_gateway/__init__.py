"""llm_gateway (설계 컴포넌트 C1 — LLM Gateway) — 코드-주도 단발 호출 (U4 FD).

의존 방향: workers → gateway → (prompts·gate·config) → domain/ports.
llm_gateway는 solver_engine·poi_curation을 import하지 않는다 (BR-U4-09, 아키텍처 테스트 강제).
"""
