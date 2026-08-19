"""InfoCollector — Orchestrator 전속 정보 수집 하위 컴포넌트 (agent-structure-v2 §3, TRIP-406).

intent별 **정보 요구표**를 보고 등록된 Provider들을 호출해 InfoPacket 묶음을
돌려준다. 판단(점수·선택)은 하지 않는다 — 수집 지시와 상태 수렴만.

- Provider 실패는 상태값(IO-7)이 원칙이지만, 계약을 어기고 예외가 새어 나와도
  수집이 죽지 않게 UNAVAILABLE 패킷으로 수렴한다 (INV-4 — 강등 판단은 호출측).
- 요구표에 있어도 **미등록 Provider는 건너뛴다** — 기능 부재는 실패가 아니다
  (오케스트레이터의 "미배선 = 기능 부재" 선례와 동일).
- 현재 등록 대상은 Weather뿐 — Place(후보 풀)·Persona는 ItineraryOrchestrator가
  기존 인라인 경로(pool_builder·context_resolver)로 직접 수집하며, Provider로의
  이관은 후속 유닛 소관. 병렬 수집도 등록 Provider가 2종 이상이 될 때 붙인다.
"""

from __future__ import annotations

from collections.abc import Mapping

from trippilot.domain.freshness import InfoPacket, ProviderKind, ProviderStatus
from trippilot.providers.base import Provider

# 정보 요구표 (agent-structure-v2 §3) — intent → 수집할 Provider 목록.
# REPLAN·EDIT 행은 해당 경로 유닛에서 채운다.
INFO_REQUIREMENTS: Mapping[str, tuple[ProviderKind, ...]] = {
    "GENERATE_SCHEDULE": (ProviderKind.WEATHER,),
}


class InfoCollector:
    def __init__(self, providers: Mapping[ProviderKind, Provider]) -> None:
        self._providers = dict(providers)

    def collect(self, intent: str, params: dict) -> dict[ProviderKind, InfoPacket]:
        """요구표의 등록 Provider들을 호출 — 패킷 묶음 반환 (요구표 밖 intent는 빈 묶음)."""
        packets: dict[ProviderKind, InfoPacket] = {}
        for kind in INFO_REQUIREMENTS.get(intent, ()):
            provider = self._providers.get(kind)
            if provider is None:  # 미등록 = 기능 부재 — 패킷 자체를 만들지 않는다
                continue
            try:
                packets[kind] = provider.fetch(params)
            except Exception as e:  # Provider 계약 위반 — 수집은 계속 (INV-4)
                packets[kind] = InfoPacket(
                    provider=kind,
                    status=ProviderStatus.UNAVAILABLE,
                    data={"reason": f"{type(e).__name__}: {e}"},
                    freshness=None,
                )
        return packets
