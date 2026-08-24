"""RFL-P1~P7: Reflect 조립층(composer·fallback) — 오염 교체·랭킹 결정론·고정 폴백 (TRIP-429).

게이트·워커 단위(RFL-P1 판정 절반·P2~P3 기록·P6 예시 왕복)는
test_llm_gateway_reflection_template.py 40건 소관 — 여기는 **조립층 몫만** 증명한다:

  RFL-P1·P2·P3  오염 후보 → 하드 위반 결정론 교체 후 **재게이트 오라클**로 하드 0
                (visit_ref ⊆ 방문 ∧ EVENT 실재 ∧ 시간 표현 0 ∧ 어휘 밖 토큰 0)
  RFL-P4        랭킹(rank_key)·교체(apply_hard_replacements) 순수 함수 —
                이중 호출 동일성 + 후보 순열 불변(사전식 비교 유일해)
  RFL-P5        3회 전부 파싱 실패 → 고정 폴백 템플릿(is_fallback=true) +
                FallbackEvent(agents.reflect) + 시도별 LlmCallRecord(success=False)
  RFL-P7        소프트 위반은 채택을 막지 않는다 — 하드 0 후보가 항상 우선,
                소프트만 있는 후보는 교체 없이 그대로 채택
  BR-U6R-05     위반 0 후보 조기 종료 (호출 횟수 스파이) / 위반 후보는 3회 소진
  BR-U6R-07     폴백 템플릿·교체 안전 문구 스스로 게이트 재적용 시 금칙 0
                (FALLBACK_NUDGE_MESSAGE 선례)

전부 fake — 실 LLM·외부 API 호출 0 (D37). wall-clock 미사용 — 고정 tz-aware now.
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import date, datetime, timezone
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.reflect.composer import (
    MAX_ATTEMPTS,
    SAFE_CAPTION_BY_LAYOUT,
    apply_hard_replacements,
    compose,
    rank_key,
)
from trippilot.agents.reflect.fallback import (
    FALLBACK_COVER_SUBTITLE,
    FALLBACK_COVER_TITLE,
    build_fallback_template,
)
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.reflection_template import (
    ReflectionTemplateContext,
    ReflectionTemplateGate,
)
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.reflection_template import ReflectionTemplateWorker
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.domain.observability import FallbackEvent, LlmCallRecord
from trippilot.domain.reflection import (
    ReflectionKind,
    ReflectionRequest,
    ReflectionTemplate,
    SceneLayout,
    SourceEventKind,
    TemplateCandidate,
    TripEventRecord,
    ViolationGrade,
    VisitRecord,
    VisitRef,
)
from trippilot.ports.llm_port import LlmRequest, LlmResponse

from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.reflection import (
    HASHTAG_COLON_POLLUTIONS,
    SOFT_POLLUTIONS,
    polluted_body_for,
    polluted_reflection_cases,
    reflection_requests,
    reflection_templates,
)

_NOW = datetime(2026, 8, 20, 9, 0, tzinfo=timezone.utc)  # 고정 tz-aware (wall-clock 0)
_TID = TraceId("t-u6-composer")
_FEAT = LlmFeature.REFLECTION_TEMPLATE
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})

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

# 위반 0 body (조기 종료 케이스) — 장면 3(범위 내)·중복 없음·캡션 40자 이내
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
# 하드 위반(TIME_EXPR) 1건이 항상 남는 body — 조기 종료가 없어야 하는 케이스
_VIOLATING_BODY = {
    "cover": _CLEAN_BODY["cover"],
    "scenes": _CLEAN_BODY["scenes"][:2] + [{"layout": "MAP", "caption": "이동 30분"}],
    "hashtags": ["#부산여행"],
}


def _raw(body: dict) -> str:
    return json.dumps({"template": body}, ensure_ascii=False)


def _ctx(request: ReflectionRequest) -> ReflectionTemplateContext:
    return ReflectionTemplateContext(
        kind=request.kind,
        visit_refs=tuple(v.ref for v in request.visits),
        event_kinds=frozenset(e.kind for e in request.events),
    )


def _gate(request: ReflectionRequest, body: dict):
    outcome = ReflectionTemplateGate().apply(
        _raw(body), _ctx(request), feature=_FEAT, trace_id=_TID, now=_NOW
    )
    assert outcome.error is None, f"generator body는 항상 파싱 성립해야: {outcome.error}"
    return outcome


def _regate_violations(request: ReflectionRequest, template: ReflectionTemplate):
    """재게이트 오라클 — 최종 산출물을 그대로 게이트에 다시 태워 위반을 판정한다."""
    d = template.to_dict()
    body = {"cover": d["cover"], "scenes": d["scenes"], "hashtags": d["hashtags"]}
    return _gate(request, body).value.violations


def _hard(violations) -> list:
    return [v for v in violations if v.grade is ViolationGrade.HARD]


def _refs_of(template: ReflectionTemplate) -> list[VisitRef]:
    refs = [s.photo_slot.visit_ref for s in template.scenes if s.photo_slot is not None]
    if template.cover.photo_slot is not None:
        refs.append(template.cover.photo_slot.visit_ref)
    return refs


class ScriptedLlm:
    """시나리오 응답 + 호출 횟수 계수 스파이 (마지막 응답 반복) — 실 호출 0 (D37)."""

    def __init__(self, *texts: str) -> None:
        self._texts = texts
        self.calls = 0

    def invoke(self, request: LlmRequest) -> LlmResponse:
        text = self._texts[min(self.calls, len(self._texts) - 1)]
        self.calls += 1
        return LlmResponse(raw_text=text, input_tokens=1, output_tokens=len(text),
                           latency_ms=1, model_id=request.model_id)


def _compose_env(llm) -> tuple[ReflectionTemplateWorker, InMemoryTrace]:
    trace = InMemoryTrace()
    gateway = GatewayFacade(
        llm, PromptRegistry(_PROMPTS), ReflectionTemplateGate(), _CFG, trace
    )
    return ReflectionTemplateWorker(gateway), trace


# ── RFL-P1·P2·P3 — 오염 스윕 → 교체 후 하드 0 (재게이트 오라클) ──


@given(case=polluted_reflection_cases())
@settings(max_examples=120, deadline=None)
def test_rfl_p1_p2_p3_replacement_erases_all_hard_violations(case) -> None:
    """어떤 오염 조합(0~100%)에도: 교체 후 재게이트 하드 0 ∧ visit_ref 전부 방문 내
    ∧ EVENT 장면 전부 실재 ∧ 방문 밖 참조는 GateDropEvent로 계측."""
    request, bodies = case
    body, kinds = bodies[0]
    outcome = _gate(request, body)
    final = apply_hard_replacements(outcome.value)

    # P1 — 최종 산출물의 참조 폐쇄성 (INV-1 사영)
    allowed = {v.ref for v in request.visits}
    assert all(ref in allowed for ref in _refs_of(final))
    event_kinds = {e.kind for e in request.events}
    assert all(
        s.source_event in event_kinds
        for s in final.scenes if s.source_event is not None
    )
    # P2·P3 — 재게이트 시 하드(시간 표현·어휘 밖·참조 밖·미실재 이벤트) 소멸
    assert _hard(_regate_violations(request, final)) == []
    # P1 계측 — 방문 밖 참조 오염이 있었으면 드롭 이벤트에 유령 id가 실린다
    if {"scene_visit_ref_out", "cover_visit_ref_out"} & kinds:
        assert outcome.drop_event is not None
        assert PoiId("ghost-999") in outcome.drop_event.dropped_ids


@given(case=polluted_reflection_cases(pool=HASHTAG_COLON_POLLUTIONS, min_pollution=1))
@settings(max_examples=30, deadline=None)
def test_rfl_p2_p3_hashtag_with_colon_is_still_replaced(case) -> None:
    """태그 자체에 콜론이 든 하드 위반 해시태그도 교체(제거)돼야 한다 —
    교체 맵의 "hashtags:{태그}:" detail 라벨 split 파싱 적대 케이스."""
    request, bodies = case
    body, _ = bodies[0]
    final = apply_hard_replacements(_gate(request, body).value)
    assert _hard(_regate_violations(request, final)) == []


@given(case=polluted_reflection_cases(pool=SOFT_POLLUTIONS))
@settings(max_examples=60, deadline=None)
def test_rfl_p7_soft_only_candidate_adopted_unchanged(case) -> None:
    """소프트 위반만 있는 후보는 교체 없이 그대로 채택된다 (계약 §4.1 — 랭킹 감점만)."""
    request, bodies = case
    candidate = _gate(request, bodies[0][0]).value
    assert all(v.grade is ViolationGrade.SOFT for v in candidate.violations)
    assert apply_hard_replacements(candidate) == candidate.template


# ── RFL-P4 — 랭킹·교체 결정론 (이중 호출 + 순열 불변) ─────────


@given(case=polluted_reflection_cases(n_bodies=(1, 3)), data=st.data())
@settings(max_examples=60, deadline=None)
def test_rfl_p4_rank_and_replace_deterministic(case, data) -> None:
    request, bodies = case
    candidates = [
        replace(_gate(request, body).value, attempt=i + 1)
        for i, (body, _) in enumerate(bodies)
    ]
    best_a = min(candidates, key=rank_key)
    best_b = min(candidates, key=rank_key)
    assert best_a == best_b  # 이중 호출 동일 채택
    assert apply_hard_replacements(best_a) == apply_hard_replacements(best_b)
    # 사전식 비교 유일해 — attempt가 전부 달라 키가 유일 → 순열해도 같은 채택
    shuffled = data.draw(st.permutations(candidates))
    assert min(shuffled, key=rank_key) == best_a


@given(case=polluted_reflection_cases(n_bodies=(2, 3)))
@settings(max_examples=60, deadline=None)
def test_rfl_p7_hard_zero_candidate_always_beats_hard_positive(case) -> None:
    """채택된 후보의 하드 수 = 후보 집합 최소 하드 수 — 소프트가 아무리 많아도
    하드 0 후보가 하드 有 후보에 항상 우선한다."""
    request, bodies = case
    candidates = [
        replace(_gate(request, body).value, attempt=i + 1)
        for i, (body, _) in enumerate(bodies)
    ]
    hard_counts = [len(_hard(c.violations)) for c in candidates]
    best = min(candidates, key=rank_key)
    assert len(_hard(best.violations)) == min(hard_counts)


def test_rfl_p7_soft_heavy_beats_single_hard_example() -> None:
    """방향 고정 예시 — 소프트 3종(길이·중복·장면 수)만 가진 후보가
    총 위반 수는 더 적어도 하드 1건짜리 후보를 이긴다."""
    soft_body = {
        "cover": {"title": "기록", "subtitle": "{region}"},
        "scenes": [
            {"layout": "PHOTO_FULL",
             "photo_slot": {"visit_ref": {"date": "2026-08-01", "poi_id": "poi-1"}},
             "caption": "가" * 41},
            {"layout": "PHOTO_CAPTION",
             "photo_slot": {"visit_ref": {"date": "2026-08-01", "poi_id": "poi-1"}},
             "caption": "같은 곳 한 장 더"},
        ],
        "hashtags": [],
    }
    soft = replace(_gate(_REQUEST, soft_body).value, attempt=2)
    hard = replace(_gate(_REQUEST, _VIOLATING_BODY).value, attempt=1)
    assert len(_hard(soft.violations)) == 0 and len(soft.violations) >= 3
    assert len(_hard(hard.violations)) == 1
    assert min([hard, soft], key=rank_key) == soft  # 차수가 늦어도 소프트가 이긴다


# ── RFL-P5 — 3회 전부 파싱 실패 → 고정 폴백 + 관측 ───────────


def test_rfl_p5_all_attempts_failed_yields_fixed_fallback_and_events() -> None:
    for llm in (FailingLlm(), FakeLlm(canned="회고: JSON이 아닌 산문")):
        worker, trace = _compose_env(llm)
        template = compose(worker, _REQUEST, _TID, _NOW, trace)
        assert template.is_fallback is True
        # 결정론 — 같은 (kind, trace_id, now)의 고정 폴백과 완전 동일
        assert template == build_fallback_template(_REQUEST.kind, _TID, _NOW)
        records = trace.of_type(LlmCallRecord)
        assert len(records) == MAX_ATTEMPTS
        assert all(r.success is False for r in records)  # 시도별 실패 계측 (BR-U4-03)
        own = [e for e in trace.of_type(FallbackEvent) if e.component == "agents.reflect"]
        assert len(own) == 1 and own[0].to_mode == "fixed_template"
        assert str(MAX_ATTEMPTS) in own[0].reason  # 침묵 금지 — 사유에 시도 수


@given(raw=st.text(max_size=120))
@settings(max_examples=50, deadline=None)
def test_rfl_p5_pbt_compose_never_raises_never_silent(raw: str) -> None:
    """어떤 쓰레기 텍스트에도: 예외 없음 ∧ 폴백이면 고정 템플릿+FallbackEvent,
    아니면 후보 채택 경로(호출 계측 존재) — 침묵 실패 없음 (INV-4)."""
    worker, trace = _compose_env(FakeLlm(canned=raw))
    template = compose(worker, _REQUEST, _TID, _NOW, trace)
    assert isinstance(template, ReflectionTemplate)
    if template.is_fallback:
        assert template == build_fallback_template(_REQUEST.kind, _TID, _NOW)
        assert any(e.component == "agents.reflect" for e in trace.of_type(FallbackEvent))
    assert trace.of_type(LlmCallRecord)  # 성공·실패 불문 시도는 계측된다


# ── BR-U6R-05 — 조기 종료·시도 소진 (호출 횟수 스파이) ───────


def test_zero_violation_candidate_short_circuits_after_one_call() -> None:
    llm = ScriptedLlm(_raw(_CLEAN_BODY))
    worker, trace = _compose_env(llm)
    template = compose(worker, _REQUEST, _TID, _NOW, trace)
    assert llm.calls == 1  # 위반 0 → 조기 종료
    assert template.is_fallback is False
    assert len(template.scenes) == 3


def test_violating_candidate_exhausts_all_attempts() -> None:
    llm = ScriptedLlm(_raw(_VIOLATING_BODY))
    worker, trace = _compose_env(llm)
    template = compose(worker, _REQUEST, _TID, _NOW, trace)
    assert llm.calls == MAX_ATTEMPTS  # 위반이 남는 한 조기 종료 없음
    assert template.is_fallback is False
    assert _hard(_regate_violations(_REQUEST, template)) == []  # 교체는 그래도 수행


def test_parse_fail_then_clean_recovers_without_fallback() -> None:
    """1차 파싱 실패 후 2차 위반 0 — 폴백이 아니라 2차 채택 + 조기 종료."""
    llm = ScriptedLlm("산문 응답 (파싱 불가)", _raw(_CLEAN_BODY))
    worker, trace = _compose_env(llm)
    template = compose(worker, _REQUEST, _TID, _NOW, trace)
    assert llm.calls == 2
    assert template.is_fallback is False
    assert [e for e in trace.of_type(FallbackEvent) if e.component == "agents.reflect"] == []


def test_compose_is_deterministic_for_same_inputs() -> None:
    """같은 입력 두 번 → 같은 출력 (④⑤⑥ 순수·now 주입 — wall-clock 0)."""
    results = []
    for _ in range(2):
        worker, trace = _compose_env(FakeLlm(canned=_raw(_VIOLATING_BODY)))
        results.append(compose(worker, _REQUEST, _TID, _NOW, trace))
    assert results[0] == results[1]


# ── BR-U6R-07 — 고정 문구 자기 검증 (FALLBACK_NUDGE 선례) ────


def test_fallback_template_passes_gate_with_zero_hard() -> None:
    template = build_fallback_template(ReflectionKind.TRIP_SUMMARY, _TID, _NOW)
    violations = _regate_violations(_REQUEST, template)
    assert _hard(violations) == []  # 금칙·어휘 전부 통과 — 폴백 스스로 하드 0
    # 장면 2(STATS·MAP)는 소프트 SCENE_COUNT만 허용 (계약 §4.3 면제 — 산출 가능)
    assert {v.code.value for v in violations} <= {"SCENE_COUNT"}


def test_safe_captions_and_fallback_cover_pass_gate_with_zero_hard() -> None:
    """교체용 안전 문구(레이아웃 5종)·폴백 표지 문구가 스스로 게이트를 통과한다 —
    교체 결과가 새 하드 위반을 만들지 않는 근거."""
    slot = {"visit_ref": {"date": "2026-08-01", "poi_id": "poi-1"}}
    body = {
        "cover": {"title": FALLBACK_COVER_TITLE, "subtitle": FALLBACK_COVER_SUBTITLE},
        "scenes": [
            {"layout": "PHOTO_FULL", "photo_slot": slot,
             "caption": SAFE_CAPTION_BY_LAYOUT[SceneLayout.PHOTO_FULL]},
            {"layout": "PHOTO_CAPTION", "photo_slot": slot,
             "caption": SAFE_CAPTION_BY_LAYOUT[SceneLayout.PHOTO_CAPTION]},
            {"layout": "STATS", "caption": SAFE_CAPTION_BY_LAYOUT[SceneLayout.STATS]},
            {"layout": "MAP", "caption": SAFE_CAPTION_BY_LAYOUT[SceneLayout.MAP]},
            {"layout": "EVENT", "caption": SAFE_CAPTION_BY_LAYOUT[SceneLayout.EVENT],
             "source_event": "PLAN_B"},
        ],
        "hashtags": [],
    }
    outcome = _gate(_REQUEST, body)
    assert _hard(outcome.value.violations) == []
    # PHOTO_* 중복 slot(소프트 DUP)만 가능 — 하드는 어떤 것도 없어야 한다
    assert outcome.drop_event is None


# ── RFL-P6 — generator 기반 직렬화 왕복 (U5-P10 승계) ────────


@given(request=reflection_requests())
@settings(max_examples=50, deadline=None)
def test_rfl_p6_request_roundtrip(request: ReflectionRequest) -> None:
    assert ReflectionRequest.from_dict(request.to_dict()) == request
    json.dumps(request.to_dict(), ensure_ascii=False)  # 와이어 직렬화 가능


@given(template=reflection_templates())
@settings(max_examples=50, deadline=None)
def test_rfl_p6_template_roundtrip(template: ReflectionTemplate) -> None:
    assert ReflectionTemplate.from_dict(template.to_dict()) == template
    json.dumps(template.to_dict(), ensure_ascii=False)


@given(template=reflection_templates(), attempt=st.integers(min_value=1, max_value=3))
@settings(max_examples=50, deadline=None)
def test_rfl_p6_candidate_roundtrip(template: ReflectionTemplate, attempt: int) -> None:
    candidate = TemplateCandidate(template=template, violations=(), attempt=attempt)
    assert TemplateCandidate.from_dict(candidate.to_dict()) == candidate
