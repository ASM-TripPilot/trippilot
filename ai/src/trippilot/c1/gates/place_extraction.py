"""PLACE_EXTRACTION 출구 게이트 (정본 §2.5) — 항목 단위 격리."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from trippilot.c1.gates.base import GateOutcome, _load_json_object
from trippilot.domain.common import GeoPoint, PoiId, TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature
from trippilot.domain.observability import GateDropEvent
from trippilot.domain.poi import ExtractedPlace


class PlaceExtractionGate:
    """PLACE_EXTRACTION 출구 게이트 (정본 §2.5) — 항목 단위 격리.

    스키마 위반 항목은 전체 실패가 아니라 해당 항목만 격리(드롭)한다
    ("추출 실패/저품질 → 해당 POI 격리, 생성은 정상 진행"). 좌표는 범위
    검증(GeoPoint) 실패 시 격리 — 임의 생성 금지 가드의 코드 측 방어.
    수집 게이트(5단, U6 sourcing) 통과 전에는 후보가 되지 않는다 (INV-1).
    """

    def apply(
        self,
        raw_text: str,
        pool: CandidatePool | None,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome:
        try:
            items = _load_json_object(raw_text, "places")
            if not isinstance(items, list):
                raise ValueError("places가 배열이 아님")
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        survivors: list[ExtractedPlace] = []
        dropped_count = 0
        for item in items:
            place = self._to_place(item)
            if place is None:
                dropped_count += 1  # 카운트만 — 장소명을 유사 PoiId로 지표에 넣지 않는다 (TRIP-260 #3)
            else:
                survivors.append(place)
        drop_event = (
            GateDropEvent(
                trace_id=trace_id, occurred_at=now, component="c1.gate",
                feature=feature.value, dropped_ids=(),  # 추출 드롭은 풀 ID가 아님 — 환각률 지표 순수성
                total_count=len(items), dropped_count=dropped_count,
            )
            if dropped_count else None
        )
        return GateOutcome(value=tuple(survivors), drop_event=drop_event, error=None)

    @staticmethod
    def _to_place(item: object) -> ExtractedPlace | None:
        if not isinstance(item, dict):
            return None
        name, source_url = item.get("name"), item.get("sourceUrl")
        confidence = item.get("confidence")
        if not isinstance(name, str) or not name.strip():
            return None
        if not isinstance(source_url, str) or not source_url:
            return None
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not math.isfinite(confidence)
        ):
            return None
        coord_raw = item.get("coord")
        coord: GeoPoint | None = None
        if coord_raw is not None:
            if not isinstance(coord_raw, dict):
                return None
            lat, lng = coord_raw.get("lat"), coord_raw.get("lng")
            if isinstance(lat, bool) or isinstance(lng, bool):
                return None  # bool ⊂ int라 범위 검사를 통과함 — 명시 격리 (TRIP-260 #1)
            try:
                coord = GeoPoint(lat=lat, lng=lng)
            except (TypeError, ValueError):
                return None  # 범위 밖/형식 오류 좌표 = 격리 (임의 생성 방어)
        address, hours, category = item.get("address"), item.get("hours"), item.get("category")
        if not all(v is None or isinstance(v, str) for v in (address, hours, category)):
            return None
        return ExtractedPlace(
            name=name, address=address, coord=coord, hours=hours,
            category_raw=category,
            confidence=min(1.0, max(0.0, float(confidence))),
            source_url=source_url,
        )
