"""U6-03(TRIP-244) — EDIT_TRANSLATION 4종 세트: 프롬프트·게이트·워커·PBT.

증명하는 것:
  ① op는 항상 EditOp closed-set 안 (밖이면 명령 자체가 만들어지지 않는다)
  ② affectedSlots ⊆ 후보 풀 (INV-1) — 풀 밖이 섞이면 명령 전체 드롭(부분 반영 금지)
  ③ 반영 모드는 코드가 확정 — resolve_apply_mode 재사용, LLM 제안 무시 (M16-P2)
  ④ params에 시각·소요시간 금지 (INV-2·INV-3 — 시각·순서는 솔버 소유)
  ⑤ LLM 실패 → 침묵 없이 폴백 TypedResult (INV-4, M16-P3의 워커 측 절반)
  ⑥ 프롬프트 렌더 결정론 + 좌표 미포함(G181) + "의도 재해석 금지" 문구 존재 (DL-3)

범위 밖: 편집의 실제 반영·솔버 검증(M16-P1)은 EditAgent/U5 소관.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from hypothesis import assume, given
from hypothesis import strategies as st

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.edit_translation import EditTranslationGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.edit_translation import (
    EditTranslationInput,
    EditTranslationWorker,
    build_edit_translation_vars,
)
from trippilot.domain.common import GeoPoint, PoiId, TraceId
from trippilot.domain.edit import (
    ApplyMode,
    EditCommand,
    EditOp,
    EditTranslation,
    resolve_apply_mode,
)
from trippilot.domain.llm import CandidatePool, LlmFeature, ModelTier
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.generators.edit import edit_commands
from tests.generators.poi import candidate_pools

_NOW = datetime(2026, 8, 6, 9, 0, tzinfo=timezone.utc)
_TID = TraceId("t-u6-edit")
_FEAT = LlmFeature.EDIT_TRANSLATION
_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})


def _poi(pid: str, name: str) -> Poi:
    return Poi(
        poi_id=PoiId(pid), name=name, category=PoiCategory.FOOD,
        coord=GeoPoint(36.3, 127.4), open_hours=(), avg_cost=None, rating=None,
        quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None,
    )


def _pool() -> CandidatePool:
    pois = (_poi("p1", "성심당"), _poi("p2", "한밭수목원"))
    return CandidatePool(
        poi_ids=frozenset({PoiId("p1"), PoiId("p2")}), pois=pois, generated_at=_NOW
    )


def _raw(op: str, slots: list[str], *, params: dict | None = None,
         apply_mode: str = "AUTO_APPLY") -> str:
    return json.dumps(
        {
            "editCommand": {"op": op, "params": params or {}, "affectedSlots": slots},
            "applyMode": apply_mode,
        }
    )


def _apply(raw: str, pool: CandidatePool | None = None):
    return EditTranslationGate().apply(
        raw, _pool() if pool is None else pool, feature=_FEAT, trace_id=_TID, now=_NOW
    )


# ── 게이트: 정상 ─────────────────────────────────────────────


def test_gate_translates_valid_command() -> None:
    out = _apply(_raw("ADD_SLOT", ["p1"]))
    assert out.error is None and out.drop_event is None
    assert isinstance(out.value, EditTranslation)
    assert out.value.command.op is EditOp.ADD_SLOT
    assert out.value.command.affected_slots == (PoiId("p1"),)
    assert out.value.apply_mode is ApplyMode.AUTO_APPLY


def test_gate_accepts_command_without_slots_or_params() -> None:
    out = _apply(json.dumps({"editCommand": {"op": "CLEAR_DAY"}}))
    assert out.error is None
    assert out.value.command.params == {} and out.value.command.affected_slots == ()


# ── 게이트: 오염 (closed-set 2종 + 시각 필드) ────────────────


def test_gate_rejects_op_outside_closed_set() -> None:
    """① 환각 op — 명령 자체가 만들어지지 않는다 (풀 ID 지표는 오염 안 함)."""
    out = _apply(_raw("SUMMON_SLOT", ["p1"]))
    assert out.value is None and out.drop_event is None
    assert out.error.startswith("parse_error:") and "EditOp 밖" in out.error


def test_gate_drops_whole_command_when_any_slot_outside_pool() -> None:
    """② 부분 반영 금지 — 유효 슬롯이 섞여 있어도 명령 전체를 버린다 (INV-1)."""
    out = _apply(_raw("REPLACE_SLOT", ["p1", "유령장소"]))
    assert out.value is None
    assert out.error.startswith("closed_set_violation:")
    assert out.drop_event is not None
    assert out.drop_event.dropped_ids == (PoiId("유령장소"),)
    assert out.drop_event.total_count == 2 and out.drop_event.dropped_count == 1


@pytest.mark.parametrize(
    "key",
    ["startTime", "duration_min", "travel-time", "ETA", "stayDuration", "durationSec",
     "minutes", "startAt", "visitMinutes", "arriveBy", "departAt", "hours",
     # 회귀(invariant-reviewer 재현): 구 edit_agent 목록만 통과시키던 키들
     "eta", "arrive_by", "travelSecs", "start", "end"],
)
def test_gate_rejects_time_params(key: str) -> None:
    """④ 시각·소요시간은 솔버 소유 — 조용히 지우지 않고 명령을 거부한다.

    정확 키 목록은 변형(durationSec·visitMinutes…)에 뚫리므로 토큰 부분일치로 막는다.
    """
    out = _apply(_raw("ADD_SLOT", ["p1"], params={key: 10}))
    assert out.value is None and "솔버" in out.error


def test_gate_allows_non_time_params_and_order_hint() -> None:
    """순서·위치 제안은 통과 — 워커는 제안만, 확정은 솔버 (INV-2 원문)."""
    out = _apply(_raw("MOVE_SLOT", ["p1"], params={"toIndex": 2, "note": "비 와서"}))
    assert out.error is None and out.value.command.params["toIndex"] == 2
    # eta·start·end는 정확일치로만 막는다 — metadata·startPoiId·endPoiId 같은
    # 무해한 키(POI 참조 포함)가 걸리지 않도록
    assert _apply(_raw("ADD_SLOT", ["p1"], params={"metadata": "x"})).error is None
    ok = _apply(_raw("ADD_SLOT", ["p1"], params={"startPoiId": "p2", "endPoiId": "p1"}))
    assert ok.error is None


def test_gate_crosses_param_poi_refs_with_pool() -> None:
    """② params의 *PoiId도 풀 교차 — REPLACE_SLOT 대상이 params로 새는 경로 차단."""
    ok = _apply(_raw("REPLACE_SLOT", ["p1"], params={"targetPoiId": "p2"}))
    assert ok.error is None and ok.value.command.params["targetPoiId"] == "p2"

    ghost = _apply(_raw("REPLACE_SLOT", ["p1"], params={"targetPoiId": "환각카페"}))
    assert ghost.value is None
    assert ghost.error.startswith("closed_set_violation:")
    assert ghost.drop_event.dropped_ids == (PoiId("환각카페"),)


def test_gate_rejects_nested_params() -> None:
    """④ 중첩으로 시각·POI 검사를 우회하지 못한다."""
    nested = _apply(_raw("ADD_SLOT", ["p1"], params={"newSlot": {"startTime": "10:00"}}))
    assert nested.value is None and "평면" in nested.error
    assert _apply(_raw("ADD_SLOT", ["p1"], params={"ids": ["p2"]})).value is None


def test_gate_rejects_malformed_param_poi_ref() -> None:
    assert _apply(_raw("ADD_SLOT", [], params={"targetPoiId": 7})).value is None
    assert _apply(_raw("ADD_SLOT", [], params={"target_poi_id": ""})).value is None


def test_gate_allows_place_name_params() -> None:
    """POI '이름'은 교차 대상이 아니다 — 이름 해소는 코드(fuzzy match) 몫 (AI-D04)."""
    out = _apply(_raw("ADD_SLOT", [], params={"placeName": "성심당 본점"}))
    assert out.error is None and out.value.command.params["placeName"] == "성심당 본점"


def test_gate_signals_untranslatable_instead_of_faking_success() -> None:
    """번역 불가는 성공으로 위장하지 않는다 — 게이트웨이가 폴백으로 전환 (INV-4)."""
    out = _apply(json.dumps({"editCommand": None}))
    assert out.value is None and "not_translatable" in out.error


# ── 게이트: 파싱 실패·구조 위반 ──────────────────────────────


def test_gate_parse_failures_and_pool_guard() -> None:
    assert EditTranslationGate().apply(
        "{}", None, feature=_FEAT, trace_id=_TID, now=_NOW
    ).error.startswith("gate_error:")
    assert _apply("이건 JSON이 아니다").error.startswith("parse_error:")
    assert _apply(json.dumps({"command": {"op": "ADD_SLOT"}})).error.startswith("parse_error:")
    assert _apply(json.dumps({"editCommand": "ADD_SLOT"})).error is not None
    assert _apply(json.dumps({"editCommand": {"op": "ADD_SLOT", "params": []}})).error is not None
    assert _apply(json.dumps({"editCommand": {"op": "ADD_SLOT", "affectedSlots": "p1"}})).error is not None
    assert _apply(json.dumps({"editCommand": {"op": "ADD_SLOT", "affectedSlots": [""]}})).error is not None
    # op가 비문자열(해시 불가 포함) — enum 조회 예외가 폴백 신호로 수렴
    assert _apply(json.dumps({"editCommand": {"op": ["ADD_SLOT"]}})).error is not None
    assert _apply(json.dumps({"editCommand": {"op": 3}})).error is not None
    assert _apply(json.dumps({"editCommand": {"op": "ADD_SLOT", "params": {"1": "x"}}})).error is None


# ── 게이트: 반영 모드는 코드 확정 (M16-P2) ───────────────────


def test_gate_ignores_llm_apply_mode_for_destructive_op() -> None:
    out = _apply(_raw("REMOVE_SLOT", ["p1"], apply_mode="AUTO_APPLY"))
    assert out.value.apply_mode is ApplyMode.CONFIRM_REQUIRED  # LLM 제안 무시


def test_gate_dedups_slots_so_mode_is_not_inflated() -> None:
    """중복 ID가 affected>1을 만들어 반영 모드를 흔들지 않는다."""
    out = _apply(_raw("ADD_SLOT", ["p1", "p1"]))
    assert out.value.command.affected_slots == (PoiId("p1"),)
    assert out.value.apply_mode is ApplyMode.AUTO_APPLY


# ── PBT ──────────────────────────────────────────────────────


@st.composite
def _pool_and_command(draw):
    pool = draw(candidate_pools().filter(lambda p: bool(p.poi_ids)))
    ids = sorted(pool.poi_ids, key=str)
    op = draw(st.sampled_from(list(EditOp)))
    slots = draw(st.lists(st.sampled_from(ids), max_size=3, unique=True))
    return pool, op, tuple(slots)


@given(_pool_and_command())
def test_pbt_gate_output_is_always_closed_set_and_code_resolved(case) -> None:
    """①③ 통과분은 항상 EditOp closed-set ∧ 풀 안 ∧ 코드가 확정한 반영 모드."""
    pool, op, slots = case
    out = _apply(_raw(op.value, [str(s) for s in slots]), pool)
    assert out.error is None
    cmd = out.value.command
    assert cmd.op in set(EditOp)
    assert all(pool.contains(pid) for pid in cmd.affected_slots)
    assert out.value.apply_mode is resolve_apply_mode(cmd)
    if op in {EditOp.REMOVE_SLOT, EditOp.CLEAR_DAY, EditOp.REORDER_DAY, EditOp.REPLAN} or len(slots) > 1:
        assert out.value.apply_mode is ApplyMode.CONFIRM_REQUIRED


@given(
    _pool_and_command(),
    st.text(min_size=1, max_size=12),
)
def test_pbt_polluted_slot_never_survives(case, ghost: str) -> None:
    """② 풀 밖 ID가 섞이면 어떤 경우에도 명령이 통과하지 않는다 (INV-1)."""
    pool, op, slots = case
    assume(PoiId(ghost) not in pool.poi_ids)
    out = _apply(_raw(op.value, [*(str(s) for s in slots), ghost]), pool)
    assert out.value is None and out.error is not None
    assert out.drop_event is not None and PoiId(ghost) in out.drop_event.dropped_ids


@given(_pool_and_command(), st.text(min_size=1, max_size=12))
def test_pbt_polluted_param_poi_ref_never_survives(case, ghost: str) -> None:
    """② params 경로로도 풀 밖 POI가 빠져나가지 못한다 (INV-1)."""
    pool, op, slots = case
    assume(PoiId(ghost) not in pool.poi_ids)
    out = _apply(
        _raw(op.value, [str(s) for s in slots], params={"targetPoiId": ghost}), pool
    )
    assert out.value is None and out.error is not None
    assert out.drop_event is not None and PoiId(ghost) in out.drop_event.dropped_ids


@given(_pool_and_command(), st.sampled_from(["startTime", "durationSec", "visitMinutes"]))
def test_pbt_time_params_never_survive(case, key: str) -> None:
    """③ 어떤 op·슬롯 조합에서도 시각·소요시간 params는 통과하지 않는다."""
    pool, op, slots = case
    out = _apply(_raw(op.value, [str(s) for s in slots], params={key: 30}), pool)
    assert out.value is None and out.error is not None


@given(edit_commands())
def test_pbt_edit_translation_roundtrip(cmd: EditCommand) -> None:
    x = EditTranslation(command=cmd, apply_mode=resolve_apply_mode(cmd))
    assert EditTranslation.from_dict(x.to_dict()) == x


# ── 프롬프트 (⑥) ────────────────────────────────────────────


def _vars(pool: CandidatePool) -> dict[str, str]:
    return build_edit_translation_vars(
        pool,
        EditTranslationInput(
            utterance="둘째 날 성심당 빼줘", target_date="2026-08-10",
            current_slots=(PoiId("p1"),),
        ),
    )


def test_prompt_renders_deterministically_without_coordinates() -> None:
    pool = _pool()
    reg = PromptRegistry(_PROMPTS)
    p1, ref = reg.render(_FEAT, _vars(pool))
    p2, _ = reg.render(_FEAT, _vars(pool))
    assert p1 == p2  # 결정론
    assert ref.prompt_id == "prompts/edit_translation.yaml" and ref.version == "0.1.0"
    assert ref.feature == "EDIT_TRANSLATION"
    for poi in pool.pois:
        assert str(poi.poi_id) in p1  # 슬롯·후보 전원 포함
        assert str(poi.coord.lat) not in p1 and str(poi.coord.lng) not in p1  # G181


def test_prompt_states_no_intent_reinterpretation_and_injects_op_closed_set() -> None:
    """DL-3·BR-AF-02: 확정된 의도를 다시 분류하지 않는다는 문구가 프롬프트에 있다."""
    prompt, _ = PromptRegistry(_PROMPTS).render(_FEAT, _vars(_pool()))
    assert "의도를 다시 분류" in prompt
    assert "EDIT_SCHEDULE" in prompt
    for op in EditOp:
        assert op.value in prompt  # 서버 주입 closed-set 목록


def test_build_vars_rejects_slot_outside_pool() -> None:
    with pytest.raises(ValueError):
        build_edit_translation_vars(
            _pool(),
            EditTranslationInput(utterance="u", target_date="d",
                                 current_slots=(PoiId("없는슬롯"),)),
        )


# ── 워커 e2e (실물 레지스트리·게이트) ────────────────────────


def _worker(llm) -> EditTranslationWorker:
    gateway = GatewayFacade(
        llm, PromptRegistry(_PROMPTS), EditTranslationGate(), _CFG, InMemoryTrace()
    )
    return EditTranslationWorker(gateway)


def _input() -> EditTranslationInput:
    return EditTranslationInput(
        utterance="성심당 대신 수목원 갈래", target_date="2026-08-10",
        current_slots=(PoiId("p1"),),
    )


def test_worker_end_to_end_success() -> None:
    canned = _raw("REPLACE_SLOT", ["p1"], params={"targetPoiId": "p2"})
    result = _worker(FakeLlm(canned=canned)).translate(_pool(), _input(), _TID, _NOW)
    assert result.is_fallback is False
    assert result.value.command.op is EditOp.REPLACE_SLOT
    assert result.value.apply_mode is ApplyMode.AUTO_APPLY


def test_worker_falls_back_loudly_on_llm_failure() -> None:
    """⑤ INV-4 — 침묵 실패 없음: 폴백 표시 + 사유가 실린다 (수동 편집 안내는 호출측)."""
    result = _worker(FailingLlm()).translate(_pool(), _input(), _TID, _NOW)
    assert result.is_fallback is True and result.value is None
    assert result.error and result.call_record is not None


def test_worker_falls_back_when_gate_drops_command() -> None:
    result = _worker(FakeLlm(canned=_raw("ADD_SLOT", ["유령장소"]))).translate(
        _pool(), _input(), _TID, _NOW
    )
    assert result.is_fallback is True and result.value is None
    assert "closed_set_violation" in result.error
