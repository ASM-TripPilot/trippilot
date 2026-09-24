"""EXPL-H1~H13 — EXPLANATION 게이트 해시태그 경로 (v0.2.0) 속성 (gates/explanation.py).

| 속성 | 내용 |
|---|---|
| EXPL-H1 | 태그 단위 **형식** 판정 == 오라클: `#` 하나 + 공백·`#` 없는 본문 1~10자, `fullmatch` — 전각 `＃`·`x#서울`·`#서울#`·NBSP·U+3000·`#` 단독은 빠진다 |
| **EXPL-H2** | 시간 표현·연락처 꼴은 **그 태그만** 빠진다 — 슬롯 통째 blank 금지 |
| EXPL-H3 | (a) 유효 6개+ → **앞 5개, 순서 보존** |
| **EXPL-H4** | (b) 유효+무효 혼합 → 유효만, **필터 뒤 절단** (앞 5칸에 무효가 있어도 유효 ≥5 면 정확히 5) |
| EXPL-H5 | (c) 다중 슬롯 — 전부 무효인 슬롯은 `text=""` 로 **살고** 다른 슬롯·error·drop_event 에 영향 없음 |
| EXPL-H6 | (d) 슬롯 하나 + 전부 무효(또는 `tags: []`) → `value=(PoiExplanation(p1,""),)`, `error=None`, `drop_event=None` — 라벨 없음(문장판 contact-like 비움과 동일 판정) |
| EXPL-H7 | (e) 왕복·멱등: `text.split(" ") == 기대 태그열`, 결과를 다시 넣어도 같은 text, 빈 목록이면 `""` |
| EXPL-H8 | 결정론: 같은 raw 두 번·항목 키 순서 바꿔도 같은 `GateOutcome` |
| EXPL-H9 | INV-1·드롭 계수 불변: 유령 poiId 드롭 + `GateDropEvent`(total=서로 다른 id 수), 중복 poiId 첫 등장, **태그 전부 무효인 풀 안 슬롯은 드롭으로 안 센다** |
| EXPL-H10 | 스키마 엄격: `tags` 비배열·원소 비문자열·`tags` 누락(v0.1.0 `text` 회귀)·`explanations` 비배열 → 전체 `parse_error` |
| EXPL-H11 | 길이 경계: 본문 1~10 통과, 11 탈락, `#` 은 안 센다(코드포인트 기준) |
| EXPL-H12 | 처리 순서 `strip → 첫 등장 중복 제거 → 필터 → 5개`: 공백 패딩은 살고 패딩만 다른 중복은 하나로, 중복 제거는 **절단보다 먼저** |
| EXPL-H13 | `feature=ALTERNATIVE_EXPLANATION` 은 종전 **문장** 경로 그대로 — 보통 문장 유지·연락처/시간 문장은 `""`·풀 밖 드롭·`tags` 스키마는 parse_error |

프롬프트 ↔ 게이트 상수 정합(개수 5·길이 10)은 `test_llm_gateway_extended.py::
test_explanation_prompt_states_the_gate_limits` 가 고정한다 — 여기서 다시 쓰지 않는다.

**오라클은 규칙에서 따로 적었다.** `_TAG_MAX=10`·`_TAG_KEEP=5` 는 설계값 **리터럴**이다(구현 상수
`HASHTAG_*` 를 import 하지 않는다 — reflection_template 테스트의 `_SCENE_MIN` 선례). 구현이
값을 바꾸면 여기가 울어야 한다. 형식 정규식도 테스트가 따로 적고, 시간·연락처 검출기 2종은 규칙이
**이름으로** 지정한 공유 함수라 import 한다(그 둘의 성질은 test_gate_injection_defense 몫).

**알려진 한계 — 버그로 고정하지 않는다** (팀 결정 2026-09-24): 길이는 코드포인트(`#🇰🇷` 는 2),
ZWSP(U+200B) 는 `\\s` 밖이라 형식을 통과한다. 생성기는 한글 음절만 써서 그 자리를 밟지 않는다.

실 외부 호출 0(D37) — 게이트 단독, LLM 없음. now 는 tz-aware 고정값.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, PoiExplanation
from trippilot.llm_gateway.gates.base import has_contact_like
from trippilot.llm_gateway.gates.explanation import ExplanationGate
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR

from tests.generators.poi import candidate_pools
from tests.test_gate_injection_defense import _Pool

_TID = TraceId("t-expl-hashtag")
_NOW = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)
_EXP = LlmFeature.EXPLANATION
_ALT = LlmFeature.ALTERNATIVE_EXPLANATION

# ── 독립 오라클 (규칙 그대로 — 구현 함수·상수 import 금지) ───────────────

_TAG_MAX = 10   # 본문('#' 제외) 길이 상한 — 프롬프트 "10자 이내"
_TAG_KEEP = 5   # 슬롯당 개수 — 프롬프트 "해시태그 5개"
_TAG_FMT = re.compile(rf"#[^\s#]{{1,{_TAG_MAX}}}")


def _tag_ok(tag: str) -> bool:
    """형식 fullmatch ∧ ¬시간표현 ∧ ¬연락처 꼴."""
    return (bool(_TAG_FMT.fullmatch(tag))
            and not _TIME_EXPR.search(tag)
            and not has_contact_like(tag))


def _expected_tags(tags: list[str]) -> list[str]:
    """strip → 첫 등장 중복 제거 → 태그 단위 필터 → 앞에서 5개."""
    deduped = list(dict.fromkeys(t.strip() for t in tags))
    return [t for t in deduped if _tag_ok(t)][:_TAG_KEEP]


def _expected_text(tags: list[str]) -> str:
    return " ".join(_expected_tags(tags))


# ── 하네스 (test_gate_injection_defense 의 `_Pool` 재사용) ───────────────


def _apply(raw: str, *pool_ids: str, feature: LlmFeature = _EXP):
    return ExplanationGate().apply(
        raw, _Pool(*pool_ids), feature=feature, trace_id=_TID, now=_NOW)


def _explain_tags(*slots: tuple[str, list[str]], pool: tuple[str, ...] = ("p1",),
                  feature: LlmFeature = _EXP):
    raw = json.dumps({"explanations": [{"poiId": pid, "tags": tags} for pid, tags in slots]})
    return _apply(raw, *pool, feature=feature)


def _one(tags: list[str]):
    """슬롯 하나(p1) 의 text."""
    out = _explain_tags(("p1", tags))
    assert out.error is None and out.drop_event is None
    (item,) = out.value
    assert item.poi_id == PoiId("p1")
    return item.text


# ── 생성기 — 한글 음절만 (숫자·라틴·`.`·`@` 없음 → 시간·연락처 규칙에 절대 안 걸린다) ──

# 음절 후보를 좁혀 **중복이 잦게** 한다 — 중복 제거·동률 자리가 실제로 생겨야 H12 가 산다.
_SYLLABLES = list("서울맛집여행뷰카페산책바다야경힐링")
_BODY = st.text(alphabet=st.sampled_from(_SYLLABLES), min_size=1, max_size=_TAG_MAX)
_VALID = _BODY.map(lambda s: "#" + s)
# str.strip() 이 지우는 공백류 — NBSP·U+3000 도 유니코드 공백이라 벗겨진다.
_PAD = st.sampled_from(["", " ", "  ", "\t", "\n", " ", "　"])
_PADDED_VALID = st.tuples(_PAD, _VALID, _PAD).map(lambda t: t[0] + t[1] + t[2])

_BAD_FORMAT = st.one_of(
    _BODY,                                                   # 선행 '#' 없음
    _BODY.map(lambda s: "＃" + s),                           # 전각 ＃ (U+FF03)
    _BODY.map(lambda s: "##" + s),                           # 이중 #
    st.tuples(_BODY, _BODY).map(lambda p: f"#{p[0]}#{p[1]}"),  # 내부 #
    _BODY.map(lambda s: f"#{s}#"),                           # 끝 #
    st.tuples(_BODY, st.sampled_from([" ", "\t", "\n", " ", "　"]), _BODY)
      .map(lambda p: f"#{p[0]}{p[1]}{p[2]}"),                # 내부 공백류 (strip 이 못 벗긴다)
    st.just("#"),                                            # 본문 0자
    _BODY.map(lambda s: "x#" + s),                           # 앵커 — search 면 통과한다
    st.integers(_TAG_MAX + 1, _TAG_MAX + 8).map(lambda n: "#" + "가" * n),  # 길이 초과
)
# 형식은 통과하고 **시간 규칙만** 걸리는 것 — 전부 본문 ≤10 (실행으로 매치 확인)
_TIME_TAGS = st.sampled_from(
    ["#30분", "#1시간", "#오전9시", "#오후3시", "#3시", "#24시간", "#duration", "#Duration코스", "#24시편의점"])
# 형식은 통과하고 **연락처 규칙만** 걸리는 것 — TLD 목록 안·본문 ≤10
_CONTACT_TAGS = st.sampled_from(
    ["#a.kr", "#서울.kr", "#t.me", "#go.shop", "#www.a", "#x@y.io", "#http://a"])
_INVALID = st.one_of(_BAD_FORMAT, _TIME_TAGS, _CONTACT_TAGS)
_MIXED = st.lists(st.one_of(_VALID, _PADDED_VALID, _INVALID), max_size=12)

_PBT = settings(max_examples=150, deadline=None)


@st.composite
def _front_loaded(draw) -> list[str]:
    """유효(서로 다른) ≥5 + 무효 1~3, 무효 하나는 **반드시 앞 5칸 안** — 필터/절단 순서를 가른다."""
    valid = draw(st.lists(_VALID, min_size=5, max_size=8, unique=True))
    bad = draw(st.lists(_INVALID, min_size=1, max_size=3))
    rest = draw(st.permutations(valid + bad[1:]))
    at = draw(st.integers(0, min(4, len(rest))))
    return rest[:at] + [bad[0]] + rest[at:]


# ── EXPL-H1: 태그 단위 형식 판정 ───────────────────────────────────────


@_PBT
@given(tag=st.one_of(_VALID, _BAD_FORMAT))
def test_h1_format_verdict_matches_oracle(tag) -> None:
    assert _one([tag]) == (tag if _tag_ok(tag) else "")


@pytest.mark.parametrize("tag", ["＃서울", "x#서울", "#서울#", "##서울", "#", "# 서울", "#서울 맛집",
                                 "#서울 맛집", "#서울　맛집", "#서울\t맛집"])
def test_h1_named_format_violations_are_dropped(tag) -> None:
    """예제 — 규칙의 각 조각을 하나씩 친다(전각·앵커·끝/이중/내부 #·빈 본문·공백류)."""
    assert not _tag_ok(tag)          # 오라클 자체가 이걸 무효로 보는지 먼저
    assert _one([tag]) == ""


# ── EXPL-H2: 시간·연락처는 그 태그만 (핵심) ────────────────────────────


@_PBT
@given(valid=st.lists(_VALID, min_size=1, max_size=4, unique=True),
       bad=st.lists(st.one_of(_TIME_TAGS, _CONTACT_TAGS), min_size=1, max_size=3))
def test_h2_time_and_contact_tags_are_removed_individually(valid, bad) -> None:
    """유효분은 상대 순서 그대로 남는다 — `" ".join` 뒤 문장 전체를 검사하면 여기서 갈린다.

    "출력에 시간표현이 없다"로만 쓰면 슬롯 통째 blank 변이를 못 잡는다 — 등식으로 쓴다.
    """
    tags = [None] * (len(valid) + len(bad))
    # 무효를 사이사이에 끼운다 (앞·중간·끝 전부)
    order = sorted(range(len(tags)), key=lambda i: (i * 7919) % len(tags))
    src = iter(valid + bad)
    for i in order:
        tags[i] = next(src)

    text = _one(tags)

    assert text == _expected_text(tags)
    assert text.split() == [t for t in tags if t in valid][:_TAG_KEEP]
    assert not _TIME_EXPR.search(text) and not has_contact_like(text)


@pytest.mark.parametrize("bad", ["#30분", "#오후3시", "#24시편의점", "#Duration코스"])
def test_h2_time_tag_examples(bad) -> None:
    assert _TIME_EXPR.search(bad)    # 공유 정규식이 잡는지 먼저
    assert _one(["#고궁산책", bad, "#야경"]) == "#고궁산책 #야경"


@pytest.mark.parametrize("bad", ["#a.kr", "#서울.kr", "#t.me", "#x@y.io", "#http://a"])
def test_h2_contact_tag_examples(bad) -> None:
    assert has_contact_like(bad) and _TAG_FMT.fullmatch(bad)   # 형식은 통과·연락처만 걸린다
    assert _one(["#고궁산책", bad]) == "#고궁산책"


# ── EXPL-H3: (a) 유효 6개+ → 앞 5개, 순서 보존 ─────────────────────────


@_PBT
@given(tags=st.lists(_VALID, min_size=_TAG_KEEP + 1, max_size=12, unique=True))
def test_h3_more_than_five_valid_keeps_first_five_in_order(tags) -> None:
    assert _one(tags).split(" ") == tags[:_TAG_KEEP]


# ── EXPL-H4: (b) 혼합 → 유효만, 필터 뒤 절단 ──────────────────────────


@_PBT
@given(tags=_front_loaded())
def test_h4_filter_happens_before_truncation(tags) -> None:
    """앞 5칸에 무효가 있고 유효가 5개 이상이면 **정확히 5개** — 절단 뒤 필터면 3~4개가 된다."""
    kept = _one(tags).split(" ")
    assert len(kept) == _TAG_KEEP
    assert kept == [t for t in tags if _tag_ok(t)][:_TAG_KEEP]


@_PBT
@given(tags=_MIXED)
def test_h4_mixed_list_equals_oracle(tags) -> None:
    """무작위 혼합(패딩·중복 포함) 전 분포에서 등식."""
    assert _one(tags) == _expected_text(tags)


# ── EXPL-H5: (c) 다중 슬롯 — 빈 슬롯은 살고 이웃에 영향 없음 ─────────────


@_PBT
@given(bad=st.lists(_INVALID, min_size=1, max_size=6),
       good=st.lists(st.one_of(_VALID, _INVALID), min_size=1, max_size=8)
              .filter(lambda ts: _expected_tags(ts)),
       bad_first=st.booleans())
def test_h5_all_invalid_slot_survives_blank_next_to_a_good_one(bad, good, bad_first) -> None:
    slots = [("pa", bad), ("pb", good)] if bad_first else [("pb", good), ("pa", bad)]

    out = _explain_tags(*slots, pool=("pa", "pb"))

    assert out.error is None and out.drop_event is None
    assert [str(e.poi_id) for e in out.value] == [pid for pid, _ in slots]
    by_id = {str(e.poi_id): e.text for e in out.value}
    assert by_id["pa"] == ""
    assert by_id["pb"] == _expected_text(good)


# ── EXPL-H6: (d) 슬롯 하나 + 전부 무효 → 라벨 없음 ───────────────────────


@_PBT
@given(tags=st.one_of(st.just([]), st.lists(_INVALID, min_size=1, max_size=8)))
def test_h6_single_slot_all_invalid_is_kept_blank_without_error(tags) -> None:
    """`value=(PoiExplanation(p1,""),)`·`error=None`·`drop_event=None`.

    `empty_result_error` 는 value 의 truthiness 만 보고, 빈 text 슬롯도 원소 1개라 참이다 —
    문장판이 연락처 꼴을 비우던 자리와 **같은 판정**이다(`llm_empty_result` 도
    `gate_dropped_all` 도 아니다). `tags: []` 도 같은 칸(팀 결정 2026-09-24).
    """
    out = _explain_tags(("p1", tags))

    assert out.value == (PoiExplanation(PoiId("p1"), ""),)
    assert out.error is None
    assert out.drop_event is None


# ── EXPL-H7: (e) 왕복·멱등 ──────────────────────────────────────────


@_PBT
@given(tags=_MIXED)
def test_h7_join_split_round_trip_and_idempotence(tags) -> None:
    text = _one(tags)
    expected = _expected_tags(tags)

    assert (text.split(" ") if text else []) == expected
    assert text.split() == expected                # 유효 태그엔 \s 가 없다 — 두 분할이 같다
    assert text == text.strip() and "  " not in text
    assert all(_tag_ok(t) for t in expected)
    if expected:
        assert _one(text.split(" ")) == text       # 결과를 다시 넣어도 그대로 (멱등)
    else:
        assert text == ""


# ── EXPL-H8: 결정론 ────────────────────────────────────────────────


@_PBT
@given(slots=st.lists(st.tuples(st.sampled_from(["p1", "p2", "유령"]), _MIXED), min_size=1, max_size=5))
def test_h8_same_raw_twice_and_key_order_do_not_matter(slots) -> None:
    raw_a = json.dumps({"explanations": [{"poiId": p, "tags": t} for p, t in slots]})
    raw_b = json.dumps({"explanations": [{"tags": t, "poiId": p} for p, t in slots]})

    first = _apply(raw_a, "p1", "p2")
    assert first == _apply(raw_a, "p1", "p2")
    assert first == _apply(raw_b, "p1", "p2")


# ── EXPL-H9: INV-1 · 드롭 계수 ─────────────────────────────────────


@_PBT
@given(pool=candidate_pools().filter(lambda p: bool(p.poi_ids)),
       picks=st.lists(st.integers(0, 3), min_size=1, max_size=5),
       ghosts=st.lists(st.sampled_from(["유령1", "유령2"]), max_size=3),
       tag_lists=st.lists(_MIXED, min_size=8, max_size=8))
def test_h9_closed_set_and_drop_accounting_unchanged(pool: CandidatePool, picks, ghosts, tag_lists) -> None:
    ids = sorted(pool.poi_ids, key=str)
    in_pool = [str(ids[i % len(ids)]) for i in picks]            # 중복 허용
    ghost_ids = [g for g in ghosts if PoiId(g) not in pool.poi_ids]
    order = in_pool + ghost_ids
    slots = list(zip(order, tag_lists))
    raw = json.dumps({"explanations": [{"poiId": p, "tags": t} for p, t in slots]})

    out = ExplanationGate().apply(raw, pool, feature=_EXP, trace_id=_TID, now=_NOW)

    first_seen: dict[str, list[str]] = {}
    for p, t in slots:
        first_seen.setdefault(p, t)
    expected_ids = [p for p in dict.fromkeys(order) if PoiId(p) in pool.poi_ids]
    assert [str(e.poi_id) for e in out.value] == expected_ids            # 첫 등장·입력 순서
    assert [e.text for e in out.value] == [_expected_text(first_seen[p]) for p in expected_ids]
    distinct_ghosts = list(dict.fromkeys(ghost_ids))
    if distinct_ghosts:
        assert out.drop_event is not None
        assert out.drop_event.dropped_count == len(distinct_ghosts)
        assert out.drop_event.total_count == len(dict.fromkeys(order))
        assert set(map(str, out.drop_event.dropped_ids)) == set(distinct_ghosts)
        assert out.error is None                                          # 풀 안 슬롯이 하나는 있다
    else:
        assert out.drop_event is None and out.error is None


def test_h9_blank_slot_is_not_counted_as_dropped() -> None:
    """태그가 전부 무효인 풀 안 슬롯은 **살아 있다** — 드롭 계수·이벤트에 들어가면 안 된다."""
    out = _explain_tags(("p1", ["#30분"]), ("유령", ["#좋음"]))
    assert [str(e.poi_id) for e in out.value] == ["p1"] and out.value[0].text == ""
    assert out.drop_event is not None and out.drop_event.dropped_count == 1
    assert out.drop_event.total_count == 2
    assert out.error is None


def test_h9_empty_result_labels_are_preserved() -> None:
    """전부 유령 → gate_dropped_all, 빈 배열 → llm_empty_result (TRIP-260 #5 라벨 2종)."""
    assert _explain_tags(("유령", ["#좋음"])).error == "gate_dropped_all"
    assert _apply('{"explanations": []}', "p1").error == "llm_empty_result"


# ── EXPL-H10: 스키마 엄격 ──────────────────────────────────────────


@pytest.mark.parametrize("item", [
    {"poiId": "p1", "tags": "#문자열"},                 # 배열 아님
    {"poiId": "p1", "tags": None},
    {"poiId": "p1", "tags": [1, "#서울"]},              # 원소 비문자열 — 격리 아니라 전체 위반
    {"poiId": "p1", "tags": ["#서울", None]},
    {"poiId": "p1"},                                   # tags 누락
    {"poiId": "p1", "text": "v0.1.0 문장으로 답함"},     # 구스키마 회귀 — 조용히 통과 금지
    {"poiId": "", "tags": ["#서울"]},
    {"tags": ["#서울"]},
])
def test_h10_shape_violations_are_whole_parse_errors(item) -> None:
    out = _apply(json.dumps({"explanations": [item]}), "p1")
    assert out.value == () and out.drop_event is None
    assert out.error is not None and out.error.startswith("parse_error:")


@pytest.mark.parametrize("raw", ['{"explanations": {}}', '{"explanations": "x"}',
                                 '{"explanations": [1]}', '{"other": []}', "깨짐"])
def test_h10_top_level_shape_violations(raw) -> None:
    assert _apply(raw, "p1").error.startswith("parse_error:")


@_PBT
@given(good=st.lists(_VALID, min_size=1, max_size=3, unique=True))
def test_h10_one_bad_item_poisons_the_whole_response(good) -> None:
    """항목 하나가 형태 위반이면 옆의 정상 항목도 나가지 않는다(종전 파서 엄격도 계승)."""
    raw = json.dumps({"explanations": [{"poiId": "p1", "tags": good},
                                       {"poiId": "p2", "tags": "#문자열"}]})
    out = _apply(raw, "p1", "p2")
    assert out.value == () and out.error.startswith("parse_error:")


# ── EXPL-H11: 길이 경계 ────────────────────────────────────────────


@_PBT
@given(n=st.integers(1, _TAG_MAX))
def test_h11_body_up_to_max_passes(n) -> None:
    tag = "#" + "가" * n
    assert _one([tag]) == tag


@_PBT
@given(extra=st.integers(1, 6))
def test_h11_body_over_max_is_dropped(extra) -> None:
    assert _one(["#" + "가" * (_TAG_MAX + extra)]) == ""


def test_h11_hash_is_not_counted() -> None:
    """본문 10자 = 전체 11자 통과 — `len(tag) <= 10` 으로 세면 여기서 갈린다."""
    tag = "#" + "가" * _TAG_MAX
    assert len(tag) == _TAG_MAX + 1
    assert _one([tag]) == tag


# ── EXPL-H12: strip → 중복 제거 → 필터 → 5개 ────────────────────────


@_PBT
@given(tag=_VALID, lead=_PAD, trail=_PAD)
def test_h12_whitespace_padding_is_stripped_not_rejected(tag, lead, trail) -> None:
    assert _one([lead + tag + trail]) == tag


@_PBT
@given(tag=_VALID, pads=st.lists(st.tuples(_PAD, _PAD), min_size=2, max_size=5))
def test_h12_padding_variants_collapse_to_one(tag, pads) -> None:
    """`"#서울"`·`" #서울 "`·`"\\t#서울"` 은 strip 뒤 같은 태그 — 첫 등장 하나만."""
    assert _one([a + tag + b for a, b in pads]) == tag


@_PBT
@given(distinct=st.lists(_VALID, min_size=_TAG_KEEP + 1, max_size=8, unique=True),
       dup_count=st.integers(1, 4))
def test_h12_dedupe_happens_before_the_cap(distinct, dup_count) -> None:
    """앞 5칸에 중복이 끼어 있어도 결과는 서로 다른 5개 — 절단을 먼저 하면 5개가 안 된다."""
    tags = [distinct[0]] * dup_count + distinct[1:]     # 중복이 앞을 차지
    kept = _one(tags).split(" ")
    assert len(kept) == _TAG_KEEP and len(set(kept)) == _TAG_KEEP
    assert kept == distinct[:_TAG_KEEP]


@_PBT
@given(tags=_MIXED)
def test_h12_output_has_no_duplicates(tags) -> None:
    kept = _one(tags).split(" ") if _expected_tags(tags) else []
    assert len(kept) == len(set(kept))


# ── EXPL-H13: ALTERNATIVE_EXPLANATION 은 문장 경로 그대로 ───────────────


def _alt(text: str, *, pid: str = "p1"):
    raw = json.dumps({"explanations": [{"poiId": pid, "text": text}]})
    return _apply(raw, "p1", feature=_ALT)


def test_h13_alternative_keeps_ordinary_sentence() -> None:
    out = _alt("조용한 곳이라 잘 맞아요.")
    assert out.error is None and out.value[0].text == "조용한 곳이라 잘 맞아요."


@pytest.mark.parametrize("text", ["예약은 book-now.example.kr 에서 미리 하세요", "관람에 약 40분이면 충분합니다"])
def test_h13_alternative_blanks_contact_or_time_sentence_but_keeps_slot(text) -> None:
    out = _alt(text)
    assert out.error is None and out.value[0].poi_id == PoiId("p1") and out.value[0].text == ""


def test_h13_alternative_still_enforces_closed_set() -> None:
    out = _alt("좋은 곳입니다", pid="not-in-pool")
    assert out.value == () and out.drop_event is not None and out.drop_event.dropped_count == 1


@_PBT
@given(tags=st.lists(_VALID, min_size=1, max_size=5))
def test_h13_alternative_rejects_hashtag_schema(tags) -> None:
    """문장 경로에 `tags` 를 보내면 parse_error — feature 분기가 빠지면(전부 tags) 여기와 H10 이 함께 갈린다."""
    out = _explain_tags(("p1", tags), feature=_ALT)
    assert out.value == () and out.error.startswith("parse_error:")


@_PBT
@given(text=st.text(alphabet=st.sampled_from(_SYLLABLES + [" ", "."]), min_size=1, max_size=40)
              .filter(lambda s: s.strip()))
def test_h13_alternative_sentence_is_passed_through_unchanged(text) -> None:
    """한글 문장(숫자·라틴 없음)은 그대로 — 해시태그 규칙(형식·개수·길이)이 문장 경로로 새면 갈린다."""
    out = _alt(text)
    assert out.error is None and out.value[0].text == text
