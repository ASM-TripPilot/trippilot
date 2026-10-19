"""Plan-B 기회 경계(`POST /ai/v1/planb/opportunities`) ↔ 판정 사영 (situation-awareness BR-SA-22 · DEC-SA-6).

LLM 0회. 재료 둘을 모아 `orchestrator/opportunity.find_opportunities` 에 넘기고 와이어로 싼다.

- 행사: 생성 요구표의 EVENT 행(`InfoCollector.collect(GENERATE_SCHEDULE, only={EVENT})`) — 같은 Provider·같은
  상태값을 소비만 한다. 새 Intent 를 만들지 않는다(Intent 는 도우미 라우터의 닫힌 라벨이라 늘리면 그쪽 표가 움직인다).
  기준점은 슬롯 중심 — 하루 동선 폭이 80km 를 넘으면 Provider 의 40km 1차 필터에 먼 끝 행사가 빠질 수 있다(수용).
- 장소: 남은 슬롯마다 `poi_db.find_by_radius(슬롯, 1km)` — 요청 순서대로 최대 8회, 시한의 70% 안에서.
- 슬롯의 장소와 `planned_poi_ids` 는 이미 일정에 있는 곳이라 카드에서 뺀다.

실패는 notes 로 말한다(INV-4 — 침묵 금지, 무발화의 관측은 WARN 한 줄):
행사 미배선·실패 → 요즘 인기만 · 장소 조회 실패 → 빈 목록 · 시한 초과·슬롯 상한 → 부분 결과 ·
예산 안에서 시작한 조회가 예산을 넘겨 끝남 → 결과는 그대로(`poi_lookup_late`).
`wiring.py` 는 경합 1위 파일이라 여기 둔다 — 거기엔 import 1줄과 위임 메서드만 있다.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Sequence
from datetime import date, datetime, tzinfo

from trippilot.api import schemas
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.event import EventInfo
from trippilot.domain.freshness import ProviderKind, ProviderStatus
from trippilot.domain.intent import Intent
from trippilot.domain.poi import Poi
from trippilot.orchestrator.info_collector import InfoCollector
from trippilot.orchestrator.opportunity import NEAR_KM, Opportunity, find_opportunities
from trippilot.providers.transit import _format_distance_range

MAX_LOOKUPS = 8      # 반경 조회(백엔드 왕복) 상한 — 백엔드도 남은 슬롯을 8개까지만 보낸다
BUDGET_SHARE = 0.7   # 시한 중 재료 수집에 쓰는 몫 — 나머지는 판정·직렬화·왕복 여유

_log = logging.getLogger(__name__)


def find(
    info: InfoCollector,
    poi_db: object,
    request: schemas.OpportunitiesRequest,
    tz: tzinfo,
    *,
    monotonic: Callable[[], float] = time.monotonic,
) -> schemas.OpportunitiesResponse:
    started = monotonic()
    meta = request.request_meta
    now = meta.requested_at if meta.requested_at.tzinfo is not None else meta.requested_at.replace(tzinfo=tz)
    slots = tuple((s.slot_key, GeoPoint(s.coord.lat, s.coord.lng)) for s in request.slots)
    notes: list[str] = []

    events = _events(info, request.date, slots, now, notes)
    budget_s = None if meta.deadline_ms is None else meta.deadline_ms * BUDGET_SHARE / 1000
    pois = _pois(poi_db, slots, lambda: budget_s is not None and monotonic() - started >= budget_s, notes)
    planned = {PoiId(p) for p in request.planned_poi_ids} | {PoiId(s.poi_id) for s in request.slots}
    found = () if pois is None else find_opportunities(request.date, slots, events, pois, planned)

    if notes:
        _log.warning("planb_opportunities request_id=%s notes=%s", meta.request_id, notes)
    return schemas.OpportunitiesResponse(opportunities=[_wire(o) for o in found], notes=notes)


def _events(info: InfoCollector, day: date, slots: Sequence[tuple[str, GeoPoint]], now: datetime,
            notes: list[str]) -> tuple[EventInfo, ...]:
    anchor = GeoPoint(sum(c.lat for _, c in slots) / len(slots), sum(c.lng for _, c in slots) / len(slots))
    packet = info.collect(Intent.GENERATE_SCHEDULE, {"anchor": anchor, "days": (day,), "now": now},
                          only=frozenset({ProviderKind.EVENT})).get(ProviderKind.EVENT)
    if packet is None:  # 행사 저장소 미배선 = 기능 부재
        notes.append("events_unwired")
        return ()
    if packet.status not in (ProviderStatus.OK, ProviderStatus.LOW):
        notes.append(f"events_unavailable: {packet.data.get('reason', packet.status.value)}")
        return ()
    if packet.status is ProviderStatus.LOW:
        notes.append("events_low")  # 저장소 절단 — 받은 만큼은 쓴다
    try:
        return tuple(EventInfo.from_dict(e) for e in packet.data.get("events", ()))
    except Exception as e:  # 패킷 형식 오류 — 비가용과 같게 다룬다
        notes.append(f"events_unavailable: {type(e).__name__}")
        return ()


def _pois(poi_db: object, slots: Sequence[tuple[str, GeoPoint]], over_budget: Callable[[], bool],
          notes: list[str]) -> tuple[Poi, ...] | None:
    """슬롯 1km 안 등록 POI — 조회가 한 번이라도 실패하면 None(빈 목록 + 노트)."""
    found: dict[PoiId, Poi] = {}
    for _, center in slots[:MAX_LOOKUPS]:
        if over_budget():
            notes.append("poi_lookup_partial: deadline")
            return tuple(found.values())
        try:
            for poi in poi_db.find_by_radius(center, NEAR_KM):  # type: ignore[attr-defined]
                found.setdefault(poi.poi_id, poi)
        except Exception as e:  # 백엔드 장애 — 일부만 본 카드는 내지 않는다
            notes.append(f"poi_lookup_unavailable: {type(e).__name__}")
            return None
    if over_budget():  # 진행 중인 조회는 끊지 못한다 — 백엔드 읽기 상한을 넘겼을 수 있음을 이쪽에도 남긴다
        notes.append("poi_lookup_late")
    if len(slots) > MAX_LOOKUPS:
        notes.append("poi_lookup_partial: slot_cap")
    return tuple(found.values())


def _wire(o: Opportunity) -> schemas.OpportunitySchema:
    """기간은 일 단위만(INV-2), 거리는 기존 표시 문자열 하나로(INV-3 — 직선거리, 소요시간 없음).

    1km 미만은 100m 단위로 반올림해 넘긴다(D6) — '약 437m' 같은 가짜 정밀도와, 슬롯과 같은 좌표의
    '동선에서 약 0m' 을 막는다(최소 100m). 1km 가까이는 기존 함수가 '약 1.0km' 로 쓴다.
    """
    km = max(round(o.distance_km, 1), 0.1)
    return schemas.OpportunitySchema(
        key=o.key,
        kind=o.kind.value,
        event_name=o.event.name if o.event is not None else None,
        start=o.event.start if o.event is not None else None,
        end=o.event.end if o.event is not None else None,
        poi_id=str(o.poi.poi_id),
        poi_name=o.poi.name,
        near_slot_key=o.near_slot_key,
        distance_label=_format_distance_range((km, km)),
    )
