"""서빙 전환 판정기 — 리마인드 학생 모델을 Bedrock 에 둘지 EKS GPU 로 옮길지 (AI-D08).

주 1회 `.github/workflows/ai-serving-judge.yml` 이 돌린다. 양쪽의 **실측**(CloudWatch·Cost
Explorer)을 읽어 `docs/mlops/serving-ledger.md` 에 행을 붙이고, 전환 조건이 2주 연속
성립하면 `deploy/eks/chart/values.yaml` 의 `reminderLlm.transport` 를 바꿔 PR 을 연다.
**머지가 승인이다** — 이 스크립트는 실서비스를 직접 건드리지 않는다.

    uv run python scripts/mlops/serving_judge.py --ledger docs/mlops/serving-ledger.md
    uv run python scripts/mlops/serving_judge.py --ledger ... --dry-run   # AWS 안 읽고 규칙만

측정하지 못하는 값은 **모델링하지 않는다.** EKS 쪽 지연은 아직 자동으로 못 읽으므로
(인클러스터 vLLM 은 CloudWatch 에 안 나온다) 원장 게이트 표의 `eks_p95_ms` 를 사람이
첫 측정 후 적는다. 그 칸이 비어 있으면 판정은 HOLD 다.

왜 매주 다시 재는가 — 볼륨은 자라고 단가는 바뀐다. 한 번 고른 것을 다시 재지 않으면
첫 결정이 영구가 된다.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

# 히스테리시스 — 상대가 이 비율보다 싸야 옮긴다. 둘 다 방향에 같은 값(왔다갔다 금지).
CHEAPER_RATIO = 0.7
# 같은 판정이 이만큼 연속돼야 PR 을 연다.
CONSECUTIVE_FOR_PR = 2

# Cost Explorer 서비스명·GPU 인스턴스 패밀리 — 태그에 기대지 않는다(#657 노드 태그가 어떻든 잡힌다).
BEDROCK_SERVICE = "Amazon Bedrock"
# Cost Explorer 를 못 읽을 때(샌드박스 SSO 역할이 ce:GetCostAndUsage 를 거부 — 2026-09-26 실측)
# Bedrock 만은 **청구 규칙**으로 정확히 센다: 활성 5분 창 × CMU × 분당 단가 × 5. 모델링이 아니라
# 공시된 과금 단위다. CMU 는 임포트 시점에 정해진다(컨텍스트 4096 으로 1). EKS 는 이런 규칙이
# 없으니(노드 시간은 프로비저닝·풀·로드에 달렸다) CE 없이는 0 = "측정 없음" 으로 남긴다.
BEDROCK_CMU = 1
BEDROCK_USD_PER_CMU_MINUTE = 0.0785
GPU_FAMILIES = ("g4dn", "g5", "g6", "g6e", "p3", "p4d", "p5")

HOLD, SWITCH_TO_LOCAL, SWITCH_TO_BEDROCK, STAY = "HOLD", "SWITCH_TO_LOCAL", "SWITCH_TO_BEDROCK", "STAY"


@dataclass(frozen=True)
class Gates:
    gpu_quota: bool
    zero_billing_verified: bool
    eks_p95_ms: float | None
    fill_deadline_ms: float


@dataclass(frozen=True)
class Measured:
    days: int
    bedrock_calls_per_day: float
    bedrock_active_windows_per_day: float
    bedrock_p95_ms: float | None
    bedrock_usd_per_day: float
    eks_usd_per_day: float
    notes: tuple[str, ...] = ()

    @property
    def bedrock_usd_per_call(self) -> float | None:
        return self.bedrock_usd_per_day / self.bedrock_calls_per_day if self.bedrock_calls_per_day else None

    @property
    def eks_usd_per_call(self) -> float | None:
        # 호출 수는 전송로와 무관하게 백엔드가 정한다 — 같은 볼륨으로 나눈다.
        return self.eks_usd_per_day / self.bedrock_calls_per_day if self.bedrock_calls_per_day else None


@dataclass(frozen=True)
class Verdict:
    verdict: str
    action: str  # none | open_pr
    reasons: tuple[str, ...]


# ---------------------------------------------------------------- 규칙 (순수 — 테스트 대상)


def judge(m: Measured, g: Gates, current_transport: str, previous_verdicts: list[str]) -> Verdict:
    reasons: list[str] = []
    if not g.gpu_quota:
        reasons.append("gpu_quota=no")
    if not g.zero_billing_verified:
        reasons.append("zero_billing_verified=no")
    if g.eks_p95_ms is None:
        reasons.append("eks_p95_ms 미측정")
    if m.eks_usd_per_day <= 0:
        reasons.append("EKS 비용 실측 없음")
    if m.bedrock_calls_per_day <= 0:
        reasons.append("Bedrock 호출 0 — 건당 비용 계산 불가")
    if reasons:
        return Verdict(HOLD, "none", tuple(reasons))

    b, e = m.bedrock_usd_per_call, m.eks_usd_per_call
    assert b is not None and e is not None and g.eks_p95_ms is not None
    if current_transport == "bedrock":
        cheaper = e < CHEAPER_RATIO * b
        fast = g.eks_p95_ms < g.fill_deadline_ms
        if cheaper and fast:
            verdict = SWITCH_TO_LOCAL
            reasons.append(f"EKS ${e:.4f}/건 < {CHEAPER_RATIO}×Bedrock ${b:.4f}/건, p95 {g.eks_p95_ms:.0f}<{g.fill_deadline_ms:.0f}ms")
        else:
            verdict = STAY
            reasons.append("EKS 가 충분히 싸지 않음" if not cheaper else f"EKS p95 {g.eks_p95_ms:.0f}ms ≥ 마감 {g.fill_deadline_ms:.0f}ms")
    else:
        if b < CHEAPER_RATIO * e:
            verdict = SWITCH_TO_BEDROCK
            reasons.append(f"Bedrock ${b:.4f}/건 < {CHEAPER_RATIO}×EKS ${e:.4f}/건")
        else:
            verdict = STAY
            reasons.append("Bedrock 이 충분히 싸지 않음")

    # 연속만 센다 — 중간에 다른 판정이 끼면 끊긴다.
    streak = 0
    if verdict.startswith("SWITCH"):
        streak = 1
        for v in reversed(previous_verdicts):
            if v != verdict:
                break
            streak += 1
    action = "open_pr" if streak >= CONSECUTIVE_FOR_PR else "none"
    if verdict.startswith("SWITCH"):
        reasons.append(f"연속 {streak}/{CONSECUTIVE_FOR_PR}")
    return Verdict(verdict, action, tuple(reasons))


# ---------------------------------------------------------------- 원장 읽기/쓰기

_ROW = re.compile(r"^\|(.+)\|\s*$")


def _cells(line: str) -> list[str]:
    m = _ROW.match(line)
    if not m:
        raise ValueError(f"표 행이 아님: {line!r}")
    return [c.strip() for c in m.group(1).split("|")]


def read_gates(text: str) -> Gates:
    rows: dict[str, str] = {}
    section = text.split("## 게이트", 1)[1].split("## ", 1)[0]
    for line in section.splitlines():
        if line.startswith("|") and not line.startswith("|---") and "게이트" not in line:
            key, value, *_ = _cells(line)
            rows[key] = value
    missing = {"gpu_quota", "zero_billing_verified", "eks_p95_ms", "fill_deadline_ms"} - rows.keys()
    if missing:
        raise ValueError(f"게이트 표에 없음: {sorted(missing)}")
    yes = lambda v: v.strip().lower() == "yes"  # noqa: E731
    p95 = rows["eks_p95_ms"].strip()
    return Gates(
        gpu_quota=yes(rows["gpu_quota"]),
        zero_billing_verified=yes(rows["zero_billing_verified"]),
        eks_p95_ms=float(p95) if p95 not in ("", "-") else None,
        fill_deadline_ms=float(rows["fill_deadline_ms"]),
    )


def read_previous_verdicts(text: str) -> list[str]:
    section = text.split("## 주간 기록", 1)[1]
    verdicts = []
    for line in section.splitlines():
        if line.startswith("|") and not line.startswith("|---") and "주(끝)" not in line:
            cells = _cells(line)
            verdicts.append(cells[10])
    return verdicts


def ledger_row(week_end: dt.date, m: Measured, transport: str, v: Verdict) -> str:
    f = lambda x: "-" if x is None else f"{x:.4f}"  # noqa: E731
    cells = [
        week_end.isoformat(), str(m.days), transport,
        f"{m.bedrock_calls_per_day:.1f}", f"{m.bedrock_active_windows_per_day:.1f}",
        "-" if m.bedrock_p95_ms is None else f"{m.bedrock_p95_ms:.0f}",
        f"{m.bedrock_usd_per_day:.2f}", f"{m.eks_usd_per_day:.2f}",
        f(m.bedrock_usd_per_call), f(m.eks_usd_per_call),
        v.verdict, v.action, "; ".join(m.notes + v.reasons),
    ]
    return "| " + " | ".join(c.replace("|", "/") for c in cells) + " |"


# 스위치는 차트의 `reminderLlm.transport`(PR #657) — 인클러스터 서빙 블록의 한 줄이다. 블록 안의
# `transport:` 만 잡는다(다른 블록에 같은 이름의 키가 생겨도 안 건드린다).
_TRANSPORT = re.compile(r"^(reminderLlm:\n(?:[ \t]+.*\n)*?[ \t]+transport:[ \t]*)(\w+)", re.M)


def read_transport(values_yaml: Path) -> str:
    """차트에 스위치 줄이 없으면 bedrock — `_local_route` 의 미설정 기본과 같다."""
    m = _TRANSPORT.search(values_yaml.read_text())
    return m.group(2) if m else "bedrock"


def flip_transport(values_yaml: Path, to: str) -> None:
    text, n = _TRANSPORT.subn(rf"\g<1>{to}", values_yaml.read_text())
    if n != 1:
        raise ValueError(f"{values_yaml}: reminderLlm.transport 줄이 {n}개 — #657 이 아직 안 들어왔거나 블록이 바뀌었다")
    values_yaml.write_text(text)


# ---------------------------------------------------------------- AWS 읽기 (얇게 — 값만 가져온다)


def measure(days: int, bedrock_region: str, cost_region: str) -> Measured:
    import boto3

    notes: list[str] = []
    end = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = end - dt.timedelta(days=days)

    cw = boto3.client("cloudwatch", region_name=bedrock_region)
    model_ids = sorted(
        {d["Value"] for m in cw.list_metrics(Namespace="AWS/Bedrock", MetricName="Invocations")["Metrics"]
         for d in m["Dimensions"] if d["Name"] == "ModelId" and "imported-model" in d["Value"]}
    )
    calls = windows = 0.0
    p95: float | None = None
    if not model_ids:
        notes.append("CloudWatch 에 imported-model Invocations 없음")
    for model_id in model_ids:
        dims = [{"Name": "ModelId", "Value": model_id}]
        # 5분 창 = 청구 단위. 한 호출당 1,440 점 상한이라(실측: 7일이 2,016 점) 하루씩 끊는다.
        for day in range(days):
            inv = cw.get_metric_statistics(
                Namespace="AWS/Bedrock", MetricName="Invocations", Dimensions=dims,
                StartTime=start + dt.timedelta(days=day), EndTime=start + dt.timedelta(days=day + 1),
                Period=300, Statistics=["Sum"],
            )["Datapoints"]
            calls += sum(p["Sum"] for p in inv)
            windows += sum(1 for p in inv if p["Sum"] > 0)
        lat = cw.get_metric_statistics(
            Namespace="AWS/Bedrock", MetricName="InvocationLatency", Dimensions=dims,
            StartTime=start, EndTime=end, Period=days * 86400, ExtendedStatistics=["p95"],
        )["Datapoints"]
        if lat:
            p95 = max(p95 or 0.0, lat[0]["ExtendedStatistics"]["p95"])

    ce = boto3.client("ce", region_name=cost_region)
    period = {"Start": start.date().isoformat(), "End": end.date().isoformat()}

    def cost(filter_: dict) -> float:
        try:
            r = ce.get_cost_and_usage(TimePeriod=period, Granularity="DAILY", Metrics=["UnblendedCost"], Filter=filter_)
        except Exception as e:  # CE 미활성·권한 — 판정은 HOLD 로 가되 원인을 남긴다
            code = getattr(e, "response", {}).get("Error", {}).get("Code", type(e).__name__)
            if f"CostExplorer: {code}" not in notes:
                notes.append(f"CostExplorer: {code}")
            return 0.0
        return sum(float(day["Total"]["UnblendedCost"]["Amount"]) for day in r["ResultsByTime"])

    bedrock_usd = cost({"Dimensions": {"Key": "SERVICE", "Values": [BEDROCK_SERVICE]}})
    eks_usd = cost({"Dimensions": {"Key": "INSTANCE_TYPE_FAMILY", "Values": list(GPU_FAMILIES)}})
    if bedrock_usd == 0.0 and windows > 0:
        bedrock_usd = windows * BEDROCK_CMU * BEDROCK_USD_PER_CMU_MINUTE * 5
        notes.append("Bedrock $ 는 청구 규칙 계산(활성 창×CMU×단가)")

    return Measured(
        days=days,
        bedrock_calls_per_day=calls / days,
        bedrock_active_windows_per_day=windows / days,
        bedrock_p95_ms=p95,
        bedrock_usd_per_day=bedrock_usd / days,
        eks_usd_per_day=eks_usd / days,
        notes=tuple(notes),
    )


# ---------------------------------------------------------------- 진입


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--ledger", type=Path, required=True)
    ap.add_argument("--values", type=Path, default=Path("../deploy/eks/chart/values.yaml"))
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--bedrock-region", default="us-east-1")
    ap.add_argument("--cost-region", default="us-east-1")  # Cost Explorer 는 us-east-1 엔드포인트
    ap.add_argument("--dry-run", action="store_true", help="AWS 를 읽지 않고 0 측정으로 규칙만 돌린다")
    ap.add_argument("--json", type=Path, help="판정 결과 JSON 저장 경로")
    args = ap.parse_args(argv)

    text = args.ledger.read_text()
    gates = read_gates(text)
    previous = read_previous_verdicts(text)
    transport = read_transport(args.values)
    m = (
        Measured(args.days, 0.0, 0.0, None, 0.0, 0.0, ("dry-run",))
        if args.dry_run
        else measure(args.days, args.bedrock_region, args.cost_region)
    )
    v = judge(m, gates, transport, previous)

    row = ledger_row(dt.date.today(), m, transport, v)
    args.ledger.write_text(text.rstrip("\n") + "\n" + row + "\n")
    if v.action == "open_pr":
        flip_transport(args.values, "local" if v.verdict == SWITCH_TO_LOCAL else "bedrock")

    out = {**asdict(v), "transport": transport, "measured": asdict(m), "row": row}
    print(json.dumps(out, ensure_ascii=False, indent=2))
    if args.json:
        args.json.write_text(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
