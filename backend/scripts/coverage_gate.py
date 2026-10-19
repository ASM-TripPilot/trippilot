"""커버리지 하한선 게이트 — `:app:testCodeCoverageReport` 의 합산 XML 을 읽어 판정한다.

    ./gradlew :app:coverageGate        # 리포트를 만든 직후 이 스크립트를 부른다(옛 XML 로 판정하지 않게)

- 전체 라인·분기가 TOTAL_FLOORS 아래거나, 어느 모듈이든 MODULE_FLOORS 아래면 exit 1(머지 차단).
- 모듈(패키지 `com.trippilot.<모듈>`)별 표와 실패 사유를 stdout 에, CI 면 `$GITHUB_STEP_SUMMARY` 에도 쓴다.

하한선은 **래칫**이다 — 오르면 상수를 올리는 PR 을 내고, 내리지 않는다. 처음부터 목표치(80% 같은)를
걸면 첫날부터 빨갛거나 아무도 못 지키는 숫자가 되어 결국 게이트를 끄게 된다. 측정한 기준선에서 시작한다.

Gradle 내장 `JacocoCoverageVerification` 을 안 쓰는 이유: 합산 리포트에서 규칙을 걸 수 있는 단위가
번들·패키지·클래스뿐이라 **모듈**(하위 패키지 여럿의 합)별 바닥을 표현할 수 없다.

검사: `python3 -m unittest scripts/test_coverage_gate.py`
"""

import os
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

KINDS = ("LINE", "BRANCH")

# 기준선(2026-10-19 develop 실측: 라인 95.4% · 분기 84.8%)에서 소수점을 버리고 1p 더 내렸다. 올릴 때만 고친다.
# 1p 여유의 이유: 버림값(95·84)이면 남는 여유가 미커버 약 70줄·70분기다. 각자 통과한 PR 둘이 합쳐 넘으면
# 그 뒤의 **무관한** PR 이 전부 빨개진다 — 래칫이 막으려는 것은 크게 떨어지는 것이지 한 줄 한 줄이 아니다.
# PBT 무작위 입력에 따른 실행 간 차이는 쟀더니 분기 8,084개 중 1개(0.01p)라 여유 산정에 넣지 않았다.
# 분기를 같이 거는 이유 — 라인은 이미 높아 거의 안 움직인다. 빠진 `else`·예외 경로는 분기에서 보인다.
TOTAL_FLOORS = {"LINE": 94.0, "BRANCH": 83.0}

# 모듈 바닥 — 전체 평균은 작은 새 모듈을 덮는다(분기 30개짜리 모듈이 0% 여도 전체는 0.3p 떨어질 뿐이다).
# 목표가 아니라 "테스트가 사실상 없다"를 잡는 바닥이라 현재 최저(라인 moderation 82.9% · 분기 change-log
# 51.9%)보다 넉넉히 아래로 잡았다 — 최저 모듈의 평범한 수정(널 안전 연산자 몇 개)으로는 안 걸리게.
MODULE_FLOORS = {"LINE": 70.0, "BRANCH": 40.0}

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


def fmt(value, floor):
    if value is None:
        return "n/a"
    return f"{value:.1f}%" + (" ❌" if value < floor else "")


def module_of(package_name):
    parts = package_name.split("/")
    return parts[2] if len(parts) > 2 and parts[:2] == ["com", "trippilot"] else package_name


def evaluate(root):
    """(전체 비율, 모듈별 비율, 실패 사유 목록)."""
    sums = defaultdict(lambda: {k: [0, 0] for k in KINDS})
    for package in root.iter("package"):
        for kind in KINDS:
            covered, missed = counter(package, kind)
            sums[module_of(package.get("name"))][kind][0] += covered
            sums[module_of(package.get("name"))][kind][1] += missed

    totals = {k: pct(*counter(root, k)) or 0.0 for k in KINDS}
    modules = {m: {k: pct(*c[k]) for k in KINDS} for m, c in sums.items()}
    failures = [f"전체 {k} {totals[k]:.1f}% < 하한 {TOTAL_FLOORS[k]:g}%" for k in KINDS if totals[k] < TOTAL_FLOORS[k]]
    failures += [
        f"{m} {k} {p[k]:.1f}% < 모듈 바닥 {MODULE_FLOORS[k]:g}%"
        for m, p in sorted(modules.items()) for k in KINDS
        if p[k] is not None and p[k] < MODULE_FLOORS[k]
    ]
    return totals, modules, failures


def render(totals, modules, failures):
    rows = sorted(modules.items(), key=lambda kv: (kv[1]["BRANCH"] is None, kv[1]["BRANCH"] or 0.0))
    lines = [
        "### 백엔드 커버리지 — " + " · ".join(f"{k} {totals[k]:.1f}% (하한 {TOTAL_FLOORS[k]:g}%)" for k in KINDS),
        "모듈 바닥: " + " · ".join(f"{k} {MODULE_FLOORS[k]:g}%" for k in KINDS),
        "",
    ]
    if failures:
        lines += ["**실패:**", *(f"- {f}" for f in failures), ""]
    lines += [
        "| 모듈 | 라인 | 분기 |",
        "|---|---:|---:|",
        *(f"| {m} | {fmt(p['LINE'], MODULE_FLOORS['LINE'])} | {fmt(p['BRANCH'], MODULE_FLOORS['BRANCH'])} |" for m, p in rows),
    ]
    return "\n".join(lines)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XML
    if not os.path.exists(path):
        print(f"리포트가 없다: {path}\n`./gradlew :app:coverageGate` 로 부른다(리포트를 먼저 만든다).", file=sys.stderr)
        return 2

    totals, modules, failures = evaluate(ET.parse(path).getroot())
    report = render(totals, modules, failures)
    print(report)
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf-8") as f:
            f.write(report + "\n")
    for k in KINDS:
        if totals[k] >= TOTAL_FLOORS[k] + 2:
            print(f"\n{k} 하한선을 {int(totals[k]) - 1}% 로 올릴 수 있다(TOTAL_FLOORS — 버림에서 1p 여유).")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
