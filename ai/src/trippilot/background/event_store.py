"""JsonEventStore — 행사 저장소 (파일 1개 = 정본 문서, TRIP-421).

새벽 배치(collect_events.py)가 쓰고, 실시간 EventProvider가 EventPort로 읽는다.
문서는 collect-state 전용 브랜치에 영속된다 (POI 수집 상태 TRIP-348 선례).

문서 형태 (JSON-safe):
{
  "events":   [EventInfo.to_dict() + {"region": str, "collected_at": iso}],
  "coverage": {지역명: 마지막 수집 iso 시각},   ← 부족 신호("없음 vs 안 긁음") 구분 근거
  "pointer":  int                              ← 지역 로테이션 시작 위치 (이월)
}

만료 탈락 2겹의 두 번째 겹: 조회(날짜 겹침 필터)가 첫 겹이고, 여기 purge가
종료 +N일 지난 레코드를 물리 삭제한다 (창고 비대 방지). 행사는 POI가 아니라서
"의미 없는 POI로 남는" 문제 자체가 없다 — 삭제는 청소일 뿐이다.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable

from trippilot.domain.event import EventInfo
from trippilot.domain.serialization import to_iso


def _dedup_key(event: EventInfo) -> tuple[str, str, str]:
    """이름(공백 제거)+기간 — 여러 출처가 같은 축제를 보도해도 1건만."""
    return ("".join(event.name.split()), event.start.isoformat(),
            event.end.isoformat())


class JsonEventStore:
    """행사 문서 저장소 — EventPort 구현(search_events) + 배치 쓰기 API."""

    EXPIRE_GRACE_DAYS = 7  # 종료 후 이 일수가 지나면 물리 삭제

    def __init__(self, path: Path) -> None:
        self._path = path
        self._doc: dict = {"events": [], "coverage": {}, "pointer": 0}
        if path.exists():
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and isinstance(loaded.get("events"), list):
                self._doc = {"events": loaded["events"],
                             "coverage": dict(loaded.get("coverage", {})),
                             "pointer": int(loaded.get("pointer", 0))}

    # ── EventPort (실시간 읽기) ──────────────────────────────────────

    def search_events(
        self, start: date, end: date
    ) -> tuple[tuple[EventInfo, ...], bool]:
        """기간과 겹치는 행사들 → (목록, truncated=False — 파일 전체 조회라 절단 없음)."""
        found = []
        for record in self._doc["events"]:
            event = EventInfo.from_dict(record)
            if event.start <= end and start <= event.end:  # 폐구간 교차
                found.append(event)
        return tuple(found), False

    # ── 배치 쓰기 (collect_events.py 전용) ───────────────────────────

    @property
    def pointer(self) -> int:
        return self._doc["pointer"]

    @pointer.setter
    def pointer(self, value: int) -> None:
        self._doc["pointer"] = value

    def coverage(self, region: str) -> str | None:
        return self._doc["coverage"].get(region)

    def upsert(
        self, region: str, events: Iterable[EventInfo], now: datetime
    ) -> int:
        """dedup 등록 + 커버리지 갱신 — 신규 건수 반환. 기존 레코드 우선(재수집 무해)."""
        seen = {_dedup_key(EventInfo.from_dict(r)) for r in self._doc["events"]}
        added = 0
        for event in events:
            key = _dedup_key(event)
            if key in seen:
                continue
            seen.add(key)
            self._doc["events"].append(
                {**event.to_dict(), "region": region, "collected_at": to_iso(now)}
            )
            added += 1
        self._doc["coverage"][region] = to_iso(now)
        return added

    def purge_expired(self, today: date) -> int:
        """종료 + 유예일 지난 행사 물리 삭제 — 삭제 건수 반환."""
        cutoff = today - timedelta(days=self.EXPIRE_GRACE_DAYS)
        before = len(self._doc["events"])
        self._doc["events"] = [
            r for r in self._doc["events"]
            if date.fromisoformat(r["end"]) >= cutoff
        ]
        return before - len(self._doc["events"])

    def counts(self) -> dict:
        return {"events": len(self._doc["events"]),
                "regions_covered": len(self._doc["coverage"])}

    def save(self) -> None:
        self._path.write_text(
            json.dumps(self._doc, ensure_ascii=False, indent=1), encoding="utf-8"
        )
