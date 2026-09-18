"""컨텍스트 참조 타입 (U4 FD domain-entities §3, D31).

클라이언트가 넘긴 원본 데이터는 프롬프트에 넣지 않는다 — ResourceRef로
요청자 권한 하에 재조회한 값만 쓴다. 위반 시 부분 성공 없이 즉시 예외
("조용한 제외 금지", BR-U4-07).
"""

from __future__ import annotations

from dataclasses import dataclass


class PermissionDeniedError(Exception):
    """권한 위반 — 부분 성공 0, 조용한 제외 금지 (BR-U4-07)."""


@dataclass(frozen=True, slots=True)
class Principal:
    """요청자."""

    user_id: str

    def __post_init__(self) -> None:
        if not self.user_id:
            raise ValueError("user_id 비어있음")


@dataclass(frozen=True, slots=True)
class ResourceRef:
    """재조회 대상 참조 — 원본 데이터가 아니라 참조만 오간다 (D31)."""

    kind: str  # 예: persona / trip / schedule
    ref_id: str
    owner_id: str

    def __post_init__(self) -> None:
        if not self.kind or not self.ref_id or not self.owner_id:
            raise ValueError("kind/ref_id/owner_id 비어있음")
