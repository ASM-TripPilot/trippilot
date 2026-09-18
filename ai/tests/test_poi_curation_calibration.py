"""U3-03 — 엔티티 해소 임계 캘리브레이션 하네스 검증 (TRIP-252).

하네스 결정론(같은 입력 → 같은 표) + 라벨 케이스셋 무결성 + 임계 단조성 PBT.
resolver 내부는 건드리지 않는다 — benchmarks 하네스의 공개 함수만 검증.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from benchmarks.calibrate_entity_resolution import (
    BASELINE_AUTO,
    BASELINE_CONFIRM,
    decision_counts,
    evaluate,
    format_baseline_detail,
    format_sweep_table,
    judge,
    sweep,
)
from benchmarks.data.entity_resolution_cases import CASES

_N_SAME = sum(1 for c in CASES if c.gold_poi_id is not None)


# ── 하네스 결정론 ────────────────────────────────────────────
def test_sweep_is_deterministic() -> None:
    """같은 입력 → 같은 표 (행 데이터·렌더링 모두)."""
    r1, r2 = sweep(CASES), sweep(CASES)
    assert r1 == r2
    assert format_sweep_table(r1, _N_SAME) == format_sweep_table(r2, _N_SAME)
    assert format_baseline_detail(CASES) == format_baseline_detail(CASES)


def test_baseline_in_sweep_grid() -> None:
    """초기값 (0.85, 0.60) 조합이 스윕 표에 반드시 존재 — 성적 추적 대상."""
    assert any((r.auto, r.confirm) == (BASELINE_AUTO, BASELINE_CONFIRM)
               for r in sweep(CASES))


# ── 라벨 케이스셋 무결성 ─────────────────────────────────────
def test_case_ids_unique() -> None:
    ids = [c.case_id for c in CASES]
    assert len(ids) == len(set(ids))


def test_labels_valid() -> None:
    for c in CASES:
        assert c.query.strip(), f"{c.case_id}: query 비어있음"
        assert c.pool, f"{c.case_id}: pool 비어있음"
        pool_ids = [pid for pid, _ in c.pool]
        assert len(pool_ids) == len(set(pool_ids)), f"{c.case_id}: pool id 중복"
        assert all(name.strip() for _, name in c.pool), f"{c.case_id}: 빈 이름"
        if c.gold_poi_id is not None:
            assert c.gold_poi_id in pool_ids, \
                f"{c.case_id}: gold {c.gold_poi_id} ∉ pool"


def test_cases_cover_both_labels() -> None:
    """동일 장소 변형과 다른 장소 케이스가 모두 존재해야 스윕이 의미 있음."""
    assert any(c.gold_poi_id is not None for c in CASES)
    assert any(c.gold_poi_id is None for c in CASES)


# ── 판정·집계 정합 ───────────────────────────────────────────
def test_evaluate_counts_partition_cases() -> None:
    """6개 평가 어휘의 합 = 전체 케이스 수 (누락·중복 집계 없음)."""
    r = evaluate(CASES, BASELINE_AUTO, BASELINE_CONFIRM)
    total = (r.auto_ok + r.false_auto + r.over_confirm
             + r.confirm_guard + r.miss + r.unresolved_ok)
    assert total == len(CASES)


# ── 임계 단조성 PBT ──────────────────────────────────────────
_TH = st.floats(min_value=0.0, max_value=1.0, allow_nan=False)


@settings(max_examples=60)
@given(ths=st.tuples(_TH, _TH, _TH))
def test_raising_auto_never_increases_auto_count(ths) -> None:
    """confirm 고정 시 auto 임계 ↑ → AUTO 판정 수 단조 비증가."""
    confirm, a_low, a_high = sorted(ths)
    n_low = decision_counts(CASES, a_low, confirm).auto
    n_high = decision_counts(CASES, a_high, confirm).auto
    assert n_high <= n_low


@settings(max_examples=60)
@given(ths=st.tuples(_TH, _TH, _TH))
def test_raising_confirm_never_decreases_unresolved(ths) -> None:
    """auto 고정 시 confirm 임계 ↑ → UNRESOLVED 판정 수 단조 비감소."""
    c_low, c_high, auto = sorted(ths)
    n_low = decision_counts(CASES, auto, c_low).unresolved
    n_high = decision_counts(CASES, auto, c_high).unresolved
    assert n_high >= n_low


@settings(max_examples=60)
@given(ths=st.tuples(_TH, _TH))
def test_judge_deterministic_across_thresholds(ths) -> None:
    """임의 유효 임계에서도 judge는 결정론 + 판정 분포는 케이스 수를 보존."""
    confirm, auto = sorted(ths)
    for case in CASES:
        assert judge(case, auto, confirm) == judge(case, auto, confirm)
    d = decision_counts(CASES, auto, confirm)
    assert d.auto + d.confirm + d.unresolved == len(CASES)
