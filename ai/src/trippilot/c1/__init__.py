"""C1 LLM Gateway — 코드-주도 단발 호출 (U4 FD).

의존 방향: workers → gateway → (prompts·gate·config) → domain/ports.
c1은 c2·m7을 import하지 않는다 (BR-U4-09, 아키텍처 테스트 강제).
"""
