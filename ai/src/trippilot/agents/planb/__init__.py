"""PlanBAgent — 여행 중 변수 대응 (RAG 패턴, planb-rag-design.md).

모듈 구성 (re-export 없음 — 소비 측은 전체 경로로 import, gates/ 선례):
- `kb_retrieval.py` : KB 3종 collection 배정 + 적재 + retrieve 3종
- `rag.py`          : Retrieve → Augment → Generate 골격 + closed-set 관문

경계 (BR-AF-10): 형제 agents import 금지(L-2), LlmPort 직접 import 금지(L-3 —
LLM은 C1 `GatewayFacade` 경유만), providers import 금지(L-4).
"""
