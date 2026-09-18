"""TRIP-678 — 의도 라우터 평가 지표 (intent-matching-design §6) 채점 로직.

§6 가 요구하는 것: intent accuracy(전체/의도별) · 경로별 비중 · FALLBACK율 · p95 지연 ·
혼동쌍(EDIT↔REPLAN↔GENERATE 경계 중점). 채점은 순수 함수라 여기서 표로 고정한다 —
러너(scripts/trace_intents.py --eval)는 이 함수를 부를 뿐이다.

OUT_OF_SCOPE 라벨의 정답 = 라우터가 OUT_OF_SCOPE 로 폴백한 것(FALLBACK 경로).
"""

from __future__ import annotations

import pytest

from trippilot.domain.intent import Intent, IntentMatch, MatchRoute
from trippilot.orchestrator.intent_eval import Sample, format_report, score


def _m(intent: Intent, route: MatchRoute, conf: float = 0.9, reason: str | None = None) -> IntentMatch:
    # 폴백은 사유 필수(INV-4) — 도메인이 강제하므로 픽스처도 실물 계약대로 만든다
    return IntentMatch(intent=intent, slots={}, confidence=conf, match_route=route, reason=reason)


_SAMPLES = (
    Sample(Intent.GENERATE_SCHEDULE, "u1", _m(Intent.GENERATE_SCHEDULE, MatchRoute.CONFIDENT), 10.0),
    Sample(Intent.GENERATE_SCHEDULE, "u2", _m(Intent.GENERATE_SCHEDULE, MatchRoute.VOTED), 20.0),
    Sample(Intent.EDIT_SCHEDULE, "u3", _m(Intent.REPLAN, MatchRoute.VOTED), 30.0),  # 경계 혼동
    Sample(Intent.REPLAN, "u4", _m(Intent.REPLAN, MatchRoute.LLM_DIRECT), 40.0),
    Sample(Intent.OUT_OF_SCOPE, "u5",
           _m(Intent.OUT_OF_SCOPE, MatchRoute.FALLBACK, 0.0,
              reason="below_t_mid(0.55) → intent_fallback: parse_error: not_classifiable: 의도 분류 불가"),
           50.0),
    Sample(Intent.OUT_OF_SCOPE, "u6", _m(Intent.EDIT_SCHEDULE, MatchRoute.VOTED), 60.0),  # 범위 밖 흡입
)

# 인프라 실패(키 오설정·타임아웃·게이트웨이 부재)도 라우터는 OUT_OF_SCOPE 폴백으로 수렴한다(INV-4).
# 그걸 범위 밖 "정답"으로 세면 LLM 이 죽어 있어도 정확도가 부풀려진다 — 별도 버킷으로 가른다.
_INFRA = (
    Sample(Intent.OUT_OF_SCOPE, "u7",
           _m(Intent.OUT_OF_SCOPE, MatchRoute.FALLBACK, 0.0,
              reason="below_t_mid(0.60) → intent_fallback: timeout: 2.5s"), 70.0),
    Sample(Intent.GET_WEATHER, "u8",
           _m(Intent.OUT_OF_SCOPE, MatchRoute.FALLBACK, 0.0,
              reason="router_error: RuntimeError: boom"), 80.0),
)


def test_accuracy_overall_and_per_intent() -> None:
    report = score(_SAMPLES)
    assert (report.correct, report.total) == (4, 6)
    assert report.accuracy == pytest.approx(4 / 6)
    assert report.per_intent[Intent.GENERATE_SCHEDULE] == (2, 2)
    assert report.per_intent[Intent.EDIT_SCHEDULE] == (0, 1)
    assert report.per_intent[Intent.OUT_OF_SCOPE] == (1, 2)


def test_confusions_only_record_wrong_pairs_label_to_prediction() -> None:
    report = score(_SAMPLES)
    assert report.confusions == {
        (Intent.EDIT_SCHEDULE, Intent.REPLAN): 1,
        (Intent.OUT_OF_SCOPE, Intent.EDIT_SCHEDULE): 1,
    }


def test_route_distribution_fallback_rate_and_p95() -> None:
    report = score(_SAMPLES)
    assert report.routes == {
        MatchRoute.CONFIDENT: 1, MatchRoute.VOTED: 3, MatchRoute.LLM_DIRECT: 1, MatchRoute.FALLBACK: 1,
    }
    assert report.fallback_rate == pytest.approx(1 / 6)
    assert report.p95_ms == 60.0  # 6건 → ceil(0.95*6)=6번째 = 최대값


def test_infra_fallback_is_not_counted_as_out_of_scope_hit() -> None:
    report = score(_SAMPLES + _INFRA)
    assert report.total == 8 and report.correct == 4  # u7 은 라벨이 OUT_OF_SCOPE 여도 정답 아님
    assert report.unrefused_fallbacks == 2  # u7(타임아웃) + u8(라우터 예외)
    assert report.per_intent[Intent.OUT_OF_SCOPE] == (1, 3)
    text = format_report(report)
    assert "비거절 폴백 2" in text


def test_refusal_markers_match_real_router_fallback_reasons() -> None:
    """거절 표지 문자열은 IntentGate·intent_router 원천의 복제다 — 원천이 개명되면 거절 전부가 조용히
    비거절 폴백으로 빠진다(정확도 과소). 실물 라우터 + 대본 게이트웨이로 두 경로를 직접 태워 고정한다."""
    from pathlib import Path

    from trippilot.llm_gateway.config import C1Config
    from trippilot.llm_gateway.gates.intent import IntentGate
    from trippilot.llm_gateway.gateway import GatewayFacade
    from trippilot.llm_gateway.prompts import PromptRegistry
    from trippilot.domain.common import TraceId
    from trippilot.domain.llm import ModelTier
    from trippilot.orchestrator.intent_router import IntentRouter
    from tests.fakes.fake_embedding import FakeEmbedding
    from tests.fakes.fake_llm import FakeLlm
    from tests.fakes.in_memory_trace import InMemoryTrace
    from tests.fakes.in_memory_vector_store import InMemoryVectorStore
    from datetime import datetime, timezone

    prompts = Path(__file__).resolve().parent.parent / "prompts"
    cfg = C1Config(model_ids={ModelTier.LIGHT: "m", ModelTier.HEAVY: "m"})

    def _route_with(canned: str) -> IntentMatch:
        gw = GatewayFacade(FakeLlm(canned=canned), PromptRegistry(prompts), IntentGate(), cfg, InMemoryTrace())
        router = IntentRouter(FakeEmbedding(), InMemoryVectorStore(), intent_gateway=gw)  # 빈 뱅크 → 3차
        return router.route("아무 말", TraceId("t"), datetime(2026, 9, 8, tzinfo=timezone.utc))

    refused_null = _route_with('{"intent": null}')  # IntentGate: not_classifiable
    refused_oos = _route_with('{"intent": "OUT_OF_SCOPE"}')  # 라우터: intent_not_routable
    for match in (refused_null, refused_oos):
        assert match.match_route is MatchRoute.FALLBACK and match.intent is Intent.OUT_OF_SCOPE
    report = score([
        Sample(Intent.OUT_OF_SCOPE, "a", refused_null, 1.0),
        Sample(Intent.OUT_OF_SCOPE, "b", refused_oos, 1.0),
    ])
    assert (report.correct, report.unrefused_fallbacks) == (2, 0)


def test_empty_samples_do_not_divide_by_zero() -> None:
    report = score(())
    assert report.total == 0 and report.accuracy == 0.0 and report.fallback_rate == 0.0
    assert report.p95_ms == 0.0


def test_report_text_names_the_boundary_confusion() -> None:
    text = format_report(score(_SAMPLES))
    assert "4/6" in text
    assert "EDIT_SCHEDULE → REPLAN" in text  # 혼동은 라벨 → 예측 방향으로 읽힌다
    assert "FALLBACK" in text and "p95" in text
