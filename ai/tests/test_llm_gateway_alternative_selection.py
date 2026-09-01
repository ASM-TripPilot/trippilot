"""TRIP-331 — ALTERNATIVE_SELECTION 4종 세트: 프롬프트·게이트·워커·PBT + PlanB 연결.

증명하는 것:
  ① 게이트 통과분은 항상 후보 풀 안 (INV-1) — 오염 항목만 드롭(항목 격리, explanation 선례)
  ② 파싱 실패·형태 위반은 조용히 넘기지 않고 error로 수렴 → 게이트웨이가 폴백 전환 (INV-4)
  ③ 프롬프트 렌더 결정론 + 좌표 미포함(G181) + closed-set·시간 언급 금지 문구 (INV-3)
  ④ 워커는 폴백 TypedResult를 그대로 반환 (BR-U4-09) — 규칙 랭킹 실행은 호출측 몫
  ⑤ PlanB 파이프라인 연결: gateway 주입 시 실물 4종 세트로 LLM 선택 + 근거 채택,
     LLM 실패·오염은 규칙 랭킹 폴백으로 수렴하고 산출은 언제나 closed-set 안 (INV-1·INV-4)

범위 밖: 대안의 솔버 배치·시각 확정(INV-2)은 U5 Validate 단계 소관 — 산출물에
시각·소요시간 필드 자리 자체가 없음은 test_planb_rag가 이미 고정한다.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from trippilot.agents.planb.rag import PlanBRagPipeline, PlanBRagRequest
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.alternative_selection import AlternativeSelectionGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.alternative_selection import (
    AlternativeSelectionInput,
    AlternativeSelectionWorker,
    build_alternative_selection_vars,
)
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId, TraceId
from trippilot.domain.llm import AlternativePick, CandidatePool, LlmFeature, ModelTier
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.domain.trigger import TriggerKind, TriggerParams

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from tests.generators.poi import candidate_pools

_NOW = datetime(2026, 8, 10, 14, 0, tzinfo=timezone.utc)
_TID = TraceId("t-u5-alt")
_FEAT = LlmFeature.ALTERNATIVE_SELECTION
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})


def _poi(pid: str, name: str) -> Poi:
    return Poi(
        poi_id=PoiId(pid), name=name, category=PoiCategory.CAFE,
        coord=GeoPoint(33.45, 126.56), open_hours=(), avg_cost=None, rating=None,
        quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None,
    )


def _pool() -> CandidatePool:
    pois = (_poi("p1", "을지로 카페"), _poi("p2", "전쟁기념관"), _poi("p3", "코엑스몰"))
    return CandidatePool(
        poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=_NOW
    )


def _raw(*picks: tuple[str, str]) -> str:
    return json.dumps(
        {"selections": [{"poiId": p, "reason": r} for p, r in picks]},
        ensure_ascii=False,
    )


def _apply(raw: str, pool: CandidatePool | None = None):
    return AlternativeSelectionGate().apply(
        raw, _pool() if pool is None else pool, feature=_FEAT, trace_id=_TID, now=_NOW
    )


def _input(**overrides) -> AlternativeSelectionInput:
    base = dict(
        trigger_kind="WEATHER", reason="weather",
        schedule_context="- 14시 한강공원 슬롯", situation_context="- 강수확률 80%",
        persona_context="- 저장한 을지로 카페", max_alternatives=3,
    )
    base.update(overrides)
    return AlternativeSelectionInput(**base)


# ── 게이트: 정상 ─────────────────────────────────────────────


def test_gate_parses_picks_preserving_llm_order() -> None:
    out = _apply(_raw(("p3", "실내라 비 걱정 없어요"), ("p1", "저장해둔 카페예요")))
    assert out.error is None and out.drop_event is None
    assert out.value == (
        AlternativePick(poi_id=PoiId("p3"), reason="실내라 비 걱정 없어요"),
        AlternativePick(poi_id=PoiId("p1"), reason="저장해둔 카페예요"),
    )


def test_gate_dedups_by_first_occurrence() -> None:
    out = _apply(_raw(("p1", "첫 근거"), ("p1", "뒤늦은 근거"), ("p2", "두 번째")))
    assert [str(p.poi_id) for p in out.value] == ["p1", "p2"]
    assert out.value[0].reason == "첫 근거"


def test_gate_empty_selections_is_a_fallback_signal_from_the_gate() -> None:
    """"적합 후보 없음"은 지어내기 금지의 결과지 사용자에게 줄 대안이 아니다.

    빈 결과가 실패인지는 게이트가 정한다 (TRIP-260 #5) — 여기선 규칙 랭킹이라는
    온전한 대체 경로가 있으므로 실패다. 파싱 실패와는 사유 라벨로 구분된다.
    """
    out = _apply(_raw())
    assert out.value == () and out.drop_event is None
    assert out.error == "llm_empty_result"


# ── 게이트: 오염 (closed-set, INV-1) ─────────────────────────


def test_gate_drops_only_out_of_pool_items_and_records_event() -> None:
    """① 항목 격리 — 오염 항목만 드롭하고 생존분 순서는 유지, 드롭은 관측에 남는다."""
    out = _apply(_raw(("유령카페", "지어낸 곳"), ("p2", "실내 전시"), ("p1", "가깝다")))
    assert [str(p.poi_id) for p in out.value] == ["p2", "p1"]
    assert out.error is None
    assert out.drop_event is not None
    assert out.drop_event.dropped_ids == (PoiId("유령카페"),)
    assert out.drop_event.total_count == 3 and out.drop_event.dropped_count == 1


def test_gate_all_dropped_returns_empty_with_event() -> None:
    out = _apply(_raw(("g1", "r"), ("g2", "r")))
    assert out.value == ()
    assert out.error == "gate_dropped_all"  # 무결과와 다른 처방 — 라벨을 나눈다
    assert out.drop_event is not None and out.drop_event.dropped_count == 2


# ── 게이트: 파싱 실패·구조 위반 (②) ──────────────────────────


def test_gate_parse_failures_and_pool_guard() -> None:
    assert AlternativeSelectionGate().apply(
        _raw(("p1", "r")), None, feature=_FEAT, trace_id=_TID, now=_NOW
    ).error.startswith("gate_error:")
    assert _apply("이건 JSON이 아니다").error.startswith("parse_error:")
    assert _apply(json.dumps({"picks": []})).error.startswith("parse_error:")
    assert _apply(json.dumps({"selections": "p1"})).error.startswith("parse_error:")
    assert _apply(json.dumps({"selections": ["p1"]})).error.startswith("parse_error:")
    assert _apply(json.dumps({"selections": [{"poiId": "", "reason": "r"}]})).error is not None
    assert _apply(json.dumps({"selections": [{"poiId": 3, "reason": "r"}]})).error is not None
    assert _apply(json.dumps({"selections": [{"poiId": "p1", "reason": "  "}]})).error is not None
    assert _apply(json.dumps({"selections": [{"poiId": "p1"}]})).error is not None


# ── PBT ──────────────────────────────────────────────────────

_reasons = st.text(min_size=1, max_size=12).filter(lambda s: s.strip())


@given(
    pid=st.text(min_size=1, max_size=8),
    reason=_reasons,
)
def test_pbt_alternative_pick_roundtrip(pid: str, reason: str) -> None:
    pick = AlternativePick(poi_id=PoiId(pid), reason=reason)
    assert AlternativePick.from_dict(pick.to_dict()) == pick


@st.composite
def _pool_and_refs(draw):
    pool = draw(candidate_pools().filter(lambda p: bool(p.poi_ids)))
    ids = sorted(pool.poi_ids, key=str)
    members = draw(st.lists(st.sampled_from(ids), max_size=4))
    ghosts = draw(
        st.lists(
            st.text(min_size=1, max_size=8).filter(
                lambda s: PoiId(s) not in pool.poi_ids
            ),
            max_size=3,
        )
    )
    refs = draw(st.permutations([*(str(m) for m in members), *ghosts]))
    return pool, tuple(refs), frozenset(ghosts)


@given(case=_pool_and_refs(), reason=_reasons)
def test_pbt_gate_survivors_always_inside_pool(case, reason: str) -> None:
    """① 어떤 참조 조합이 와도 통과분은 전부 풀 안, 풀 밖은 전부 드롭 이벤트에 남는다."""
    pool, refs, ghosts = case
    out = _apply(_raw(*((r, reason) for r in refs)), pool)
    # 빈 결과가 실패인 게이트의 불변식: error 유무 ⇔ 생존 0건 (TRIP-260 #5)
    assert (out.error is None) == bool(out.value)
    assert all(pool.contains(p.poi_id) for p in out.value)
    assert len({p.poi_id for p in out.value}) == len(out.value)  # 중복 없음
    if ghosts:
        assert out.drop_event is not None
        assert set(out.drop_event.dropped_ids) == {PoiId(g) for g in ghosts}


@given(raw=st.one_of(st.text(max_size=80), st.just("{}"), st.just("[]")))
def test_pbt_gate_never_raises_on_arbitrary_text(raw: str) -> None:
    """② 임의 응답에도 게이트는 예외 없이 GateOutcome으로 수렴한다 (INV-4의 게이트 측 절반)."""
    out = _apply(raw)
    if out.error is not None:
        assert not out.value  # error 있으면 value 비움 (base 불변식)
    else:
        assert all(isinstance(p, AlternativePick) for p in out.value)


# ── 프롬프트 (③) ────────────────────────────────────────────


def test_prompt_renders_deterministically_without_coordinates() -> None:
    pool = _pool()
    reg = PromptRegistry(_PROMPTS)
    p1, ref = reg.render(_FEAT, build_alternative_selection_vars(pool, _input()))
    p2, _ = reg.render(_FEAT, build_alternative_selection_vars(pool, _input()))
    assert p1 == p2  # 결정론
    assert ref.prompt_id == "prompts/alternative_selection.yaml" and ref.version == "0.1.0"
    assert ref.feature == "ALTERNATIVE_SELECTION"
    for poi in pool.pois:
        assert str(poi.poi_id) in p1 and poi.name in p1
        assert str(poi.coord.lat) not in p1 and str(poi.coord.lng) not in p1  # G181


def test_prompt_states_closed_set_and_no_duration_rules() -> None:
    """closed-set(INV-1)·시간 언급 금지(INV-3)·지어내기 금지(INV-4) 규칙 문구가 실린다."""
    prompt, _ = PromptRegistry(_PROMPTS).render(
        _FEAT, build_alternative_selection_vars(_pool(), _input())
    )
    assert "목록 밖 ID 생성 금지" in prompt
    assert "소요시간" in prompt and "시각은 솔버가 정합니다" in prompt
    assert "지어내기 금지" in prompt
    assert "최대 3개" in prompt  # max_alternatives 주입


def test_build_vars_excludes_pois_and_stringifies_everything() -> None:
    """제외 POI는 후보 목록에서 아예 빠진다 — 고를 수 있는 값 자체를 한정 (INV-1)."""
    variables = build_alternative_selection_vars(
        _pool(), _input(excluded_poi_ids=frozenset({PoiId("p2")}))
    )
    assert all(isinstance(v, str) for v in variables.values())
    assert "p2" not in variables["candidates"]
    assert "p1" in variables["candidates"] and "p3" in variables["candidates"]


def test_build_vars_placeholders_for_empty_context() -> None:
    variables = build_alternative_selection_vars(
        _pool(), _input(schedule_context="", situation_context=" ", persona_context="")
    )
    assert variables["schedule_context"] == "(검색 결과 없음)"
    assert variables["situation_context"] == "(검색 결과 없음)"
    assert variables["persona_context"] == "(검색 결과 없음)"


def test_input_rejects_nonpositive_max_alternatives() -> None:
    with pytest.raises(ValueError):
        _input(max_alternatives=0)


# ── 워커 e2e (실물 레지스트리·게이트, ④) ────────────────────


def _worker(llm) -> AlternativeSelectionWorker:
    gateway = GatewayFacade(
        llm, PromptRegistry(_PROMPTS), AlternativeSelectionGate(), _CFG, InMemoryTrace()
    )
    return AlternativeSelectionWorker(gateway)


def test_worker_end_to_end_success() -> None:
    canned = _raw(("p2", "실내 전시라 비 걱정이 없어요"), ("p1", "저장해둔 카페예요"))
    result = _worker(FakeLlm(canned=canned)).select(_pool(), _input(), _TID, _NOW)
    assert result.is_fallback is False
    assert [str(p.poi_id) for p in result.value] == ["p2", "p1"]
    assert result.call_record is not None and result.call_record.success is True


def test_worker_falls_back_loudly_on_llm_failure() -> None:
    """④ INV-4 — 침묵 실패 없음: 폴백 표시 + 사유. 규칙 랭킹 실행은 호출측(PlanB) 몫."""
    result = _worker(FailingLlm()).select(_pool(), _input(), _TID, _NOW)
    assert result.is_fallback is True and result.value is None
    assert result.error and result.call_record is not None


def test_worker_falls_back_when_gate_drops_all_picks() -> None:
    result = _worker(FakeLlm(canned=_raw(("유령1", "r"), ("유령2", "r")))).select(
        _pool(), _input(), _TID, _NOW
    )
    assert result.is_fallback is True and result.value is None
    assert "gate_dropped_all" in result.error


# ── PlanB 연결 (⑤ — 실물 4종 세트로 파이프라인 통과) ─────────


def _rag_gateway(llm) -> GatewayFacade:
    return GatewayFacade(
        llm, PromptRegistry(_PROMPTS), AlternativeSelectionGate(), _CFG, InMemoryTrace()
    )


def _pipeline(llm) -> PlanBRagPipeline:
    return PlanBRagPipeline(
        FakeEmbedding(dim=8), InMemoryVectorStore(), alternative_gateway=_rag_gateway(llm)
    )


def _request(pool: CandidatePool, **overrides) -> PlanBRagRequest:
    base = dict(
        trigger=TriggerParams(
            kind=TriggerKind.WEATHER,
            schedule_id=ScheduleId("sched-1"),
            affected_date=_NOW.date(),
            payload={"pop": 80},
        ),
        reason="weather", pool=pool, trace_id=_TID, now=_NOW,
    )
    base.update(overrides)
    return PlanBRagRequest(**base)


def test_pipeline_uses_llm_picks_and_their_reasons() -> None:
    canned = _raw(("p3", "실내라 비 걱정 없어요"), ("p1", "저장해둔 카페예요"))
    result = _pipeline(FakeLlm(canned=canned)).run(_request(_pool()))
    assert result.is_fallback is False and result.fallback_level == 0
    assert [str(p) for a in result.alternatives for p in a.poi_ids] == ["p3", "p1"]
    assert [a.rationale for a in result.alternatives] == [
        "실내라 비 걱정 없어요", "저장해둔 카페예요",
    ]


def test_pipeline_gate_drops_ghost_before_closed_set_filter() -> None:
    """유령 POI는 게이트에서 이미 죽는다 — 파이프라인 관문(closed_set_filter)은 2겹째."""
    canned = _raw(("유령카페", "지어낸 곳"), ("p2", "실내 전시예요"))
    result = _pipeline(FakeLlm(canned=canned)).run(_request(_pool()))
    assert result.is_fallback is False
    assert [str(p) for a in result.alternatives for p in a.poi_ids] == ["p2"]
    assert result.dropped_out_of_pool == ()  # 게이트 층에서 이미 제거됨 (drop_event로 관측)


def test_pipeline_drops_excluded_pick_via_second_gate() -> None:
    """게이트는 풀 멤버십만 안다 — 제외 POI는 파이프라인 관문이 잡는다 (2겹 방어)."""
    canned = _raw(("p1", "저장해둔 카페예요"), ("p2", "실내 전시예요"))
    result = _pipeline(FakeLlm(canned=canned)).run(
        _request(_pool(), excluded_poi_ids=frozenset({PoiId("p1")}))
    )
    assert [str(p) for a in result.alternatives for p in a.poi_ids] == ["p2"]
    assert result.dropped_out_of_pool == ("p1",)


def test_pipeline_falls_back_to_rule_ranking_on_llm_failure() -> None:
    """⑤ INV-4 — LLM 실패는 규칙 랭킹으로 수렴하고 사유가 notes에 남는다."""
    result = _pipeline(FailingLlm()).run(_request(_pool()))
    assert result.is_fallback is True and result.fallback_level == 1
    assert any(n.startswith("alternative_fallback") for n in result.notes)
    assert result.alternatives  # 폴백이어도 대안은 나온다 (침묵 실패 금지)


def test_pipeline_falls_back_on_unparseable_llm_output() -> None:
    result = _pipeline(FakeLlm(canned="JSON이 아닌 잡담")).run(_request(_pool()))
    assert result.is_fallback is True and result.fallback_level == 1
    assert any("parse_error" in n for n in result.notes)


@given(raw=st.one_of(st.text(max_size=60), st.just('{"selections": []}')))
@settings(max_examples=60, deadline=None)
def test_pbt_pipeline_output_inside_pool_for_any_llm_text(raw: str) -> None:
    """⑤ 어떤 LLM 응답이 와도: 예외 없음 ∧ 산출 POI 전부 closed-set 안 ∧ 대안 보장 (INV-1·INV-4)."""
    pool = _pool()
    result = _pipeline(FakeLlm(canned=raw)).run(_request(pool))
    picked = [p for a in result.alternatives for p in a.poi_ids]
    assert all(pool.contains(p) for p in picked)
    assert result.alternatives  # 풀이 비지 않는 한 폴백 계단이 대안을 보장
    assert result.is_fallback == (result.fallback_level >= 1)


@given(case=_pool_and_refs(), reason=_reasons)
@settings(max_examples=40, deadline=None)
def test_pbt_pipeline_llm_picks_never_escape_pool(case, reason: str) -> None:
    """⑤ 게이트+파이프라인 2겹을 함께 돌려도 풀 밖 참조는 절대 살아남지 않는다 (INV-1)."""
    pool, refs, _ = case
    assume(refs)
    canned = _raw(*((r, reason) for r in refs))
    result = _pipeline(FakeLlm(canned=canned)).run(_request(pool))
    picked = [p for a in result.alternatives for p in a.poi_ids]
    assert all(pool.contains(p) for p in picked)
