"""서빙 전환 판정기 — 규칙·원장 파서 (AI-D08, TRIP-973). AWS 는 안 부른다."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "serving_judge", Path(__file__).resolve().parents[1] / "scripts" / "mlops" / "serving_judge.py"
)
sj = importlib.util.module_from_spec(_spec)
sys.modules["serving_judge"] = sj
_spec.loader.exec_module(sj)

LEDGER = (Path(__file__).resolve().parents[1] / "docs" / "mlops" / "serving-ledger.md").read_text()

OPEN = sj.Gates(gpu_quota=True, zero_billing_verified=True, eks_p95_ms=3000, fill_deadline_ms=8000)


def measured(bedrock_usd=10.0, eks_usd=5.0, calls=100.0):
    return sj.Measured(14, calls, 20.0, 1500.0, bedrock_usd, eks_usd)


def test_gates_closed_hold_regardless_of_cost():
    """게이트가 닫혀 있으면 EKS 가 공짜여도 HOLD — 표만 남긴다."""
    g = sj.Gates(gpu_quota=False, zero_billing_verified=True, eks_p95_ms=1000, fill_deadline_ms=8000)
    v = sj.judge(measured(eks_usd=0.01), g, "bedrock", [])
    assert v.verdict == sj.HOLD and v.action == "none" and "gpu_quota=no" in v.reasons


def test_no_eks_measurement_is_hold_not_switch():
    """EKS 비용 0 은 '공짜' 가 아니라 '측정 없음' 이다."""
    v = sj.judge(measured(eks_usd=0.0), OPEN, "bedrock", [])
    assert v.verdict == sj.HOLD


def test_cheaper_and_fast_recommends_local_but_needs_two_in_a_row():
    v1 = sj.judge(measured(bedrock_usd=10, eks_usd=5), OPEN, "bedrock", [])
    assert v1.verdict == sj.SWITCH_TO_LOCAL and v1.action == "none"
    v2 = sj.judge(measured(bedrock_usd=10, eks_usd=5), OPEN, "bedrock", [sj.SWITCH_TO_LOCAL])
    assert v2.action == "open_pr"


def test_streak_breaks_on_intervening_verdict():
    v = sj.judge(measured(bedrock_usd=10, eks_usd=5), OPEN, "bedrock", [sj.SWITCH_TO_LOCAL, sj.HOLD])
    assert v.verdict == sj.SWITCH_TO_LOCAL and v.action == "none"


def test_hysteresis_band_keeps_current_transport():
    """0.7 배 안쪽이면 어느 쪽이든 STAY — 왔다갔다 금지."""
    assert sj.judge(measured(bedrock_usd=10, eks_usd=8), OPEN, "bedrock", []).verdict == sj.STAY
    assert sj.judge(measured(bedrock_usd=8, eks_usd=10), OPEN, "local", []).verdict == sj.STAY


def test_slow_eks_stays_even_if_cheap():
    g = sj.Gates(gpu_quota=True, zero_billing_verified=True, eks_p95_ms=9000, fill_deadline_ms=8000)
    v = sj.judge(measured(bedrock_usd=10, eks_usd=1), g, "bedrock", [])
    assert v.verdict == sj.STAY and any("마감" in r for r in v.reasons)


def test_switch_back_to_bedrock_when_local_costs_more():
    v = sj.judge(measured(bedrock_usd=5, eks_usd=10), OPEN, "local", [sj.SWITCH_TO_BEDROCK])
    assert v.verdict == sj.SWITCH_TO_BEDROCK and v.action == "open_pr"


def test_ledger_gates_parse_committed_file():
    """커밋된 원장의 게이트 표를 파서가 읽는다 — 열 이름이 바뀌면 여기서 깨진다."""
    g = sj.read_gates(LEDGER)
    assert g == sj.Gates(gpu_quota=False, zero_billing_verified=False, eks_p95_ms=None, fill_deadline_ms=8000)
    assert sj.read_previous_verdicts(LEDGER) == []


def test_ledger_row_round_trips_verdict():
    import datetime as dt

    m = measured()
    v = sj.judge(m, OPEN, "bedrock", [])
    row = sj.ledger_row(dt.date(2026, 9, 28), m, "bedrock", v)
    assert sj.read_previous_verdicts(LEDGER + row + "\n") == [v.verdict]


VALUES = """ai:
  replicas: 1
embedding:
  enabled: false
reminderLlm:
  # in-cluster serving (#657)
  enabled: false
  transport: bedrock
  servedModelName: local-reminder-qwen3-4b-v1
gateway:
  transport: tcp
"""


def test_flip_transport_changes_only_the_reminder_llm_line(tmp_path):
    values = tmp_path / "values.yaml"
    values.write_text(VALUES)
    sj.flip_transport(values, "local")
    assert sj.read_transport(values) == "local"
    assert "  transport: tcp" in values.read_text()  # 다른 블록의 같은 키는 안 건드린다


def test_missing_switch_reads_as_bedrock_but_refuses_to_flip(tmp_path):
    """#657 전의 차트 — 읽기는 기본값, 뒤집기는 실패(조용히 줄을 만들지 않는다)."""
    values = tmp_path / "values.yaml"
    values.write_text("ai:\n  replicas: 1\n")
    assert sj.read_transport(values) == "bedrock"
    with pytest.raises(ValueError, match="#657"):
        sj.flip_transport(values, "local")


def test_dry_run_appends_hold_row_and_never_flips(tmp_path):
    ledger = tmp_path / "ledger.md"; ledger.write_text(LEDGER)
    values = tmp_path / "values.yaml"; values.write_text(VALUES)
    assert sj.main(["--ledger", str(ledger), "--values", str(values), "--dry-run"]) == 0
    assert sj.read_previous_verdicts(ledger.read_text()) == [sj.HOLD]
    assert sj.read_transport(values) == "bedrock"
