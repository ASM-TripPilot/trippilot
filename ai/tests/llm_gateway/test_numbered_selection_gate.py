"""다시 짜기 구성(REPLAN_COMPOSITION) — 후보를 UUID 대신 번호로 싣고, 게이트가 번호를 poi_id 로 되돌린다.

출력 글자의 36%가 후보 UUID 를 그대로 베끼는 것이었다(캡처 16건, 출력 ~650토큰·7.4s — 2026-10-21,
`ai/docs/서빙-최적화-실적.md` §8). 번호 → poi_id 는 같은 풀을 같은 순서(poi_id 정렬)로 세면 다시 만들어지므로
상태가 없다. 나머지 검사(풀 안·중복·이유의 시간 표현)는 `AlternativeSelectionGate` 그대로다.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from trippilot.domain.common import GeoPoint, PoiId, TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.llm_gateway.gates.numbered_selection import NumberedSelectionGate, numbered

_NOW = datetime(2026, 10, 21, tzinfo=timezone.utc)
_IDS = ("c-uuid-3", "a-uuid-1", "b-uuid-2")  # 정렬하면 a, b, c


def _pool() -> CandidatePool:
    pois = tuple(Poi(PoiId(i), i, PoiCategory.SIGHT, GeoPoint(33.5, 126.5), (), None, None,
                     DataQuality.FULL, PoiSource.SEED, None) for i in _IDS)
    return CandidatePool(poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=_NOW)


def _apply(selections: list[dict]):
    return NumberedSelectionGate().apply(json.dumps({"selections": selections}, ensure_ascii=False), _pool(),
                                         feature=LlmFeature.REPLAN_COMPOSITION, trace_id=TraceId("t"), now=_NOW)


def test_번호는_poi_id_정렬_순서다() -> None:
    assert [str(p.poi_id) for p in numbered(_pool())] == ["a-uuid-1", "b-uuid-2", "c-uuid-3"]


def test_번호를_poi_id_로_되돌리고_고른_순서와_이유는_그대로() -> None:
    out = _apply([{"no": 3, "reason": "바다가 보인다"}, {"no": "1", "reason": "조용한 정원"}])
    assert out.error is None
    assert [(str(p.poi_id), p.reason) for p in out.value] == [("c-uuid-3", "바다가 보인다"), ("a-uuid-1", "조용한 정원")]


def test_목록_밖_번호는_그것만_버린다() -> None:
    out = _apply([{"no": 9, "reason": "x"}, {"no": True, "reason": "y"}, {"no": 2, "reason": "z"}])
    assert [str(p.poi_id) for p in out.value] == ["b-uuid-2"]
    assert out.drop_event is not None and out.drop_event.dropped_count == 2


def test_poi_id_로_답해도_통과한다() -> None:
    """옛 판(0.6.0)·테스트 가짜는 poiId 로 답한다 — 같은 게이트가 받는다."""
    out = _apply([{"poiId": "b-uuid-2", "reason": "z"}])
    assert [str(p.poi_id) for p in out.value] == ["b-uuid-2"]


def test_모양이_틀리면_종전과_같은_파싱_실패() -> None:
    out = NumberedSelectionGate().apply("not json", _pool(), feature=LlmFeature.REPLAN_COMPOSITION,
                                        trace_id=TraceId("t"), now=_NOW)
    assert out.value == () and out.error.startswith("parse_error")
