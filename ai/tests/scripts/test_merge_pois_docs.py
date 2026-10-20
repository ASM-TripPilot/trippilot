"""merge_pois_docs — 병합 규칙과 영업시간 재파싱 (TRIP-392 · TRIP-687).

파서를 고쳐도 이미 수집된 것에는 소급되지 않는다 — 증분 색인이 "변경 없음"으로
스킵해 상세를 다시 안 받는다. 그래서 병합이 원문(`opening_hours_raw`)에서
`open_hours` 를 **현재 파서로** 다시 낸다. 2026-09-17 실측: 결측 15,859건 중
2,490건이 원문만 있고 파싱이 비어 있었다 — `상시 개방` 을 종일로 읽게 고친
PR #280 이 공유본에 반영되지 않은 채였다.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식(동일 디렉토리 경로)으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "collect"))

import merge_pois_docs as M  # noqa: E402
from collect_pois import load_closed_refs  # noqa: E402
from merge_pois_docs import (  # noqa: E402
    drop_closed,
    drop_non_travel,
    drop_rejected_verdicts,
    merge,
    reparse_open_hours,
)

_DATA = Path(__file__).resolve().parents[2] / "data"


def _prop(cid: str, raw: str | None, hours: list | None = None, name: str = "곳") -> dict:
    return {
        "provenance": {"content_id": cid},
        "poi": {"name": name, "open_hours": hours or []},
        "opening_hours_raw": raw,
    }


# ── 재파싱 — 원문이 정본, open_hours 는 파생 ──────────────────────────


def test_reparse_fills_always_open_that_old_parser_missed() -> None:
    """공유본에 실제로 남아 있던 모양 — `상시 개방` 원문 + 빈 open_hours."""
    p = _prop("1", "상시 개방")
    assert reparse_open_hours([p]) == 1
    assert len(p["poi"]["open_hours"]) == 7
    assert p["poi"]["open_hours"][0] == {"day_of_week": 0, "open_min": 0, "close_min": 1440}


def test_reparse_does_not_touch_existing_hours() -> None:
    """이미 값이 있으면 건드리지 않는다 — 수집 시점 판정을 병합이 뒤집지 않는다."""
    existing = [{"day_of_week": 0, "open_min": 600, "close_min": 1320}]
    p = _prop("1", "상시 개방", hours=list(existing))
    assert reparse_open_hours([p]) == 0
    assert p["poi"]["open_hours"] == existing


def test_reparse_leaves_unparseable_raw_empty() -> None:
    """파서가 여전히 못 읽는 원문은 그대로 비워 둔다 — 지어내지 않는다."""
    p = _prop("1", "※ 일부 통제될 수 있으므로 방문 시 전화문의 요망")
    assert reparse_open_hours([p]) == 0
    assert p["poi"]["open_hours"] == []


def test_reparse_skips_when_no_raw() -> None:
    p = _prop("1", None)
    assert reparse_open_hours([p]) == 0
    assert p["poi"]["open_hours"] == []


@settings(max_examples=60, deadline=None)
@given(raws=st.lists(st.sampled_from([
    "상시 개방", "09:00~18:00", "10:00 - 22:00", None, "",
    "※ 방문 시 전화문의", "09:00~18:00 (동절기 17:00)",
]), min_size=0, max_size=12))
def test_pbt_reparse_is_idempotent_and_counts_exactly(raws) -> None:
    """두 번 돌려도 같다(멱등). 반환값은 실제로 채운 건수와 정확히 같다."""
    props = [_prop(str(i), r) for i, r in enumerate(raws)]
    n1 = reparse_open_hours(props)
    filled = sum(1 for p in props if p["poi"]["open_hours"])
    assert n1 == filled
    snapshot = [list(p["poi"]["open_hours"]) for p in props]
    assert reparse_open_hours(props) == 0
    assert [list(p["poi"]["open_hours"]) for p in props] == snapshot


# ── 원문 칸의 휴무 (TRIP-1226) ──────────────────────────────────────────


def _week(days, open_min: int = 540, close_min: int = 1080) -> list[dict]:
    return [{"day_of_week": d, "open_min": open_min, "close_min": close_min} for d in days]


def test_reparse_reads_rest_carried_in_raw() -> None:
    """원문 칸에 휴무가 실려 있으면 갈라 읽는다 — 통째로 읽으면 월요일에도 영업이다."""
    p = _prop("1", "09:00~18:00\n휴무: 매주 월요일")
    assert reparse_open_hours([p]) == 1
    assert p["poi"]["open_hours"] == _week(range(1, 7))


def test_reparse_does_not_fill_rest_the_collector_gave_up_on() -> None:
    """수집이 포기한 휴무(동절기 휴장 등)를 병합이 7일 영업으로 채우지 않는다 — 종전엔 채웠다."""
    p = _prop("1", "09:00~18:00\n휴무: 동절기 휴장")
    assert reparse_open_hours([p]) == 0
    assert p["poi"]["open_hours"] == []


def test_daily_merge_keeps_backfilled_rest_and_new_collection_still_wins() -> None:
    """일일 병합(공유본 + 금일 산출물)이 백필을 되돌리지 않는다.

    재제안이 없는 제안은 백필된 원문 그대로 남고, 재제안된 제안은 나중 수집분이 이긴다 —
    그 수집분은 파이프라인이 휴무를 함께 싣는 형식이라 휴무가 다시 사라지지 않는다.
    """
    base = {"schema_version": 1, "source": "TOURAPI", "area_codes": ["1"], "content_types": ["39"]}
    shared = {**base, "collected_at": "2026-10-02T00:00:00+00:00", "proposals": [
        _prop("1", "09:00~18:00\n휴무: 매주 월요일", hours=_week(range(1, 7))),
        _prop("2", "10:00~20:00\n휴무: 매주 화요일", hours=_week([0, 2, 3, 4, 5, 6], 600, 1200)),
    ]}
    today = {**base, "collected_at": "2026-10-05T00:00:00+00:00", "proposals": [
        _prop("2", "10:00~21:00\n휴무: 매주 수요일", hours=_week([0, 1, 3, 4, 5, 6], 600, 1260)),
        _prop("3", "09:00~18:00\n휴무: 매주 일요일"),   # 신규 — 파싱 빈칸이면 병합이 휴무까지 읽는다
    ]}
    out = merge([shared, today])
    reparse_open_hours(out["proposals"])
    by = {p["provenance"]["content_id"]: p for p in out["proposals"]}
    assert by["1"]["opening_hours_raw"] == "09:00~18:00\n휴무: 매주 월요일"
    assert by["1"]["poi"]["open_hours"] == _week(range(1, 7))
    assert by["2"]["opening_hours_raw"] == "10:00~21:00\n휴무: 매주 수요일"
    assert by["3"]["poi"]["open_hours"] == _week(range(6))


# ── 병합 규칙 (기존 --self-check 를 pytest 로) ──────────────────────────


def test_later_collection_wins_on_same_content_id() -> None:
    older = {"schema_version": 1, "source": "TOURAPI", "collected_at": "2026-01-01",
             "area_codes": ["1"], "content_types": ["12"],
             "proposals": [_prop("x", None, name="옛것")]}
    newer = {**older, "collected_at": "2026-02-01",
             "proposals": [_prop("x", None, name="새것")]}
    out = merge([newer, older])   # 입력 순서와 무관하게 수집 시각이 이긴다
    assert out["proposals"][0]["poi"]["name"] == "새것"
    assert out["stats"] == {"merged_runs": 2, "unique_proposals": 1}


# ── 관광 무관 소급 제거 (2026-09-26) ────────────────────────────

def test_수집_뒤에_들어온_규칙이_기존_제안에_소급된다() -> None:
    """실측 모양 — 공유본(09-13 수집)에 09-16 규칙으로 걸리는 편의점 2건이 남아 있었다."""
    props = [_prop("1", None, name="이마트24 강릉여고점"),
             _prop("2", None, name="성산일출봉"),
             _prop("3", None, name="꽃사슴복권마트(슈퍼맨편의점)")]
    assert drop_non_travel(props) == {"convenience_store": 2}
    assert [p["poi"]["name"] for p in props] == ["성산일출봉"]


def test_관광지는_한_건도_지우지_않는다() -> None:
    """**오탐이 곧 관광지 삭제다** — 규칙이 좁아야 하는 이유."""
    names = ["성산일출봉", "국립중앙박물관", "광장시장", "남산서울타워",
             "제주 올레시장", "부산 감천문화마을", "경복궁", "한라산국립공원",
             "일반음식점 대성집", "대구 서문시장"]
    props = [_prop(str(i), None, name=n) for i, n in enumerate(names)]
    assert drop_non_travel(props) == {}
    assert len(props) == len(names)


def test_제거하면_유니크_수를_다시_센다() -> None:
    """`stats.unique_proposals` 가 실제 제안 수와 어긋나면 읽는 쪽이 커버리지를 잘못 잰다."""
    props = [_prop("1", None, name="CU 강릉점"), _prop("2", None, name="성산일출봉")]
    dropped = drop_non_travel(props)
    assert sum(dropped.values()) == 1 and len(props) == 1


def test_걸릴_것이_없으면_아무것도_안_바꾼다() -> None:
    props = [_prop("1", None, name="성산일출봉")]
    before = list(props)
    assert drop_non_travel(props) == {}
    assert props == before


# ── 폐업 소급 제거 (2026-10-05, TRIP-1248) ──────────────────────────────
# 게이트 2단은 수집 시점에만 폐업을 거른다 — 근거 파일(09-08) 이전 수집분 210건이 공유본에 남아 있었다.

_CLOSED = frozenset({("tourapi", "1")})


def _src(cid: str, source: str, name: str = "곳") -> dict:
    return {**_prop(cid, None, name=name), "source": source}


def test_폐업은_같은_출처의_같은_번호만_뺀다() -> None:
    """조회 키는 게이트와 같은 (출처, 번호) — 번호만 같은 LOCALDATA·MANUAL 은 남는다."""
    props = [_src("1", "TOURAPI", "문닫은집"), _src("2", "TOURAPI", "영업중"),
             _src("1", "LOCALDATA", "우진해장국"), _src("1", "MANUAL", "손으로 넣은 곳")]
    assert drop_closed(props, _CLOSED) == 1
    assert [(p["source"], p["provenance"]["content_id"]) for p in props] \
        == [("TOURAPI", "2"), ("LOCALDATA", "1"), ("MANUAL", "1")]


def test_폐업_제거는_멱등이고_근거가_비면_무동작() -> None:
    props = [_src("1", "TOURAPI"), _src("2", "TOURAPI")]
    assert drop_closed(props, frozenset()) == 0 and len(props) == 2
    assert drop_closed(props, _CLOSED) == 1
    snapshot = list(props)
    assert drop_closed(props, _CLOSED) == 0 and props == snapshot


def test_main이_폐업_건수를_stats에_남기고_0이면_키를_안_만든다(tmp_path, monkeypatch) -> None:
    """축소 가드가 `closed_dropped` 를 빼고 비교한다 — `non_travel_dropped` 와 같은 규약(0 이면 키 없음)."""
    doc = {"schema_version": 1, "source": "TOURAPI", "collected_at": "2026-10-05T00:00:00+00:00",
           "area_codes": ["1"], "content_types": ["39"],
           "proposals": [_src("1", "TOURAPI", "문닫은집"), _src("2", "TOURAPI", "영업중")]}
    src, out = tmp_path / "in.json", tmp_path / "out.json"
    src.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(M, "load_closed_refs", lambda: _CLOSED)
    assert M.main(["-o", str(out), str(src)]) == 0
    merged = json.loads(out.read_text(encoding="utf-8"))
    assert [p["provenance"]["content_id"] for p in merged["proposals"]] == ["2"]
    assert merged["stats"]["unique_proposals"] == 1 and merged["stats"]["closed_dropped"] == 1

    monkeypatch.setattr(M, "load_closed_refs", lambda: frozenset())
    assert M.main(["-o", str(out), str(src)]) == 0
    merged = json.loads(out.read_text(encoding="utf-8"))
    assert merged["stats"]["unique_proposals"] == 2 and "closed_dropped" not in merged["stats"]


def test_공유본에_폐업_확인분이_남아_있지_않다() -> None:
    """⚠️ 픽스처가 아니라 **리포에 커밋된 실데이터 둘**(poi_business_status.json·collected_pois.json)을 읽는다.

    2026-10-05 에 210건을 한 번 손으로 뺐고 그 뒤로는 병합이 매일 소급한다 — 여기서 걸리면 누군가 병합을
    거치지 않고 공유본을 썼거나 근거 파일이 갱신됐는데 병합이 아직 안 돈 것이다. 근거 파일을 갱신하는 PR 은
    같은 PR 에서 공유본에 병합을 한 번 돌린다(README §poi_business_status.json 갱신 3). 24MB 파싱 1회(1초 안쪽).
    """
    closed = load_closed_refs(_DATA / "poi_business_status.json")
    assert closed, "근거 파일이 비어 있으면 이 테스트는 아무것도 보지 않는다"
    shared = json.loads((_DATA / "collected_pois.json").read_text(encoding="utf-8"))
    assert drop_closed(shared["proposals"], closed) == 0
    assert shared["stats"]["unique_proposals"] == len(shared["proposals"])


def test_근거_파일_갱신_절차는_공유본_병합을_같은_PR에_넣는다() -> None:
    """위 검사의 짝 — 근거 파일만 올린 PR 은 위 검사에 걸린다. 매일 병합(봇)은 그 파일이 develop 에 들어간
    뒤에야 새 CLOSED 를 뺄 수 있고, 봇의 머지 push 는 ai-ci 를 돌리지 않아 위 검사는 사람 PR 에서만 돈다.

    그래서 갱신 절차 두 벌(README · 담당자에게 메일로 가는 리마인더 이슈 본문)이 모두 공유본 병합을 같은
    PR 에 넣으라고 해야 한다 — 절차가 두 곳이라 한쪽만 고쳐지기 쉽다(2026-10-05 리뷰에서 실제로 한쪽이 빠졌다).
    """
    # `--allow-mixed` 는 공유본이 섞인 뒤로 필수다(2026-10-14) — 빠진 절차는 거부로 끝난다.
    cmd = ("scripts/collect/merge_pois_docs.py --allow-mixed "
           "-o data/collected_pois.json data/collected_pois.json")
    readme = (_DATA / "README.md").read_text(encoding="utf-8")
    section = readme.split("## `poi_business_status.json`", 1)[1].split("\n## ", 1)[0]
    assert cmd in section
    reminder = _DATA.parents[1] / ".github" / "workflows" / "ai-business-status-reminder.yml"
    assert cmd in reminder.read_text(encoding="utf-8")


# ── 교차 출처 병합 (2026-10-14) ───────────────────────────────────────
#
# 수신 계약 `PoiProposalDocument` 은 **문서 레벨 source 하나만** 읽는다(`ProposalItem` 에
# source 칸이 없다). 유일키가 (source, content_id) 라, 출처가 다른 문서를 합치면 최상위
# source 를 늦은 쪽이 가져가고 **전량이 그 출처로 한 벌 더** 들어간다.
# 실측: 19,079(TOURAPI) + 22,283(LOCALDATA) 을 합쳤더니 최상위가 LOCALDATA 가 됐다.


def _doc(source: str, cid: str, collected_at: str) -> dict:
    return {
        "schema_version": 1, "source": source, "collected_at": collected_at,
        "area_codes": ["1"], "content_types": ["12"],
        "proposals": [{"provenance": {"content_id": cid},
                       "poi": {"name": "고집돌우럭"}, "source": source}],
    }


def test_출처가_섞이면_기본적으로_거부한다() -> None:
    """조용히 합쳐 주면 중복 적재가 배포까지 간다 — 실제로 거기까지 갔다."""
    with pytest.raises(SystemExit) as e:
        merge([_doc("TOURAPI", "1", "2026-10-13T00:00:00Z"),
               _doc("LOCALDATA", "2", "2026-10-14T00:00:00Z")])
    assert "출처가 섞" in str(e.value)


def test_같은_출처는_종전과_똑같다() -> None:
    out = merge([_doc("TOURAPI", "1", "2026-10-13T00:00:00Z"),
                 _doc("TOURAPI", "2", "2026-10-14T00:00:00Z")])
    assert out["source"] == "TOURAPI"
    assert "sources" not in out, "같은 출처인데 sources 를 붙이면 소비자가 갈라 보내려 한다"
    assert len(out["proposals"]) == 2


def test_허용하면_문서가_섞였다고_스스로_말한다() -> None:
    """최상위 source 하나만 읽으면 틀린다는 것을 문서가 드러내야 한다."""
    out = merge([_doc("TOURAPI", "1", "2026-10-13T00:00:00Z"),
                 _doc("LOCALDATA", "2", "2026-10-14T00:00:00Z")], allow_mixed=True)
    assert out["sources"] == ["LOCALDATA", "TOURAPI"]
    assert len(out["proposals"]) == 2
    # 항목별 source 가 정본이다 — 소비자가 이걸로 갈라 보낸다
    assert {p["source"] for p in out["proposals"]} == {"TOURAPI", "LOCALDATA"}


def test_공유본이_섞였으면_sources_가_있다() -> None:
    """실제 공유본 회귀 — 섞인 채로 `sources` 가 없으면 소비자가 못 알아챈다."""
    doc = json.loads((_DATA / "collected_pois.json").read_text(encoding="utf-8"))
    item_sources = {p.get("source") for p in doc["proposals"]}
    if len(item_sources) > 1:
        assert sorted(s for s in item_sources if s) == doc.get("sources"), (
            "공유본 항목 출처가 섞였는데 문서의 sources 와 다르다 — "
            "수신이 최상위 source 하나만 읽어 전량 중복 적재된다"
        )


def test_섞인_문서를_혼자_재병합해도_표식이_남는다() -> None:
    """공유본 재병합(폐업 소급 제거)에서 실제로 하는 일이다 — 문서 레벨만 보면 표식이 사라진다.

    항목 출처가 정본이므로, 문서가 하나여도 그 안이 섞였으면 섞인 것이다.
    실제로 `merge_pois_docs.py -o data/collected_pois.json data/collected_pois.json`
    한 번에 `sources` 가 통째로 날아갔다(2026-10-14, 커밋 전 발견).
    """
    mixed = _doc("TOURAPI", "1", "2026-10-14T00:00:00Z")
    mixed["proposals"].append({"provenance": {"content_id": "2"},
                               "poi": {"name": "수로밥상"}, "source": "LOCALDATA"})
    with pytest.raises(SystemExit):
        merge([mixed])
    out = merge([mixed], allow_mixed=True)
    assert out["sources"] == ["LOCALDATA", "TOURAPI"]


def _backend_sources() -> tuple[set[str], set[str]]:
    """(앱 enum, DB CHECK) — 둘 다 정본에서 직접 읽는다."""
    root = next(p for p in Path(__file__).resolve().parents
                if (p / "backend/modules/place-data").is_dir())
    kt = root / "backend/modules/place-data/src/main/kotlin/com/trippilot/placedata/domain/Poi.kt"
    m = re.search(r"enum class PoiSource \{([^}]*)\}", kt.read_text(encoding="utf-8"))
    assert m is not None
    app = {v.strip() for v in m.group(1).split(",") if v.strip()}

    mig = root / "backend/app/src/main/resources/db/migration"
    best, best_key = None, ()
    for f in mig.glob("V*.sql"):
        if "poi_source_check" not in f.read_text(encoding="utf-8"):
            continue
        nums = tuple(int(x) for x in re.findall(r"\d+", f.name.split("__")[0]))
        if nums > best_key:
            best, best_key = f, nums
    assert best is not None
    m2 = re.search(r"source IN \(([^)]*)\)", best.read_text(encoding="utf-8"))
    assert m2 is not None
    return app, {v.strip().strip("'") for v in m2.group(1).split(",")}


def test_공유본의_모든_출처를_백엔드가_받는다() -> None:
    """**배포 순서 사고를 기계로 막는다.**

    공유본에 백엔드가 모르는 출처가 섞인 채 배포되면 수신이 문서째 400 으로 거부하고,
    적재 Job 이 실패해 **배포 전체가 실패**한다. 공유본과 enum·CHECK 는 같은 리포·같은
    커밋에 있으므로, 한쪽만 앞서 나가는 것을 여기서 잡을 수 있다.

    (2026-10-14 trippilot-f7 이 짚은 위험. OVERTURE 는 V2.71 에서 열었다.)
    """
    doc = json.loads((_DATA / "collected_pois.json").read_text(encoding="utf-8"))
    used = {p.get("source") for p in doc["proposals"] if p.get("source")}
    used |= {doc["source"]} if doc.get("source") else set()
    used |= set(doc.get("sources") or [])
    app, db = _backend_sources()
    assert used <= app, f"백엔드 enum 에 없는 출처가 공유본에 있다: {sorted(used - app)}"
    assert used <= db, f"DB CHECK 에 없는 출처가 공유본에 있다: {sorted(used - db)}"


# ── 병합 키는 (출처, content_id) — 백엔드 유일키와 같은 모양 (2026-10-15) ──
# ai-e3 Codex 리뷰. `content_id` 만으로 잡으면 다른 출처의 같은 번호가 서로를 덮고,
# 그 행이 `--close-missing` 에서 "목록 부재"로 읽혀 **살아 있는 POI 가 퇴출된다.**
def _keyed_doc(source: str, *ids: str, at: str = "2026-10-15T00:00:00+00:00") -> dict:
    return {
        "schema_version": 1, "source": source, "collected_at": at,
        "area_code": "1", "content_types": ["12"], "stats": {},
        "proposals": [
            {"provisional_id": f"{source.lower()}-{i}", "source": source,
             "poi": {"poi_id": f"{source.lower()}-{i}", "name": f"{source}-{i}",
                     "category": "SIGHT",
                     "coord": {"lat": 37.5, "lng": 127.0}, "open_hours": [],
                     "avg_cost": None, "rating": None, "saved_count": 0,
                     "quality": "PARTIAL", "source": "PLACES_API", "confidence": None,
                     "tags": [], "source_ref": None},
             "tags": [], "region": "중구", "opening_hours_raw": None,
             "provenance": {"content_id": i, "address": "서울특별시 중구 1", "image_url": None}}
            for i in ids
        ],
    }


def test_같은_번호가_다른_출처면_둘_다_남는다() -> None:
    """실제 재현 — `merge([TOURAPI id=42, LOCALDATA id=42])` 가 1건이 되고 있었다."""
    out = merge([_keyed_doc("TOURAPI", "42"), _keyed_doc("LOCALDATA", "42")], allow_mixed=True)
    assert out["stats"]["unique_proposals"] == 2
    assert {(p["source"], p["provenance"]["content_id"]) for p in out["proposals"]} == {
        ("TOURAPI", "42"), ("LOCALDATA", "42")}


def test_같은_출처_같은_번호는_나중_수집분이_이긴다() -> None:
    """덮어쓰기 방향은 그대로다 — 재제안 = 변경 감지분."""
    early = _keyed_doc("TOURAPI", "42", at="2026-10-01T00:00:00+00:00")
    late = _keyed_doc("TOURAPI", "42", at="2026-10-15T00:00:00+00:00")
    late["proposals"][0]["poi"]["name"] = "나중 것"
    out = merge([late, early], allow_mixed=True)   # 입력 순서와 무관하게 수집 시각으로 정렬
    assert out["stats"]["unique_proposals"] == 1
    assert out["proposals"][0]["poi"]["name"] == "나중 것"


def test_항목_source_가_없으면_문서_source_를_쓴다() -> None:
    """수신도 그 순서로 읽는다 — 항목이 정본, 없으면 문서."""
    doc = _keyed_doc("TOURAPI", "42")
    del doc["proposals"][0]["source"]
    out = merge([doc, _keyed_doc("LOCALDATA", "42")], allow_mixed=True)
    assert out["stats"]["unique_proposals"] == 2


def test_세_출처의_번호_꼴은_겹치지_않는다() -> None:
    """실측 근거 고정 — 지금 충돌 0 인 이유는 **운이 아니라 꼴이 다르기** 때문이다.

    공유본 실측(2026-10-15): TOURAPI 숫자만 19,079 · LOCALDATA 관리번호(하이픈) 36,931 ·
    OVERTURE UUID 1,195, 쌍별 교집합 전부 0. 네 번째 출처가 숫자나 UUID 를 쓰면 깨진다.
    """
    import re
    tourapi, localdata, overture = "1000981", "3000000-101-1967-03256", \
        "00a0d0a8-7d8f-4786-843e-fe5ad0b3b501"
    assert re.fullmatch(r"\d+", tourapi)
    assert not re.fullmatch(r"\d+", localdata) and not re.fullmatch(r"\d+", overture)
    assert len({tourapi, localdata, overture}) == 3


# ── 판정 reject 소급 (2026-10-15) ──────────────────────────────────────
# 불변식: **공유본에는 reject 판정을 받은 행이 없다.** 기준을 조이면(프롬프트 판본 상승)
# 이미 적재된 행에도 소급돼야 한다 — 종전엔 손으로 지워야 했고 다음 수집에 다시 들어왔다.
def _verdict_file(tmp_path, verdicts: dict):
    p = tmp_path / "v.json"
    p.write_text(json.dumps({"verdicts": verdicts}, ensure_ascii=False), encoding="utf-8")
    return p


def test_reject_판정은_빠지고_accept_와_미판정은_남는다(tmp_path) -> None:
    props = (_keyed_doc("OVERTURE", "a")["proposals"]
             + _keyed_doc("OVERTURE", "b")["proposals"]
             + _keyed_doc("TOURAPI", "c")["proposals"])
    path = _verdict_file(tmp_path, {
        "a": {"verdict": "reject", "prompt": "4"},
        "b": {"verdict": "accept", "prompt": "4"},
    })                                      # "c" 는 판정 없음(TourAPI — 판정 대상이 아니다)
    assert drop_rejected_verdicts(props, path) == 1
    assert [p["provenance"]["content_id"] for p in props] == ["b", "c"]


def test_판정_파일이_없으면_아무것도_빼지_않는다(tmp_path) -> None:
    props = _keyed_doc("OVERTURE", "a")["proposals"]
    assert drop_rejected_verdicts(props, tmp_path / "없는파일.json") == 0
    assert len(props) == 1


def test_판정_파일이_깨져도_배치를_죽이지_않는다(tmp_path) -> None:
    """근거를 못 읽으면 판정하지 않는 것이 맞다 — 수집 본업은 돌아야 한다(INV-4 정신)."""
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    props = _keyed_doc("OVERTURE", "a")["proposals"]
    assert drop_rejected_verdicts(props, bad) == 0
    assert len(props) == 1


def test_reject_가_없으면_목록을_건드리지_않는다(tmp_path) -> None:
    props = _keyed_doc("OVERTURE", "a")["proposals"]
    path = _verdict_file(tmp_path, {"a": {"verdict": "accept", "prompt": "4"}})
    assert drop_rejected_verdicts(props, path) == 0
    assert len(props) == 1


# ── 클럽은 웹 큐레이션(KAKAO_LOCAL) 것만 (2026-10-18) ─────────────────────
def _tagged(source: str, cid: str, tags: list[str]) -> dict:
    p = _keyed_doc(source, cid)["proposals"][0]
    p["tags"] = tags
    return p


def test_클럽은_큐레이션_출처만_남고_다른_나이트라이프는_그대로다() -> None:
    props = [_tagged("OVERTURE", "a", ["나이트라이프", "클럽"]),
             _tagged("KAKAO_LOCAL", "1", ["나이트라이프", "클럽"]),
             _tagged("OVERTURE", "b", ["나이트라이프", "와인바"])]
    assert M.drop_bad_nightlife(props) == 1
    assert [p["provenance"]["content_id"] for p in props] == ["1", "b"]


def test_큐레이션_목록은_항목마다_근거가_있다() -> None:
    """이름은 사람이 웹에서 골랐다 — 근거 없는 항목은 '인기'라는 주장의 출처가 없다."""
    seed = json.loads((_DATA / "curated_popular_places.json").read_text(encoding="utf-8"))
    assert all(s["evidence"] in seed["evidence"] for s in seed["places"])


# ── 주소 시도 약칭 → 정식 이름 (2026-10-19) ─────────────────────────────
def test_시도_약칭만_정식_이름으로_편다() -> None:
    props = [{"provenance": {"address": "강원 속초시 장사동 632-250"}},
             {"provenance": {"address": "충청북도 단양군 영춘면"}},          # 이미 정식 — 그대로
             {"provenance": {"address": None}}]
    abbrev = {"강원": "강원특별자치도", "충북": "충청북도"}
    assert M.expand_sido_abbrev(props, abbrev) == 1
    assert props[0]["provenance"]["address"] == "강원특별자치도 속초시 장사동 632-250"
    assert props[1]["provenance"]["address"] == "충청북도 단양군 영춘면"
    assert M.expand_sido_abbrev(props, abbrev) == 0                         # 멱등


def test_실제_카탈로그의_약칭_표는_한_키가_한_시도만_가리키고_정식_이름과_겹치지_않는다() -> None:
    """표는 setdefault 로 만들어 키 충돌이 조용히 "먼저 온 쪽"으로 처리되고, 정식 이름과 같은 키는 조용히 빠진다
    (`pop`). 카탈로그가 바뀌어(통합시 신설 등) 한 시도의 약칭이 다른 시도의 키·정식 이름과 같아지면 엉뚱한 시도로
    펴지거나 펴지지 않는다 — 실제 카탈로그에서 막는다. 특정 시도 이름을 박지 않는다(카탈로그 변경에도 견디게)."""
    from collect_localdata import _MIGRATION, load_regions
    from trippilot.poi_curation.sourcing.overture_address import sido_abbreviations
    regions = load_regions(_MIGRATION / "R__seed_region_catalog.sql")
    sido = {n for _, n, _, lvl, _ in regions if lvl == "SIDO"}
    claims: dict[str, set[str]] = {}
    for name in sido:   # 각 시도가 만들 수 있는 키를 따로 만들어 겹치는지 본다
        for key in sido_abbreviations([r for r in regions if r[1] == name]):
            claims.setdefault(key, set()).add(name)
    assert {k: v for k, v in claims.items() if len(v) > 1} == {}
    assert set(claims) & sido == set()
    abbrev = sido_abbreviations(regions)
    assert all(abbrev[n[:-1]] == n for n in sido if n[:-1] not in sido)   # 끝 글자 떼기는 모든 시도에서 제자리로 편다


def test_공유본의_모든_주소는_백엔드가_시도를_정한다() -> None:
    """**백엔드 실문서 IT(`regionUnresolved == 0`)의 거울.** 주소 첫 낱말이 카탈로그 시도 이름이 아니면
    백엔드가 지역 코드를 못 붙여 커버리지 집계에서 빠진다 — #1352 가 약칭 3건으로 백엔드 CI 를 깼다.
    여기서 먼저 잡는다(같은 카탈로그 파일을 읽는다)."""
    from collect_localdata import _MIGRATION, load_regions
    sido = {n for _, n, _, lvl, _ in load_regions(_MIGRATION / "R__seed_region_catalog.sql") if lvl == "SIDO"}
    doc = json.loads((_DATA / "collected_pois.json").read_text(encoding="utf-8"))
    bad = [(p["source"], p["provenance"]["content_id"], p["provenance"].get("address"))
           for p in doc["proposals"]
           if _backend_first_token((p.get("provenance") or {}).get("address")) not in sido]
    assert bad == [], f"백엔드가 시도를 못 정하는 주소 {len(bad)}건: {bad[:5]}"


def _backend_first_token(address: str | None) -> str | None:
    """`RegionResolver.resolve` 의 첫 토큰을 그대로 흉내 낸다. 주소가 없으면 백엔드는 미판정으로 세니 None 이다.
    Kotlin `Regex("\\s+")` 는 ASCII 공백만 나누므로 `str.split()`(NBSP·U+3000 도 나눔)을 쓰면 거울이 느슨해진다."""
    tokens = [t for t in re.split(r"[ \t\n\x0b\f\r]+", (address or "").strip(_KT_WHITESPACE)) if t.strip(_KT_WHITESPACE)]
    return tokens[0] if tokens else None


# Kotlin `trim()`·`isBlank()` 의 공백(Char.isWhitespace) — Python `isspace` 와 U+0085(NEL) 하나만 다르다(BMP 전수 대조).
_KT_WHITESPACE = "".join(c for c in map(chr, range(0x10000)) if c.isspace() and c != "\x85")


def test_거울의_첫_토큰은_백엔드와_같이_자른다() -> None:
    assert _backend_first_token(None) is None
    assert _backend_first_token("  ") is None                                  # 백엔드: 미판정
    assert _backend_first_token("부산광역시\u3000사하구") == "부산광역시\u3000사하구"  # 백엔드: 한 토큰
    assert _backend_first_token(" 부산광역시  사하구") == "부산광역시"
    assert _backend_first_token("\x85부산광역시 사하구") == "\x85부산광역시"      # Kotlin trim 은 NEL 을 안 자른다


# ── 공유본 직렬화 — 한 행에 한 줄 (2026-10-18) ─────────────────────────
def test_공유본은_한_행에_한_줄이고_되읽으면_같다() -> None:
    doc = merge([_keyed_doc("TOURAPI", "1", "2")], allow_mixed=True)
    text = M.dumps_doc(doc)
    assert json.loads(text) == doc
    assert sum(ln.lstrip().startswith('{"provisional_id"') for ln in text.splitlines()) == 2
    assert json.loads(M.dumps_doc({**doc, "proposals": []}))["proposals"] == []
