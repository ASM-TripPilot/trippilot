"""ContextResolver — 프롬프트 입력의 권한 재조회 (U4 FD §1 context.py, D31).

원칙: 프롬프트에 들어가는 값은 전부 "요청자 권한 하에 재조회한 것"만 (BR-U4-07).
owner 불일치가 하나라도 있으면 조회 자체를 시작하지 않는다 — 부분 성공 0.
"""

from __future__ import annotations

from typing import Protocol

from trippilot.domain.context import PermissionDeniedError, Principal, ResourceRef


class ContextStore(Protocol):
    """재조회 저장소 콘센트 — 실 구현(DB/백엔드 조회)은 U5. 테스트는 fake."""

    def get(self, ref: ResourceRef) -> object | None: ...


class ContextResolver:
    def __init__(self, store: ContextStore) -> None:
        self._store = store

    def resolve(self, principal: Principal, ref: ResourceRef) -> object:
        return self.resolve_many(principal, (ref,))[0]

    def verify_ownership(
        self, principal: Principal, refs: tuple[ResourceRef, ...]
    ) -> None:
        """소유 검증만 — 저장소 조회 없음 (LLM 호출도 없다).

        보안 규칙의 권위는 이 클래스 한 곳이다. 오케스트레이터의 시한 스킵 경로가
        fail-closed(TRIP-333, 팀 결정 2026-08-11)를 위해 이 갈래만 단독 호출한다 —
        검사를 복제하지 않는다. 하나라도 위반이면 PermissionDeniedError (부분 성공 0).
        """
        for ref in refs:
            if ref.owner_id != principal.user_id:
                raise PermissionDeniedError(
                    f"권한 위반: {ref.kind}/{ref.ref_id} (owner={ref.owner_id}, "
                    f"principal={principal.user_id})"
                )

    def resolve_many(
        self, principal: Principal, refs: tuple[ResourceRef, ...]
    ) -> tuple[object, ...]:
        # 1) 권한 전수 검사 먼저 — 하나라도 위반이면 어떤 조회도 하지 않는다 (CTX-P1)
        self.verify_ownership(principal, refs)
        # 2) 재조회 — 참조가 실체 없으면 데이터 정합 오류 (권한 문제와 구분)
        values: list[object] = []
        for ref in refs:
            value = self._store.get(ref)
            if value is None:
                raise LookupError(f"재조회 실패: {ref.kind}/{ref.ref_id}")
            values.append(value)
        return tuple(values)
