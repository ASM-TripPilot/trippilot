"""providers — 정보 수집 전담 계층 (agent-structure-v2 §2, LLM 0회).

Provider 5종: Place·Weather·Transit·Persona·Event.
Orchestrator의 InfoCollector가 유일한 호출자이며, 출력은 InfoPacket(data + FreshnessMeta).

규칙:
- LLM 호출 금지 (규칙 로직·API 조회·캐시만 허용)
- 실패는 예외가 아니라 ProviderStatus 상태값 (IO-7, INV-4)
- 모든 성공 응답에 FreshnessMeta 필수 (BR-AF-06)
- 하위 계층(domain·ports)만 import 가능 (L-4)
- agents·orchestrator import 금지
"""
