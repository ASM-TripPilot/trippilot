"""EditAgent — 일정 편집 (해석 → 검증 → 반영, agent-foundation FD §1).

모듈 구성 (re-export 없음 — 소비 측은 전체 경로로 import, planb/·reflect/·schedule/ 선례):
- `agent.py`    : `EditAgent.run(EditTask) -> EditOutcome` — 번역 워커를 생성자로 감싸는
                  에이전트 본체. 자연어 번역·확인 게이트·재타이밍·어셈블리 검증을 소유
- `commands.py` : 명령 검증·시퀀스 변형·결정론 재타이밍 — 순수 함수

역할 경계 (팀 결정 2026-08-22, TRIP-431): LLM 은 **번역만** — 시각·순서·가능 여부는
전부 코드·어셈블리 소유. 사용자 노출은 어셈블리 `validate` 통과분만(INV-2).

경계 (BR-AF-10): 형제 agents import 금지(L-2), LlmPort 직접 import 금지(L-3 — LLM 은
게이트웨이 워커 경유만), providers import 금지(L-4), orchestrator import 금지(L-6).
"""
