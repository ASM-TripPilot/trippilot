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

import re
from typing import Callable

from trippilot.domain.event import EventInfo
from trippilot.domain.serialization import to_iso

# 이름 정규화 — 실측 변형 중복(2026-08-21: "세종한글축제"/"2026 세종한글축제",
# "감악산 꽃별여행"/"제6회 …", 「」 괄호, 후행 "공연" 등)을 흡수한다.
_YEAR_RE = re.compile(r"20\d{2}년?")
_NTH_RE = re.compile(r"제?\s*\d+\s*회")
_PUNCT_RE = re.compile(r"[^\w가-힣]")  # 괄호·하이픈·특수기호 전부 제거
_GENERIC_SUFFIXES = ("공연", "전시", "행사")  # 후행 장르어 — "축제"는 이름의 일부인 경우가 많아 제외


def normalize_name(name: str) -> str:
    text = _NTH_RE.sub("", _YEAR_RE.sub("", name))
    text = _PUNCT_RE.sub("", text)
    for suffix in _GENERIC_SUFFIXES:
        if text.endswith(suffix) and len(text) > len(suffix) + 2:
            text = text[: -len(suffix)]
    return text


def _dedup_key(event: EventInfo) -> tuple[str, str, str]:
    """정규화 이름+기간 — 여러 출처·표기 변형이 같은 축제를 보도해도 1건만."""
    return (normalize_name(event.name), event.start.isoformat(),
            event.end.isoformat())


def _same_event(key_a: tuple[str, str, str], key_b: tuple[str, str, str]) -> bool:
    """같은 기간 + 이름 동일 또는 **포함**("한화와 함께하는 서울세계불꽃축제" ⊃
    "서울세계불꽃축제") — 포함 판정은 오탐 방지로 6자 이상일 때만."""
    if key_a[1:] != key_b[1:]:
        return False
    na, nb = key_a[0], key_b[0]
    if na == nb:
        return True
    shorter = min(na, nb, key=len)
    return len(shorter) >= 6 and (shorter in na and shorter in nb)


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
    ) -> tuple[int, int]:
        """dedup 등록 + 좌표 백필 + 커버리지 갱신 — (신규, 좌표백필) 건수 반환.

        "기존 레코드 우선"은 재수집이 덮어쓰지 않게 하려는 규칙인데, 그게 **새로
        얻은 좌표까지 버리고 있었다**. 2026-08-25 실측: 그날 지오코딩 57건 중 19건이
        성공했는데 저장소 좌표는 **한 건도 늘지 않았다**(신규 10건 전부 coord=None).
        중복분이 통째로 skip 되면서 좌표만 딸려 사라진 것이다.

        좌표 없는 행사는 근접 POI 부착에서 제외되므로(`event_affinity.py`) 이건
        "수집은 됐는데 쓰이지 않는" 상태다. 그래서 중복이어도 **기존이 비어 있고
        새 것에 좌표가 있으면 그 칸만 채운다.** 기존 좌표는 절대 덮지 않는다 —
        덮으면 재수집이 값을 흔드는 원래 문제로 돌아간다.
        """
        index: dict[tuple[str, str, str], dict] = {}
        for record in self._doc["events"]:
            index[_dedup_key(EventInfo.from_dict(record))] = record
        added = backfilled = 0
        for event in events:
            key = _dedup_key(event)
            match = next((r for k, r in index.items() if _same_event(key, k)), None)
            if match is not None:
                if match.get("coord") is None and event.coord is not None:
                    match["coord"] = event.to_dict()["coord"]
                    backfilled += 1
                continue
            record = {**event.to_dict(), "region": region, "collected_at": to_iso(now)}
            index[key] = record
            self._doc["events"].append(record)
            added += 1
        self._doc["coverage"][region] = to_iso(now)
        return added, backfilled

    def purge_expired(self, today: date) -> int:
        """종료 + 유예일 지난 행사 물리 삭제 — 삭제 건수 반환."""
        cutoff = today - timedelta(days=self.EXPIRE_GRACE_DAYS)
        before = len(self._doc["events"])
        self._doc["events"] = [
            r for r in self._doc["events"]
            if date.fromisoformat(r["end"]) >= cutoff
        ]
        return before - len(self._doc["events"])

    def sanitize(
        self,
        *,
        drop_event: Callable[[str, EventInfo], bool],
        coord_ok: Callable[[str, "object"], bool],
    ) -> dict:
        """기존 레코드 소급 정리 (규칙은 호출측 주입 — 저장소는 판단 규칙을 모른다).

        ① drop_event=True인 레코드 삭제 (저품질 이름 등)
        ② coord_ok=False인 좌표 제거 — 행사는 유지 (오매칭 좌표만, TRIP-421 실측)
        ③ 변형 중복 제거 — 강화된 dedup 규칙을 기존 건에 재적용 (선입 우선)
        반환: {"dropped": n, "coord_cleared": n, "deduped": n}
        """
        result = {"dropped": 0, "coord_cleared": 0, "deduped": 0}
        kept: list[dict] = []
        kept_keys: list[tuple[str, str, str]] = []
        for record in self._doc["events"]:
            event = EventInfo.from_dict(record)
            if drop_event(record.get("region", ""), event):
                result["dropped"] += 1
                continue
            key = _dedup_key(event)
            if any(_same_event(key, k) for k in kept_keys):
                result["deduped"] += 1
                continue
            if event.coord is not None and not coord_ok(record.get("region", ""),
                                                       event.coord):
                record = {**record, "coord": None}
                result["coord_cleared"] += 1
            kept_keys.append(key)
            kept.append(record)
        self._doc["events"] = kept
        return result

    def counts(self) -> dict:
        return {"events": len(self._doc["events"]),
                "regions_covered": len(self._doc["coverage"])}

    def save(self) -> None:
        self._path.write_text(
            json.dumps(self._doc, ensure_ascii=False, indent=1), encoding="utf-8"
        )
