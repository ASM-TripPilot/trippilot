"""/edit 풀 밖 이름 장소(F9) — 경계 관통 (실 LLM·DB·네트워크 0: FakeLlm + StaticPoiDb 서울 좌표 + 가짜 장소 DB 연결).

"효창공원을 경리단길 끝나고 넣어줘" — 그곳이 기본 풀(반경·5,000곳 절단) 밖이면 번역 후보에도 INV-1 풀에도 없어 게이트가 명령을 버렸다
(TRANSLATION_FAILED). 장소 DB(`poi_public`)가 배선돼 있으면 경계가 이름으로 찾아 정본 좌표·영업시간을 받고, 풀과 같은 자격·여행지 50km 로
거른 등록 POI 를 번역 후보와 같은 풀에 합친다. 기본 풀 밖으로 만드는 방법은 앵커를 그곳에서 10km 넘게(대중교통 반경 밖) 두는 것이다.

가짜 장소 DB(`tests/fakes/fake_place_db.py`)는 `_SAID_SQL` 의 문자열 함수를 그대로 옮긴 것이다 — 고르는 코드(`said_matches`)를 되쓰지
않는다(거울이 실물과 같아야 한다).
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from tests.fakes.fake_llm import FakeLlm
from tests.fakes.fake_place_db import FakePlaceDb
from trippilot.api.wiring import StaticPoiDb, build_dev_app
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.poi_curation.adapters.pg_place_sql import PgPlaceSql

_DAY = "2026-10-21"


def _poi(n: int, name: str, cat: PoiCategory, lat: float, lng: float, quality=DataQuality.FULL) -> Poi:
    return Poi(PoiId(f"00000000-0000-4000-8000-{n:012d}"), name, cat, GeoPoint(lat, lng), (), None, None, quality,
               PoiSource.SEED, None)


GYEONGBOK = _poi(1, "경복궁", PoiCategory.SIGHT, 37.5796, 126.9770)
GYEONGNI = _poi(2, "경리단길", PoiCategory.SIGHT, 37.5385, 126.9888)
YEONNAM = _poi(3, "연남동 경의선숲길", PoiCategory.NATURE, 37.5600, 126.9230)
HYOCHANG = _poi(10, "효창공원", PoiCategory.NATURE, 37.5446, 126.9616)
SEOUL_HYOCHANG = _poi(11, "서울 효창공원", PoiCategory.NATURE, 37.5446, 126.9616)  # 지역 접두로 등록된 이름
ONION_YN = _poi(20, "어니언 연남점", PoiCategory.CAFE, 37.5600, 126.9230)  # 지점 — 둘 다 앵커에서 10km 넘게(풀 밖)
ONION_AG = _poi(21, "어니언 안국점", PoiCategory.CAFE, 37.5772, 126.9862)
BUSAN_HYOCHANG = _poi(30, "효창공원", PoiCategory.FOOD, 35.1577, 129.0596)  # 같은 이름 — 여행지 50km 밖
BARE_HYOCHANG = _poi(31, "효창공원", PoiCategory.NATURE, 37.5446, 126.9616, quality=DataQuality.MINIMAL)  # 풀 자격 밖
_JAMSIL = (37.5133, 127.1001)  # 앵커 — 효창공원에서 12.7km(대중교통 반경 10km 밖)

_SLOTS = [{"poi_id": str(p.poi_id), "start_at": s, "end_at": e, "ends_next_day": False, "distance_range": None,
           "is_fixed": False}
          for p, s, e in ((GYEONGBOK, "09:00:00", "10:00:00"), (GYEONGNI, "11:00:00", "12:30:00"),
                          (YEONNAM, "15:00:00", "16:30:00"))]


def _db_row(p: Poi, category: str, sido: str, sigungu: str) -> tuple:
    return (str(p.poi_id), p.name, category, sido, sigungu, [], True)


_CANNED = json.dumps({"editCommand": {"op": "ADD_SLOT", "params": {"targetPoiId": str(HYOCHANG.poi_id),
                                                                   "afterPoiId": str(GYEONGNI.poi_id)},
                                      "affectedSlots": []}})


def _post(utterance: str, seed: tuple[Poi, ...], db: FakePlaceDb | None, canned: str = _CANNED) -> dict:
    app = build_dev_app(poi_db=StaticPoiDb((GYEONGBOK, GYEONGNI, YEONNAM, *seed)), llm=FakeLlm(canned=canned),
                        model_id="m-fake", place_sql=PgPlaceSql(db) if db is not None else None)
    body = {
        "trip_id": "trip-named", "target_date": _DAY,
        "itinerary": {"days": [{"date": _DAY, "slots": _SLOTS}], "day1_ready_at": None, "explanations": {},
                      "solve_mode": "OR_TOOLS", "is_fallback": False, "freshness": None, "candidates_summary": None},
        "anchor": {"lat": _JAMSIL[0], "lng": _JAMSIL[1]}, "transport_mode": "대중교통", "confirm": True,
        "request_meta": {"request_id": "named-1", "requested_at": "2026-10-20T20:00:00+09:00"},
        "utterance": utterance,
    }
    with TestClient(app, raise_server_exceptions=False) as client:
        res = client.post("/ai/v1/itinerary/edit", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _ids(body: dict) -> list[str]:
    return [s["poi_id"] for s in body["itinerary"]["days"][0]["slots"]]


def _add(p: Poi) -> str:
    return _CANNED.replace(str(HYOCHANG.poi_id), str(p.poi_id))


# ── 풀 밖 이름 장소가 번역 후보·INV-1 풀에 든다 ─────────────────────────────────


def test_named_place_outside_the_pool_is_added_in_place() -> None:
    db = FakePlaceDb([_db_row(HYOCHANG, "자연", "서울특별시", "용산구")])
    body = _post("효창공원을 경리단길 끝나고 넣어줘", (HYOCHANG,), db)
    assert body["status"] == "APPLIED", body
    assert _ids(body) == [str(p.poi_id) for p in (GYEONGBOK, GYEONGNI, HYOCHANG, YEONNAM)]
    slots = body["itinerary"]["days"][0]["slots"]
    assert slots[3]["start_at"] >= "15:00:00"  # 기준점 있는 추가 — 뒤를 앞당기지 않는다(종전 규칙)
    assert slots[2]["distance_range"] is not None  # 응답 거리도 같은 좌표로 잰다
    assert "효창공원" in db.queries[0]["words"] and "경리단길" not in db.queries[0]["words"]


def test_without_the_place_db_the_closed_set_still_rejects() -> None:
    """장소 DB 미배선 — 종전 그대로(게이트가 풀 밖 id 를 버린다)."""
    body = _post("효창공원을 경리단길 끝나고 넣어줘", (HYOCHANG,), None)
    assert body["status"] == "TRANSLATION_FAILED" and "closed_set_violation" in body["reason"]


def test_region_prefixed_registration_is_found_by_the_spoken_name() -> None:
    """등록 이름이 "서울 효창공원"(지역 접두)이어도 "효창공원"으로 찾는다."""
    db = FakePlaceDb([_db_row(SEOUL_HYOCHANG, "자연", "서울특별시", "용산구")])
    body = _post("효창공원을 경리단길 끝나고 넣어줘", (SEOUL_HYOCHANG,), db, canned=_add(SEOUL_HYOCHANG))
    assert body["status"] == "APPLIED", body
    assert _ids(body)[2] == str(SEOUL_HYOCHANG.poi_id)


def test_one_branch_is_found_but_two_branches_are_not_guessed() -> None:
    one = FakePlaceDb([_db_row(ONION_YN, "카페", "서울특별시", "마포구")])
    body = _post("어니언 경리단길 끝나고 넣어줘", (ONION_YN,), one, canned=_add(ONION_YN))
    assert body["status"] == "APPLIED", body
    two = FakePlaceDb([_db_row(ONION_YN, "카페", "서울특별시", "마포구"), _db_row(ONION_AG, "카페", "서울특별시", "종로구")])
    body = _post("어니언 경리단길 끝나고 넣어줘", (ONION_YN, ONION_AG), two, canned=_add(ONION_YN))
    assert body["status"] == "TRANSLATION_FAILED" and "closed_set_violation" in body["reason"]  # 지점 여럿 — 고르지 않는다


def test_same_name_far_away_or_below_the_pool_quality_is_not_added() -> None:
    """같은 이름이라도 여행지 50km 밖(부산 식당 '효창공원')·풀 자격 밖(MINIMAL)은 후보가 되지 않는다 — 풀과 같은 자격이다."""
    for p in (BUSAN_HYOCHANG, BARE_HYOCHANG):
        db = FakePlaceDb([_db_row(p, "자연", "부산광역시" if p is BUSAN_HYOCHANG else "서울특별시", "용산구")])
        body = _post("효창공원을 경리단길 끝나고 넣어줘", (p,), db, canned=_add(p))
        assert body["status"] == "TRANSLATION_FAILED" and "closed_set_violation" in body["reason"], p.name


def test_place_db_down_is_an_honest_translation_result_not_a_500() -> None:
    body = _post("효창공원을 경리단길 끝나고 넣어줘", (HYOCHANG,), FakePlaceDb([], down=True))
    assert body["status"] == "TRANSLATION_FAILED" and "closed_set_violation" in body["reason"]
