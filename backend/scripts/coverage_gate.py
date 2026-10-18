"""커버리지 하한선 게이트 — `:app:testCodeCoverageReport` 의 합산 XML 을 읽어 판정한다.

    python3 scripts/coverage_gate.py [xml 경로]

- 전체 라인·분기 커버리지 중 하나라도 하한선(FLOORS)보다 낮으면 exit 1(머지 차단).
- 모듈(패키지 `com.trippilot.<모듈>`)별 표를 stdout 에, CI 면 `$GITHUB_STEP_SUMMARY` 에도 쓴다.

하한선은 **래칫**이다 — 오르면 이 상수를 올리는 PR 을 내고, 내리지 않는다. 처음부터 목표치(80% 같은)를
걸면 첫날부터 빨갛거나 아무도 못 지키는 숫자가 되어 결국 게이트를 끄게 된다. 측정한 기준선에서 시작한다.
"""

import os
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

# 기준선(2026-10-18 develop 실측: 라인 94.8% · 분기 81.5%)에서 소수점 버림. 올릴 때만 고친다.
# 분기를 같이 거는 이유 — 라인은 이미 높아 거의 안 움직인다. 빠진 `else`·예외 경로는 분기에서 보인다.
FLOORS = {"LINE": 94.0, "BRANCH": 81.0}

DEFAULT_XML = "app/build/reports/jacoco/testCodeCoverageReport/testCodeCoverageReport.xml"


def counter(element, kind):
    for c in element.findall("counter"):
        if c.get("type") == kind:
            return int(c.get("covered")), int(c.get("missed"))
    return 0, 0


def pct(covered, missed):
    total = covered + missed
    return 100.0 * covered / total if total else 0.0


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XML
    root = ET.parse(path).getroot()

    modules = defaultdict(lambda: {k: [0, 0] for k in FLOORS})
    for package in root.iter("package"):
        parts = package.get("name").split("/")
        module = parts[2] if len(parts) > 2 and parts[:2] == ["com", "trippilot"] else package.get("name")
        for kind in FLOORS:
            covered, missed = counter(package, kind)
            modules[module][kind][0] += covered
            modules[module][kind][1] += missed

    totals = {kind: pct(*counter(root, kind)) for kind in FLOORS}
    rows = sorted(modules.items(), key=lambda kv: pct(*kv[1]["BRANCH"]))
    lines = [
        "### 백엔드 커버리지 — " + " · ".join(f"{k} {totals[k]:.1f}% (하한 {FLOORS[k]:.0f}%)" for k in FLOORS),
        "",
        "| 모듈 | 라인 | 분기 |",
        "|---|---:|---:|",
        *(f"| {m} | {pct(*c['LINE']):.1f}% | {pct(*c['BRANCH']):.1f}% |" for m, c in rows),
    ]
    report = "\n".join(lines)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(report + "\n")

    below = [k for k in FLOORS if totals[k] < FLOORS[k]]
    for k in below:
        print(f"\n{k} 커버리지 {totals[k]:.1f}% 가 하한선 {FLOORS[k]:.0f}% 아래다.", file=sys.stderr)
    for k in FLOORS:
        if totals[k] >= FLOORS[k] + 1:
            print(f"\n{k} 하한선을 {int(totals[k])}% 로 올릴 수 있다(FLOORS).")
    return 1 if below else 0


if __name__ == "__main__":
    sys.exit(main())
