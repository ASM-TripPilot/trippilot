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
    """스위치 블록이 없는 차트 — 읽기는 기본값, 뒤집기는 실패(조용히 줄을 만들지 않는다).

    2026-10-01 부터 **이것이 현재 상태**다: 인클러스터 서빙 매니페스트를 철회해
    `reminderLlm` 블록이 차트에 없다. 판정기는 계속 돌아야 하고(표는 남는다) 뒤집기만
    막혀야 한다 — 줄을 새로 만들면 스키마가 거부하는 값이 차트에 들어간다.
    """
    values = tmp_path / "values.yaml"
    values.write_text("ai:\n  replicas: 1\n")
    assert sj.read_transport(values) == "bedrock"
    with pytest.raises(ValueError, match="철회"):
        sj.flip_transport(values, "local")


def test_local_switch_records_the_row_without_dying_on_the_withdrawn_switch(tmp_path, monkeypatch):
    """전환 권고가 2주 연속 나와도 판정기는 죽지 않고 원장 행을 남긴다.

    인클러스터 서빙을 철회하면서(2026-10-01) 차트의 `reminderLlm.transport` 줄이
    사라졌는데 `main()` 은 `open_pr` 이면 방향을 안 보고 `flip_transport` 를 불렀다.
    그래서 **원장 행을 파일에 쓴 뒤** ValueError 로 죽었고, 워크플로의 PR 스텝은 판정
    스텝이 실패하면 건너뛰므로 그 주 판정이 커밋되지 않고 사라졌다. 다음 주에도
    원장에 1주차 행이 남아 streak 가 다시 2 가 되므로 같은 자리에서 또 죽는다 —
    원장이 그 지점에서 영구히 멈춘다.

    local 전환은 값 한 줄이 아니라 매니페스트 재작성이므로, PR 은 착수 제안이고
    뒤집을 줄은 없는 것이 맞다.
    """
    import datetime as dt

    ledger = tmp_path / "ledger.md"
    # 게이트를 열고 1주차 SWITCH_TO_LOCAL 을 이미 받은 상태로 만든다 → 이번이 2주 연속.
    text = LEDGER.replace("| gpu_quota | no |", "| gpu_quota | yes |") \
                 .replace("| zero_billing_verified | no |", "| zero_billing_verified | yes |") \
                 .replace("| eks_p95_ms | - |", "| eks_p95_ms | 3000 |")
    assert "gpu_quota | yes" in text and "eks_p95_ms | 3000" in text, "원장 게이트 표 형식이 바뀌었다"
    ledger.write_text(text.rstrip("\n") + "\n"
                      + sj.ledger_row(dt.date(2026, 9, 24), measured(), "bedrock",
                                      sj.Verdict(sj.SWITCH_TO_LOCAL, "none", ("1주차",))) + "\n")
    values = tmp_path / "values.yaml"
    values.write_text("ai:\n  replicas: 1\n")  # 철회 후의 차트 — reminderLlm 블록이 없다

    monkeypatch.setattr(sj, "measure", lambda *a, **k: measured(bedrock_usd=10, eks_usd=5))

    assert sj.main(["--ledger", str(ledger), "--values", str(values)]) == 0
    verdicts = sj.read_previous_verdicts(ledger.read_text())
    assert verdicts[-2:] == [sj.SWITCH_TO_LOCAL, sj.SWITCH_TO_LOCAL]
    assert sj.read_transport(values) == "bedrock"  # 차트는 손대지 않았다


def test_dry_run_appends_hold_row_and_never_flips(tmp_path):
    ledger = tmp_path / "ledger.md"; ledger.write_text(LEDGER)
    values = tmp_path / "values.yaml"; values.write_text(VALUES)
    assert sj.main(["--ledger", str(ledger), "--values", str(values), "--dry-run"]) == 0
    assert sj.read_previous_verdicts(ledger.read_text()) == [sj.HOLD]
    assert sj.read_transport(values) == "bedrock"
