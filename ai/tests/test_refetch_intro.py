"""refetch_intro — 상세 되감기 재조회 (TRIP-1230 후속). 실 호출 0 — fake HTTP 만.

공유본 대부분은 #949(원문 칸에 휴무 동봉) 이전에 수집됐고, 일일 수집은 변경 없는 항목의 상세를
다시 받지 않는다. 되감기는 표지(`provenance.detail_fetched_on`) 없는 제안의 상세를 content_id 로
다시 받아 정상 수집과 같은 제안을 다시 낸다. 여기서는 **고르는 규칙**과 **키를 쓰는 규칙**을 문다 —
제안 재구성 자체(정상 수집과 같은가)는 test_poi_sourcing_pipeline 의 `refresh_proposal` 속성이 문다.

키 규칙은 실 API 로 확인하지 않는다 — 순수 로직이라 fake 로 무는 게 싸고 영구적이다
(anti-patterns: 퇴출 로직을 넣고 "넣었으니 되겠지"가 이 리포에서 두 번 틀렸다).
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tests.fakes.fake_tourapi_http import (
    FakeTourApiHttp,
    HttpStatusError,
    envelope,
    intro_item,
)

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식(동일 디렉토리 경로)으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import refetch_intro as R  # noqa: E402
from merge_pois_docs import merge  # noqa: E402

_TODAY = "2026-10-05"
_CATEGORY = {"12": "NATURE", "14": "CULTURE", "25": "SIGHT", "28": "ACTIVITY",
             "38": "SHOPPING", "39": "FOOD"}


def _stored(cid: str, *, kind: str = "12", raw: str | None = "09:00~18:00",
            name: str | None = None, **prov: str) -> dict:
    """공유본 제안 1건 — 실물 모양 그대로(옛 Poi 직렬화: tags·source_ref 없음, 사진 http)."""
    n = int(cid)
    return {
        "provisional_id": f"tourapi-{cid}",
        "source": "TOURAPI",
        "poi": {"poi_id": f"tourapi-{cid}", "name": name or f"장소{cid}",
                "category": _CATEGORY[kind],
                "coord": {"lat": 33.30 + n % 50 * 0.002, "lng": 126.20 + n % 37 * 0.003},
                "open_hours": [], "avg_cost": None, "rating": None, "quality": "PARTIAL",
                "source": "PLACES_API", "confidence": None},
        "tags": ["자연관광지"],
        "region": "제주시",
        "opening_hours_raw": raw,
        "provenance": {"content_id": cid, "content_type_id": kind,
                       "address": "제주특별자치도 제주시 한경면 청수리",
                       "image_url": f"http://tong.visitkorea.or.kr/{cid}.jpg",
                       "modified_time": "20250430134222", **prov},
    }


def _http(pending: list[dict], *, dead: dict | None = None, empty: set[str] = frozenset(),
          cls=FakeTourApiHttp, **kw) -> FakeTourApiHttp:
    """대기 항목마다 상세 응답(영업 + 휴무)을 단 fake. `empty` 는 빈 응답."""
    intros = {}
    for p in pending:
        cid, kind = p["provenance"]["content_id"], p["provenance"]["content_type_id"]
        if cid not in empty:
            intros[cid] = envelope([intro_item(cid, kind, "10:00~18:00", "매주 월요일")], 1)
    return cls(intros=intros, dead_keys=dead, **kw)


def _calls_by_key(http: FakeTourApiHttp) -> Counter:
    return Counter(params["serviceKey"] for _, params in http.calls)


class _Scripted(FakeTourApiHttp):
    """n 번째 호출(0부터)에 `outcomes[n]` HTTP 상태로 실패 — None 이거나 목록 밖이면 정상 응답."""

    def __init__(self, outcomes: list[int | None], **kw) -> None:
        super().__init__(**kw)
        self._outcomes = outcomes

    def get_json(self, url, params):
        n = len(self.calls)
        if n < len(self._outcomes) and self._outcomes[n] is not None:
            self.calls.append((url, dict(params)))
            raise HttpStatusError(self._outcomes[n])
        return super().get_json(url, params)


# ── 대기 선별 ─────────────────────────────────────────────────────────


def test_대기는_조건대로_고르고_원문_있는_것부터_낸다() -> None:
    """원문 칸이 있는 것 → 원문 없는 것 → 원문 없는 레포츠(28, 실측 86.7% 빈 응답) 순."""
    doc = {"proposals": [
        _stored("104", raw=None, kind="28"),           # 원문 없는 레포츠 — 번호가 앞서도 맨 뒤
        _stored("105", raw=None),                      # 원문 없음 — 가운데
        _stored("103"),
        _stored("102", kind="28"),                     # 레포츠라도 원문이 있으면 앞
        _stored("101", kind="39"),
        _stored("106", kind="25"),                     # 상세 영업시간 필드가 없는 타입
        _stored("107", detail_fetched_on="2026-10-04"),   # 이미 받았다
        _stored("108"),                                # 폐업
        _stored("109"),                                # 오늘 일일 수집분 — 더 새 판이 있다
        {**_stored("110"), "source": "LOCALDATA"},     # 다른 출처
    ]}
    got = R.select_pending(doc, closed=frozenset({("tourapi", "108")}), exclude={"109"}, today=_TODAY)
    ids = [p["provenance"]["content_id"] for p in got]
    assert set(ids[:3]) == {"101", "102", "103"} and ids[3:] == ["105", "104"]


def test_같은_무리_안_순서는_날마다_바뀌고_같은_날엔_같다() -> None:
    """고정 순서면 늘 실패하는 항목이 매일 맨 앞에 모여 실패 절반 규칙에 걸리고 되감기가 멈춘다."""
    doc = {"proposals": [_stored(str(200 + i)) for i in range(30)]}

    def order(day: str) -> list[str]:
        return [p["provenance"]["content_id"]
                for p in R.select_pending(doc, closed=frozenset(), exclude=set(), today=day)]

    assert order("2026-10-05") == order("2026-10-05")
    assert order("2026-10-05") != order("2026-10-06")
    assert sorted(order("2026-10-06")) == sorted(p["provenance"]["content_id"] for p in doc["proposals"])


def test_늘_실패하는_항목이_있어도_날이_바뀌면_멈추지_않는다() -> None:
    """리뷰 재현의 반례 — 봉투 오류만 내는 항목 60건이 고정 순서로 매일 맨 앞에 오면 0건/일로 멈췄다."""
    pending_doc = {"proposals": [_stored(str(1000 + i)) for i in range(300)]}
    bad = {str(1000 + i) for i in range(60)}

    class _Bad(FakeTourApiHttp):
        def get_json(self, url, params):
            if params.get("contentId") in bad:
                self.calls.append((url, dict(params)))
                return {"response": {"header": {"resultCode": "01", "resultMsg": "APPLICATION ERROR"}}}
            return super().get_json(url, params)

    for day in ("2026-10-05", "2026-10-06", "2026-10-07"):
        pending = R.select_pending(pending_doc, closed=frozenset(), exclude=set(), today=day)
        http = _http(pending, cls=_Bad)
        _, stats = R.rewind(pending, [("A", "KA", 1000)], http, fetched_on=day)
        assert stats["halted"] is None and stats["emitted"] == 240


def test_키는_설정된_것만_정한_순서와_상한으로() -> None:
    """KEY1 은 일일 수집이 먼저 쓰는 키라 상한이 낮다. 빈 값은 미설정이다(GH Actions 는 '' 를 넣는다)."""
    assert R.keys_from_env({"TOUR_API_KEY": "a", "TOUR_API_KEY2": "b", "TOUR_API_KEY3": "c"}) == [
        ("TOUR_API_KEY3", "c", 1000), ("TOUR_API_KEY", "a", 700), ("TOUR_API_KEY2", "b", 1000)]
    assert R.keys_from_env({"TOUR_API_KEY": "a", "TOUR_API_KEY2": "", "OTHER": "x"}) == [
        ("TOUR_API_KEY", "a", 700)]


# ── 키 규칙 ───────────────────────────────────────────────────────────


def test_429가_세_번_연달아면_그_키를_접고_다음_키가_이어받는다() -> None:
    pending = [_stored(str(100 + i)) for i in range(5)]
    http = _http(pending, dead={"K3": 429})
    proposals, stats = R.rewind(pending, [("TOUR_API_KEY3", "K3", 1000), ("TOUR_API_KEY", "K1", 700)],
                                http, fetched_on=_TODAY)
    assert _calls_by_key(http) == {"K3": 3, "K1": 5}
    assert stats["attempted"] == {"TOUR_API_KEY3": 3, "TOUR_API_KEY": 5}
    assert stats["failures"] == {"429": 3}
    # 429 를 맞은 첫 항목은 버려지지 않는다 — 다음 키가 받았다
    assert [p["provenance"]["content_id"] for p in proposals] == ["100", "101", "102", "103", "104"]
    assert stats["remaining"] == 0 and stats["halted"] is None


def test_429_연속은_성공이_끊는다() -> None:
    """"연달아"의 뜻 — 사이에 성공이 끼면 다시 센다. 띄엄띄엄 오는 429 로 키를 접지 않는다."""
    pending = [_stored(str(100 + i)) for i in range(3)]
    http = _http(pending, cls=_Scripted, outcomes=[429, 429, None, 429, 429])
    proposals, stats = R.rewind(pending, [("TOUR_API_KEY3", "K3", 1000)], http, fetched_on=_TODAY)
    assert len(http.calls) == 7 and stats["failures"] == {"429": 4}
    assert len(proposals) == 3


@pytest.mark.parametrize("rejection", [403, "30"])
def test_죽은_키는_첫_거부에서_접는다(rejection) -> None:
    """403·키 resultCode 는 "이 키로는 오늘 안 된다" — 한 번 맞으면 그 키는 끝(실측: KEY2 는 08-19 부터 전부 403)."""
    pending = [_stored(str(100 + i)) for i in range(3)]
    http = _http(pending, dead={"K2": rejection})
    proposals, stats = R.rewind(pending, [("TOUR_API_KEY2", "K2", 1000), ("TOUR_API_KEY", "K1", 700)],
                                http, fetched_on=_TODAY)
    assert _calls_by_key(http) == {"K2": 1, "K1": 3}
    assert stats["failures"] == {"dead_key": 1}
    assert len(proposals) == 3


def test_키당_상한은_시도_기준이다() -> None:
    """실패한 호출도 한도를 먹는다 — 상한은 성공이 아니라 시도로 센다(파이프라인 예산과 같은 기준)."""
    pending = [_stored(str(100 + i)) for i in range(10)]
    http = _http(pending, cls=_Scripted, outcomes=[500])
    proposals, stats = R.rewind(pending, [("A", "KA", 2), ("B", "KB", 3)], http, fetched_on=_TODAY)
    assert _calls_by_key(http) == {"KA": 2, "KB": 3}
    assert stats["failures"] == {"other": 1}         # 100 — 다음 실행이 다시 묻는다
    assert [p["provenance"]["content_id"] for p in proposals] == ["101", "102", "103", "104"]
    assert stats["remaining"] == 6


def test_실패가_절반을_넘으면_실행_전체를_멈춘다(capsys) -> None:
    """망·벤더 장애에 남은 키까지 태우지 않는다 — 50번 시도 뒤 실패가 절반 이상이면 그 자리에서 끝."""
    pending = [_stored(str(1000 + i)) for i in range(80)]
    http = _http(pending, dead={"KA": 500})
    proposals, stats = R.rewind(pending, [("A", "KA", 1000), ("B", "KB", 1000)], http, fetched_on=_TODAY)
    assert stats["attempted"] == {"A": 50} and _calls_by_key(http) == {"KA": 50}
    assert stats["failures"] == {"other": 50} and stats["halted"] == "failure_rate"
    assert proposals == []
    assert "::warning::" in capsys.readouterr().err


def test_실패가_정확히_절반이어도_멈춘다() -> None:
    """규칙은 '절반 이상' 이다 — '절반 초과' 로 바뀌면 반반 실패하는 망 장애에 남은 키까지 태운다."""
    pending = [_stored(str(1000 + i)) for i in range(80)]
    http = _http(pending, cls=_Scripted, outcomes=[500, None] * 25)
    _, stats = R.rewind(pending, [("A", "KA", 1000)], http, fetched_on=_TODAY)
    assert stats["halted"] == "failure_rate" and len(http.calls) == 50


def test_429도_실패_우세에_센다() -> None:
    """3연속이 아닌 429 가 섞여도(키를 접지 않는 모양) 실패 우세면 멈춘다 — 429·죽은 키·그 밖 모두 실패다."""
    pending = [_stored(str(1000 + i)) for i in range(80)]
    http = _http(pending, cls=_Scripted, outcomes=[429, 429, None] * 17)
    _, stats = R.rewind(pending, [("A", "KA", 1000)], http, fetched_on=_TODAY)
    assert stats["halted"] == "failure_rate" and len(http.calls) == 50


def test_마감은_키_도중에도_지킨다(monkeypatch) -> None:
    """마감 확인이 키마다 한 번이면 한 키가 상한(1,000콜)까지 마감을 넘겨 달린다 — 항목마다 본다."""
    from types import SimpleNamespace
    ticks = iter(range(0, 100_000, 600))   # monotonic() 한 번에 10분
    monkeypatch.setattr(R, "time", SimpleNamespace(monotonic=lambda: next(ticks)))
    pending = [_stored(str(100 + i)) for i in range(10)]
    http = _http(pending)
    _, stats = R.rewind(pending, [("A", "KA", 1000)], http, fetched_on=_TODAY)
    assert stats["halted"] == "deadline" and len(http.calls) == 3


def test_마감_시각이_지나면_새_호출을_하지_않는다(monkeypatch) -> None:
    """스텝 타임아웃에 죽으면 받은 것까지 다 잃는다 — 그 전에 멈추고 산출을 쓴다."""
    monkeypatch.setattr(R, "_DEADLINE_SEC", 0)
    pending = [_stored("100")]
    http = _http(pending)
    proposals, stats = R.rewind(pending, [("A", "KA", 1000)], http, fetched_on=_TODAY)
    assert http.calls == [] and proposals == [] and stats["halted"] == "deadline"


def test_통계는_저장본_유지와_게이트_탈락을_따로_센다() -> None:
    pending = [_stored("100"),                         # 새 영업 원문 → 휴무까지 실린다
               _stored("101"),                         # 빈 응답 → 저장본 영업시간 유지
               _stored("102", raw=None),               # 빈 응답 + 원문 없음 → 지킬 것도 없다
               _stored("103", name="GS25 제주점")]     # 게이트 탈락 (관광 무관 이름)
    http = _http(pending, empty={"101", "102"})
    proposals, stats = R.rewind(pending, [("TOUR_API_KEY3", "K3", 1000)], http, fetched_on=_TODAY)
    assert (stats["emitted"], stats["kept_stored_hours"], stats["gate_dropped"]) == (3, 1, 1)
    assert stats["remaining"] == 1                     # 탈락분은 표지가 없어 대기로 남는다
    by_id = {p["provenance"]["content_id"]: p for p in proposals}
    assert by_id["100"]["opening_hours_raw"] == "10:00~18:00\n휴무: 매주 월요일"
    assert by_id["101"]["opening_hours_raw"] == "09:00~18:00"
    assert by_id["102"]["opening_hours_raw"] is None
    assert {p["provenance"]["detail_fetched_on"] for p in proposals} == {_TODAY}


@settings(max_examples=60, deadline=None)
@given(
    outcomes=st.lists(st.sampled_from([None, None, None, 429, 500, 403]), max_size=150),
    caps=st.lists(st.integers(min_value=1, max_value=40), min_size=3, max_size=3),
)
def test_pbt_키_규칙은_어떤_응답_순서에도_지켜진다(outcomes, caps) -> None:
    """임의 응답 순서: 상한·죽은 키·429 연속·실패 우세 규칙이 전부 지켜지고, 낸 제안은 대기 안의 것뿐이다."""
    pending = [_stored(str(1000 + i)) for i in range(70)]
    http = _http(pending, cls=_Scripted, outcomes=outcomes)
    keys = [("A", "KA", caps[0]), ("B", "KB", caps[1]), ("C", "KC", caps[2])]
    proposals, stats = R.rewind(pending, keys, http, fetched_on=_TODAY)

    statuses = [outcomes[i] if i < len(outcomes) else None for i in range(len(http.calls))]
    by_key = Counter(params["serviceKey"] for _, params in http.calls)
    for name, key, cap in keys:
        assert by_key[key] == stats["attempted"].get(name, 0) <= cap
        seq = [s for (_, params), s in zip(http.calls, statuses) if params["serviceKey"] == key]
        if 403 in seq:                                       # 죽은 키는 첫 거부가 마지막 호출
            assert seq.index(403) == len(seq) - 1
        streak = 0
        for i, s in enumerate(seq):                          # 429 세 번 연달아면 그 키는 끝
            streak = streak + 1 if s == 429 else (0 if s is None else streak)
            if streak == 3:
                assert i == len(seq) - 1
    failed = sum(s is not None for s in statuses)
    assert sum(stats["failures"].values()) == failed
    assert stats["emitted"] + stats["gate_dropped"] == len(http.calls) - failed
    if stats["halted"] == "failure_rate":
        assert len(http.calls) >= 50 and failed * 2 >= len(http.calls)
    ids = [p["provenance"]["content_id"] for p in proposals]
    assert len(ids) == len(set(ids)) and set(ids) <= {p["provenance"]["content_id"] for p in pending}
    assert all(p["provenance"]["detail_fetched_on"] == _TODAY for p in proposals)


# ── 실행 (main) — 산출 문서·병합·서머리 ─────────────────────────────────


def _doc(at: str, proposals: list[dict]) -> dict:
    return {"schema_version": 1, "source": "TOURAPI", "collected_at": at,
            "area_codes": ["39"], "content_types": ["12"], "stats": {}, "proposals": proposals}


@pytest.fixture
def run(tmp_path, monkeypatch):
    """main 을 fake HTTP 로 돌린다 — `UrllibHttpClient` 를 바꿔 실 호출 0 을 구조로 보장."""
    for name, _ in R.KEYS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)

    def _run(shared: dict, *, daily: dict | None = None, http=None, keys: dict | None = None,
             extra: tuple[str, ...] = ()) -> tuple[int, Path]:
        for name, value in (keys or {}).items():
            monkeypatch.setenv(name, value)
        monkeypatch.setattr(R, "UrllibHttpClient", lambda: http or FakeTourApiHttp())
        (tmp_path / "shared.json").write_text(json.dumps(shared, ensure_ascii=False), encoding="utf-8")
        argv = ["--pois", str(tmp_path / "shared.json"), "--out", str(tmp_path / "out.json"), *extra]
        if daily is not None:
            (tmp_path / "daily.json").write_text(json.dumps(daily, ensure_ascii=False), encoding="utf-8")
            argv += ["--daily", str(tmp_path / "daily.json")]
        return R.main(argv), tmp_path / "out.json"
    return _run


def test_산출_문서는_공유본_뒤에_병합돼_이긴다(run, tmp_path, monkeypatch) -> None:
    """워크플로가 공유본 · 일일 산출 · 되감기 순으로 merge_pois_docs 에 넣는다 — 나중 수집분이 이긴다."""
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    shared = _doc("2026-01-01T00:00:00+00:00",
                  [_stored("100"), _stored("101"), _stored("102", detail_fetched_on="2026-01-01")])
    today = _stored("101", raw="08:00~20:00", detail_fetched_on="2026-01-02")
    daily = _doc("2026-01-02T00:00:00+00:00", [today])
    http = _http(shared["proposals"])
    rc, out = run(shared, daily=daily, http=http, keys={"TOUR_API_KEY3": "K3"})

    assert rc == 0
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert set(doc) == {"schema_version", "source", "collected_at", "stats", "proposals"}
    assert (doc["schema_version"], doc["source"]) == (1, "TOURAPI")
    assert doc["collected_at"] > daily["collected_at"] > shared["collected_at"]
    assert [p["provenance"]["content_id"] for p in doc["proposals"]] == ["100"]   # 101 은 일일분, 102 는 받음
    assert _calls_by_key(http) == {"K3": 1}

    merged = {p["provenance"]["content_id"]: p for p in merge([shared, daily, doc])["proposals"]}
    assert merged["100"] == doc["proposals"][0]
    assert merged["100"]["opening_hours_raw"] == "10:00~18:00\n휴무: 매주 월요일"
    assert merged["101"] == today and merged["102"] == shared["proposals"][2]
    assert "상세 되감기" in summary.read_text(encoding="utf-8")


def test_키가_다_막혀도_산출을_쓰고_0으로_끝난다(run) -> None:
    """한도 소진은 정상 종료다 — 남은 것은 내일 이어서 받는다. 빈 산출도 쓴다(병합은 0건을 그냥 지난다)."""
    shared = _doc("2026-01-01T00:00:00+00:00", [_stored("100"), _stored("101")])
    http = _http(shared["proposals"], dead={"K3": 429, "K1": 429, "K2": 403})
    rc, out = run(shared, http=http, keys={"TOUR_API_KEY3": "K3", "TOUR_API_KEY": "K1",
                                           "TOUR_API_KEY2": "K2"})
    assert rc == 0
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert doc["proposals"] == []
    assert doc["stats"]["failures"] == {"429": 6, "dead_key": 1}
    assert doc["stats"]["remaining"] == 2


def test_대기가_0이면_호출_없이_빈_산출(run) -> None:
    """전부 받으면 이 스텝은 아무것도 안 한다 — 그때 워크플로에서 지운다."""
    shared = _doc("2026-01-01T00:00:00+00:00", [_stored("100", detail_fetched_on="2026-01-01")])
    http = FakeTourApiHttp()
    rc, out = run(shared, http=http, keys={"TOUR_API_KEY3": "K3"})
    assert rc == 0 and http.calls == []
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert doc["proposals"] == [] and doc["stats"]["pending"] == 0


def test_main은_폐업_목록으로_대기를_거른다(run, tmp_path, monkeypatch) -> None:
    """선별은 폐업 집합을 인자로 받는다 — main 이 그 집합을 실제로 넘기는지(라벨 ("tourapi", id) 일치까지) 본다."""
    import collect_pois
    status = tmp_path / "status.json"
    status.write_text(json.dumps({"status": {"101": {"state": "CLOSED"}}}), encoding="utf-8")
    monkeypatch.setattr(R, "load_closed_refs", lambda: collect_pois.load_closed_refs(status))
    shared = _doc("2026-01-01T00:00:00+00:00", [_stored("100"), _stored("101")])
    http = _http(shared["proposals"])
    rc, out = run(shared, http=http, keys={"TOUR_API_KEY3": "K3"})
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert rc == 0 and [p["provenance"]["content_id"] for p in doc["proposals"]] == ["100"]
    assert doc["stats"]["pending"] == 1


def test_드라이런은_호출도_산출도_없다(run, capsys) -> None:
    shared = _doc("2026-01-01T00:00:00+00:00",
                  [_stored("100"), _stored("101", raw=None), _stored("102", raw=None, kind="28")])
    http = FakeTourApiHttp()
    rc, out = run(shared, http=http, keys={"TOUR_API_KEY3": "K3"}, extra=("--dry-run",))
    assert rc == 0 and http.calls == [] and not out.exists()
    assert "대기 3" in capsys.readouterr().out
