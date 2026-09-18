"""PersonaProvider — 페르소나 재조회 수집 (agent-structure-v2 §2, TRIP-407).

BR-U4-07("프롬프트에 들어가는 값은 요청자 권한 하에 재조회한 것만")의 재조회
시점이 워커(D31)에서 이 Provider(수집 단계)로 이동했다 — 검사의 권위는 여전히
ContextResolver 한 곳이고(TRIP-333과 같은 인스턴스 주입), 워커는 재조회된
PersonaSummary 객체를 봉투로 받는다 (v2 §3 "정보는 봉투로만").

**보안 예외 — IO-7의 명시적 예외 1건**: PermissionDeniedError는 상태값으로
삼키지 않고 그대로 승격한다. 권한 위반을 COLD_START 따위로 수렴시키면 규칙
점수 일정으로 "성공한 척"하게 된다(fail-closed, 부분 성공 0). ⓪ 소유 검증이
먼저 막으므로 정상 흐름에서는 도달하지 않는 방어선이다.

그 외 실패(실체 없음 등)는 COLD_START + 사유 — 페르소나 없이도 일정은 나가야
한다(INV-4, 강등 판단은 호출측).
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from trippilot.domain.context import PermissionDeniedError, Principal, ResourceRef
from trippilot.domain.freshness import (
    FreshnessMeta,
    InfoPacket,
    ProviderKind,
    ProviderStatus,
)
from trippilot.domain.persona import PersonaSummary


class PersonaResolver(Protocol):
    """권한 재조회 콘센트 — 실 구현은 llm_gateway.context.ContextResolver.

    구조적 타이핑으로 받는다(직접 import 없음) — providers는 설비 계층(c1)을
    모른 채 계약만 본다.
    """

    def resolve(self, principal: Principal, ref: ResourceRef) -> object: ...


class PersonaProvider:
    """InfoCollector가 호출하는 페르소나 수집 Provider. LLM 0회.

    params:
    - "principal": Principal — 요청자
    - "persona_ref": ResourceRef — 재조회 대상
    - "now": datetime(tz-aware)
    """

    def __init__(self, resolver: PersonaResolver) -> None:
        self._resolver = resolver

    def fetch(self, params: dict) -> InfoPacket:
        now: datetime = params["now"]
        try:
            value = self._resolver.resolve(params["principal"], params["persona_ref"])
        except PermissionDeniedError:
            raise  # 보안 — 상태값 수렴 금지 (모듈 docstring)
        except Exception as e:
            return self._cold_start(f"{type(e).__name__}: {e}")
        if not isinstance(value, PersonaSummary):
            return self._cold_start(f"PersonaSummary 아님: {type(value).__name__}")
        return InfoPacket(
            provider=ProviderKind.PERSONA,
            status=ProviderStatus.OK,
            data={"persona": value.to_dict()},  # JSON-safe — 소형이라 직접 포함 (DL-2)
            freshness=FreshnessMeta(
                source="CONTEXT_STORE",
                fetched_at=now,
                cache_hit=False,
                ttl_sec=0,  # 캐시 없음 — 매 요청 재조회 값 (BR-U4-07)
                stale=False,
            ),
        )

    @staticmethod
    def _cold_start(reason: str) -> InfoPacket:
        return InfoPacket(
            provider=ProviderKind.PERSONA,
            status=ProviderStatus.COLD_START,
            data={"reason": reason},
            freshness=None,
        )
