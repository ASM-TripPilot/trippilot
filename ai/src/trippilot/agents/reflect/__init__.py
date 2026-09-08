"""ReflectAgent — 회고 생성 (agent-foundation FD §1의 예약 자리 실체화, TRIP-429·595).

모듈 구성 (re-export 없음 — 소비 측은 전체 경로로 import, planb/·schedule/ 선례):
- `agent.py`         : `ReflectAgent.run(ReflectTask) -> ReflectionTemplate` — 워커를
                       생성자로 감싸는 에이전트 본체. Phase 1(텍스트)·Phase 2(vision)를
                       `ReflectTask.vision` 유무로 갈라 한 진입점으로 모은다
- `composer.py`      : 랭킹·하드 교체·봉투 — 순수 결정론 단계
- `fallback.py`      : 전 시도 실패 시 고정 폴백 템플릿 (INV-4)
- `highlight_rule.py`: 대표 사진 결정론 선별 (LLM 실패 시 강등 대상)

경계 (BR-AF-10): 형제 agents import 금지(L-2), LlmPort 직접 import 금지(L-3 — 이미지
값 타입 `LlmImagePart` 를 이름으로 받지 않고 불투명 payload 로 전달하는 이유), providers
import 금지(L-4), orchestrator import 금지(L-6).

`AgentTask` 봉투 수렴은 넷 다 후속 — 라우팅 배선과 함께 (business-rules 미결 #8).
"""
