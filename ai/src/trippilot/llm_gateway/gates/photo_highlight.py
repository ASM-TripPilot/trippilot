"""PHOTO_HIGHLIGHT 출구 게이트 (TRIP-595 — U6 Reflect FD business-logic-model §6 ⓐ).

`{"highlights": [photo_id, ...]}` → `tuple[PhotoId, ...]` (FD domain-entities §4:
하이라이트 산출에 별도 타입을 두지 않는다).

**강제하는 것** (검증 가능한 것만 — BR-U6R-11):
  ① photo_id ⊆ 입력 사진 집합 — 밖 참조는 드롭 + GateDropEvent 계측 (INV-1 사영, BR-U6R-03)
  ② 중복 0 — 첫 등장 채택 (explanation 게이트 선례)
  ③ 개수 ≤ 요청 상한 N — 초과분은 앞에서부터 남기고 결정론 절단

**강제하지 않는 것**: 사진 내용과 선택의 타당성. 애초에 시각 서술을 받지 않으므로
판정 대상이 없다 — 1×1 투명 PNG에 "64×17 연초록"이 나온 실측(2026-08-25) 이후,
"모델이 정말 사진을 봤는가"는 게이트가 답할 수 없는 질문으로 분류한다.

error는 **파싱 실패만** (게이트웨이가 폴백 신호로 전환 → 호출측이 메타 규칙 폴백).
전량이 입력 밖이면 error가 아니라 빈 튜플 — 게이트웨이가 `gate_dropped_all`로 가른다.
"error 있으면 value 비움" 불변식은 base.GateOutcome이 강제한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from trippilot.llm_gateway.gates.base import GateOutcome, _load_json_object
from trippilot.domain.common import TraceId
from trippilot.domain.llm import LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.domain.reflection import PhotoId

# 장면 상한(_SCENE_MAX=8)과 같은 값 — 장면마다 1장이 사진 최대 수요다.
# 실제 상한은 호출측이 요청 단위로 넘긴다(PhotoHighlightContext.limit) — 여행 길이에
# 따라 달라지는 값이라 게이트 상수로 고정하지 않는다.
DEFAULT_HIGHLIGHT_LIMIT = 8


@dataclass(frozen=True, slots=True)
class PhotoHighlightContext:
    """게이트 검증 컨텍스트 — GatewayFacade.call의 pool 자리로 관통
    (reflection_template·event_extraction 선례). 이것이 closed-set 대조 집합이다.
    """

    photo_ids: frozenset[PhotoId]
    limit: int = DEFAULT_HIGHLIGHT_LIMIT

    def __post_init__(self) -> None:
        if not self.photo_ids:
            raise ValueError("photo_ids ≥ 1 (대조 집합 없이는 멤버십 판정 불가)")
        if self.limit < 1:
            raise ValueError("limit ≥ 1")


class PhotoHighlightGate:
    """PHOTO_HIGHLIGHT 출구 게이트 — 입력 사진 집합 교차 (INV-1 사영)."""

    def apply(
        self,
        raw_text: str,
        pool: object,  # PhotoHighlightContext — pool 자리로 관통 (ExitGate 계약 호환)
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        if not isinstance(pool, PhotoHighlightContext):
            # 대조 집합이 없으면 "입력 밖 id"를 판정할 수 없다 = 게이트가 없는 것과 같다
            return GateOutcome(
                value=(),
                drop_event=None,
                error="gate_error: PhotoHighlightContext 없음 (입력 사진 집합 필요)",
            )
        try:
            items = _load_json_object(raw_text, "highlights")
            if not isinstance(items, list):
                raise ValueError("highlights가 배열이 아님")
            parsed: list[str] = []
            for i, item in enumerate(items):
                if not isinstance(item, str) or not item.strip():
                    raise ValueError(f"highlights[{i}]가 비어있지 않은 문자열이 아님")
                parsed.append(item.strip())
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        seen: set[str] = set()
        survivors: list[PhotoId] = []
        dropped: list[str] = []
        for pid_str in parsed:
            if pid_str in seen:  # ② 중복은 첫 등장만 — 드롭 계측 대상 아님(환각이 아니다)
                continue
            seen.add(pid_str)
            pid = PhotoId(pid_str)
            if pid in pool.photo_ids:  # ① 멤버십
                survivors.append(pid)
            else:
                dropped.append(pid_str)

        # ③ 상한 절단은 GateDropEvent에 넣지 않는다 — 이 이벤트는 INV-1 환각률 지표이고,
        # "유효하지만 N장을 넘어 잘린 사진"을 같은 통계에 섞으면 지표가 무의미해진다
        # (gate_dropped_all/llm_empty_result를 가른 것과 같은 이유 — 처방이 다르다).
        selected = tuple(survivors[: pool.limit])

        drop_event = (
            GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                # photo_id는 풀 ID가 아님 — 환각률 지표 순수성 (place_extraction·
                # event_extraction·paraphrase·reflection_nudge 선례와 동일). PoiId로
                # 캐스팅해 실으면 POI 단위로 집계하는 소비자에게 미등록 POI로 잡힌다.
                # 어떤 id가 환각이었는지는 개수로만 남는다 (선례가 감수한 트레이드오프).
                dropped_ids=(),
                total_count=len(seen),
                dropped_count=len(dropped),
            )
            if dropped
            else None
        )
        return GateOutcome(value=selected, drop_event=drop_event, error=None)
