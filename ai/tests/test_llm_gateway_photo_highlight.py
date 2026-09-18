"""TRIP-595 — PHOTO_HIGHLIGHT 4종 세트: 프롬프트·게이트·워커 + 결정론 폴백 규칙.

증명하는 것 (U6 Reflect FD의 VIS 속성 중 본 범위):
  ① VIS-P2 게이트 절반 — photo_id ⊆ 입력 사진 집합 ∧ 중복 0 ∧ 개수 ≤ N.
     입력 밖 id는 드롭 + GateDropEvent 계측 (INV-1 사영, BR-U6R-03)
  ② 파싱 실패만 error — 전량 드롭은 error가 아니라 빈 결과(게이트웨이가 사유를 가른다)
  ③ VIS-P4 — 이미지가 텍스트 전용 어댑터에 가면 예외가 위로 새지 않고 폴백 신호로
     수렴하고, 사유가 `unsupported:`로 구분된다 (재시도 아닌 강등이 처방이므로)
  ④ 동의 경계 — 동의 집합 밖 바이트·바이트 0장은 폴백이 아니라 호출 버그(ValueError)
  ⑤ VisionSpyLlm으로 **실제 전송된 이미지**를 관측 (몇 장이 어떤 순서로 실렸는가)
  ⑥ VIS-P2 폴백 절반 — 메타 규칙 폴백의 결정론(입력 순서 무관·재호출 동일)과
     "방문당 1장 → 시간 분산" 규칙

범위 밖 (다음 단계 — composer 통합): vision 실패 시 Phase 1 텍스트 경로 강등의 배선,
FallbackEvent(stage="vision") 발행 — 지금은 공용 `_fallback`이 stage="llm"으로 낸다 —,
REFLECTION_TEMPLATE_VISION.
  · VIS-P1(어떤 조합에도 미동의면 images==()): 전제인 "미동의 VisionInput 생성 불가"는
    test_llm_port_vision_seam.py가 이미 고정. 전체 속성은 요청 조합을 만드는 composer가
    있어야 스윕할 수 있어 유예 — **끝난 것이 아니다**
  · VIS-P3(실패해도 응답 스키마 = Phase 1): 조립층이 없어 유예
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.reflect.highlight_rule import select_highlights
from trippilot.llm_gateway.config import C1Config, default_tier_map
from trippilot.llm_gateway.gates.photo_highlight import (
    DEFAULT_HIGHLIGHT_LIMIT,
    PhotoHighlightContext,
    PhotoHighlightGate,
)
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.photo_highlight import (
    PhotoHighlightWorker,
    build_photo_highlight_vars,
)
from trippilot.domain.common import GeoPoint, PoiId, TraceId
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.domain.observability import FallbackEvent, GateDropEvent
from trippilot.domain.reflection import (
    PhotoConsent,
    PhotoId,
    PhotoRef,
    VisionInput,
    VisitRef,
)
from trippilot.ports.llm_port import LlmImagePart

from tests.fakes.fake_llm import FailingLlm, FakeLlm, TextOnlyLlm, VisionSpyLlm
from tests.fakes.in_memory_trace import InMemoryTrace

_NOW = datetime(2026, 8, 28, 9, 0, tzinfo=timezone.utc)
_TID = TraceId("t-u6-photo")
_FEAT = LlmFeature.PHOTO_HIGHLIGHT
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})

_D1, _D2 = date(2026, 8, 1), date(2026, 8, 2)
_REF1 = VisitRef(date=_D1, poi_id=PoiId("poi-1"))
_REF2 = VisitRef(date=_D2, poi_id=PoiId("poi-2"))
_PNG = b"\x89PNG\r\n\x1a\n fake bytes"


def _at(hour: int, day: date = _D1) -> datetime:
    return datetime(day.year, day.month, day.day, hour, 0, tzinfo=timezone.utc)


def _photo(pid: str, ref: VisitRef | None = _REF1, taken_at: datetime | None = None,
           gps: GeoPoint | None = None) -> PhotoRef:
    return PhotoRef(photo_id=PhotoId(pid), visit_ref=ref, taken_at=taken_at, gps=gps)


def _vision(*photos: PhotoRef) -> VisionInput:
    return VisionInput(
        photos=photos or (_photo("ph-1"), _photo("ph-2", _REF2)),
        consent=PhotoConsent(granted=True, consent_ref="consent-log-1", granted_at=_NOW),
    )


def _images(vision: VisionInput) -> dict[PhotoId, LlmImagePart]:
    return {
        p.photo_id: LlmImagePart(media_type="image/png", data=_PNG + str(p.photo_id).encode())
        for p in vision.photos
    }


def _raw(ids: list) -> str:
    return json.dumps({"highlights": ids}, ensure_ascii=False)


def _ctx(vision: VisionInput, limit: int = DEFAULT_HIGHLIGHT_LIMIT) -> PhotoHighlightContext:
    return PhotoHighlightContext(
        photo_ids=frozenset(p.photo_id for p in vision.photos), limit=limit
    )


def _apply(raw: str, ctx: PhotoHighlightContext):
    return PhotoHighlightGate().apply(raw, ctx, feature=_FEAT, trace_id=_TID, now=_NOW)


# ── 게이트: 멤버십·중복·상한 (①) ─────────────────────────────


def test_gate_accepts_ids_inside_input_set() -> None:
    out = _apply(_raw(["ph-1", "ph-2"]), _ctx(_vision()))
    assert out.value == (PhotoId("ph-1"), PhotoId("ph-2"))
    assert out.error is None and out.drop_event is None


def test_gate_drops_ids_outside_input_set_and_meters() -> None:
    """환각 id는 통과하지 못하고 GateDropEvent로 계측된다 (INV-1 사영)."""
    out = _apply(_raw(["ph-1", "ph-999", "ph-2"]), _ctx(_vision()))
    assert out.value == (PhotoId("ph-1"), PhotoId("ph-2"))
    assert out.error is None
    assert out.drop_event is not None
    assert out.drop_event.dropped_count == 1 and out.drop_event.total_count == 3
    assert out.drop_event.feature == "PHOTO_HIGHLIGHT"
    # photo_id는 풀 ID가 아니라 dropped_ids를 비운다 — 환각률 지표에 다른 ID
    # 네임스페이스를 섞지 않는 선례(place_extraction·event_extraction 등)를 따른다
    assert out.drop_event.dropped_ids == ()


def test_gate_dedupes_keeping_first_occurrence() -> None:
    out = _apply(_raw(["ph-2", "ph-1", "ph-2"]), _ctx(_vision()))
    assert out.value == (PhotoId("ph-2"), PhotoId("ph-1"))
    assert out.drop_event is None  # 중복은 환각이 아니다 — 드롭 계측 대상 아님


def test_gate_truncates_to_limit_without_metering_it() -> None:
    """상한 절단은 INV-1 지표를 오염시키지 않는다 — 유효한데 잘린 것과 입력 밖인 것은
    처방이 다르다 (gate_dropped_all/llm_empty_result를 가른 것과 같은 이유)."""
    vision = _vision(_photo("ph-1"), _photo("ph-2"), _photo("ph-3"))
    out = _apply(_raw(["ph-1", "ph-2", "ph-3"]), _ctx(vision, limit=2))
    assert out.value == (PhotoId("ph-1"), PhotoId("ph-2"))
    assert out.drop_event is None and out.error is None


def test_gate_all_outside_is_gate_dropped_all() -> None:
    """전량 밖이면 게이트가 직접 gate_dropped_all — 대표 사진 0장은 쓸 수 없어서
    빈 결과의 의미가 '실패'인 feature다 (TRIP-260 #5: 의미론은 게이트 소유.
    라벨 구분: drop_event 있음 = 게이트가 버림 → 환각을 보라는 신호)."""
    out = _apply(_raw(["ph-x", "ph-y"]), _ctx(_vision()))
    assert out.value == () and out.error == "gate_dropped_all"
    assert out.drop_event is not None and out.drop_event.dropped_count == 2


def test_gate_empty_selection_is_llm_empty_result() -> None:
    """모델이 아무것도 안 골랐으면 llm_empty_result — 프롬프트·입력을 보라는 신호
    (drop_event 부재 = 게이트는 아무것도 안 버렸다는 증거)."""
    out = _apply(_raw([]), _ctx(_vision()))
    assert out.value == () and out.error == "llm_empty_result"
    assert out.drop_event is None


# ── 게이트: 파싱 실패만 error (②) ────────────────────────────


@pytest.mark.parametrize(
    "raw",
    [
        "사진은 1번과 3번이 좋겠습니다",       # JSON 아님
        '{"photos": ["ph-1"]}',              # 루트 키 다름
        '{"highlights": "ph-1"}',            # 배열 아님
        '{"highlights": [{"id": "ph-1"}]}',  # 문자열 아님
        '{"highlights": ["  "]}',            # 공백뿐
    ],
)
def test_gate_parse_failures_are_the_only_error(raw: str) -> None:
    out = _apply(raw, _ctx(_vision()))
    assert out.error is not None and out.error.startswith("parse_error")
    assert out.value == () and out.drop_event is None  # error면 value 비움 (base 불변식)


def test_gate_without_context_cannot_judge_membership() -> None:
    out = PhotoHighlightGate().apply(
        _raw(["ph-1"]), None, feature=_FEAT, trace_id=_TID, now=_NOW
    )
    assert out.error is not None and out.error.startswith("gate_error")
    assert out.value == ()


def test_gate_context_invariants() -> None:
    with pytest.raises(ValueError):
        PhotoHighlightContext(photo_ids=frozenset())  # 대조 집합 없음
    with pytest.raises(ValueError):
        PhotoHighlightContext(photo_ids=frozenset({PhotoId("ph-1")}), limit=0)


def test_gate_strips_code_fence() -> None:
    out = _apply("```json\n" + _raw(["ph-1"]) + "\n```", _ctx(_vision()))
    assert out.value == (PhotoId("ph-1"),)


# ── 프롬프트 (BR-AF-07 yaml 등록·정본 규칙 문구) ──────────────


def test_photo_highlight_is_registered_in_tier_map_as_heavy() -> None:
    """5종 세트 — enum + tier_map 동반 (BR-AF-07). vision 지원 모델이 필요해 HEAVY."""
    assert default_tier_map()[LlmFeature.PHOTO_HIGHLIGHT] is ModelTier.HEAVY


def test_prompt_renders_deterministically() -> None:
    reg = PromptRegistry(_PROMPTS)
    vision = _vision()
    p1, ref = reg.render(_FEAT, build_photo_highlight_vars(vision, limit=3))
    p2, _ = reg.render(_FEAT, build_photo_highlight_vars(vision, limit=3))
    assert p1 == p2
    assert ref.prompt_id == "prompts/photo_highlight.yaml" and ref.version == "0.1.0"
    assert ref.feature == "PHOTO_HIGHLIGHT"
    assert "ph-1" in p1 and "최대 3장" in p1


def test_prompt_states_closed_set_and_no_visual_description_rules() -> None:
    """게이트가 사실성을 판정할 수 없으므로(BR-U6R-11) 프롬프트가 두 가지를 강하게 건다:
    목록 안의 id만 고를 것 · 사진 묘사를 쓰지 말 것."""
    prompt, _ = PromptRegistry(_PROMPTS).render(
        _FEAT, build_photo_highlight_vars(_vision(), limit=3)
    )
    assert "목록 밖 id 생성 금지" in prompt
    assert "같은 photo_id를 두 번 넣지 마세요" in prompt
    assert "설명·묘사·감상을 쓰지 마세요" in prompt
    assert "시각·소요시간·이동시간을 언급하지 마세요" in prompt  # INV-3
    assert "지어내지 마세요" in prompt
    assert '{"highlights"' in prompt  # 게이트 루트 키와 동일


# ── vars 조립 (G181 좌표 미포함·시각 미주입) ──────────────────


def test_build_vars_are_str_without_coordinates_or_clock_time() -> None:
    vision = _vision(
        _photo("ph-1", _REF1, taken_at=_at(14), gps=GeoPoint(lat=35.1234, lng=129.5678)),
        _photo("ph-2", _REF2, taken_at=_at(9, _D2)),
    )
    variables = build_photo_highlight_vars(vision, limit=4)
    assert all(isinstance(v, str) for v in variables.values())
    photos = variables["photos"]
    assert "35.1234" not in photos and "129.5678" not in photos  # G181
    assert "14:00" not in photos and "T14" not in photos  # 시각 미주입 (BR-U6R-04)
    assert "2026-08-01" in photos and "1번째" in photos  # 날짜·순번까지만
    assert "ph-1" in photos and "poi-1" in photos


def test_build_vars_order_is_input_order_independent() -> None:
    """렌더 결정론(BR-U4-06) — 같은 사진 집합이면 순서가 달라도 같은 프롬프트."""
    a = _photo("ph-a", _REF1, taken_at=_at(9))
    b = _photo("ph-b", _REF1, taken_at=_at(11))
    c = _photo("ph-c", _REF2, taken_at=_at(9, _D2))
    forward = build_photo_highlight_vars(_vision(a, b, c), limit=3)
    backward = build_photo_highlight_vars(_vision(c, b, a), limit=3)
    assert forward == backward


# ── 워커 e2e (실물 레지스트리·게이트, ③④⑤) ──────────────────


def _worker(llm) -> tuple[PhotoHighlightWorker, InMemoryTrace]:
    trace = InMemoryTrace()
    gateway = GatewayFacade(
        llm, PromptRegistry(_PROMPTS), PhotoHighlightGate(), _CFG, trace
    )
    return PhotoHighlightWorker(gateway), trace


def test_worker_end_to_end_success_on_heavy_tier() -> None:
    vision = _vision()
    worker, _ = _worker(FakeLlm(canned=_raw(["ph-2"])))
    result = worker.select(vision, _images(vision), _TID, _NOW, limit=3)
    assert result.is_fallback is False
    assert result.value == (PhotoId("ph-2"),)
    assert result.call_record is not None and result.call_record.success is True
    assert result.call_record.model_id == "m-h"  # HEAVY 티어 (default_tier_map)


def test_worker_actually_ships_the_image_bytes_in_prompt_order() -> None:
    """⑤ 전송된 이미지를 관측한다 — 사진이 실제로 실렸는지, 프롬프트 목록과 같은
    순서인지. 순서가 어긋나면 id는 맞고 사진만 틀린 선택이 나온다."""
    vision = _vision(
        _photo("ph-late", _REF1, taken_at=_at(18)),
        _photo("ph-early", _REF1, taken_at=_at(8)),
    )
    spy = VisionSpyLlm(canned=_raw(["ph-early"]))
    worker, _ = _worker(spy)
    worker.select(vision, _images(vision), _TID, _NOW)

    assert len(spy.seen_images) == 1  # 1회 호출 조립
    sent = spy.seen_images[0]
    assert len(sent) == 2 and all(p.media_type == "image/png" for p in sent)
    # 촬영 시각 순 = 프롬프트 목록 순 (ph-early 먼저)
    assert sent[0].data.endswith(b"ph-early") and sent[1].data.endswith(b"ph-late")


def test_worker_rejects_bytes_outside_the_consented_set() -> None:
    """④ 동의 집합 밖 사진을 보내는 것은 그 자체로 동의 위반(BR-U6R-09) —
    조용히 거르면 왜 빠졌는지가 어디에도 남지 않는다."""
    vision = _vision()
    images = _images(vision)
    images[PhotoId("ph-not-consented")] = LlmImagePart(media_type="image/png", data=_PNG)
    worker, _ = _worker(VisionSpyLlm(canned=_raw(["ph-1"])))
    with pytest.raises(ValueError, match="ph-not-consented"):
        worker.select(vision, images, _TID, _NOW)


def test_worker_rejects_missing_bytes_as_a_silent_partial_degradation() -> None:
    """④ 목록에는 있는데 바이트가 없는 사진 — 목록 순서와 전송 순서의 대응이 깨져
    id는 맞고 사진만 틀린 선택이 나온다. 게다가 조용한 부분 강등이다 (BR-U6R-10)."""
    vision = _vision(_photo("ph-1"), _photo("ph-2", _REF2))
    partial = {PhotoId("ph-1"): LlmImagePart(media_type="image/png", data=_PNG)}
    worker, trace = _worker(VisionSpyLlm(canned=_raw(["ph-1"])))
    with pytest.raises(ValueError, match="ph-2"):
        worker.select(vision, partial, _TID, _NOW)
    assert trace.events == []  # 호출 버그 — 폴백 신호가 아니다


def test_worker_rejects_zero_images_as_a_silent_degradation() -> None:
    """④ vision feature인데 바이트가 0장이면 사실상 텍스트 호출 — 강등은 호출측이
    명시적으로 선택해야 한다 (BR-U6R-10 조용한 강등 금지)."""
    vision = _vision()
    worker, spy_trace = _worker(VisionSpyLlm(canned=_raw(["ph-1"])))
    with pytest.raises(ValueError):
        worker.select(vision, {}, _TID, _NOW)
    assert spy_trace.events == []  # 호출 버그 — 폴백 신호가 아니다


def test_worker_converges_to_fallback_on_text_only_adapter() -> None:
    """③ VIS-P4 — 이미지 미지원 어댑터에서 예외가 위로 새지 않고 폴백 신호로 수렴.
    사유는 `unsupported:` — 재시도가 아니라 강등이 처방이라 구분이 필요하다."""
    vision = _vision()
    worker, trace = _worker(TextOnlyLlm())
    result = worker.select(vision, _images(vision), _TID, _NOW)
    assert result.is_fallback is True and result.value is None
    assert result.error is not None and result.error.startswith("unsupported:")
    assert len(trace.of_type(FallbackEvent)) == 1  # 침묵 실패 금지 (INV-4)
    assert result.call_record is not None and result.call_record.success is False


def test_worker_falls_back_loudly_on_llm_failure() -> None:
    vision = _vision()
    worker, trace = _worker(FailingLlm())
    result = worker.select(vision, _images(vision), _TID, _NOW)
    assert result.is_fallback is True and result.value is None
    assert len(trace.of_type(FallbackEvent)) == 1


def test_worker_falls_back_when_every_id_is_hallucinated() -> None:
    """전량 밖 = 게이트 전량 드롭 — 폴백 신호 + 드롭 계측 둘 다 남는다."""
    vision = _vision()
    worker, trace = _worker(FakeLlm(canned=_raw(["ph-x"])))
    result = worker.select(vision, _images(vision), _TID, _NOW)
    assert result.is_fallback is True and result.error == "gate_dropped_all"
    assert len(trace.of_type(GateDropEvent)) == 1


# ── PBT ──────────────────────────────────────────────────────


@given(
    ids=st.lists(
        st.sampled_from(["ph-1", "ph-2", "ph-3", "ph-x", "ph-y", ""]), max_size=12
    ),
    limit=st.integers(min_value=1, max_value=4),
)
@settings(max_examples=80, deadline=None)
def test_pbt_vis_p2_gate_half(ids: list[str], limit: int) -> None:
    """VIS-P2(게이트 절반) — **어떤 오염 조합에도** 결과는 입력 집합 안 ∧ 중복 0 ∧ ≤ N."""
    vision = _vision(_photo("ph-1"), _photo("ph-2", _REF2), _photo("ph-3", _REF2))
    allowed = {p.photo_id for p in vision.photos}
    out = _apply(_raw(ids), _ctx(vision, limit=limit))
    if out.error is not None:
        assert out.value == ()  # 파싱 실패면 결과 없음
        return
    assert set(out.value) <= allowed
    assert len(set(out.value)) == len(out.value)
    assert len(out.value) <= limit


@given(
    raw=st.one_of(
        st.text(max_size=120),
        st.just('{"highlights": []}'),
        # 유효 JSON도 섞는다 — 쓰레기 텍스트만 주면 성공 분기가 도달 불가라
        # "수렴한다"의 절반(성공 경로)이 사실상 검증되지 않는다
        st.lists(st.sampled_from(["ph-1", "ph-2", "ph-x", ""]), max_size=5).map(_raw),
    )
)
@settings(max_examples=80, deadline=None)
def test_pbt_worker_converges_for_any_llm_text(raw: str) -> None:
    """어떤 LLM 응답이 와도: 예외 없음 ∧ (id 튜플 or 폴백 신호) — 침묵 실패 없음."""
    vision = _vision()
    worker, _ = _worker(FakeLlm(canned=raw))
    result = worker.select(vision, _images(vision), _TID, _NOW)
    if result.is_fallback:
        assert result.value is None and result.error
    else:
        assert isinstance(result.value, tuple) and result.value


# ── 결정론 메타 규칙 폴백 (⑥, LLM 0회) ───────────────────────

_FB_PHOTOS = (
    _photo("a1", _REF1, taken_at=_at(9)),
    _photo("a2", _REF1, taken_at=_at(12)),
    _photo("a3", _REF1, taken_at=_at(18)),
    _photo("b1", _REF2, taken_at=_at(10, _D2)),
    _photo("c1", None, taken_at=None),
)


# 뒤섞인 입력으로 단언한다 — 정렬 전 순서 그대로 뽑아도 통과하는 픽스처면
# "정렬한다"는 주장을 검증하지 못한다 (변이 테스트에서 실제로 살아남았다)
_FB_SHUFFLED = (_FB_PHOTOS[2], _FB_PHOTOS[4], _FB_PHOTOS[1], _FB_PHOTOS[3], _FB_PHOTOS[0])


def test_fallback_takes_one_per_visit_before_seconds() -> None:
    """FD §6 ⓐ '방문당 1장' — 사진이 몰린 방문이 결과를 독점하지 않는다."""
    assert select_highlights(_FB_SHUFFLED, limit=3) == (
        PhotoId("a1"), PhotoId("b1"), PhotoId("c1"),
    )


def test_fallback_spreads_within_visit_by_time_on_later_rounds() -> None:
    """상한이 남으면 같은 방문의 다음 시간대가 붙는다 (시간 분산)."""
    assert select_highlights(_FB_SHUFFLED, limit=5) == (
        PhotoId("a1"), PhotoId("b1"), PhotoId("c1"), PhotoId("a2"), PhotoId("a3"),
    )


def test_fallback_needs_no_llm_and_no_bytes() -> None:
    """폴백은 메타만 본다 — 게이트웨이도, 이미지도, 동의 증빙도 인자에 없다."""
    assert select_highlights((_photo("solo", None),), limit=8) == (PhotoId("solo"),)
    assert select_highlights((), limit=3) == ()
    with pytest.raises(ValueError):
        select_highlights(_FB_PHOTOS, limit=0)


@given(
    perm=st.permutations(_FB_PHOTOS),
    limit=st.integers(min_value=1, max_value=6),
)
@settings(max_examples=60, deadline=None)
def test_pbt_fallback_is_deterministic_and_order_independent(perm, limit: int) -> None:
    """VIS-P2 폴백 절반 — 같은 사진 집합이면 **넘긴 순서와 무관하게** 같은 결과가
    나오고, 결과는 입력 안 ∧ 중복 0 ∧ ≤ limit."""
    baseline = select_highlights(_FB_PHOTOS, limit=limit)
    shuffled = select_highlights(tuple(perm), limit=limit)
    assert shuffled == baseline == select_highlights(_FB_PHOTOS, limit=limit)
    assert set(baseline) <= {p.photo_id for p in _FB_PHOTOS}
    assert len(set(baseline)) == len(baseline) <= limit


def test_pbt_fallback_covers_gate_contract() -> None:
    """폴백 산출도 게이트를 그대로 통과한다 — 폴백이 스스로 계약을 어기지 않는다
    (FALLBACK_NUDGE_MESSAGE·고정 폴백 템플릿 선례: 폴백에 게이트 재적용)."""
    vision = _vision(*_FB_PHOTOS)
    picks = select_highlights(_FB_PHOTOS, limit=3)
    out = _apply(_raw([str(p) for p in picks]), _ctx(vision, limit=3))
    assert out.value == picks and out.error is None and out.drop_event is None
