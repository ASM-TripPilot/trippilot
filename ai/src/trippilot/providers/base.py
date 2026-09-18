"""Provider Protocol — 정보 수집 계층의 공통 계약 (agent-structure-v2 §2).

모든 Provider는 이 Protocol을 따른다:
- 입력: 요청 파라미터 (intent별 정보 요구표에서 결정)
- 출력: InfoPacket (data + FreshnessMeta + ProviderStatus)
- LLM 호출 0회
- 실패 시 예외 대신 상태값 반환 (INV-4)
"""

from __future__ import annotations

from typing import Protocol

from trippilot.domain.freshness import InfoPacket


class Provider(Protocol):
    """정보 수집 Provider 공통 계약.

    구현체는 이 Protocol을 상속하지 않고 시그니처만 맞추면 된다 (구조적 타이핑).
    각 Provider는 도메인 특화 메서드를 가지되, 공통 계약은 fetch 하나로 표현한다.
    """

    def fetch(self, params: dict) -> InfoPacket: ...
