"""agents — c1·c2·m7을 조립하는 유일한 상위 계층 (BR-AF-10, business-logic-model §1·§6).

base.py의 Agent Protocol + 에이전트 4종 — 넷 다 **워커를 감싸는 객체**이고, 경계는
`run(<Task>)` 하나만 안다 (2026-09-09 통일):
  edit/    `EditAgent.run(EditTask) -> EditOutcome`             — 해석·검증·재타이밍·어셈블리 검증
  planb/   `PlanBAgent.run(PlanBRagRequest) -> …Result`  — RAG 대안 생성
  reflect/ `ReflectAgent.run(ReflectTask) -> ReflectionTemplate` — 회고 템플릿 (텍스트·vision)
  schedule/`ScheduleAgent.run(ScheduleTask) -> GenerationOutcome` — 일정 생성 (오케스트레이터 위임)
`handle(AgentTask) -> AgentResult` 봉투 수렴은 넷 다 후속(business-rules 미결 #8).
경계: 형제 상호 import 금지(L-2), LlmPort 직접 import 금지(L-3, 게이트웨이 경유만),
providers import 금지(L-4), orchestrator import 금지(L-6 — 재료는 봉투로만).
"""
