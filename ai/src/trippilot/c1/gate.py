"""파이프라인 5·6단 — 스키마 파서 + ClosedSetGate (U4 FD §1 gate.py).

raw_text → RawScore들(파서) → 풀 교차(INV-1) → (ScoredPoi들, GateDropEvent?).
검증 전 데이터가 도메인 타입이 되는 것을 RawScore/GateOutcome 경계로 차단한다
(FD domain-entities §4). 파싱 실패·전량 드롭의 폴백 전환은 게이트웨이 몫.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from trippilot.domain.common import GeoPoint, PoiId, TraceId
from trippilot.domain.llm import (
    CandidatePool,
    LlmFeature,
    Mood,
    PoiExplanation,
    ReflectionDraft,
    ScoredPoi,
)
from trippilot.domain.observability import GateDropEvent
from trippilot.domain.poi import ExtractedPlace


@dataclass(frozen=True, slots=True)
class GateOutcome:
    """파서+게이트의 단일 결과. error가 있으면 value는 비어 있다.

    value의 실체는 feature별 게이트가 정의 (scoring=tuple[ScoredPoi,...],
    explanation=tuple[PoiExplanation,...], reflection=ReflectionDraft, …).
    - value 거짓값 + error 없음 = 전량 드롭/무결과 (게이트웨이가 폴백 전환)
    - drop_event는 드롭이 1건이라도 있을 때만 (부분 생존 포함)
    """

    value: object
    drop_event: GateDropEvent | None
    error: str | None

    def __post_init__(self) -> None:
        if self.error is not None and self.value:
            raise ValueError("error가 있으면 value는 비어야 함 (검증 실패 = 결과 없음)")


class ExitGate(Protocol):
    def apply(
        self,
        raw_text: str,
        pool: CandidatePool | None,
        *,
        feature: LlmFeature,
        trace_id: TraceId,
        now: datetime,
    ) -> GateOutcome: ...


@dataclass(frozen=True, slots=True)
class RawScore:
    """LLM raw JSON의 중간 표현 — c1 내부 타입, 도메인 아님 (FD domain-entities §4).

    게이트 통과 후에만 ScoredPoi로 승격. reason은 표시용 원문 보존
    (현 도메인 ScoredPoi에는 없음 — 승격 시 버려진다).
    """

    poi_id_str: str
    score: float
    reason: str


def _parse_scores(raw_text: str) -> tuple[RawScore, ...]:
    """OutputSchema(ai-prompt-design §2.1) 강제 파서 — 위반은 ValueError.

    {"scores": [{"poiId": str, "score": number, "reason": str}]}
    poiId(비어있지 않은 str)·score(유한 number)는 필수, reason 누락은 ""로 허용.
    score의 0.0~1.0 클램프는 승격 시(§3) — 파서는 형태만 본다.
    """
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 아님: {e.msg}") from e
    if not isinstance(data, dict) or not isinstance(data.get("scores"), list):
        raise ValueError('최상위가 {"scores": [...]} 형태가 아님')
    raws: list[RawScore] = []
    for i, item in enumerate(data["scores"]):
        if not isinstance(item, dict):
            raise ValueError(f"scores[{i}]가 객체가 아님")
        poi_id = item.get("poiId")
        score = item.get("score")
        if not isinstance(poi_id, str) or not poi_id:
            raise ValueError(f"scores[{i}].poiId가 비어있지 않은 문자열이 아님")
        if isinstance(score, bool) or not isinstance(score, (int, float)):
            raise ValueError(f"scores[{i}].score가 숫자가 아님")
        if not math.isfinite(score):
            raise ValueError(f"scores[{i}].score가 유한하지 않음")
        reason = item.get("reason", "")
        if not isinstance(reason, str):
            raise ValueError(f"scores[{i}].reason이 문자열이 아님")
        raws.append(RawScore(poi_id_str=poi_id, score=float(score), reason=reason))
    return tuple(raws)


class ClosedSetGate:
    """closed-set 출구 게이트 — 4겹 제한 장치의 4겹 (INV-1, BR-U4-01).

    파서 통과분을 풀과 교차: 풀 밖 poi_id 드롭 + GateDropEvent 재료화.
    중복 poiId는 첫 등장만 채택 (결정론). 드롭/생존 판정은 pool.contains O(1).
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
        if pool is None:
            # 풀 없이 게이트를 통과시킬 수 없다 — 조용한 통과 대신 폴백 신호 (INV-1)
            return GateOutcome(value=(), drop_event=None, error="gate_error: 후보 풀 없음")
        try:
            raws = _parse_scores(raw_text)
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        seen: set[str] = set()
        survivors: list[ScoredPoi] = []
        dropped: list[PoiId] = []
        for rs in raws:
            if rs.poi_id_str in seen:
                continue  # 중복 — 첫 등장 채택 (드롭 계수에 미포함)
            seen.add(rs.poi_id_str)
            poi_id = PoiId(rs.poi_id_str)
            if pool.contains(poi_id):
                survivors.append(
                    ScoredPoi(
                        poi_id=poi_id,
                        score=min(1.0, max(0.0, rs.score)),  # 0.0~1.0 클램프 (§3)
                        is_llm_score=True,
                    )
                )
            else:
                dropped.append(poi_id)

        drop_event = (
            GateDropEvent(
                trace_id=trace_id,
                occurred_at=now,
                component="c1.gate",
                feature=feature.value,
                dropped_ids=tuple(dropped),
                total_count=len(seen),
                dropped_count=len(dropped),
            )
            if dropped
            else None
        )
        return GateOutcome(value=tuple(survivors), drop_event=drop_event, error=None)


def _load_json_object(raw_text: str, root_key: str) -> object:
    """공통: JSON 로드 + 최상위 {root_key: ...} 강제. 위반은 ValueError."""
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 아님: {e.msg}") from e
    if not isinstance(data, dict) or root_key not in data:
        raise ValueError(f'최상위가 {{"{root_key}": ...}} 형태가 아님')
    return data[root_key]


class ExplanationGate:
    """EXPLANATION 출구 게이트 (정본 §2.2) — poiId ⊆ 풀 교차 (INV-1).

    {"explanations": [{"poiId": str, "text": str}]} 강제. 중복 첫 등장 채택.
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
        if pool is None:
            return GateOutcome(value=(), drop_event=None, error="gate_error: 후보 풀 없음")
        try:
            items = _load_json_object(raw_text, "explanations")
            if not isinstance(items, list):
                raise ValueError("explanations가 배열이 아님")
            parsed: list[tuple[str, str]] = []
            for i, item in enumerate(items):
                if not isinstance(item, dict):
                    raise ValueError(f"explanations[{i}]가 객체가 아님")
                poi_id, text = item.get("poiId"), item.get("text")
                if not isinstance(poi_id, str) or not poi_id:
                    raise ValueError(f"explanations[{i}].poiId 비정상")
                if not isinstance(text, str) or not text.strip():
                    raise ValueError(f"explanations[{i}].text 비정상")
                parsed.append((poi_id, text))
        except ValueError as e:
            return GateOutcome(value=(), drop_event=None, error=f"parse_error: {e}")

        seen: set[str] = set()
        survivors: list[PoiExplanation] = []
        dropped: list[PoiId] = []
        for pid_str, text in parsed:
            if pid_str in seen:
                continue
            seen.add(pid_str)
            pid = PoiId(pid_str)
            if pool.contains(pid):
                survivors.append(PoiExplanation(poi_id=pid, text=text))
            else:
                dropped.append(pid)
        drop_event = (
            GateDropEvent(
                trace_id=trace_id, occurred_at=now, component="c1.gate",
                feature=feature.value, dropped_ids=tuple(dropped),
                total_count=len(seen), dropped_count=len(dropped),
            )
            if dropped else None
        )
        return GateOutcome(value=tuple(survivors), drop_event=drop_event, error=None)


class ReflectionGate:
    """REFLECTION 출구 게이트 (정본 §2.3) — 스키마만 강제 (poi 선택 없음, 풀 불필요).

    {"title": str, "body": str, "highlights": [str], "mood": GREAT|GOOD|OKAY|TIRED}
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
            data = json.loads(raw_text)
        except json.JSONDecodeError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: JSON 아님: {e.msg}")
        try:
            if not isinstance(data, dict):
                raise ValueError("최상위가 객체가 아님")
            title, body = data.get("title"), data.get("body")
            highlights, mood = data.get("highlights"), data.get("mood")
            if not isinstance(title, str) or not title.strip():
                raise ValueError("title 비정상")
            if not isinstance(body, str) or not body.strip():
                raise ValueError("body 비정상")
            if not isinstance(highlights, list) or not all(
                isinstance(h, str) for h in highlights
            ):
                raise ValueError("highlights 비정상")
            try:
                mood_enum = Mood(mood)
            except ValueError:
                raise ValueError(f"mood가 enum 밖: {mood!r}") from None
        except ValueError as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")
        draft = ReflectionDraft(
            title=title, body=body, highlights=tuple(highlights), mood=mood_enum
        )
        return GateOutcome(value=draft, drop_event=None, error=None)


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
        dropped: list[PoiId] = []
        for i, item in enumerate(items):
            place = self._to_place(item)
            if place is None:
                name = item.get("name") if isinstance(item, dict) else None
                dropped.append(PoiId(name if isinstance(name, str) and name else f"item[{i}]"))
            else:
                survivors.append(place)
        drop_event = (
            GateDropEvent(
                trace_id=trace_id, occurred_at=now, component="c1.gate",
                feature=feature.value, dropped_ids=tuple(dropped),
                total_count=len(items), dropped_count=len(dropped),
            )
            if dropped else None
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
            try:
                coord = GeoPoint(lat=coord_raw["lat"], lng=coord_raw["lng"])
            except (KeyError, TypeError, ValueError):
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
