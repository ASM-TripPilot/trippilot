"""U4-02 — ClosedSetGate: 스키마 파서 + closed-set 교차 (INV-1).

GATE-P1: 어떤 오염된 LLM 출력에도 결과 poi_id ⊆ 풀, 드롭 수 = 입력 − 생존 (U5-P5 승계)
GATE-P2: 전량 드롭 → scored 비움 (폴백 전환은 게이트웨이, test_c1_gateway에서 검증)
파서: OutputSchema 위반 전부 parse_error (스키마 강제 — 4겹 장치의 3겹)
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from hypothesis import given
from hypothesis import strategies as st

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import TraceId
from trippilot.domain.llm import CandidatePool, LlmFeature, ModelTier
from trippilot.domain.prompt import PromptRef
from tests.fakes.fake_llm import FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.poi import candidate_pools, polluted_scored_pois

_NOW = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)
_TRACE_ID = TraceId("t-u4-gate")
_FEATURE = LlmFeature.PREFERENCE_SCORING


def _apply(raw_text: str, pool: CandidatePool | None):
    return ClosedSetGate().apply(
        raw_text, pool, feature=_FEATURE, trace_id=_TRACE_ID, now=_NOW
    )


def _payload(entries: list[tuple[str, float]]) -> str:
    # v0.2.0 스키마 (TRIP-374) — reason 없음
    return json.dumps({"scores": [{"poiId": i, "score": s} for i, s in entries]})


# ── GATE-P1/P2: 적대적 PBT — 환각 0 ─────────────────────────


@st.composite
def _gate_cases(draw):
    """풀 + (정상 ⊆ 풀, 오염 ∉ 풀) id 목록 — 오염률 0~100% 자연 스윕."""
    pool = draw(candidate_pools())
    valid = (
        draw(
            st.lists(
                st.sampled_from(sorted(pool.poi_ids, key=str)), unique=True, max_size=6
            )
        )
        if pool.poi_ids
        else []
    )
    polluted = draw(
        st.lists(polluted_scored_pois(pool), unique_by=lambda s: s.poi_id, max_size=4)
    )
    entries = [(str(i), 0.5) for i in valid] + [
        (str(s.poi_id), s.score) for s in polluted
    ]
    order = draw(st.permutations(entries))
    return pool, set(map(str, valid)), {str(s.poi_id) for s in polluted}, list(order)


@given(_gate_cases())
def test_gate_p1_no_hallucination_survives(case) -> None:
    pool, valid_ids, polluted_ids, entries = case
    out = _apply(_payload(entries), pool)

    # 빈 결과가 실패인 게이트의 불변식: error 유무 ⇔ 생존 0건 (TRIP-260 #5)
    assert (out.error is None) == bool(out.value)
    survivor_ids = {str(s.poi_id) for s in out.value}
    assert survivor_ids <= {str(i) for i in pool.poi_ids}  # 환각 0 (INV-1)
    assert survivor_ids == valid_ids  # 정상분은 전원 생존
    assert all(s.is_llm_score for s in out.value)
    if polluted_ids:  # 드롭 수 = 입력 − 생존 (GATE-P1)
        assert out.drop_event is not None
        assert out.drop_event.dropped_count == len(polluted_ids)
        assert out.drop_event.total_count == len(valid_ids) + len(polluted_ids)
        assert {str(i) for i in out.drop_event.dropped_ids} == polluted_ids
    else:
        assert out.drop_event is None
    if not valid_ids:  # 전량 드롭/빈 출력 → scored 비움 + 폴백 사유 (GATE-P2)
        assert out.value == ()
        assert out.error == ("gate_dropped_all" if polluted_ids else "llm_empty_result")


# ── 승격 규칙: 클램프·중복·풀 부재 ──────────────────────────


@given(candidate_pools().filter(lambda p: bool(p.poi_ids)))
def test_score_clamped_to_unit_interval(pool: CandidatePool) -> None:
    pid = sorted(pool.poi_ids, key=str)[0]
    out = _apply(_payload([(str(pid), 2.5)]), pool)
    assert out.value[0].score == 1.0
    out = _apply(_payload([(str(pid), -0.3)]), pool)
    assert out.value[0].score == 0.0


@given(candidate_pools().filter(lambda p: bool(p.poi_ids)))
def test_duplicate_poi_id_keeps_first(pool: CandidatePool) -> None:
    pid = str(sorted(pool.poi_ids, key=str)[0])
    out = _apply(_payload([(pid, 0.2), (pid, 0.9)]), pool)
    assert len(out.value) == 1 and out.value[0].score == 0.2
    assert out.drop_event is None  # 중복은 드롭 계수 아님


def test_no_pool_is_fallback_signal_not_silent_pass() -> None:
    out = _apply(_payload([("p1", 0.5)]), None)
    assert out.value == () and out.error is not None
    assert out.error.startswith("gate_error:")


# ── 파서: 스키마 강제 ────────────────────────────────────────


@pytest.mark.parametrize(
    "raw",
    [
        "완전 자유 텍스트",
        "[]",
        '{"scores": {}}',
        '{"scores": [\"str\"]}',
        '{"scores": [{"score": 0.5}]}',  # poiId 누락
        '{"scores": [{"poiId": "", "score": 0.5}]}',  # 빈 poiId
        '{"scores": [{"poiId": "a", "score": "high"}]}',  # score 문자열
        '{"scores": [{"poiId": "a", "score": true}]}',  # bool은 숫자 아님
        '{"scores": [{"poiId": "a", "score": NaN}]}',  # 비유한
    ],
)
def test_schema_violations_become_parse_error(raw: str) -> None:
    pool_free_error = _apply(raw, None)  # pool 체크가 먼저지만
    assert pool_free_error.error is not None


@given(candidate_pools().filter(lambda p: bool(p.poi_ids)))
def test_parse_error_over_valid_pool(pool: CandidatePool) -> None:
    out = _apply("깨진 출력", pool)
    assert out.value == () and out.error is not None
    assert out.error.startswith("parse_error:")


@given(candidate_pools().filter(lambda p: bool(p.poi_ids)))
def test_stray_reason_is_ignored_not_error(pool: CandidatePool) -> None:
    """TRIP-374: reason은 계약에서 제거 — 구모델·전환기 응답에 섞여 와도 무시.

    문자열이든 아니든(과거엔 비문자열이 parse_error) 통과하며, poiId·score
    검증은 그대로 엄격하다 (INV-1 무관 필드의 관용).
    """
    pid = str(sorted(pool.poi_ids, key=str)[0])
    for reason in ("한 문장 설명", 1, None, ["list"]):
        raw = json.dumps({"scores": [{"poiId": pid, "score": 0.5, "reason": reason}]})
        out = _apply(raw, pool)
        assert out.error is None
        assert [str(s.poi_id) for s in out.value] == [pid]
        assert out.value[0].score == 0.5


# ── 게이트웨이 통합 스모크: 실제 게이트로 end-to-end ─────────


@given(candidate_pools().filter(lambda p: bool(p.poi_ids)))
def test_facade_with_real_gate_smoke(pool: CandidatePool) -> None:
    pid = str(sorted(pool.poi_ids, key=str)[0])
    canned = _payload([(pid, 0.7), ("hallucinated-poi", 0.9)])

    class _Renderer:
        def render(self, feature, variables):
            return "p", PromptRef(
                prompt_id="prompts/test.yaml", version="0.0.1", feature=feature.value
            )

    cfg = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})
    trace = InMemoryTrace()
    facade = GatewayFacade(FakeLlm(canned=canned), _Renderer(), ClosedSetGate(), cfg, trace)
    result = facade.call(_FEATURE, {}, pool, _TRACE_ID, _NOW)

    assert result.is_fallback is False
    assert [str(s.poi_id) for s in result.value] == [pid]  # 환각은 걸러지고 정상만
