"""merge_pois_docs — 병합 규칙과 영업시간 재파싱 (TRIP-392 · TRIP-687).

파서를 고쳐도 이미 수집된 것에는 소급되지 않는다 — 증분 색인이 "변경 없음"으로
스킵해 상세를 다시 안 받는다. 그래서 병합이 원문(`opening_hours_raw`)에서
`open_hours` 를 **현재 파서로** 다시 낸다. 2026-09-17 실측: 결측 15,859건 중
2,490건이 원문만 있고 파싱이 비어 있었다 — `상시 개방` 을 종일로 읽게 고친
PR #280 이 공유본에 반영되지 않은 채였다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식(동일 디렉토리 경로)으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import merge_pois_docs as M  # noqa: E402
from collect_pois import load_closed_refs  # noqa: E402
from merge_pois_docs import drop_closed, drop_non_travel, merge, reparse_open_hours  # noqa: E402

_DATA = Path(__file__).resolve().parents[1] / "data"


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
    cmd = "scripts/merge_pois_docs.py -o data/collected_pois.json data/collected_pois.json"
    readme = (_DATA / "README.md").read_text(encoding="utf-8")
    section = readme.split("## `poi_business_status.json`", 1)[1].split("\n## ", 1)[0]
    assert cmd in section
    reminder = _DATA.parents[1] / ".github" / "workflows" / "ai-business-status-reminder.yml"
    assert cmd in reminder.read_text(encoding="utf-8")
