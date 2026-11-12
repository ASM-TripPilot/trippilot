#!/usr/bin/env python3
"""운영 대시보드(trippilot-<env>-ops)를 infra/dashboards/ops.json.tpl 로 만들거나 덮어쓴다.

Terraform 밖에 두는 이유: 배포 역할에 cloudwatch:PutDashboard 가 없다 — stack 에 넣으면 권한을 넓히기 전까지
운영 배포가 실패한다. 대시보드는 지우고 다시 만들어도 잃는 게 없어 사람이 이 스크립트로 올린다(PutDashboard 는 멱등).

    AWS_PROFILE=... python3 infra/scripts/put_ops_dashboard.py [dev] [--dry-run]
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from string import Template

TEMPLATE = Path(__file__).resolve().parents[1] / "dashboards" / "ops.json.tpl"
REGION = "ap-northeast-2"


def aws(*args: str) -> str:
    return subprocess.run(["aws", "--region", REGION, *args], check=True, capture_output=True, text=True).stdout


def render(env: str, alarm_arns: list[str]) -> str:
    name = f"trippilot-{env}"
    body = Template(TEMPLATE.read_text()).substitute(
        region=REGION,
        cluster=name,
        db=name,
        app_log_group=f"/aws/containerinsights/{name}/application",
        alerts_namespace=f"TripPilot/{env}",
        alarm_arns=json.dumps(alarm_arns),
    )
    json.loads(body)  # 깨진 JSON 이면 올리기 전에 멈춘다
    return body


def main(argv: list[str]) -> int:
    env = next((a for a in argv if not a.startswith("--")), "dev")
    arns = json.loads(aws("cloudwatch", "describe-alarms", "--alarm-name-prefix", f"trippilot-{env}-",
                          "--query", "MetricAlarms[].AlarmArn", "--output", "json"))
    if not arns:
        print(f"trippilot-{env}-* 알람이 없다 — 알람이 켜진 환경에서만 만든다", file=sys.stderr)
        return 1
    body = render(env, sorted(arns))
    if "--dry-run" in argv:
        print(body)
        return 0
    out = aws("cloudwatch", "put-dashboard", "--dashboard-name", f"trippilot-{env}-ops", "--dashboard-body", body)
    print(out.strip() or f"trippilot-{env}-ops: 알람 {len(arns)}개 연결")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
