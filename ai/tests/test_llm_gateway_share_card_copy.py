"""TRIP-429 후속 — SHARE_CARD_COPY 4종 세트: 프롬프트·게이트·워커·PBT (j06 공유 카드).

증명하는 것:
  ① 게이트 위반 6종을 각각 잡는다 — 시간 표현(INV-3) · 어휘 밖 자리표시자(숫자 환각) ·
     없는 장소(INV-1 사영) · 캡션 150자 초과 · 해시태그 11개 이상 · 해시태그 어휘 밖
     (④⑤는 FE `shareCard.ts` 상한과 같은 값 — 잘린 문장을 미리 막는다)
  ② 빈 결과 라벨 2종이 갈린다 (TRIP-260 #5): 빈 캡션=`llm_empty_result`,
     위반 드롭=`gate_dropped_all` + GateDropEvent
  ③ 프롬프트 렌더 결정론 + **게이트가 검사하는 규칙이 전부 프롬프트에도 있다**
     (누락하면 게이트가 매번 떨어뜨려 폴백만 나간다 — 그 사고의 재발 방지 테스트)
  ④ 워커는 폴백 TypedResult를 그대로 반환 (BR-U4-09) — 재시도 없음. 정적 폴백
     `fallback_share_card_copy`는 게이트 규칙을 스스로 만족한다 (INV-4의 마지막 계단)
  ⑤ PBT — 임의 LLM 응답에서 예외 0: 산출은 항상 제약 안이거나 폴백으로 수렴
  ⑥ ShareCardCopy 직렬화 왕복

범위 밖: 카드 이미지(통계·동선 목록·워터마크)는 서비스가 기계 조립한다 — LLM 무관.
실 LLM 호출 0 (D37) — fake만 쓴다.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from hypothesis import example, given, settings
from hypothesis import strategies as st

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.share_card_copy import (
    CAPTION_MAX_LENGTH,
    _display_length,
    HASHTAG_MAX_COUNT,
    ShareCardCopyContext,
    ShareCardCopyGate,
)
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.share_card_copy import (
    ShareCardCopyWorker,
    build_share_card_copy_vars,
    fallback_share_card_copy,
)
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.domain.observability import FallbackEvent, GateDropEvent
from trippilot.domain.reflection import (
    PLACEHOLDER_VOCAB,
    ReflectionKind,
    ReflectionRequest,
    ShareCardCopy,
    SourceEventKind,
    TripEventRecord,
    VisitRecord,
    VisitRef,
)

from tests.fakes.fake_llm import FailingLlm, FakeLlm, VisionSpyLlm
from tests.fakes.in_memory_trace import InMemoryTrace

_NOW = datetime(2026, 8, 20, 9, 0, tzinfo=timezone.utc)
_TID = TraceId("t-u6-share-card")
_FEAT = LlmFeature.SHARE_CARD_COPY
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})

_CTX = ShareCardCopyContext(poi_names=("감천문화마을", "해운대"), region="부산")


def _request(**overrides) -> ReflectionRequest:
    base = dict(
        kind=ReflectionKind.TRIP_SUMMARY,
        region="부산",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 2),
        visits=(
            VisitRecord(
                ref=VisitRef(date=date(2026, 8, 1), poi_id=PoiId("poi-1")),
                poi_name="감천문화마을",
                category="SIGHT",
                order_in_day=1,
                photo_count=3,
            ),
            VisitRecord(
                ref=VisitRef(date=date(2026, 8, 2), poi_id=PoiId("poi-2")),
                poi_name="해운대",
                category="NATURE",
                order_in_day=1,
                photo_count=0,
            ),
        ),
        events=(
            TripEventRecord(
                kind=SourceEventKind.PLAN_B, date=date(2026, 8, 1), detail="휴무로 코스 변경"
            ),
        ),
        persona_summary="느긋한 일정 선호",
        weather_summary="이틀 다 맑음",
    )
    base.update(overrides)
    return ReflectionRequest(**base)


def _raw(caption: str, hashtags=None, places=None) -> str:
    body: dict = {"caption": caption}
    if hashtags is not None:
        body["hashtags"] = list(hashtags)
    if places is not None:
        body["places"] = list(places)
    return json.dumps({"share_card": body}, ensure_ascii=False)


def _apply(raw: str, ctx: ShareCardCopyContext | None = _CTX):
    return ShareCardCopyGate().apply(
        raw, ctx, feature=_FEAT, trace_id=_TID, now=_NOW
    )


_OK_CAPTION = "{region}에서 보낸 이틀, 감천문화마을 골목이 오래 남습니다."
_OK_TAGS = ["#부산여행", "#감천문화마을"]
_OK_PLACES = ["감천문화마을"]


# ── 게이트: 정상 통과 ────────────────────────────────────────


def test_gate_passes_valid_copy() -> None:
    out = _apply(_raw(_OK_CAPTION, _OK_TAGS, _OK_PLACES))
    assert out.error is None and out.drop_event is None
    assert out.value == ShareCardCopy(
        caption=_OK_CAPTION, hashtags=("#부산여행", "#감천문화마을"), is_fallback=False
    )


def test_gate_strips_caption_and_tolerates_missing_optional_arrays() -> None:
    """hashtags·places 누락은 빈 배열 — 없는 것과 형태 위반은 다른 사건이다."""
    out = _apply(_raw("  {region} 골목을 걷던 이틀  "))
    assert out.error is None
    assert out.value.caption == "{region} 골목을 걷던 이틀"
    assert out.value.hashtags == ()


def test_gate_accepts_every_placeholder_in_the_closed_vocabulary() -> None:
    caption = " ".join("{" + token + "}" for token in sorted(PLACEHOLDER_VOCAB))
    assert _apply(_raw(caption)).error is None


# ── 게이트: 위반 6종 (①) ────────────────────────────────────


@pytest.mark.parametrize(
    ("label", "raw"),
    [
        # ① 시간 표현 (INV-3) — 캡션
        ("TIME_EXPR", _raw("30분 만에 닿은 바다, 그 기억", _OK_TAGS, [])),
        # ① 시간 표현 — 해시태그도 같은 검사를 받는다
        ("TIME_EXPR", _raw("좋았던 이틀", ["#부산여행", "#2시간코스"], [])),
        # ② 어휘 밖 자리표시자 (숫자 환각 차단 — closed-set)
        ("PLACEHOLDER_OUT", _raw("{trip_days}일의 기록", _OK_TAGS, [])),
        # ③ 없는 장소 (INV-1 사영)
        ("PLACE_NOT_FOUND", _raw("광안리의 밤이 좋았던 여행", _OK_TAGS, ["광안리"])),
        # ④ FE 캡션 상한 초과 — 잘린 문장이 나가지 않게 미리 막는다
        ("CAPTION_LEN", _raw("가" * (CAPTION_MAX_LENGTH + 1), _OK_TAGS, [])),
        # ⑤ FE 해시태그 개수 상한 초과
        ("HASHTAG_COUNT", _raw("좋았던 이틀", ["#부산여행"] * (HASHTAG_MAX_COUNT + 1), [])),
        # ⑥ 해시태그 어휘 — 지역·방문지·브랜드 파생 아님
        ("HASHTAG_OUT", _raw("좋았던 이틀", ["#존맛탱"], [])),
    ],
)
def test_gate_drops_violating_copy_with_reason(label: str, raw: str) -> None:
    out = _apply(raw)
    # 산출이 1건이라 전량 드롭 — 값 없음 + 사유 (재시도는 하지 않는다)
    assert out.value is None
    assert out.error.startswith("gate_dropped_all") and label in out.error
    assert out.drop_event is not None
    assert out.drop_event.total_count == 1 and out.drop_event.dropped_count == 1
    assert out.drop_event.dropped_ids == ()  # 문구 드롭은 풀 ID가 아님
    assert out.drop_event.feature == "SHARE_CARD_COPY"


def test_gate_boundary_values_pass() -> None:
    """상한 **정확히**는 통과 — FE가 자르지 않는 경계와 같아야 한다."""
    assert _apply(_raw("가" * CAPTION_MAX_LENGTH)).error is None
    assert _apply(_raw("좋았던 이틀", ["#부산여행"] * HASHTAG_MAX_COUNT)).error is None


def test_gate_allows_multiword_place_hashtag_but_rejects_the_abbreviation() -> None:
    """다어절 상호명 회귀 — `_tag_allowed`는 소스가 태그 본문의 부분문자열일 때만 통과한다.

    해시태그에 공백을 담을 수 없으므로 공백 제거형을 대조 소스에 함께 넣는다
    (그 전에는 정당한 `#해운대해수욕장`까지 전부 HASHTAG_OUT 이었다 — 실측).
    축약형(`#해운대`)은 여전히 거부이고, **프롬프트가 그 사실을 말한다**(정합 테스트가 고정).
    """
    ctx = ShareCardCopyContext(poi_names=("해운대 해수욕장",), region="부산 해운대구")
    full = ShareCardCopyGate().apply(
        _raw("좋았던 이틀", ["#해운대해수욕장", "#부산해운대구여행"], []),
        ctx, feature=_FEAT, trace_id=_TID, now=_NOW)
    assert full.error is None

    abbreviated = ShareCardCopyGate().apply(
        _raw("좋았던 이틀", ["#해운대"], []),
        ctx, feature=_FEAT, trace_id=_TID, now=_NOW)
    assert "HASHTAG_OUT" in abbreviated.error


def test_caption_limit_uses_the_same_unit_as_the_frontend() -> None:
    """FE는 JS `String.length`(UTF-16 코드유닛)로 센다 — 코드포인트로 재면 헐거워진다.

    한글 100자 + 이모지 50개 = 파이썬 150 / JS 200. 코드포인트 기준이면 이 캡션이
    게이트를 통과하고 FE에서 50 단위가 잘린다 — 막으려던 바로 그 시나리오다.
    """
    emoji_caption = "가" * 100 + "🎉" * 50
    assert len(emoji_caption) == CAPTION_MAX_LENGTH  # 코드포인트로는 상한 안
    assert _display_length(emoji_caption) == 200  # FE 단위로는 초과
    assert "CAPTION_LEN" in _apply(_raw(emoji_caption)).error


def test_gate_rejects_place_declared_but_absent_from_caption() -> None:
    """신고만 하고 캡션엔 없는 장소 — 교차가 무의미해지므로 같은 등급으로 막는다."""
    out = _apply(_raw("바다를 보던 이틀", _OK_TAGS, ["해운대"]))
    assert out.value is None and "PLACE_NOT_FOUND" in out.error


def test_gate_requires_context() -> None:
    """대조 집합 없이 통과시키면 장소·해시태그가 검증 없이 나간다."""
    out = _apply(_raw(_OK_CAPTION), ctx=None)
    assert out.value is None and out.error.startswith("gate_error:")


# ── 게이트: 빈 결과 라벨 2종 + 파싱 실패 (②) ─────────────────


def test_gate_distinguishes_empty_llm_output_from_gate_drop() -> None:
    """`llm_empty_result`(프롬프트·입력을 보라) vs `gate_dropped_all`(규칙·환각을 보라).

    판별 근거는 GateDropEvent 유무 — 한때 같은 라벨이라 원인 추적에 3단계가 필요했다.
    """
    empty = _apply(_raw("   "))
    assert empty.value is None and empty.error == "llm_empty_result"
    assert empty.drop_event is None

    dropped = _apply(_raw("무려 40분이나 걸린 이동"))
    assert dropped.error.startswith("gate_dropped_all")
    assert dropped.drop_event is not None


@pytest.mark.parametrize(
    "raw",
    [
        "이건 JSON이 아니다",
        json.dumps({"copy": {"caption": "다른 키"}}),
        json.dumps({"share_card": ["배열"]}),
        json.dumps({"share_card": {"caption": 3}}),
        json.dumps({"share_card": {"caption": None}}),
        json.dumps({"share_card": {"caption": "ok", "hashtags": "배열 아님"}}),
        json.dumps({"share_card": {"caption": "ok", "hashtags": ["  "]}}),
        json.dumps({"share_card": {"caption": "ok", "places": [3]}}),
    ],
)
def test_gate_parse_failures(raw: str) -> None:
    out = _apply(raw)
    assert out.value is None and out.error.startswith("parse_error:")
    assert out.drop_event is None  # 파싱 실패는 드롭이 아니다 (라벨 구분 유지)


def test_gate_accepts_code_fenced_json() -> None:
    """```json 포장은 파싱 전에 벗긴다 (gates.base.strip_code_fence 공용 규약)."""
    fenced = "```json\n" + _raw(_OK_CAPTION, _OK_TAGS, _OK_PLACES) + "\n```"
    assert _apply(fenced).error is None


# ── 직렬화 왕복 (⑥) ─────────────────────────────────────────


@pytest.mark.parametrize(
    "copy",
    [
        ShareCardCopy(caption="부산 여행의 기록", hashtags=("#부산여행",)),
        ShareCardCopy(caption="{region} 이틀", hashtags=(), is_fallback=True),
    ],
)
def test_share_card_copy_round_trip(copy: ShareCardCopy) -> None:
    assert ShareCardCopy.from_dict(copy.to_dict()) == copy


# ── PBT (①②⑤) ──────────────────────────────────────────────


@given(raw=st.one_of(st.text(max_size=200), st.just("{}"), st.just("[]")))
def test_pbt_gate_never_raises_on_arbitrary_text(raw: str) -> None:
    """임의 텍스트는 사실상 전부 parse_error로 수렴한다 — 여기서 증명하는 것은
    "예외 없이 GateOutcome으로 수렴한다" 하나뿐이다 (생존 분기는 아래 PBT 담당)."""
    out = _apply(raw)
    assert out.error is None or not out.value  # error 있으면 value 비움 (base 불변식)


# 스키마가 성립하는 응답만 만든다 — 위 PBT의 생성기로는 생존 분기가 **한 번도**
# 평가되지 않았다(500 examples 실측: 생존 0). 계약 주장을 증명하려면 게이트가
# 실제로 통과시키는 입력이 표본에 들어야 한다.
_pbt_captions = st.one_of(
    st.sampled_from([
        "{region}에서 보낸 이틀",
        "감천문화마을 골목이 오래 남습니다",
        "{visit_count}곳을 걸었던 기록",
        "30분 만에 닿은 바다",  # TIME_EXPR — 드롭 분기
        "{trip_days}일의 기록",  # PLACEHOLDER_OUT — 드롭 분기
        "가" * (CAPTION_MAX_LENGTH + 1),  # CAPTION_LEN — 드롭 분기
    ]),
    st.text(max_size=200),
)
_pbt_tags = st.lists(
    st.sampled_from(["#부산여행", "#감천문화마을", "#트립파일럿", "#존맛탱"]),
    max_size=HASHTAG_MAX_COUNT + 2,
)
_pbt_raw = st.builds(lambda c, t: _raw(c, t, []), _pbt_captions, _pbt_tags)


@given(raw=_pbt_raw)
@example(raw=_raw(_OK_CAPTION, _OK_TAGS, _OK_PLACES))  # 생존 분기 평가를 보장
@settings(max_examples=120, deadline=None)
def test_pbt_gate_survivors_are_always_inside_constraints(raw: str) -> None:
    out = _apply(raw)
    if out.error is not None:
        assert not out.value
        return
    assert isinstance(out.value, ShareCardCopy)
    assert 0 < _display_length(out.value.caption) <= CAPTION_MAX_LENGTH
    assert len(out.value.hashtags) <= HASHTAG_MAX_COUNT
    assert out.value.is_fallback is False


# ── 프롬프트 (③) ────────────────────────────────────────────


def test_prompt_renders_deterministically() -> None:
    reg = PromptRegistry(_PROMPTS)
    p1, ref = reg.render(_FEAT, build_share_card_copy_vars(_request()))
    p2, _ = reg.render(_FEAT, build_share_card_copy_vars(_request()))
    assert p1 == p2  # 결정론
    assert ref.prompt_id == "prompts/share_card_copy.yaml" and ref.version == "0.1.0"
    assert ref.feature == "SHARE_CARD_COPY"
    assert "부산" in p1 and "2026-08-01 ~ 2026-08-02" in p1
    assert "감천문화마을" in p1 and "해운대" in p1
    assert "PLAN_B | 2026-08-01 | 휴무로 코스 변경" in p1


def test_prompt_carries_every_rule_the_gate_checks() -> None:
    """게이트가 검사하는 규칙은 **전부** 프롬프트에도 있어야 한다.

    빠뜨리면 게이트가 매번 떨어뜨려 정적 폴백만 나간다(해시태그 규칙 누락 사고).
    상한 숫자는 게이트 상수에서 만들어 비교한다 — 한쪽만 바뀌면 여기서 깨진다.
    """
    prompt, _ = PromptRegistry(_PROMPTS).render(
        _FEAT, build_share_card_copy_vars(_request())
    )
    # ④⑤ FE 상한 (게이트 상수 = 프롬프트 문구 = FE shareCard.ts)
    assert f"{CAPTION_MAX_LENGTH}자 이내" in prompt
    assert f"{HASHTAG_MAX_COUNT}개 이내" in prompt
    # ② 자리표시자 어휘 — closed-set 전원이 프롬프트에 열거돼 있다
    for token in PLACEHOLDER_VOCAB:
        assert "{" + token + "}" in prompt, f"어휘 누락: {token}"
    assert "이 어휘 밖의 자리표시자 금지" in prompt
    # ① 시간 표현 금지 (INV-3)
    assert "소요시간·시각·이동시간을 언급하지 마세요" in prompt
    # ③ 없는 장소 금지 + places 신고 규칙 (게이트 교차의 전제)
    assert "지어내지 마세요" in prompt and "places" in prompt
    # ⑥ 해시태그 어휘 — `_tag_allowed`가 "소스 전체 포함"을 요구한다는 사실까지 말해야
    #    한다. "장소명에서 만드세요"만 있던 동안 `#해운대`(축약)가 규칙을 지킨 줄 알고
    #    나왔다가 전량 드롭됐다 — 프롬프트-게이트 괴리의 실제 모양이다.
    assert "공백만 뺀 채 그대로 포함해서" in prompt
    assert "축약한 태그는 거부됩니다" in prompt
    # 해시태그도 캡션과 같은 시간·자리표시자 검사를 받는다는 사실
    assert "캡션과 같은 규칙입니다" in prompt


def test_build_vars_stringifies_everything_and_omits_coordinates() -> None:
    variables = build_share_card_copy_vars(
        _request(region=" ", persona_summary="", weather_summary="", events=())
    )
    assert all(isinstance(v, str) for v in variables.values())
    assert variables["region"] == "미지정"
    assert variables["persona_summary"] == "(요약 없음)"
    assert variables["weather_summary"] == "(요약 없음)"
    assert variables["events"] == "(이벤트 없음)"
    # G181 — 좌표·시각·체류분·poi_id는 싣지 않는다 (문구에 필요 없는 필드 최소화)
    rendered = "\n".join(variables.values())
    assert "poi-1" not in rendered and "lat" not in rendered
    for banned in ("분", "duration", "start_at"):
        assert banned not in variables["visits"]


# ── 워커 e2e (실물 레지스트리·게이트, ④) ────────────────────


def _worker(llm, trace: InMemoryTrace | None = None) -> ShareCardCopyWorker:
    gateway = GatewayFacade(
        llm,
        PromptRegistry(_PROMPTS),
        ShareCardCopyGate(),
        _CFG,
        trace if trace is not None else InMemoryTrace(),
    )
    return ShareCardCopyWorker(gateway)


def test_worker_end_to_end_success() -> None:
    canned = _raw(_OK_CAPTION, _OK_TAGS, _OK_PLACES)
    result = _worker(FakeLlm(canned=canned)).generate(_request(), _TID, _NOW)
    assert result.is_fallback is False
    assert result.value.caption == _OK_CAPTION
    assert result.value.hashtags == ("#부산여행", "#감천문화마을")
    assert result.value.is_fallback is False
    assert result.call_record is not None and result.call_record.success is True
    assert result.call_record.model_id == "m-l"  # LIGHT 티어 — 짧은 카피 1회


def test_worker_falls_back_loudly_on_llm_failure() -> None:
    """INV-4 — 침묵 실패 없음: 폴백 표시 + 사유 + FallbackEvent. 정적 조립은 호출측 몫."""
    trace = InMemoryTrace()
    result = _worker(FailingLlm(), trace).generate(_request(), _TID, _NOW)
    assert result.is_fallback is True and result.value is None
    assert result.error and result.call_record is not None
    events = trace.of_type(FallbackEvent)
    assert len(events) == 1
    assert (events[0].from_mode, events[0].to_mode) == ("llm_share_card", "static_copy")


def test_worker_falls_back_when_gate_drops_copy() -> None:
    """위반이면 재시도하지 않고 값 없음 + 사유 — 드롭 계측도 함께 나간다."""
    trace = InMemoryTrace()
    result = _worker(FakeLlm(canned=_raw("무려 40분이나 걸린 이동")), trace).generate(
        _request(), _TID, _NOW
    )
    assert result.is_fallback is True and result.value is None
    assert "gate_dropped_all" in result.error and "TIME_EXPR" in result.error
    assert len(trace.of_type(GateDropEvent)) == 1


def test_worker_sends_no_images_so_consent_is_not_in_play() -> None:
    """동의(사진)와 무관한 텍스트 feature — 요청에 이미지가 **실리지 않는 것**을 본다.

    `consent_ref is None`만 보면 항상 참이라 아무것도 증명하지 못한다(게이트웨이 기본값).
    벤더에 나간 요청의 images가 비어 있다는 것이 BR-U6R-09가 걸릴 자리가 없다는 근거다.
    """
    spy = VisionSpyLlm(canned=_raw(_OK_CAPTION))
    result = _worker(spy).generate(_request(), _TID, _NOW)
    assert spy.seen_images == [()]  # 호출 1회, 이미지 0장
    assert result.call_record is not None and result.call_record.consent_ref is None


def test_static_fallback_matches_client_shape_and_passes_the_gate() -> None:
    """④ 마지막 계단의 자기 정합 — 정적 폴백이 게이트 규칙을 스스로 만족한다.

    문구는 FE가 지금 기계 조립하던 모양 그대로라 폴백이 곧 종전 동작이다.
    """
    copy = fallback_share_card_copy(_request())
    assert copy == ShareCardCopy(
        caption="부산 여행의 기록", hashtags=("#부산여행",), is_fallback=True
    )
    out = _apply(_raw(copy.caption, copy.hashtags, []))
    assert out.error is None and out.value.caption == copy.caption


def test_static_fallback_without_region_still_passes_the_gate() -> None:
    """지역명이 없으면 지역 태그를 지어내지 않고 브랜드 태그로 간다 (게이트 통과 유지)."""
    copy = fallback_share_card_copy(_request(region="  "))
    assert copy == ShareCardCopy(
        caption="여행의 기록", hashtags=("#트립파일럿",), is_fallback=True
    )
    assert _apply(
        _raw(copy.caption, copy.hashtags, []),
        ctx=ShareCardCopyContext(poi_names=("감천문화마을",), region=""),
    ).error is None


@pytest.mark.parametrize("region", ["부산", "제주 서귀포", "서울 종로구"])
def test_static_fallback_passes_the_gate_for_multiword_regions(region: str) -> None:
    """다어절 지역 회귀 — "부산" 하나만 보던 동안 `#제주서귀포여행`이 HASHTAG_OUT 이었다.

    폴백은 게이트를 타지 않으므로 사용자 영향은 없었지만, 코드가 선언한 자기 정합
    불변식이 거짓이었다 (테스트가 증명하지 못하던 자리).
    """
    copy = fallback_share_card_copy(_request(region=region))
    out = _apply(
        _raw(copy.caption, copy.hashtags, []),
        ctx=ShareCardCopyContext(poi_names=("감천문화마을",), region=region),
    )
    assert out.error is None, f"{region}: {out.error}"


@given(raw=st.one_of(
    _pbt_raw, st.text(max_size=200), st.just('{"share_card": {"caption": ""}}')))
@example(raw=_raw(_OK_CAPTION, _OK_TAGS, _OK_PLACES))  # 성공 분기 평가를 보장
@settings(max_examples=120, deadline=None)
def test_pbt_worker_converges_for_any_llm_text(raw: str) -> None:
    """⑤ 어떤 LLM 응답이 와도: 예외 없음 ∧ (제약 안 문구 or 폴백) — 카드는 항상 성립."""
    result = _worker(FakeLlm(canned=raw)).generate(_request(), _TID, _NOW)
    if result.is_fallback:
        assert result.value is None and result.error
    else:
        assert isinstance(result.value, ShareCardCopy)
        assert 0 < _display_length(result.value.caption) <= CAPTION_MAX_LENGTH
        assert len(result.value.hashtags) <= HASHTAG_MAX_COUNT
