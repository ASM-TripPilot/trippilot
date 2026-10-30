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
from collect_place_fees import _OVERNIGHT  # noqa: E402
from collect_pois import load_closed_refs  # noqa: E402
from trippilot.domain.poi import Poi  # noqa: E402
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
    assert out["stats"] == {"merged_runs": 2, "unique_proposals": 1, "cpyrht_applied": 0}


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
    p = {**_prop(cid, None, name=name), "source": source}
    p["provenance"]["address"] = "서울특별시 중구 1"   # 주소가 없으면 시도 게이트가 격리한다(TRIP-1475)
    return p


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
    props = [_tagged("OVERTURE", "a", ["술집", "클럽"]),
             _tagged("KAKAO_LOCAL", "1", ["술집", "클럽"]),
             _tagged("OVERTURE", "b", ["술집", "와인바"])]
    assert M.drop_bad_nightlife(props) == 1
    assert [p["provenance"]["content_id"] for p in props] == ["1", "b"]


def test_큐레이션_목록은_항목마다_근거가_있다() -> None:
    """이름은 사람이 웹에서 골랐다 — 근거 없는 항목은 '인기'라는 주장의 출처가 없다."""
    seed = json.loads((_DATA / "curated_popular_places.json").read_text(encoding="utf-8"))
    assert all(s["evidence"] in seed["evidence"] for s in seed["places"])


# ── 레포츠 캠핑장 소급 제거 (2026-10-30) ───────────────────────────────────
# 수집의 cat3 야영장 드롭은 옛 코드 전용이라 지금 수집엔 거의 안 걸리고, 공유본 행엔 벤더 분류 코드가 없다 — 이 이름
# 규칙이 실제 방어선이다. 이름은 전부 공유본 실물.
def _camp(name: str, *, source: str = "TOURAPI", kind: str | None = "28", category: str = "ACTIVITY") -> dict:
    p = _keyed_doc(source, name)["proposals"][0]
    p["poi"]["name"], p["poi"]["category"] = name, category
    if kind is not None:
        p["provenance"]["content_type_id"] = kind
    return p


@pytest.mark.parametrize("name", [
    "가반나야영장", "월악산국립공원 용하야영장", "수주팔봉 야영지", "포천글램핑앤카라반", "숲내음펜션", "노르딕민박",
    "캠핑포유 펜션&캠핑", "메타피아 오래 캠핑장＆카라반",   # 묶인 상호 — 양쪽 다 숙영지(전각 ＆ 도 구분자다)
    "A&J오토캠핑장",                                    # 한 글자 조각은 상호의 일부
])
def test_레포츠로_들어온_숙영지는_빠진다(name: str) -> None:
    props = [_camp(name)]
    assert M.drop_camping(props) == 1 and props == []


@pytest.mark.parametrize(("name", "source", "kind", "category"), [
    # 레포츠 TourAPI 가 아니면 이름이 캠핑이어도 남는다 — 캠핑장 안 식당은 시설 이름으로 인허가를 낸다
    ("칡소폭포 캠핑장(식당)", "LOCALDATA", None, "FOOD"),
    ("높은터캠핑식당", "LOCALDATA", None, "FOOD"),
    ("잉카마야박물관&캠핑장", "TOURAPI", "14", "CULTURE"),
    ("캠핑7", "TOURAPI", "39", "FOOD"),
    ("고릴라캠핑 송도점", "TOURAPI", "38", "SHOPPING"),
    ("국립김천숲속야영장", "TOURAPI", "12", "NATURE"),   # 일일 개장이 있는 관광지 — 규칙 밖
    # 레포츠지만 낮 방문지 — `휴양림` 은 어휘에서 뺐고, 묶인 상호는 전부 숙영지일 때만 뺀다
    ("영인산자연휴양림 스카이어드벤처 (영인산 짚라인)", "TOURAPI", "28", "ACTIVITY"),
    ("바라산자연휴양림", "TOURAPI", "28", "ACTIVITY"),
    ("노랑카라반&고카트", "TOURAPI", "28", "ACTIVITY"),
    ("노랑카라반＆고카트", "TOURAPI", "28", "ACTIVITY"),   # 전각 ＆ — 만든 예(공유본 전각 묶음 2곳은 양쪽 다 숙영지)
    ("용인엑스파크공원", "TOURAPI", "28", "ACTIVITY"),
    # 타입·카테고리 중 하나만 어긋나도 남는다 — 공유본엔 없는 조합이라 이름만 빌렸다(만든 예)
    ("국립김천숲속야영장", "TOURAPI", "12", "ACTIVITY"),
    ("가반나야영장", "TOURAPI", "28", "FOOD"),
])
def test_숙영지가_아니거나_레포츠_TourAPI_가_아니면_남는다(name, source, kind, category) -> None:
    props = [_camp(name, source=source, kind=kind, category=category)]
    assert M.drop_camping(props) == 0 and len(props) == 1


def test_어휘는_요금_수집의_1박_표지에서_휴양림만_뺐다() -> None:
    """한쪽에만 낱말을 더하면 '1박 요금이라 안 읽은 곳'과 '숙영지라 뺀 곳'이 조용히 갈라진다 — 여기서 걸린다."""
    assert set(M._CAMPING.pattern.split("|")) == set(_OVERNIGHT.pattern.split("|")) - {"휴양림"}


def test_main이_캠핑장_제거를_stats에_남기고_축소_가드에_센다(tmp_path: Path) -> None:
    """축소 가드는 `retro_dropped_existing` 을 빼고 비교한다 — 공유본에 있던 캠핑장이 거기 들어가야 배치가 안 빨개진다."""
    shared = _keyed_doc("TOURAPI", "1")
    shared["proposals"].append(_camp("가반나야영장"))
    path = tmp_path / "shared.json"
    path.write_text(json.dumps(shared, ensure_ascii=False), encoding="utf-8")
    assert M.main(["-o", str(path), str(path)]) == 0
    stats = json.loads(path.read_text(encoding="utf-8"))["stats"]
    assert (stats["camping_dropped"], stats["retro_dropped_existing"], stats["unique_proposals"]) == (1, 1, 1)
    assert M.main(["-o", str(path), str(path)]) == 0     # 다시 돌리면 뺄 것이 없다
    assert "camping_dropped" not in json.loads(path.read_text(encoding="utf-8"))["stats"]


@settings(max_examples=150, deadline=None)
@given(rows=st.lists(st.tuples(
    st.sampled_from(["TOURAPI", "LOCALDATA", "OVERTURE", "KAKAO_LOCAL"]),
    st.sampled_from([None, "12", "14", "28", "38", "39"]),
    st.sampled_from(["ACTIVITY", "FOOD", "NATURE", "CULTURE"]),
    st.text(alphabet="캠핑야영장글램카라반펜션민박오토휴양림고트&, ", min_size=1, max_size=12),
), max_size=12))
def test_pbt_레포츠_TourAPI_ACTIVITY_밖은_어떤_이름도_안_빠지고_두_번째는_무동작(rows) -> None:
    props = [_camp(n, source=s, kind=k, category=c) for s, k, c, n in rows]
    others = [p for p in props if (p["source"], p["provenance"].get("content_type_id"), p["poi"]["category"])
              != ("TOURAPI", "28", "ACTIVITY")]
    n = M.drop_camping(props)
    assert n == len(rows) - len(props)
    assert all(any(q is p for q in props) for p in others)
    assert M.drop_camping(props) == 0


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
    back = json.loads(text)
    # `poi` 의 기본값 키만 빠지고(100MiB 한도, 2026-10-30) 나머지는 그대로, 도메인으로 읽으면 같다
    assert {**back, "proposals": None} == {**doc, "proposals": None}
    for o, n in zip(doc["proposals"], back["proposals"], strict=True):
        assert {k: v for k, v in o.items() if k != "poi"} == {k: v for k, v in n.items() if k != "poi"}
        assert Poi.from_dict(n["poi"]) == Poi.from_dict(o["poi"])
    assert sum(ln.lstrip().startswith('{"provisional_id"') for ln in text.splitlines()) == 2
    assert json.loads(M.dumps_doc({**doc, "proposals": []}))["proposals"] == []


def test_공유본은_poi_기본값_키를_싣지_않고_값이_있으면_싣는다() -> None:
    p = {"provisional_id": "x", "poi": {"name": "a", "avg_cost": None, "rating": None, "confidence": None,
                                        "source_ref": None, "saved_count": 0, "tags": []}}
    assert M._slim(p)["poi"] == {"name": "a"}
    kept = {"name": "a", "avg_cost": 5000, "rating": 4.1, "saved_count": 3, "tags": ["한식"], "source_ref": "9"}
    assert M._slim({"poi": kept})["poi"] == kept
    assert M._slim({"provisional_id": "x"}) == {"provisional_id": "x"}   # poi 없는 행은 그대로


# ── 머지 전 게이트 — 백엔드가 시도를 못 정하는 행은 격리 (TRIP-1475) ──────
def test_시도_토큰은_백엔드_RegionResolver_와_같이_자른다() -> None:
    """운영 규칙(`backend_sido_token`)을 고정한다 — 경계마다 JDK 25 jshell 로 본 Kotlin 결과와 같다."""
    assert M.backend_sido_token(None) is None
    assert M.backend_sido_token("") is None                                    # 백엔드: 미판정
    assert M.backend_sido_token("   ") is None                                 # 공백뿐 — 미판정
    assert M.backend_sido_token("\t\n") is None
    assert M.backend_sido_token(" \u3000 ") is None                           # 전각 공백만 — Kotlin trim 이 다 자른다
    assert M.backend_sido_token(" 부산광역시  사하구") == "부산광역시"
    assert M.backend_sido_token("부산광역시\t사하구") == "부산광역시"              # 탭은 Java `\s` — 나눈다
    assert M.backend_sido_token("부산광역시\u3000사하구") == "부산광역시\u3000사하구"  # `\s` 는 ASCII 만 나눈다 — 한 토큰
    assert M.backend_sido_token("부산광역시\xa0사하구") == "부산광역시\xa0사하구"      # NBSP 도 한 토큰
    assert M.backend_sido_token("\xa0부산광역시 사하구") == "부산광역시"            # 앞 NBSP 는 Kotlin trim 이 자른다
    assert M.backend_sido_token("\x85부산광역시 사하구") == "\x85부산광역시"        # Kotlin trim 은 NEL 을 안 자른다
    assert M.backend_sido_token("\x85") == "\x85"                                 # NEL 하나 — 백엔드도 빈 값이 아니다


def _state(proposed: dict[str, str]) -> dict:
    """수집기가 읽는 꼴의 최소 상태(`state.parse_state` 통과)."""
    return {"schema_version": 1, "cursors": {}, "proposed": proposed}


def _run_doc(tmp_path: Path, doc: dict, *extra: str, state: object = None,
             earlier: dict | None = None) -> tuple[int, Path, Path]:
    """워크플로와 같은 꼴로 돌린다 — `-o` 공유본(= BEFORE, `earlier`, 없으면 빈 공유본)을 첫 입력으로 다시 읽는다.
    `state` 를 주면 `--state` 로 게이트를 켠다."""
    src, out, st_path = tmp_path / "in.json", tmp_path / "out.json", tmp_path / "state.json"
    src.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    shared = earlier if earlier is not None else _keyed_doc("TOURAPI", at="2026-09-01T00:00:00+00:00")
    out.write_text(json.dumps(shared, ensure_ascii=False), encoding="utf-8")
    args = ["-o", str(out), *extra, str(out), str(src)]
    if state is not None:
        st_path.write_text(json.dumps(state), encoding="utf-8")
        args = ["--state", str(st_path), *args]
    return M.main(args), out, st_path


def _gate_run(tmp_path: Path, addresses: dict[str, str | None], *extra: str,
              state: object = None, earlier: dict | None = None) -> tuple[int, Path, Path]:
    doc = _keyed_doc("TOURAPI", *addresses)
    for p in doc["proposals"]:
        p["provenance"]["address"] = addresses[p["provenance"]["content_id"]]
    return _run_doc(tmp_path, doc, *extra, state=state, earlier=earlier)


_GATE_ADDRESSES = {
    "ok": "서울특별시 중구 1",
    "abbr": "강원 속초시 장사동",          # 약칭은 펴서 살린다 — 격리가 아니다
    "cut": "제주특별 서귀포시 색달동",      # 두 글자 잘림 — 약칭 표로 못 편다
    "empty": "",
    "none": None,
    "nbsp": "부산광역시\xa0사하구",        # 백엔드는 한 토큰으로 본다
}


def _ids(out: Path) -> list[str]:
    return [p["provenance"]["content_id"] for p in json.loads(out.read_text(encoding="utf-8"))["proposals"]]


def test_시도를_못_정하는_행은_격리하고_나머지는_병합한다(tmp_path: Path) -> None:
    rc, out, _ = _gate_run(tmp_path, _GATE_ADDRESSES, state=_state({}))
    assert rc == 0
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert _ids(out) == ["ok", "abbr"]
    assert doc["stats"]["unique_proposals"] == 2
    assert doc["stats"]["sido_quarantined"] == 4
    assert [q["content_id"] for q in doc["stats"]["sido_quarantined_refs"]] == ["cut", "empty", "none", "nbsp"]
    assert doc["stats"]["sido_quarantined_refs"][0] == {
        "source": "TOURAPI", "content_id": "cut", "address": "제주특별 서귀포시 색달동"}


def test_state_없이는_격리하지_않고_합친_채_경고와_stats_만_남긴다(tmp_path: Path, capsys) -> None:
    """main 의 구 워크플로 사본은 `--state` 없이 부르고, 상태를 병합 **전에** 영속한다 — 거기서 빼면 영구 유실이다."""
    rc, out, _ = _gate_run(tmp_path, _GATE_ADDRESSES)
    assert rc == 0
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert _ids(out) == list(_GATE_ADDRESSES)
    assert "sido_quarantined" not in doc["stats"]
    assert doc["stats"]["sido_unresolved"] == 4
    assert [q["content_id"] for q in doc["stats"]["sido_unresolved_refs"]] == ["cut", "empty", "none", "nbsp"]
    err = capsys.readouterr().err
    assert err.count("::warning::") == 5 and "'cut'" in err


def test_state_없이는_상한을_넘어도_실패하지_않는다(tmp_path: Path) -> None:
    rc, out, _ = _gate_run(tmp_path, _GATE_ADDRESSES, "--max-quarantined", "0")
    assert rc == 0 and len(_ids(out)) == 6


def test_격리가_상한과_같으면_통과하고_하나_넘으면_실패한다(tmp_path: Path) -> None:
    rc, out, _ = _gate_run(tmp_path, _GATE_ADDRESSES, "--max-quarantined", "4", state=_state({}))
    assert rc == 0 and _ids(out) == ["ok", "abbr"]
    out.unlink()
    rc, out, _ = _gate_run(tmp_path, _GATE_ADDRESSES, "--max-quarantined", "3", state=_state({}))
    assert rc == 1


def test_격리가_임계를_넘으면_실패하고_공유본도_상태도_건드리지_않는다(tmp_path: Path) -> None:
    state = _state({"cut": "20261001", "ok": "20261001"})
    rc, out, st_path = _gate_run(tmp_path, _GATE_ADDRESSES, "--max-quarantined", "3", state=state)
    assert rc == 1
    assert _ids(out) == []                                       # 공유본은 그대로(빈 공유본)
    assert json.loads(st_path.read_text(encoding="utf-8")) == state


def test_격리한_TourAPI_행은_기제안_색인에서_빠진다(tmp_path: Path) -> None:
    state = _state({"cut": "20261001", "ok": "20261001", "none": "20261002"})
    rc, _, st_path = _gate_run(tmp_path, _GATE_ADDRESSES, state=state)
    assert rc == 0
    after = json.loads(st_path.read_text(encoding="utf-8"))
    assert after == _state({"ok": "20261001"})


def test_살아_있는_행이_깨진_주소로_다시_오면_앞_판본을_지킨다(tmp_path: Path) -> None:
    """키를 통째로 빼면 공유본에서 POI 가 사라져 `--close-missing` 이 살아 있는 POI 를 닫는다."""
    earlier = _keyed_doc("TOURAPI", "cut", "gone", at="2026-10-01T00:00:00+00:00")
    earlier["proposals"][0]["poi"]["name"] = "옛 판본"
    earlier["proposals"][0]["provenance"]["address"] = "제주 서귀포시 색달동"    # 앞 판본은 약칭 — 펴서 통과
    earlier["proposals"][1]["provenance"]["address"] = "제주특별 서귀포시"       # 앞 판본도 깨졌어도 공유본 행 — 남긴다
    state = _state({"cut": "20261015", "gone": "20261015"})
    rc, out, st_path = _gate_run(tmp_path, {"cut": "제주특별 서귀포시 색달동", "gone": "제주특별 서귀포시"},
                                 state=state, earlier=earlier)
    assert rc == 0
    doc = json.loads(out.read_text(encoding="utf-8"))
    kept = {p["provenance"]["content_id"]: p for p in doc["proposals"]}
    assert set(kept) == {"cut", "gone"}
    assert kept["cut"]["poi"]["name"] == "옛 판본"
    assert kept["cut"]["provenance"]["address"] == "제주특별자치도 서귀포시 색달동"
    assert [q["content_id"] for q in doc["stats"]["sido_restored_previous_refs"]] == ["cut"]
    # 통과하는 판본이 없어도 공유본에 있던 키는 빼지 않는다 — 빼면 `--close-missing` 이 살아 있는 POI 를 닫는다
    assert doc["stats"]["sido_quarantined_refs"] == []
    assert [q["content_id"] for q in doc["stats"]["sido_unresolved_refs"]] == ["gone"]
    assert "sido_quarantined_existing" not in doc["stats"]
    assert json.loads(st_path.read_text(encoding="utf-8"))["proposed"] == {"gone": "20261015"}


def test_되돌린_앞_판본도_영업시간을_다시_읽는다(tmp_path: Path) -> None:
    """되돌린 판본은 첫 소급 제거(재파싱 포함) 뒤에 들어온다 — 따로 재파싱하지 않으면 원문만 있고 시간은 빈 채로 남는다."""
    earlier = _keyed_doc("TOURAPI", "cut", at="2026-10-01T00:00:00+00:00")
    earlier["proposals"][0]["opening_hours_raw"] = "상시 개방"
    rc, out, _ = _gate_run(tmp_path, {"cut": "제주특별 서귀포시"}, state=_state({}), earlier=earlier)
    assert rc == 0
    [p] = json.loads(out.read_text(encoding="utf-8"))["proposals"]
    assert p["opening_hours_raw"] == "상시 개방"
    assert len(p["poi"]["open_hours"]) == 7


def test_되돌릴_후보_판정은_후보를_고치지_않는다() -> None:
    """판정은 순수해야 한다 — 고르지 않은 후보까지 재파싱되면 안 되고, 재파싱 건수는 `main` 이 센다."""
    p = _prop("1", "상시 개방")
    before = json.dumps(p, sort_keys=True)
    assert M._survives_retro_drops(p) is True
    assert json.dumps(p, sort_keys=True) == before


def test_소급_제거될_앞_판본으로는_되돌리지_않고_오늘_판본을_남긴다(tmp_path: Path) -> None:
    """옛 판본만 걸리는 규칙(옛 이름이 관광 무관)이 있으면, 되돌린 뒤 그 키가 통째로 빠져 지키려던 POI 가 닫힌다.
    그래서 되돌리지 않는다 — 공유본 키이므로 벤더가 지금 내보내는 오늘 판본을 경고와 함께 둔다."""
    earlier = _keyed_doc("TOURAPI", "store", at="2026-10-01T00:00:00+00:00")
    earlier["proposals"][0]["poi"]["name"] = "이마트24 강릉여고점"
    rc, out, st_path = _gate_run(tmp_path, {"store": "제주특별 서귀포시"}, state=_state({"store": "1"}),
                                 earlier=earlier)
    assert rc == 0
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert _ids(out) == ["store"]
    assert doc["proposals"][0]["poi"]["name"] == "TOURAPI-store"            # 오늘 판본
    assert [q["content_id"] for q in doc["stats"]["sido_unresolved_refs"]] == ["store"]
    assert "non_travel_dropped" not in doc["stats"]
    assert doc["stats"]["retro_dropped_existing"] == 0
    assert "sido_restored_previous_refs" not in doc["stats"]
    assert json.loads(st_path.read_text(encoding="utf-8"))["proposed"] == {"store": "1"}


def test_공유본에만_있는_미판정_행은_빼지_않고_경고만_한다(tmp_path: Path, capsys) -> None:
    """오늘 다시 온 행이 아니다 — 빼면 `--close-missing` 이 닫고, LOCALDATA 는 다시 수집되지 않아 영영 안 돌아온다."""
    earlier = _keyed_doc("LOCALDATA", "L1", at="2026-10-01T00:00:00+00:00")
    earlier["proposals"][0]["provenance"]["address"] = "미상도 속초시"
    state = _state({"L1": "x"})
    rc, out, st_path = _gate_run(tmp_path, {"ok": "서울특별시 중구 1"}, "--allow-mixed", state=state, earlier=earlier)
    assert rc == 0
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert sorted(_ids(out)) == ["L1", "ok"]
    assert "sido_quarantined" not in doc["stats"]
    assert doc["stats"]["sido_unresolved_refs"] == [
        {"source": "LOCALDATA", "content_id": "L1", "address": "미상도 속초시"}]
    assert json.loads(st_path.read_text(encoding="utf-8")) == state
    assert "공유본에 이미 있던 행" in capsys.readouterr().err


def test_공유본에만_있는_미판정_행은_상한에_세지_않는다(tmp_path: Path) -> None:
    earlier = _keyed_doc("TOURAPI", *[f"b{i}" for i in range(3)], at="2026-10-01T00:00:00+00:00")
    for p in earlier["proposals"]:
        p["provenance"]["address"] = "미상도 속초시"
    rc, out, _ = _gate_run(tmp_path, {"ok": "서울특별시 중구 1"}, "--max-quarantined", "0",
                           state=_state({}), earlier=earlier)
    assert rc == 0 and len(_ids(out)) == 4


def _restore_run(tmp_path: Path, n: int, cap: str) -> tuple[int, Path, Path]:
    """공유본의 정상 행 n 개가 오늘 깨진 주소로 다시 온다 — 전부 앞 판본으로 되돌아간다."""
    ids = [f"r{i}" for i in range(n)]
    earlier = _keyed_doc("TOURAPI", *ids, at="2026-10-01T00:00:00+00:00")
    return _gate_run(tmp_path, dict.fromkeys(ids, "서울특 중구"), "--max-quarantined", cap,
                     state=_state(dict.fromkeys(ids, "1")), earlier=earlier)


def test_복원도_상한에_센다(tmp_path: Path) -> None:
    """형식이 통째로 바뀌면 행은 살아도 기제안 색인이 한꺼번에 지워진다 — 그것도 사고로 멈춘다."""
    rc, out, st_path = _restore_run(tmp_path, 3, "3")
    assert rc == 0 and len(_ids(out)) == 3
    assert json.loads(st_path.read_text(encoding="utf-8"))["proposed"] == {}
    rc, out, st_path = _restore_run(tmp_path, 3, "2")
    assert rc == 1
    assert json.loads(st_path.read_text(encoding="utf-8"))["proposed"] == dict.fromkeys(["r0", "r1", "r2"], "1")


def test_어차피_소급_제거될_행은_격리로_세지_않는다(tmp_path: Path) -> None:
    doc = _keyed_doc("TOURAPI", "store")
    doc["proposals"][0]["poi"]["name"] = "이마트24 강릉여고점"
    doc["proposals"][0]["provenance"]["address"] = "제주특별 서귀포시"
    rc, out, _ = _run_doc(tmp_path, doc, "--max-quarantined", "0", state=_state({}))
    assert rc == 0
    stats = json.loads(out.read_text(encoding="utf-8"))["stats"]
    assert stats["non_travel_dropped"] == 1
    assert stats["retro_dropped_existing"] == 0                        # 오늘 처음 온 행 — 축소 가드에 안 더한다
    assert "sido_quarantined" not in stats


def test_state_파일이_없으면_아무것도_쓰지_않고_실패한다(tmp_path: Path) -> None:
    doc = _keyed_doc("TOURAPI", "cut")
    doc["proposals"][0]["provenance"]["address"] = "제주특별 서귀포시"
    src, out = tmp_path / "in.json", tmp_path / "out.json"
    src.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    assert M.main(["--state", str(tmp_path / "missing.json"), "-o", str(out), str(src)]) == 1
    assert not out.exists()


@pytest.mark.parametrize("bad", [[], {"schema_version": 1, "proposed": []}, {"schema_version": 1, "proposed": {"1": 2}},
                                 {"proposed": {}}])
def test_state_형식이_틀리면_아무것도_쓰지_않고_실패한다(tmp_path: Path, bad: object) -> None:
    """JSON 이기만 하면 통과시키면 색인 지우기가 공유본을 쓴 **뒤에** 터진다(반쪽 쓰기)."""
    rc, out, st_path = _gate_run(tmp_path, {"cut": "제주특별 서귀포시"}, state=bad)
    assert rc == 1
    assert _ids(out) == []
    assert json.loads(st_path.read_text(encoding="utf-8")) == bad


def test_state_를_주면_o_가_입력_중_하나여야_한다(tmp_path: Path) -> None:
    """덮어쓸 공유본을 모르면 공유본에만 있던 행을 그날 온 행으로 오인해 격리한다(다시 수집되지 않는 출처는 영영)."""
    shared = _keyed_doc("LOCALDATA", "L1", at="2026-10-01T00:00:00+00:00")
    shared["proposals"][0]["provenance"]["address"] = "미상도 속초시"
    old, new, st = tmp_path / "old.json", tmp_path / "new.json", tmp_path / "state.json"
    old.write_text(json.dumps(shared, ensure_ascii=False), encoding="utf-8")
    st.write_text(json.dumps(_state({})), encoding="utf-8")
    assert M.main(["--state", str(st), "--allow-mixed", "-o", str(new), str(old)]) == 1
    assert not new.exists()


def test_state_를_주고_o_공유본을_못_읽으면_그것을_말하고_실패한다(tmp_path: Path, capsys) -> None:
    """입력에 있는데 깨진 것 — "-o 가 입력이어야 한다"는 틀린 진단이다."""
    rc, out, _ = _gate_run(tmp_path, {"ok": "서울특별시 중구 1"}, state=_state({}))
    assert rc == 0
    out.write_text("{깨짐", encoding="utf-8")
    src, st = tmp_path / "in.json", tmp_path / "state.json"
    assert M.main(["--state", str(st), "-o", str(out), str(out), str(src)]) == 1
    assert out.read_text(encoding="utf-8") == "{깨짐"
    err = capsys.readouterr().err
    assert "덮어쓸 공유본" in err and "입력 문서 중 하나" not in err


def test_항목_source_가_없으면_문서_source_로_색인을_지운다(tmp_path: Path) -> None:
    """`merge` 는 항목 source 가 없으면 문서 source 를 쓴다 — 게이트·색인 지우기도 같은 규칙이어야 한다."""
    doc = _keyed_doc("TOURAPI", "cut")
    del doc["proposals"][0]["source"]
    doc["proposals"][0]["provenance"]["address"] = "제주특별 서귀포시"
    rc, out, st = _run_doc(tmp_path, doc, state=_state({"cut": "1"}))
    assert rc == 0
    stats = json.loads(out.read_text(encoding="utf-8"))["stats"]
    assert stats["sido_quarantined_refs"][0]["source"] == "TOURAPI"
    assert json.loads(st.read_text(encoding="utf-8"))["proposed"] == {}


def test_색인에서는_TourAPI_격리분만_지운다(tmp_path: Path) -> None:
    """색인 키는 TourAPI 번호다 — 다른 출처 행이 같은 번호여도 그 도장은 TourAPI 행의 것이라 지우지 않는다."""
    st_path = tmp_path / "state.json"
    st_path.write_text(json.dumps({"proposed": {"7": "a", "8": "b"}}), encoding="utf-8")
    assert M.forget_quarantined(st_path, [{"source": "LOCALDATA", "content_id": "7"},
                                          {"source": "TOURAPI", "content_id": "8"}]) == 1
    assert json.loads(st_path.read_text(encoding="utf-8"))["proposed"] == {"7": "a"}


# ── 공공누리 유형 — 실행이 목록에서 본 값을 기존 행에도 붙인다 (KB-5 요청, 2026-10-30) ──────
def test_병합은_실행의_공공누리_유형을_기존_행에도_붙이고_없는_행은_만들지_않는다() -> None:
    shared = _keyed_doc("TOURAPI", "1", "2")
    run = {**_keyed_doc("TOURAPI"), "collected_at": "2099-01-01T00:00:00+00:00",
           "cpyrht_by_ref": {"1": "Type3", "999": "Type1"}}
    out = merge([shared, run], allow_mixed=True)
    prov = {p["provenance"]["content_id"]: p["provenance"] for p in out["proposals"]}
    assert prov["1"]["cpyrht_div_cd"] == "Type3"
    assert "cpyrht_div_cd" not in prov["2"]
    assert "999" not in prov and "cpyrht_by_ref" not in out   # 공유본 머리에는 싣지 않는다
