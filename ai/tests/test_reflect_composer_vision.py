"""VIS-P1(사영)·VIS-P3 + #9 예산 공유: compose_vision Phase 2 강등 계단 — 조립층 몫 (TRIP-595).

게이트·워커 단위(VIS-P2 전체·VIS-P4·동의 경계·이미지 전송 순서)는
test_llm_gateway_photo_highlight.py 소관, 텍스트 조립층(RFL-P1~P7)은
test_reflect_composer.py 소관 — 여기는 photo_highlight 파일이 "범위 밖 —
composer 통합"으로 유예했던 조각만 증명한다:

  #9 예산 공유    vision 시도와 텍스트 시도가 MAX_ATTEMPTS(3)를 공유한다 (확정
                 2026-08-28: 시도 1회 = LLM 호출 1회, vision 실패도 예산 소진) —
                 vision이 k(1~3)번째에 죽는 **모든 k**에 대해 템플릿 생성 호출
                 총합 == 3 (별도 배정·같은 반복 재호출이면 4가 돼 깨진다) ∧
                 vision 사망 후 이미지 실린 호출 0 ∧ 하이라이트는 별도 1회
  VIS-P3 드롭인   vision 실패 스윕(타임아웃·비지원·벤더 예외·파싱) → 최종 산출
                 to_dict 키 집합 == 같은 요청의 Phase 1 compose 산출 키 집합
                 (같은 텍스트 응답이면 값까지 동일) ∧ 전 시도 실패 → 고정 폴백
                 200 상당(is_fallback=True, INV-4)
  stage="vision"  vision 강등·하이라이트 강등 각각 FallbackEvent(stage="vision") —
                 운영자가 stage로 필터하면 잡힌다 (유예 항목 해소). 모드 쌍은
                 config 폴백 대장과 일치 (TRIP-260 #4·BR-AF-07). 텍스트 전용
                 경로(compose)에서는 stage="vision" 이벤트 0
  VIS-P1 사영     compose_vision 경유 시 이미지가 실리는 호출은 vision feature뿐 —
                 텍스트 강등 후 호출·Phase 1 compose 호출은 전부 images == ()
  BR-U6R-05      vision 1차 위반 0이면 템플릿 생성 1회로 조기 종료
  결정론          같은 입력 2회 → 같은 산출 (성공·강등·전실패 세 경로 전부)

전부 fake — 실 LLM·외부 API 호출 0 (D37). wall-clock 미사용 — 고정 tz-aware now.
"""

from __future__ import annotations

import json

import pytest
from datetime import date, datetime, timezone
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.reflect.composer import (
    MAX_ATTEMPTS,
    compose,
    compose_vision,
)
from trippilot.agents.reflect.fallback import build_fallback_template
from trippilot.agents.reflect.highlight_rule import select_highlights
from trippilot.llm_gateway.config import C1Config, default_fallback_modes
from trippilot.llm_gateway.gates.photo_highlight import (
    DEFAULT_HIGHLIGHT_LIMIT,
    PhotoHighlightGate,
)
from trippilot.llm_gateway.gates.reflection_template import ReflectionTemplateGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.photo_highlight import PhotoHighlightWorker
from trippilot.llm_gateway.workers.reflection_template import ReflectionTemplateWorker
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.reflection import (
    PhotoConsent,
    PhotoId,
    PhotoRef,
    ReflectionKind,
    ReflectionRequest,
    SourceEventKind,
    TripEventRecord,
    VisionInput,
    VisitRecord,
    VisitRef,
)
from trippilot.ports.llm_port import (
    LlmImagePart,
    LlmTimeoutError,
    LlmUnsupportedError,
)

from tests.fakes.fake_llm import (
    FailingLlm,
    FakeLlm,
    ScriptedVisionLlm,
    SplitVisionLlm,
    VisionSpyLlm,
)
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.reflection import polluted_reflection_cases

_NOW = datetime(2026, 8, 28, 9, 0, tzinfo=timezone.utc)  # 고정 tz-aware (wall-clock 0)
_TID = TraceId("t-u6-composer-vision")
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})
_PNG = b"\x89PNG\r\n\x1a\n fake bytes"

_D1, _D2 = date(2026, 8, 1), date(2026, 8, 2)
_REF1 = VisitRef(date=_D1, poi_id=PoiId("poi-1"))
_REF2 = VisitRef(date=_D2, poi_id=PoiId("poi-2"))
_REQUEST = ReflectionRequest(
    kind=ReflectionKind.TRIP_SUMMARY,
    region="부산",
    start_date=_D1,
    end_date=_D2,
    visits=(
        VisitRecord(ref=_REF1, poi_name="감천문화마을", category="SIGHT",
                    order_in_day=1, photo_count=3),
        VisitRecord(ref=_REF2, poi_name="해운대", category="NATURE",
                    order_in_day=1, photo_count=0),
    ),
    events=(TripEventRecord(kind=SourceEventKind.PLAN_B, date=_D1, detail="휴무로 코스 변경"),),
    persona_summary="느긋한 일정 선호",
    weather_summary="이틀 다 맑음",
)
_VISION = VisionInput(
    photos=(
        PhotoRef(photo_id=PhotoId("ph-1"), visit_ref=_REF1,
                 taken_at=datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)),
        PhotoRef(photo_id=PhotoId("ph-2"), visit_ref=_REF2,
                 taken_at=datetime(2026, 8, 2, 10, 0, tzinfo=timezone.utc)),
        PhotoRef(photo_id=PhotoId("ph-3")),  # 방문·시각 미상 — 규칙 폴백의 맨 뒤 묶음
    ),
    consent=PhotoConsent(granted=True, consent_ref="consent-log-1", granted_at=_NOW),
)

# 위반 0 body (조기 종료 케이스) — _REQUEST 기준 하드·소프트 전부 없음
_CLEAN_BODY = {
    "cover": {"title": "이틀의 기록", "subtitle": "{region} · {start_date}~{end_date}",
              "photo_slot": {"visit_ref": {"date": "2026-08-01", "poi_id": "poi-1"}}},
    "scenes": [
        {"layout": "PHOTO_FULL",
         "photo_slot": {"visit_ref": {"date": "2026-08-01", "poi_id": "poi-1"}},
         "caption": "첫날은 {poi:0.name}부터"},
        {"layout": "STATS", "caption": "{visit_count}곳 · {distance_km}km"},
        {"layout": "MAP", "caption": "우리가 지나온 길"},
    ],
    "hashtags": ["#부산여행"],
}
# 하드 위반(TIME_EXPR)이 항상 남는 body — 조기 종료가 없어야 하는 케이스
_VIOLATING_BODY = {
    "cover": _CLEAN_BODY["cover"],
    "scenes": _CLEAN_BODY["scenes"][:2] + [{"layout": "MAP", "caption": "이동 30분"}],
    "hashtags": ["#부산여행"],
}
_HL_RAW = json.dumps({"highlights": ["ph-2"]}, ensure_ascii=False)

# vision 실패 지점 스윕 — 게이트웨이가 폴백 신호로 수렴시키는 실패 4종 전부.
# 예외는 매 예제마다 새로 만든다 (인스턴스 공유로 traceback이 누적되지 않게).
_VISION_FAILURES: dict[str, object] = {
    "timeout": lambda: LlmTimeoutError("timeout > 2.5s (fake)"),
    "unsupported": lambda: LlmUnsupportedError("이미지 미지원 어댑터"),
    "vendor_error": lambda: RuntimeError("vendor 5xx (fake)"),
    "parse_garbage": lambda: "회고 느낌의 산문 응답 — JSON 아님",
}


def _raw(body: dict) -> str:
    return json.dumps({"template": body}, ensure_ascii=False)


def _images(vision: VisionInput) -> dict[PhotoId, LlmImagePart]:
    return {
        p.photo_id: LlmImagePart(
            media_type="image/png", data=_PNG + str(p.photo_id).encode())
        for p in vision.photos
    }


def _env(template_llm, highlight_llm):
    """워커 2개를 각자의 게이트로 조립 — 트레이스는 하나를 공유해 stage 필터가
    운영자 관점(전체 이벤트 스트림)과 같아진다. 템플릿 워커 안에서는 vision·텍스트
    feature가 같은 LlmPort를 공유한다 (같은 게이트웨이 — 실배선과 동형)."""
    trace = InMemoryTrace()
    worker = ReflectionTemplateWorker(GatewayFacade(
        template_llm, PromptRegistry(_PROMPTS), ReflectionTemplateGate(), _CFG, trace))
    highlight_worker = PhotoHighlightWorker(GatewayFacade(
        highlight_llm, PromptRegistry(_PROMPTS), PhotoHighlightGate(), _CFG, trace))
    return worker, highlight_worker, trace


def _run_vision(template_llm, highlight_llm, request: ReflectionRequest = _REQUEST):
    worker, highlight_worker, trace = _env(template_llm, highlight_llm)
    template = compose_vision(
        worker, highlight_worker, request, _VISION, _images(_VISION),
        _TID, _NOW, trace)
    return template, trace


def _run_phase1(llm, request: ReflectionRequest = _REQUEST):
    trace = InMemoryTrace()
    worker = ReflectionTemplateWorker(GatewayFacade(
        llm, PromptRegistry(_PROMPTS), ReflectionTemplateGate(), _CFG, trace))
    return compose(worker, request, _TID, _NOW, trace), trace


def _vision_events(trace: InMemoryTrace) -> list[FallbackEvent]:
    """운영자 필터 그대로 — stage=="vision"만 본다 (component 불문)."""
    return [e for e in trace.of_type(FallbackEvent) if e.stage == "vision"]


# ── #9 예산 공유 — vision이 k번째에 죽는 모든 k (호출 계수 스파이) ─────


@given(
    case=polluted_reflection_cases(min_pollution=1),
    k=st.integers(min_value=1, max_value=MAX_ATTEMPTS),
    failure_kind=st.sampled_from(sorted(_VISION_FAILURES)),
)
@settings(max_examples=60, deadline=None)
def test_pbt_budget_shared_vision_death_at_every_k(case, k: int, failure_kind: str) -> None:
    """vision이 k번째 시도에서 어떤 방식으로 죽든: 템플릿 생성 호출 총합 == 3
    (공유 예산 상한 — 별도 배정·같은 반복 텍스트 재호출이면 4가 돼 실패) ∧
    vision 사망 이후 이미지 실린 호출 0 ∧ 하이라이트는 별도 1회 ∧ 강등 신호 1건."""
    request, bodies = case
    raw = _raw(bodies[0][0])  # min_pollution=1 — 위반이 남아 조기 종료 없음
    # 대본: vision 생존 k-1회(위반 후보) → k번째 실패 → 남은 예산은 텍스트(반복)
    script = (raw,) * (k - 1) + (_VISION_FAILURES[failure_kind](), raw)
    template_llm = ScriptedVisionLlm(*script)
    highlight_llm = ScriptedVisionLlm(_HL_RAW)

    template, trace = _run_vision(template_llm, highlight_llm, request)

    assert template_llm.calls == MAX_ATTEMPTS  # 시도 1회 = 호출 1회, 상한 3 (#9)
    # vision 사망 후 vision 재호출 0 — 이미지 실린 호출은 정확히 앞 k번뿐
    flags = [bool(images) for images in template_llm.seen_images]
    assert flags == [True] * k + [False] * (MAX_ATTEMPTS - k)
    assert highlight_llm.calls == 1  # 하이라이트 1회는 예산 밖 (별도)
    assert template.is_fallback is False  # 텍스트(또는 생존 vision) 후보가 살았다
    events = _vision_events(trace)
    assert len(events) == 1  # 강등 1건 — 조용한 강등 금지 (BR-U6R-10)
    assert (events[0].from_mode, events[0].to_mode) == (
        "vision_template", "text_template")


def test_budget_worst_case_total_failure_caps_template_calls_at_three() -> None:
    """전부 실패하는 최악에도: 템플릿 생성 호출 3회(vision 1 + 텍스트 2)에서 멈추고
    고정 폴백 200 상당으로 수렴한다 — 침묵 없이 강등 신호 3종 전부 발행 (INV-4)."""
    template_llm = ScriptedVisionLlm(RuntimeError("vendor down (fake)"))
    highlight_llm = ScriptedVisionLlm(RuntimeError("vendor down (fake)"))
    template, trace = _run_vision(template_llm, highlight_llm)

    assert template_llm.calls == MAX_ATTEMPTS  # 최악 상한 — 4회가 아니다 (#9)
    assert [bool(i) for i in template_llm.seen_images] == [True, False, False]
    assert highlight_llm.calls == 1
    assert template.is_fallback is True
    assert template == build_fallback_template(_REQUEST.kind, _TID, _NOW)
    # Phase 1 전 시도 실패와 같은 봉투 스키마 (VIS-P3 — 폴백까지 드롭인)
    phase1, _ = _run_phase1(FailingLlm())
    assert set(template.to_dict()) == set(phase1.to_dict())
    own = [(e.stage, e.from_mode, e.to_mode)
           for e in trace.of_type(FallbackEvent) if e.component == "agents.reflect"]
    assert ("vision", "llm_highlight", "rule_highlight") in own
    assert ("vision", "vision_template", "text_template") in own
    assert ("agent", "llm_template", "fixed_template") in own


# ── VIS-P3 — 드롭인: 어떤 vision 실패에도 산출 스키마 = Phase 1 ────────


@given(
    case=polluted_reflection_cases(),
    failure_kind=st.sampled_from(sorted(_VISION_FAILURES)),
)
@settings(max_examples=80, deadline=None)
def test_pbt_vis_p3_dropin_equals_phase1_for_any_vision_failure(
    case, failure_kind: str
) -> None:
    """vision만 죽는 모든 실패 방식 × 오염 0~100% body: 최종 산출 to_dict 키 집합 ==
    같은 요청·같은 텍스트 응답의 Phase 1 compose 산출 키 집합 — 값까지 동일
    (FE 재협상 없는 드롭인) ∧ FallbackEvent(stage="vision") 발행 ∧ 재실행 동일."""
    request, bodies = case
    raw = _raw(bodies[0][0])

    def run_phase2():
        template_llm = SplitVisionLlm(
            on_vision=_VISION_FAILURES[failure_kind](), on_text=raw)
        return _run_vision(template_llm, FakeLlm(canned=_HL_RAW), request)

    phase2, trace2 = run_phase2()
    phase2_again, _ = run_phase2()
    phase1, _ = _run_phase1(FakeLlm(canned=raw), request)

    assert set(phase2.to_dict()) == set(phase1.to_dict())  # 스키마 키 집합 (VIS-P3)
    assert phase2 == phase1  # 같은 텍스트 응답이면 값까지 동일 — 강한 드롭인
    assert phase2 == phase2_again  # 결정론 (같은 입력 2회 → 같은 산출)
    assert phase2.is_fallback is False  # 강등이지 실패가 아니다
    events = _vision_events(trace2)
    assert len(events) == 1
    assert (events[0].from_mode, events[0].to_mode) == (
        "vision_template", "text_template")


# ── stage="vision" 이벤트 — 운영자 필터·config 대장 정합 ──────────────


def test_vision_degrade_event_is_catchable_by_stage_filter_and_matches_ledger() -> None:
    """vision 강등 이벤트: stage="vision" 필터로 잡히고(유예 해소), 모드 쌍은
    config 폴백 대장(REFLECTION_TEMPLATE_VISION)과 일치하며 사유가 관통한다."""
    template_llm = SplitVisionLlm(
        on_vision=LlmUnsupportedError("이미지 미지원 어댑터"),
        on_text=_raw(_CLEAN_BODY))
    template, trace = _run_vision(template_llm, FakeLlm(canned=_HL_RAW))

    assert template.is_fallback is False
    events = _vision_events(trace)
    assert len(events) == 1
    event = events[0]
    assert event.component == "agents.reflect"
    assert (event.from_mode, event.to_mode) == default_fallback_modes()[
        LlmFeature.REFLECTION_TEMPLATE_VISION]  # 대장과 코드가 같은 실체 (TRIP-260 #4)
    assert "unsupported" in event.reason  # 강등 사유 관통 — 침묵 금지


def test_highlight_degrade_event_and_deterministic_rule_fallback() -> None:
    """하이라이트 실패: FallbackEvent(stage="vision", llm_highlight→rule_highlight) +
    결정론 규칙 폴백의 결과가 실제로 vision 프롬프트의 대표 사진 목록에 실린다 —
    강등이 전체 생성을 죽이지 않는다."""
    template_llm = ScriptedVisionLlm(_raw(_CLEAN_BODY))
    template, trace = _run_vision(template_llm, FailingLlm())

    assert template.is_fallback is False  # 하이라이트 강등 ≠ 생성 실패
    events = _vision_events(trace)
    assert len(events) == 1
    assert (events[0].from_mode, events[0].to_mode) == default_fallback_modes()[
        LlmFeature.PHOTO_HIGHLIGHT]
    # 결정론 규칙 폴백(방문당 1장·시간 분산)이 실제로 쓰였다 — 프롬프트에 그 id들이 실림
    rule_ids = select_highlights(_VISION.photos, limit=DEFAULT_HIGHLIGHT_LIMIT)
    assert rule_ids  # 규칙은 언제나 답을 낸다 (INV-4)
    for photo_id in rule_ids:
        assert str(photo_id) in template_llm.prompts[0]


@given(raw=st.text(max_size=120))
@settings(max_examples=50, deadline=None)
def test_pbt_text_only_compose_never_emits_stage_vision(raw: str) -> None:
    """텍스트 전용 경로(compose)는 어떤 LLM 응답·실패에도 stage="vision" 이벤트를
    내지 않는다 — 운영자의 vision 필터에 Phase 1 잡음이 섞이지 않는다."""
    for llm in (FakeLlm(canned=raw), FailingLlm()):
        _, trace = _run_phase1(llm)
        assert _vision_events(trace) == []


# ── VIS-P1 상위 사영 — 이미지는 vision feature 호출에만 실린다 ─────────


def test_vis_p1_projection_images_ride_only_vision_calls_in_photos_order() -> None:
    """성공 경로: 템플릿 생성 1회(vision)에 이미지가 vision.photos 순서 그대로
    실리고, 하이라이트 1회에도 실린다 — 이미지 실린 호출은 vision feature뿐."""
    spy = VisionSpyLlm(canned=_raw(_CLEAN_BODY))
    highlight_spy = VisionSpyLlm(canned=_HL_RAW)
    worker, highlight_worker, trace = _env(spy, highlight_spy)
    images = _images(_VISION)
    template = compose_vision(
        worker, highlight_worker, _REQUEST, _VISION, images, _TID, _NOW, trace)

    assert template.is_fallback is False
    # vision 생성 호출 — vision.photos 순서 그대로 (워커 docstring의 결정론 계약)
    assert spy.seen_images == [tuple(images[p.photo_id] for p in _VISION.photos)]
    assert len(highlight_spy.seen_images) == 1 and highlight_spy.seen_images[0]
    assert _vision_events(trace) == []  # 전부 성공 — 강등 신호 0


def test_vis_p1_projection_degraded_text_calls_carry_empty_images() -> None:
    """텍스트 강등 후 호출엔 images == () — 강등은 '같은 파이프라인, images만 비움'
    (FD §6.1 A안)으로 표현된다."""
    template_llm = SplitVisionLlm(
        on_vision=LlmUnsupportedError("이미지 미지원 어댑터"),
        on_text=_raw(_CLEAN_BODY))
    template, _ = _run_vision(template_llm, FakeLlm(canned=_HL_RAW))

    assert template.is_fallback is False
    assert [bool(i) for i in template_llm.seen_images] == [True, False]
    assert template_llm.seen_images[1] == ()  # 빈 튜플 — None·잔상 아님


def test_vis_p1_projection_phase1_compose_never_ships_images() -> None:
    """Phase 1 compose는 어떤 호출에도 이미지를 싣지 않는다 — 3회 소진 경로 포함."""
    spy = VisionSpyLlm(canned=_raw(_VIOLATING_BODY))
    _run_phase1(spy)
    assert spy.seen_images == [()] * MAX_ATTEMPTS


# ── BR-U6R-05 — vision 1차 위반 0이면 조기 종료 ───────────────────────


def test_vision_clean_first_try_short_circuits_at_one_template_call() -> None:
    template_llm = ScriptedVisionLlm(_raw(_CLEAN_BODY))
    highlight_llm = ScriptedVisionLlm(_HL_RAW)
    template, trace = _run_vision(template_llm, highlight_llm)

    assert template_llm.calls == 1  # 위반 0 → 조기 종료 (예산 2회 절약)
    assert [bool(i) for i in template_llm.seen_images] == [True]
    assert highlight_llm.calls == 1
    assert template.is_fallback is False
    assert len(template.scenes) == 3


# ── 결정론 — 성공·강등·전실패 세 경로 전부 재실행 동일 ─────────────────


def test_compose_vision_deterministic_for_same_inputs_across_paths() -> None:
    """같은 입력 2회 → 같은 산출 (fake 결정론 전제 · now 주입 — wall-clock 0)."""
    factories = {
        "success": lambda: (ScriptedVisionLlm(_raw(_CLEAN_BODY)),
                            FakeLlm(canned=_HL_RAW)),
        "vision_degraded": lambda: (
            SplitVisionLlm(on_vision=LlmUnsupportedError("이미지 미지원 어댑터"),
                           on_text=_raw(_VIOLATING_BODY)),
            FakeLlm(canned=_HL_RAW)),
        "all_fail": lambda: (FailingLlm(), FailingLlm()),
    }
    for name, make in factories.items():
        results = [_run_vision(*make())[0] for _ in range(2)]
        assert results[0] == results[1], f"경로 {name}가 비결정론"


# ── 이미지 키 계약 — photo_highlight 워커와 대칭 (관찰 사항 반영) ─────


def test_generate_vision_rejects_mismatched_image_keys() -> None:
    """images 키 ≠ 동의 사진 집합이면 **호출 버그**(ValueError) — 조용한 필터링은
    동의 밖 바이트 유입(BR-U6R-09)과 '이미지 0장 vision 호출'(BR-U6R-10 조용한
    이미지 무시)을 숨긴다. 하이라이트를 건너뛰는 직접 호출자에서도 계약이 성립."""
    worker, _, _ = _env(FakeLlm(canned="{}"), FakeLlm(canned="{}"))
    good = _images(_VISION)

    missing = dict(good)
    missing.pop(next(iter(good)))
    with pytest.raises(ValueError, match="불일치"):
        worker.generate_vision(_REQUEST, _VISION, missing, (), _TID, _NOW)

    extra = dict(good)
    extra[PhotoId("ph-동의밖")] = LlmImagePart(media_type="image/png", data=_PNG)
    with pytest.raises(ValueError, match="불일치"):
        worker.generate_vision(_REQUEST, _VISION, extra, (), _TID, _NOW)
