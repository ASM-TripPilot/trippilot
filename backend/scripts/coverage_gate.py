"""커버리지 하한선 게이트 — `:app:testCodeCoverageReport` 의 합산 XML 을 읽어 판정한다.

    ./gradlew :app:testCodeCoverageReport && python3 scripts/coverage_gate.py [xml 경로]

- 전체 라인·분기가 TOTAL_FLOORS 아래거나, 어느 모듈이든 MODULE_FLOORS 아래면 exit 1(머지 차단).
- 모듈(패키지 `com.trippilot.<모듈>`)별 표를 stdout 에, CI 면 `$GITHUB_STEP_SUMMARY` 에도 쓴다.

하한선은 **래칫**이다 — 오르면 상수를 올리는 PR 을 내고, 내리지 않는다. 처음부터 목표치(80% 같은)를
걸면 첫날부터 빨갛거나 아무도 못 지키는 숫자가 되어 결국 게이트를 끄게 된다. 측정한 기준선에서 시작한다.

Gradle 내장 `JacocoCoverageVerification` 을 안 쓰는 이유: 합산 리포트에서 규칙을 걸 수 있는 단위가
번들·패키지·클래스뿐이라 **모듈**(하위 패키지 여럿의 합)별 하한을 표현할 수 없다.
"""

import glob
import os
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

KINDS = ("LINE", "BRANCH")

# 기준선(2026-10-19 develop 실측: 라인 95.4% · 분기 84.8%)에서 소수점 버림. 올릴 때만 고친다.
# 분기를 같이 거는 이유 — 라인은 이미 높아 거의 안 움직인다. 빠진 `else`·예외 경로는 분기에서 보인다.
# 여유를 더 두지 않은 근거: PBT 무작위 입력에 따른 실행 간 차이를 쟀더니 분기 8,084개 중 1개(0.01p)였다.
TOTAL_FLOORS = {"LINE": 95.0, "BRANCH": 84.0}

# 모듈 바닥 — 전체 평균은 테스트 0 인 새 모듈을 덮는다(분기 300개짜리 모듈이 0% 여도 전체는 0.4p 떨어진다).
# 값은 현재 최저 모듈(라인 moderation 82.9% · 분기 change-log 51.9%) 아래로 잡았다. 목표가 아니라 바닥이다.
MODULE_FLOORS = {"LINE": 80.0, "BRANCH": 50.0}

DEFAULT_XML = "app/build/reports/jacoco/testCodeCoverageReport/testCodeCoverageReport.xml"


def counter(element, kind):
    for c in element.findall("counter"):
        if c.get("type") == kind:
            return int(c.get("covered")), int(c.get("missed"))
    return 0, 0


def pct(covered, missed):
    """측정 대상이 없으면(분기 없는 모듈 등) None — 0% 로 보이면 가장 나쁜 모듈처럼 맨 위에 온다."""
    total = covered + missed
    return 100.0 * covered / total if total else None


def fmt(value):
    return "n/a" if value is None else f"{value:.1f}%"


def stale(xml_path):
    """리포트보다 새 실행 데이터가 있으면 그 리포트는 지금 코드를 말하지 않는다."""
    report = os.path.getmtime(xml_path)
    return [p for p in glob.glob("**/build/jacoco/*.exec", recursive=True) if os.path.getmtime(p) > report]


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XML
    if not os.path.exists(path):
        print(f"리포트가 없다: {path}\n먼저 `./gradlew :app:testCodeCoverageReport` 를 돌린다.", file=sys.stderr)
        return 2
    if len(sys.argv) == 1 and (newer := stale(path)):
        print(f"리포트가 실행 데이터보다 오래됐다({newer[0]} 외 {len(newer) - 1}개) — "
              "`./gradlew :app:testCodeCoverageReport` 를 다시 돌린다.", file=sys.stderr)
        return 2

    root = ET.parse(path).getroot()
    modules = defaultdict(lambda: {k: [0, 0] for k in KINDS})
    for package in root.iter("package"):
        parts = package.get("name").split("/")
        module = parts[2] if len(parts) > 2 and parts[:2] == ["com", "trippilot"] else package.get("name")
        for kind in KINDS:
            covered, missed = counter(package, kind)
            modules[module][kind][0] += covered
            modules[module][kind][1] += missed

    totals = {k: pct(*counter(root, k)) or 0.0 for k in KINDS}
    module_pct = {m: {k: pct(*c[k]) for k in KINDS} for m, c in modules.items()}
    rows = sorted(module_pct.items(), key=lambda kv: (kv[1]["BRANCH"] is None, kv[1]["BRANCH"] or 0.0))
    report = "\n".join([
        "### 백엔드 커버리지 — " + " · ".join(f"{k} {totals[k]:.1f}% (하한 {TOTAL_FLOORS[k]:g}%)" for k in KINDS),
        f"모듈 바닥: " + " · ".join(f"{k} {MODULE_FLOORS[k]:g}%" for k in KINDS),
        "",
        "| 모듈 | 라인 | 분기 |",
        "|---|---:|---:|",
        *(f"| {m} | {fmt(p['LINE'])} | {fmt(p['BRANCH'])} |" for m, p in rows),
    ])
    print(report)
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf-8") as f:
            f.write(report + "\n")

    failures = [f"전체 {k} {totals[k]:.1f}% < 하한 {TOTAL_FLOORS[k]:g}%" for k in KINDS if totals[k] < TOTAL_FLOORS[k]]
    failures += [
        f"{m} {k} {p[k]:.1f}% < 모듈 바닥 {MODULE_FLOORS[k]:g}%"
        for m, p in sorted(module_pct.items()) for k in KINDS
        if p[k] is not None and p[k] < MODULE_FLOORS[k]
    ]
    for line in failures:
        print(line, file=sys.stderr)
    for k in KINDS:
        if totals[k] >= TOTAL_FLOORS[k] + 1:
            print(f"\n{k} 하한선을 {int(totals[k])}% 로 올릴 수 있다(TOTAL_FLOORS).")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
