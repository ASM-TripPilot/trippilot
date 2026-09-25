"""페르소나 예산으로 POI 를 고른다 — 입장료 파생 지식이 점수까지 닿는가.

2026-09-24 결정: 입장료는 **AI 쪽 파생 지식**으로 둔다(백엔드 read 경계에 가격 필드
없음, `sourceRef` 조인 키 패턴). 용도는 표시가 아니라 **일정 생성 시 예산에 맞는
POI 선택**이다.

고정하는 줄:

    FeeTable(place_fees.json)
      → ScheduleAgent._rule_scores (조인: Poi.source_ref)
      → build_rule_score(fee_won=…)
      → admission_fit — 예산 초과만 감점

그리고 **켜지기 전 동작이 안 바뀌는 것**을 같이 고정한다 — 파일이 없으면 전 POI 가
'모름'이라 점수가 종전과 같아야 한다. 이게 깨지면 배포가 조용히 일정을 바꾼다.
"""

from __future__ import annotations

import json

from trippilot.assembly_engine.scorer import admission_fit, build_rule_score
from trippilot.domain.common import BudgetLevel, GeoPoint, PoiId
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.poi_curation.place_fees import EMPTY, FeeTable, load_fee_table


def _poi(pid: str, category: PoiCategory = PoiCategory.SIGHT,
         ref: str | None = None) -> Poi:
    return Poi(
        poi_id=PoiId(pid), name=pid, category=category,
        coord=GeoPoint(37.5, 127.0), open_hours=(), avg_cost=None, rating=None,
        quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None,
        source_ref=ref,
    )


# ── 파일 로딩 ─────────────────────────────────────────────────────────


def test_파일이_없으면_전부_모름이다() -> None:
    """켜지기 전 동작 = 켜진 뒤 '모름' 동작. 이게 안전 조건이다."""
    table = load_fee_table(__import__("pathlib").Path("/없는/경로/place_fees.json"))
    assert table.of("1013246") is None
    assert table.won == {}


def test_깨진_파일도_예외를_안_올린다(tmp_path) -> None:
    """요금은 부가 정보다 — 형식이 깨졌다고 일정이 실패하면 안 된다 (INV-4)."""
    bad = tmp_path / "place_fees.json"
    bad.write_text('{"fees": "배열이_아니라_문자열"}', encoding="utf-8")
    assert load_fee_table(bad).won == {}


def test_이상한_행_하나가_전량을_죽이지_않는다(tmp_path) -> None:
    """5천 건대에서 산출기의 사소한 버그 하나가 기능을 통째로 끄면 안 된다.

    그것도 **조용히** 꺼진다 — 빈 표는 전 POI 가 '모름'이라 점수가 정상처럼 보이고
    예산만 안 먹는다. 예외도 안 난다. 그래서 행 단위로 견디고 버린 수를 센다.
    """
    path = tmp_path / "place_fees.json"
    path.write_text(json.dumps({"fees": {
        "ok-1": {"won": 0, "raw": "무료"},
        "ok-2": {"won": 12000, "raw": "성인 12,000원"},
        "bad-1": {"won": "12,000원", "raw": "산출기가 문자열을 냄"},
        "bad-2": {"raw": "won 키가 없음"},
        "ok-3": {"won": None, "raw": "상이함"},
    }}, ensure_ascii=False), encoding="utf-8")
    table = load_fee_table(path)

    assert len(table.won) == 3          # 멀쩡한 것은 전부 산다
    assert table.malformed == 2         # 버린 수가 드러난다 (침묵 금지)
    assert table.of("ok-2") == 12000


def test_모수가_있으면_커버리지가_파일에서_나온다(tmp_path) -> None:
    """반쪽 파일인지 읽는 쪽이 판단할 근거 — **임계를 안 만들고** 드러낸다.

    소비 측에 "예상보다 적으면 경고"를 두면 그 수가 또 하나의 근거 없는 상수가 된다
    (얇은 표본으로 경계를 정하지 말자던 것과 같은 함정). 모수를 같이 실으면 계산된다.
    """
    path = tmp_path / "place_fees.json"
    path.write_text(json.dumps({"attempted": 10, "fees": {
        f"r{i}": {"won": 0, "raw": "무료"} for i in range(4)}}), encoding="utf-8")
    table = load_fee_table(path)

    assert table.attempted == 10
    assert table.coverage() == 0.4


def test_모수가_없는_옛_파일은_커버리지를_모른다고_한다(tmp_path) -> None:
    """`0.0` 으로 답하면 "전부 실패"로 읽힌다 — 모르는 것과 0은 다르다."""
    path = tmp_path / "place_fees.json"
    path.write_text(json.dumps({"fees": {"r1": {"won": 0, "raw": "무료"}}}),
                    encoding="utf-8")
    assert load_fee_table(path).coverage() is None


def test_정상_파일은_버린_행이_0이다(tmp_path) -> None:
    """`malformed > 0` 이 산출기 결함 신호로 쓰이려면 정상일 때 0이어야 한다."""
    path = tmp_path / "place_fees.json"
    path.write_text(json.dumps({"fees": {"r1": {"won": 0, "raw": "무료"}}}),
                    encoding="utf-8")
    assert load_fee_table(path).malformed == 0


def test_무료와_불명과_키부재를_가른다(tmp_path) -> None:
    """합치면 파서를 고칠 근거가 사라진다 — `일반 9,000원` 버그를 잡은 게 그 구분이었다."""
    path = tmp_path / "place_fees.json"
    path.write_text(json.dumps({"fetched_at": "2026-09-24", "fees": {
        "free-1": {"won": 0, "raw": "무료"},
        "paid-1": {"won": 12000, "raw": "성인 (20~65세) 12,000원"},
        "unk-1": {"won": None, "raw": "공연 별로 상이함"},
    }}), encoding="utf-8")
    table = load_fee_table(path)

    assert table.of("free-1") == 0        # 측정된 무료
    assert table.of("paid-1") == 12000
    assert table.of("unk-1") is None      # 봤는데 못 읽음
    assert table.of("없는키") is None      # 볼 것이 없었음
    # 점수에서는 뒤 둘이 같게 다뤄지지만, **세는 것은 따로 센다**
    assert table.counts() == {"free": 1, "paid": 1, "unparsed": 1}


# ── 점수까지 닿는가 ────────────────────────────────────────────────────


def test_예산_초과_POI_만_점수가_내려간다() -> None:
    """같은 POI·같은 예산에서 요금만 바꿔 비교한다 — 다른 항은 전부 동일하다."""
    poi = _poi("p1", PoiCategory.SIGHT, ref="r1")
    base = build_rule_score(poi, BudgetLevel.LOW, None, 1, fee_won=None)
    free = build_rule_score(poi, BudgetLevel.LOW, None, 1, fee_won=0)
    cheap = build_rule_score(poi, BudgetLevel.LOW, None, 1, fee_won=5_000)
    over = build_rule_score(poi, BudgetLevel.LOW, None, 1, fee_won=30_000)

    assert free == base == cheap    # 모름·무료·예산 안 — 전부 같다
    assert over < base              # 초과만 내려간다


def test_요금을_아는_것이_이득이_되지_않는다() -> None:
    """커버리지 편향이 구조적으로 생길 수 없는 근거 — 성질 테스트의 구체 사례.

    요금 레코드가 있는 무료 공원과 없는 무료 공원이 **같은 점수**여야 한다.
    """
    a, b = _poi("p1", PoiCategory.NATURE, ref="r1"), _poi("p1", PoiCategory.NATURE)
    with_record = build_rule_score(a, BudgetLevel.LOW, None, 1, fee_won=0)
    without = build_rule_score(b, BudgetLevel.LOW, None, 1, fee_won=None)
    assert with_record == without


def test_임계가_없는_카테고리는_요금이_있어도_중립이다() -> None:
    """FOOD·CAFE 는 요금 커버리지가 구조적으로 0% 고, ACTIVITY 는 표본 n=6 이라 뺐다.

    임계를 안 만든 카테고리에 값이 들어와도 점수를 흔들면 안 된다 — 근거 없는
    임계로 자르는 것과 같아진다.
    """
    for category in (PoiCategory.FOOD, PoiCategory.CAFE, PoiCategory.ACTIVITY):
        assert (admission_fit(99_000, category, BudgetLevel.LOW)
                == admission_fit(None, category, BudgetLevel.LOW)), category


def test_감점이_카테고리_선호를_뒤집지_않는다() -> None:
    """하드 배제가 아니다 — 예산 초과 POI 도 배치될 수 있어야 한다.

    부분 데이터로 후보를 없애면 원천 오타 하나가 장소를 조용히 지운다
    (실측: `청소년 181,000원` = 18,000 오타).
    """
    sight_over = build_rule_score(
        _poi("p1", PoiCategory.SIGHT), BudgetLevel.LOW, None, 1, fee_won=45_000)
    cafe_free = build_rule_score(
        _poi("p2", PoiCategory.CAFE), BudgetLevel.LOW, None, 1, fee_won=None)
    # SIGHT 1.0 - 0.1 = 0.9 vs CAFE 0.6 + 0.1 = 0.7 — 감점을 먹어도 선호가 이긴다
    assert sight_over > cafe_free


# ── 조인: 에이전트가 source_ref 로 맞추는가 ────────────────────────────


def test_에이전트가_source_ref_로_요금을_맞춘다() -> None:
    """조인 키가 어긋나면 남의 요금으로 점수가 깎인다 — KB-5 와 같은 위험이다."""
    table = FeeTable(won={"r-expensive": 40_000, "r-free": 0})
    cheap_poi = _poi("p1", PoiCategory.SIGHT, ref="r-free")
    pricey_poi = _poi("p2", PoiCategory.SIGHT, ref="r-expensive")

    assert table.of(cheap_poi.source_ref) == 0
    assert table.of(pricey_poi.source_ref) == 40_000
    assert table.of(None) is None            # ref 없는 POI 는 조용히 모름
    assert EMPTY.of("r-expensive") is None   # 빈 표는 아무것도 모른다


# ── 실물 표본 회귀 (운영·데이터 세션 산출기가 실제로 낸 파일) ──────────


def test_실물_표본을_그대로_읽는다() -> None:
    """손으로 만든 픽스처는 `<br>`·개행·탭·비ASCII 를 안 본다 — 실 산출물이 본다.

    표본 521건 실측(2026-09-24): `<br>` 93건 · 개행 69건 · 탭 1건 · 비ASCII 521건.
    포맷 계약이 3일치 수집 **뒤에** 틀리면 그 3일이 날아가므로 먼저 고정한다.

    파일이 없으면(수집 완료 후 삭제 예정) 건너뛴다 — 없어진 것이 실패는 아니다.
    """
    import pathlib

    import pytest

    sample = pathlib.Path(__file__).resolve().parent.parent / "data" / "place_fees.sample.json"
    if not sample.exists():
        pytest.skip("실물 표본 미배치 — 전량 수집 후 삭제됨")

    table = load_fee_table(sample)

    assert table.malformed == 0, "실 산출물을 한 행도 못 읽으면 포맷 계약이 갈린 것이다"
    assert table.counts() == {"free": 393, "paid": 102, "unparsed": 26}
    assert table.attempted == 710
