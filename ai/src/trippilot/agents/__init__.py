"""agents — c1·c2·m7을 조립하는 유일한 상위 계층 (BR-AF-10, business-logic-model §1·§6).

base.py의 Agent Protocol + 코어 4종: edit_agent.py(함수군) · planb/(RAG 파이프라인) ·
reflect/(compose) · schedule/(ScheduleAgent — 일정 생성, 오케스트레이터가 ScheduleTask 로 위임).
`handle(AgentTask) -> AgentResult` 봉투 수렴은 넷 다 후속(business-rules 미결 #8).
경계: 형제 상호 import 금지(L-2), LlmPort 직접 import 금지(L-3, 게이트웨이 경유만),
providers import 금지(L-4), orchestrator import 금지(L-6 — 재료는 봉투로만).
"""
