"""RecommendationAgent — 도우미 "골라 줘"(RECOMMEND_PLACES)·"어디로 갈까"(RECOMMEND_REGION)의 고르기 판단 (2026-10-23 사용자 결정 —
"추천 관련한 것은 recommendation agent 가 처리").

도우미 핸들러(`orchestrator/dialogue_handlers.py`)가 모은 재료를 `RecommendTask` 로 넘기면, 이 에이전트가 무엇을·어떤 순서로·몇 곳
고를지 정한다 — 장소는 핸들러가 팬아웃으로 이미 모은 후보(반경 풀·NL2SQL 행) 중 어느 쪽을 쓸지와 순서·개수, 지역은 취향·말한
바람 × 지역 성격표(`domain/region_recommend`)로 몇 곳과 근거. 데이터 수집과 답 꼴(Facts — 카드·버튼·템플릿) 조립은 핸들러에
남는다(L-6 — 에이전트는 오케스트레이터 타입을 모른다). LLM 0회 — 문장은 답변 LLM 이 Facts 로 짓는다.

모듈 구성 (re-export 없음 — 소비 측은 전체 경로로 import, planb/·reflect/·schedule/·edit/·unknown_handling/ 선례):
- `agent.py` : `RecommendationAgent.run(RecommendTask) -> RecommendOutcome`

경계 (BR-AF-10): 형제 agents import 금지(L-2), LlmPort 직접 import 금지(L-3 — 쓰지도 않는다), providers import 금지(L-4),
orchestrator import 금지(L-6).

`AgentTask` 봉투 수렴은 여섯 다 후속(business-rules 미결 #8).
"""
