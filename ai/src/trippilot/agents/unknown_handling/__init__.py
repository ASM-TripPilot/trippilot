"""UnknownHandlingAgent — 도우미 미확인 칸 웹 확인 (먼저 답하고 뒤에서 찾기, 2026-10-22 사용자 결정 · 넷과 같은 꼴로 편입).

도우미 핸들러(`orchestrator/dialogue_handlers.py`)가 등록 장소의 영업시간·휴무일·입장료를 "미확인"으로 답하게 될 때
`UnknownTask` 로 넘기면, 이 에이전트가 저장된 웹 확인 값을 돌려주거나(찾았음) 뒤에서 벤더 웹 검색을 내고(찾는 중) 그
결과를 저장소에 둔다. 턴은 기다리지 않는다 — 검색 7~12s 가 턴 시한 안에 못 끝나기 때문.

모듈 구성 (re-export 없음 — 소비 측은 전체 경로로 import, planb/·reflect/·schedule/·edit/ 선례):
- `agent.py` : `UnknownHandlingAgent.run(UnknownTask) -> UnknownOutcome` — 조회 워커를 생성자로 감싸는 에이전트 본체.
               저장된 값 조회 → 뒤에서 찾기 제출(장소별 중복 제거·하루 상한) → (뒤에서) 출처 있는 값만 저장
저장소 구현은 `agents/adapters/{pg,memory}_place_fact_store.py`, 타입 정본은 `ports/place_fact_store_port.py`.

경계 (BR-AF-10): 형제 agents import 금지(L-2 — 어댑터도 형제다, 저장소는 포트 타입으로 주입받는다), LlmPort 직접 import
금지(L-3 — 웹 검색은 게이트웨이 워커 `PlaceFactLookupWorker` 경유만), providers import 금지(L-4), orchestrator import 금지(L-6).

`AgentTask` 봉투 수렴은 여섯 다 후속(business-rules 미결 #8).
"""
