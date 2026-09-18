"""PhotoHighlightWorker — 동의된 사진 → 대표 N장, 1회 호출 조립 (TRIP-595).

FD business-logic-model §6 ⓐ. 워커는 vars 조립 → gateway.call 1회까지만 —
실패 시 메타 규칙 폴백(agents/reflect/highlight_rule.py) 실행은 호출측 몫이다
(BR-U4-09: c1은 신호만 낸다). 폴백 TypedResult는 그대로 반환한다.

**동의는 타입이 강제한다**: 입력을 `VisionInput`으로 받으므로, 미동의·증빙 없음
상태로는 이 워커를 호출할 인자 자체를 만들 수 없다 (BR-U6R-09, VIS-P1의 전제).
동의 검사 코드가 여기 없는 것이 누락이 아니라 설계다. 게이트웨이도 images와
consent_ref를 짝으로 요구하므로(TRIP-595), 타입을 우회해도 벤더로는 못 나간다.

**바이트는 포트 경계에서만**: `PhotoRef`에는 바이트가 없고, 실제 이미지는 호출자가
`images: Mapping[PhotoId, LlmImagePart]`로 따로 넘긴다. 덕분에 도메인·프롬프트 계층은
끝까지 메타만 다루고, 바이트는 조립 직전 한 지점에서만 존재한다.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime

from trippilot.llm_gateway.gates.photo_highlight import (
    DEFAULT_HIGHLIGHT_LIMIT,
    PhotoHighlightContext,
)
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature, TypedResult
from trippilot.domain.reflection import PhotoId, PhotoRef, VisionInput
from trippilot.ports.llm_port import LlmImagePart


def _photo_sort_key(photo: PhotoRef) -> tuple:
    """결정론 정렬 — 날짜 → 방문지 → 촬영시각 → photo_id.

    None은 항상 뒤로 (bool 선행 키). photo_id가 마지막 키라 전순서가 되고,
    입력 순서가 달라져도 같은 프롬프트가 나온다 (BR-U4-06 렌더 결정론의 전제).
    """
    ref = photo.visit_ref
    return (
        ref is None,
        ref.date.isoformat() if ref else "",
        str(ref.poi_id) if ref else "",
        photo.taken_at is None,
        photo.taken_at.isoformat() if photo.taken_at else "",
        str(photo.photo_id),
    )


def build_photo_highlight_vars(vision: VisionInput, *, limit: int) -> dict[str, str]:
    """값 전부 str · 결정론 정렬 · **좌표 미포함**(G181 — PhotoRef.gps는 프롬프트에
    싣지 않는다) · **시각 미포함**(BR-U6R-04 원천 차단 — 날짜와 그날 순번까지만).

    순번을 시각 대신 쓰는 이유: "시간 분산"에 필요한 건 앞뒤 관계지 시계 값이 아니다.
    시각을 넣으면 모델이 캡션 아닌 곳에서 그 값을 되돌려줄 여지가 생긴다 (이중 방어).
    """
    lines = []
    order_in_day: dict[str, int] = {}
    for photo in sorted(vision.photos, key=_photo_sort_key):
        ref = photo.visit_ref
        day = ref.date.isoformat() if ref else "(일자 미상)"
        order_in_day[day] = order_in_day.get(day, 0) + 1
        place = str(ref.poi_id) if ref else "(방문 미상)"
        lines.append(f"- {photo.photo_id} | {day} | {order_in_day[day]}번째 | {place}")
    return {"limit": str(limit), "photos": "\n".join(lines)}


class PhotoHighlightWorker:
    def __init__(self, gateway: GatewayFacade) -> None:
        self._gateway = gateway

    def select(
        self,
        vision: VisionInput,
        images: Mapping[PhotoId, LlmImagePart],
        trace_id: TraceId,
        now: datetime,
        *,
        limit: int = DEFAULT_HIGHLIGHT_LIMIT,
        timeout_sec: float | None = None,  # 시간 예산 미확정 (BR-U6R-14) — 호출측 관통
    ) -> TypedResult:
        """반환 value는 `tuple[PhotoId, ...]` (FD domain-entities §4 — 별도 타입 없음).

        **images의 키는 vision.photos의 id 집합과 정확히 일치해야 한다** — 어긋나면
        폴백이 아니라 ValueError다 (게이트웨이가 LlmFeature 밖 호출을 폴백이 아닌
        버그로 다루는 것과 같다). 양쪽 불일치가 각각 다른 사고이기 때문이다:
          · 남는 바이트(동의 집합 밖): 보내면 그 자체로 동의 위반(BR-U6R-09)이다.
            조용히 걸러도 안 된다 — "왜 이 사진이 빠졌지"가 어디에도 남지 않는다.
          · 모자란 바이트: 프롬프트 목록에는 있는데 이미지가 없는 사진이 생기고,
            목록 순서와 전송 순서의 대응이 깨져 **id는 맞고 사진만 틀린 선택**이
            나온다. 게다가 그건 조용한 부분 강등이다 — 바이트를 못 구한 사진은
            호출측이 VisionInput에서 명시적으로 빼고 부르는 게 맞다 (BR-U6R-10).
        """
        consented = frozenset(p.photo_id for p in vision.photos)
        if frozenset(images) != consented:
            extra = sorted(str(p) for p in frozenset(images) - consented)
            missing = sorted(str(p) for p in consented - frozenset(images))
            raise ValueError(
                "images 키가 동의된 사진 집합과 불일치 — "
                f"동의 밖 바이트(BR-U6R-09) {extra} · 바이트 없는 사진(BR-U6R-10) {missing}"
            )
        # 프롬프트 목록 순서 = 이미지 전송 순서 (같은 정렬). 키 집합이 일치하므로
        # i번째 목록 줄과 i번째 이미지가 항상 같은 사진이다.
        parts = tuple(
            images[p.photo_id] for p in sorted(vision.photos, key=_photo_sort_key)
        )
        context = PhotoHighlightContext(photo_ids=consented, limit=limit)
        return self._gateway.call(
            LlmFeature.PHOTO_HIGHLIGHT,
            build_photo_highlight_vars(vision, limit=limit),
            context,  # pool 자리 = closed-set 대조 집합
            trace_id,
            now,
            timeout_sec=timeout_sec,
            images=parts,
            # 동의 근거를 트레이스까지 잇는다 (BR-U6R-09 후반부) — 게이트웨이가
            # 이미지와 짝으로 요구하므로 이 인자 없이는 사진이 나가지 못한다
            consent_ref=vision.consent.consent_ref,
        )
