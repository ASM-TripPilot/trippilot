"""KB-5 열린 검색 순위 재료(`hybrid_rank`) — 게이트·BM25·문서 순위·규칙 순위와의 융합. 실 호출 0.

증명하는 것:
  [융합]   ① fuse 는 입력의 순열(INV-1 — PBT) · 근거 0 이면 항등 · 문서 순위가 좋아지면 자리가 나빠지지 않는다(단조, PBT) ·
             문서 없는 장소끼리는 규칙 순서 그대로(PBT) · 동점은 규칙 순서
  [게이트] ② 대조군("서울 가볼 만한 곳"·"부산 맛집"·"제주 카페 추천"·"요즘 핫한"·"핫플레이스"·"인기 많은"·"먹을 만한 곳"·"관광지들")은
             닫힌다 · 묘사 낱말("조용한 북카페"·"실내")은 연다 · 속성 낱말만 남으면 G1 은 닫고 G2 는 연다 · BM25 낱말·항에 종류 이름·지역
             이름이 없다(PBT — 끝 붙은 종류 낱말·종류 이름 든 합성어까지, 2-gram 수준) · 관형형 끝을 뗀다
  [BM25]   ③ 근거 문턱 — BM25 0 인 장소는 임베딩이 높아도 문서 순위 밖 · 종류 이름 2-gram('북카페'의 '카페')만 맞은 곳도 밖 · 장소 점수는
             조각 합이 아니라 최댓값 · 제목은 색인하지 않는다 · IDF 는 늘 양수(모든 조각에 든 낱말도)
  [색인]   ④ 벡터 머리의 ids 만으로 source_ref → 조각 id · 깨진 파일(ids 가 null 인 머리 포함)은 그 몫만 빈다 · 스위치 기본 꺼짐
"""

from __future__ import annotations

import gzip
import json
import uuid
from dataclasses import replace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.kb import KbHit, KbKind
from trippilot.domain.poi.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.poi_curation import hybrid_rank as hr

_GENERIC = frozenset({"좋은", "괜찮은", "멋진", "예쁜", "근사한"})  # 도우미 `_GENERIC_WORDS` 와 같은 값(호출측이 넘긴다)


def _poi(i: int, ref: str | None = None) -> Poi:
    return Poi(poi_id=PoiId(str(uuid.uuid5(uuid.NAMESPACE_DNS, f"hr-{i}"))), name=f"장소{i}", category=PoiCategory.SIGHT,
               coord=GeoPoint(37.5, 127.0), open_hours=(), avg_cost=None, rating=None, quality=DataQuality.FULL,
               source=PoiSource.SEED, confidence=None, source_ref=ref if ref is not None else f"r{i}")


def _hit(ref: str, text: str, score: float = 0.5, title: str | None = None) -> KbHit:
    return KbHit(kb=KbKind.POI_DESC, doc_id=f"overview:{ref}#0", score=score, text=text, poi_ref=ref,
                 metadata={"title": title} if title else {})


# ── ① 융합 ────────────────────────────────────────────────────────────────────

_orders = st.integers(min_value=0, max_value=25).flatmap(
    lambda n: st.tuples(st.just(n), st.dictionaries(st.sampled_from([f"r{i}" for i in range(max(n, 1))]),
                                                    st.integers(min_value=1, max_value=30)),
                        st.sampled_from([0.5, 1.0, 2.0])))


@settings(max_examples=200, deadline=None)
@given(_orders)
def test_fuse_is_a_permutation_of_its_input(case) -> None:
    n, doc, w = case
    pois = [_poi(i) for i in range(n)]
    out = hr.fuse(pois, doc, w)
    assert sorted(map(str, (p.poi_id for p in out))) == sorted(map(str, (p.poi_id for p in pois)))
    assert len(out) == len(pois)


@settings(max_examples=200, deadline=None)
@given(_orders)
def test_places_without_a_document_keep_their_rule_order(case) -> None:
    n, doc, w = case
    pois = [_poi(i) for i in range(n)]
    rest = [p for p in hr.fuse(pois, doc, w) if p.source_ref not in doc]
    assert rest == [p for p in pois if p.source_ref not in doc]


@settings(max_examples=200, deadline=None)
@given(_orders, st.integers(min_value=0, max_value=24))
def test_a_better_document_rank_never_moves_a_place_down(case, pick) -> None:
    n, doc, w = case
    if n == 0:
        return
    pois = [_poi(i) for i in range(n)]
    ref = pois[pick % n].source_ref
    worse, better = {**doc, ref: 20}, {**doc, ref: 1}
    pos = lambda d: [p.source_ref for p in hr.fuse(pois, d, w)].index(ref)  # noqa: E731
    assert pos(better) <= pos(worse)


def test_no_evidence_is_the_identity() -> None:
    pois = [_poi(i) for i in range(6)]
    assert hr.fuse(pois, {}) == pois
    assert hr.doc_rank([_hit("r1", "넓은 잔디 광장이 있다", 0.9)], ("북카페",), {"r1": 0}) == {}


def test_fuse_ties_fall_back_to_rule_order() -> None:
    a, b = _poi(0), _poi(1)
    # 규칙 2위가 문서 1위 · 규칙 1위가 문서 2위 → 두 점수가 같다(1/61 + 1/62) — 규칙 순서가 이긴다
    assert hr.fuse([a, b], {"r0": 2, "r1": 1}) == [a, b]


def test_fuse_lifts_a_documented_place_over_undocumented_ones() -> None:
    pois = [_poi(i) for i in range(5)]
    out = hr.fuse(pois, {"r4": 1})
    assert out[0].source_ref == "r4" and [p.source_ref for p in out[1:]] == ["r0", "r1", "r2", "r3"]


def test_a_lighter_document_weight_lifts_documented_places_less() -> None:
    pois = [_poi(i) for i in range(40)]
    doc = {"r0": 9, "r5": 3, "r20": 1, "r39": 2}
    for ref in ("r5", "r20", "r39"):  # 문서 순위가 규칙 자리보다 앞인 곳 — 무게가 줄면 덜 오른다
        pos = {w: [p.source_ref for p in hr.fuse(pois, doc, w)].index(ref) for w in (0.5, 1.0)}
        assert pos[1.0] <= pos[0.5] <= int(ref[1:])


def _named(i: int, name: str) -> Poi:
    return replace(_poi(i), name=name)


def test_a_place_named_by_the_query_stays_ahead_of_documented_places() -> None:
    """규칙 1위라도 문서가 없으면 1/61 — 이름 낱말 없이 섞으면 근거 있는 곳 전부에 밀린다(리뷰 2026-11-04 전주/비빔밥)."""
    pois = [_named(0, "하숙영가마솥비빔밥"), _named(1, "고궁"), _named(2, "한국집"), _named(3, "비빔밥 명가"), _named(4, "백송회관")]
    doc = {"r2": 1, "r4": 2, "r3": 3}
    assert [p.name for p in hr.fuse(pois, doc)][:1] == ["한국집"]  # 전제 — 이름 낱말 없이 섞으면 규칙 1위가 밀린다
    out = [p.name for p in hr.fuse(pois, doc, named=("비빔밥",))]
    # 이름 적중 둘이 먼저(그들끼리 섞인 순서 — 문서 있는 '비빔밥 명가'가 규칙 1위 위로), 나머지는 섞인 순서
    assert out == ["비빔밥 명가", "하숙영가마솥비빔밥", "한국집", "백송회관", "고궁"]
    assert hr.fuse(pois, {}, named=("비빔밥",)) == pois  # 근거 0 이면 이름 낱말이 있어도 항등


@settings(max_examples=200, deadline=None)
@given(_orders, st.sets(st.integers(min_value=0, max_value=24)))
def test_named_places_come_first_and_fuse_stays_a_permutation(case, named) -> None:
    n, doc, w = case
    pois = [_named(i, f"이름난곳{i}" if i in named else f"장소{i}") for i in range(n)]
    out = hr.fuse(pois, doc, w, named=("이름난",))
    assert sorted(str(p.poi_id) for p in out) == sorted(str(p.poi_id) for p in pois)  # 순열(INV-1)
    flags = ["이름난" in p.name for p in out]
    assert flags == sorted(flags, reverse=True) or not doc  # 이름 적중이 늘 앞(근거 0 이면 항등)


# ── ② 게이트 ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("text, kind", [
    ("서울 가볼 만한 곳", None), ("부산 맛집", "맛집"), ("제주 카페 추천", "카페"), ("요즘 핫한", None),
    ("가볼만한곳", None), ("갈 데", None), ("성수동 카페 추천해줘", "카페"), ("", None),
    # 리뷰(2026-11-04) — 낱말 안 조각만 지워 남은 꼬리('레이스'·'많은'·'먹을'·'갈까')와 복수 '들'·끝 붙은 종류 낱말이 게이트를 열었다
    ("핫플레이스", None), ("서울 핫플레이스", None), ("인기 많은", None), ("볼거리 많은", None), ("할 거 많은", None),
    ("먹을 만한 곳", "맛집"), ("먹을 데", "맛집"), ("들를 만한 곳", None), ("어디 갈까", None), ("관광지들", None), ("카페들", "카페"),
    ("쇼핑하기 좋은", None), ("구경하는 곳", None), ("야경 명소인", None), ("먹을거리", None),
])
def test_control_requests_keep_the_gate_closed(text: str, kind: str | None) -> None:
    for gate in hr.GATES:
        assert hr.open_query(text, kind, generic=_GENERIC, gate=gate) is None


def test_descriptive_words_open_the_gate_and_category_names_stay_out_of_bm25() -> None:
    q = hr.open_query("조용한 북카페", "카페", generic=_GENERIC)
    assert q is not None and q.words == ("조용", "북카페") and q.text == "조용한 북카페 카페"
    rain = hr.open_query("비 오는 날 실내", None, generic=_GENERIC)
    assert rain is not None and rain.words == ("실내",)  # '오는'은 동사 관형형 — 빈말로 게이트를 열지 않는다
    assert hr.open_query("비 오는 날", None, generic=_GENERIC) is None
    soup = hr.open_query("국밥집", "맛집", generic=_GENERIC)
    assert soup is not None and soup.words == ("국밥집",)


@pytest.mark.parametrize(("word", "stem"), [
    ("조용한", "조용"), ("매운", "매운"),  # 형용사 끝은 두 글자 이상 남을 때만
    ("산책하기", "산책"), ("잘하는", "잘"), ("오는데", "오"),  # 동사 꼴은 늘 — '하기'·'는데' 2-gram 이 거의 모든 글에 걸린다
    ("아이랑", "아이"), ("실내로", "실내"), ("북카페에서", "북카페"), ("생선구이", "생선구이"), ("놀이", "놀이"),  # 조사('이'는 안 뗀다)
])
def test_bm25_words_drop_endings_that_match_almost_any_text(word: str, stem: str) -> None:
    assert hr._stem(word) == stem


def test_property_words_open_the_gate_only_in_g2() -> None:
    for text in ("아이랑 가기 좋은", "조용한", "바다 보이는", "분위기 좋은"):
        assert hr.open_query(text, None, generic=_GENERIC, gate="G1") is None
        q = hr.open_query(text, None, generic=_GENERIC, gate="G2")
        assert q is not None and q.words
    # 속성 낱말은 게이트를 안 열어도 BM25 낱말에는 남는다 — 이름 낱말(`names`, 융합의 이름 적중)에는 들지 않는다
    quiet = hr.open_query("조용한 북카페", "카페", generic=_GENERIC, gate="G1")
    assert quiet.words == ("조용", "북카페") and quiet.names == ("북카페",)
    assert hr.open_query("아이랑 가기 좋은", None, generic=_GENERIC, gate="G2").names == ()


def test_unknown_gate_name_is_a_bug() -> None:
    with pytest.raises(ValueError):
        hr.open_query("실내", gate="G3")


_KIND_BIGRAMS = frozenset(g for k in hr._KIND_WORDS for g in hr.bigrams(k))
# 종류 이름에 붙는 끝(동사·관형형·조사·복수) · 종류 이름 앞에 붙는 수식어 — 수식어는 그 자체로 종류 이름 2-gram 을 갖지 않는 말만
_KIND_ENDS = ("", "하기", "하는", "할", "인", "에서", "을", "들", "들을", "이랑", "도")
_MODIFIERS = ("북", "한옥", "감성", "오션뷰", "노포", "야외", "전통")
_kind_words = st.builds(lambda k, e: k + e, st.sampled_from(sorted(hr._KIND_WORDS)), st.sampled_from(_KIND_ENDS))
_compounds = st.builds(lambda m, k, e: m + k + e, st.sampled_from(_MODIFIERS), st.sampled_from(sorted(hr._KIND_WORDS)),
                       st.sampled_from(("", "에서", "들", "을")))


@settings(max_examples=300, deadline=None)
@given(st.lists(st.one_of(st.sampled_from([
    "서울", "부산에서", "성수동", "홍대입구역", "카페", "맛집을", "식당", "명소", "가볼만한", "추천", "곳", "조용한", "북카페", "실내",
    "아이랑", "박물관", "전시", "비", "오는", "날", "좋은", "멋진", "요즘", "핫한", "체험", "바다",
]), _kind_words, _compounds), min_size=1, max_size=6), st.sampled_from(hr.GATES))
def test_bm25_words_never_hold_a_category_or_region_name(words, gate) -> None:
    q = hr.open_query(" ".join(words), "카페", generic=_GENERIC, gate=gate)
    if q is None:
        return
    for w in q.words:
        assert w not in hr._KIND_WORDS and not hr._is_kind(w)
        assert w not in ("서울", "부산", "성수", "홍대") and not w.startswith(("서울", "부산", "성수동", "홍대입구"))
        assert len(w) >= 2
    # 낱말이 아니라 BM25 항(2-gram) 수준에서 — "북카페"의 '카페'·"야외액티비티"의 '티비'가 근거로 새지 않는다
    assert not (hr.bm25_terms(q.words) & _KIND_BIGRAMS)


def test_kind_names_inside_compounds_are_not_bm25_terms() -> None:
    assert hr.bm25_terms(("북카페",)) == {"북카"} and hr.bm25_terms(("조용", "북카페")) == {"조용", "북카"}
    assert hr.bm25_terms(("근대거리",)) == {"근대", "대거", "거리"}  # '거리'는 종류 이름('볼거리') 자리가 아니다 — 남는다
    assert hr.bm25_terms(("관광명소",)) == frozenset() and hr.bm25_terms(("국밥집",)) == {"국밥"}  # 가장 긴 종류 이름부터 · '밥집'
    # 종류 이름 끝을 조사로 떼지 않는다 — '레스토랑'의 '랑'을 떼면 '레스토'가 남아 종류 이름 2-gram 이 샜다(PBT 가 찾은 반례)
    q = hr.open_query("북레스토랑", None, generic=_GENERIC)
    assert q is not None and q.words == ("북레스토랑",) and hr.bm25_terms(q.words) == {"북레"}
    # '카페' 2-gram 하나만 맞은 곳은 근거가 아니다(키워드 근거 문턱이 종류 이름으로 켜지지 않는다)
    assert hr.doc_rank([_hit("r0", "넓은 창이 있는 대형 카페", 0.9)], ("북카페",), {"r0": 0}) == {}
    assert hr.doc_rank([_hit("r0", "넓은 창이 있는 대형 카페", 0.9), _hit("r1", "책이 가득한 북카페", 0.1)], ("북카페",),
                       {"r0": 0, "r1": 1}) == {"r1": 1}


# ── ③ BM25 · 문서 순위 ─────────────────────────────────────────────────────────


def test_keyword_threshold_keeps_embedding_only_places_out_of_the_document_rank() -> None:
    hits = [_hit("r0", "넓은 잔디 광장과 산책로", 0.95), _hit("r1", "조용한 북카페로 책을 읽기 좋다", 0.40)]
    assert hr.doc_rank(hits, ("조용", "북카페"), {"r0": 0, "r1": 1}) == {"r1": 1}


def test_place_score_is_the_best_chunk_not_the_sum() -> None:
    weak = [_hit("r0", f"북카페 아닌 곳의 {i}번째 이야기와 다른 설명이 길게 이어진다 북") for i in range(8)]
    strong = [_hit("r1", "북카페 북카페")]
    scores = hr.bm25_scores([*weak, *strong], ("북카페",))
    assert scores["r1"] > scores["r0"] > 0


def test_titles_are_not_indexed() -> None:
    hits = [_hit("r0", "천안홍대용과학관은 천문 체험관이다", title="천안홍대용과학관"), _hit("r1", "홍대용 선생 기념 공원")]
    scores = hr.bm25_scores(hits, ("홍대용",))
    assert scores.get("r0", 0.0) == 0.0 and scores["r1"] > 0


def test_idf_stays_positive_for_a_word_in_every_chunk() -> None:
    hits = [_hit(f"r{i}", "실내 전시관") for i in range(5)]
    assert all(s > 0 for s in hr.bm25_scores(hits, ("실내",)).values())


def test_document_rank_breaks_ties_by_rule_order_and_drops_places_outside_it() -> None:
    hits = [_hit("r1", "실내 전시", 0.5), _hit("r0", "실내 전시", 0.5), _hit("zz", "실내 전시 실내", 0.9)]
    assert hr.doc_rank(hits, ("실내",), {"r0": 0, "r1": 1}) == {"r0": 1, "r1": 2}


# ── ④ 색인 · 스위치 ────────────────────────────────────────────────────────────


def _head(path, ids) -> None:
    path.write_bytes(gzip.compress(json.dumps({"model": "m", "dim": 2, "count": len(ids or ()), "ids": ids}).encode()))


def test_index_reads_chunk_ids_from_the_vector_heads_and_skips_a_broken_file(tmp_path) -> None:
    a, b, broken = tmp_path / "a.vectors.json.gz", tmp_path / "b.vectors.json.gz", tmp_path / "c.vectors.json.gz"
    _head(a, ["overview:100#0", "overview:100#1", "overview:200#0"])
    _head(b, ["wiki:100#0"])
    broken.write_bytes(b"not gzip")
    null_ids, odd_ids = tmp_path / "d.vectors.json.gz", tmp_path / "e.vectors.json.gz"
    _head(null_ids, None)  # 머리는 읽히는데 ids 가 null — 펼치다 TypeError 가 나도 그 파일 몫만 빈다
    _head(odd_ids, ["overview:300#0", 7])  # 문자열이 아닌 id 가 섞이면 그 파일 전체를 버린다(반쪽 파일 없음)
    index = hr.read_index([a, broken, null_ids, odd_ids, b])
    assert index == {"100": ("overview:100#0", "overview:100#1", "wiki:100#0"), "200": ("overview:200#0",)}


def test_switch_is_off_by_default(monkeypatch) -> None:
    monkeypatch.delenv(hr.SWITCH, raising=False)
    assert not hr.enabled()
    monkeypatch.setenv(hr.SWITCH, "on")
    assert hr.enabled()
