"""merge_pois_docs — 병합 규칙과 영업시간 재파싱 (TRIP-392 · TRIP-687).

파서를 고쳐도 이미 수집된 것에는 소급되지 않는다 — 증분 색인이 "변경 없음"으로
스킵해 상세를 다시 안 받는다. 그래서 병합이 원문(`opening_hours_raw`)에서
`open_hours` 를 **현재 파서로** 다시 낸다. 2026-09-17 실측: 결측 15,859건 중
2,490건이 원문만 있고 파싱이 비어 있었다 — `상시 개방` 을 종일로 읽게 고친
PR #280 이 공유본에 반영되지 않은 채였다.
"""

from __future__ import annotations

import sys
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식(동일 디렉토리 경로)으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from merge_pois_docs import drop_non_travel, merge, reparse_open_hours  # noqa: E402


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
