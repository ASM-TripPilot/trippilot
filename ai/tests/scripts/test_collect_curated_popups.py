"""성수 팝업 → 행사(POPUP) — 끝난 것 제외·재실행 멱등·부족 신호 보존 (2026-10-18)."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "collect"))

from collect_curated_popups import region_of, to_events  # noqa: E402

from trippilot.background.event_store import JsonEventStore  # noqa: E402
from trippilot.domain.itinerary.event import EventType  # noqa: E402
from trippilot.domain.persona import TasteTag  # noqa: E402
from trippilot.orchestrator.event_affinity import event_affinity  # noqa: E402

_TODAY = dt.date(2026, 10, 18)
_POPUPS = [
    {"name": "짱구 전시", "address": "서울 성동구 연무장5길 9-29", "start": "2026-10-17", "end": "2027-01-24"},
    {"name": "끝난 팝업", "address": "서울 성동구 연무장길 17", "start": "2026-09-30", "end": "2026-10-12"},
]


def test_끝난_팝업은_싣지_않고_id_는_재실행해도_같다() -> None:
    got = to_events(_POPUPS, _TODAY)
    assert [e.name for e in got] == ["짱구 전시"]
    assert got[0].event_type is EventType.POPUP
    assert to_events(_POPUPS, _TODAY)[0].event_id == got[0].event_id


def test_팝업_등록은_지역_수집_시각을_건드리지_않고_두_번_넣어도_한_건(tmp_path) -> None:
    store = JsonEventStore(tmp_path / "e.json")
    now = dt.datetime(2026, 10, 18, 9, tzinfo=dt.timezone.utc)
    assert store.upsert("서울", to_events(_POPUPS, _TODAY), now, covered=False) == (1, 0)
    assert store.upsert("서울", to_events(_POPUPS, _TODAY), now, covered=False) == (0, 0)
    assert store.coverage("서울") is None      # "서울을 긁었다"는 부족 신호가 아니다


def test_지역은_주소_첫_낱말이다() -> None:
    busan = to_events([{"name": "라리가", "address": "부산 부산진구 가야대로 772",
                        "start": "2026-10-30", "end": "2026-11-19"}], _TODAY)[0]
    assert region_of(busan) == "부산"
    assert region_of(to_events(_POPUPS, _TODAY)[0]) == "서울"


def test_팝업은_쇼핑_도시_문화_취향에_가산점() -> None:
    assert event_affinity(EventType.POPUP, (TasteTag.SHOPPING,)) == 1.0
    assert event_affinity(EventType.POPUP, (TasteTag.NATURE,)) == 0.0


def test_주소가_비어도_지역_판정이_터지지_않는다() -> None:
    """region_of 가 split()[0] 로 바로 짚어 빈 주소면 IndexError 였다."""
    blank = to_events(
        [{"name": "빈주소팝업", "address": " ", "start": "2026-10-20", "end": "2026-12-31"}], _TODAY)
    assert region_of(blank[0]) == ""


def test_카카오_HTTP_오류가_나도_좌표_없이_싣고_정상_종료한다(tmp_path, monkeypatch) -> None:
    """403 등 카카오 오류가 try 없이 새면 collect 스텝 전체가 비0 종료해 뒤 영속·artifact·--check 가
    전부 건너뛰어졌다(코드 리뷰 지적) — 좌표만 포기하고 계속·정상 종료해야 한다."""
    import io
    import json
    import urllib.error

    import collect_curated_popups as m

    # main 은 실제 dt.datetime.now() 로 끝난 팝업을 거른다 — _POPUPS 를 그대로 쓰면 그 안의
    # "짱구 전시"(2027-01-24 종료)가 미래에 끝난 팝업으로 걸러져 이 테스트가 삭아 버린다.
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps({"popups": [
        {"name": "먼미래팝업", "address": "서울 성동구 연무장5길 9-29",
         "start": "2026-01-01", "end": "2099-12-31"},
    ]}, ensure_ascii=False), encoding="utf-8")
    store = tmp_path / "events.json"

    class _Http403:
        def get_json(self, url, headers, params):
            raise urllib.error.HTTPError(url, 403, "Forbidden", {}, io.BytesIO(b""))

    monkeypatch.setattr(m, "UrllibHttpClient", _Http403)
    monkeypatch.setenv("KAKAO_REST_API_KEY", "fake-key")

    rc = m.main(["--seed", str(seed), "--store", str(store)])
    assert rc == 0

    saved = json.loads(store.read_text(encoding="utf-8"))
    assert saved["events"] and all(e["coord"] is None for e in saved["events"])
