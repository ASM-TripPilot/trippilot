"""커버리지 하한선 게이트 — `:app:testCodeCoverageReport` 의 합산 XML 을 읽어 판정한다.

    ./gradlew :app:coverageGate        # 리포트를 만든 직후, 그 리포트 경로를 넘겨 이 스크립트를 부른다

경로 인자는 **필수**다 — 기본 경로를 두면 옛 빌드가 남긴 XML 로 조용히 판정할 수 있다(지금 코드가 하한
아래인데 통과로 보인다). 경로는 Gradle 이 리포트 태스크의 실제 출력 위치에서 넘긴다.

- 전체 라인·분기가 TOTAL_FLOORS 아래거나, 어느 모듈이든 MODULE_FLOORS 아래면 exit 1(머지 차단).
- Gradle 모듈별 표와 실패 사유를 stdout 에, CI 면 `$GITHUB_STEP_SUMMARY` 에도 쓴다. 모듈은 패키지·소스 파일이
  아니라 **그 클래스 파일을 컴파일한 모듈**(`<모듈>/build/classes/<언어>/main/...class`)로 정한다. 리포트가
  클래스 단위로 수치를 주므로 이것이 정확하다 — 인라인 함수가 만든 클래스, `package` 선언이 폴더와 다른 파일,
  생성 소스도 실제로 컴파일된 모듈에 붙는다. 소유를 못 찾거나 두 모듈에 같은 클래스가 있으면 실패한다.
- 판정을 못 하는 경우(리포트 경로 없음·파일 없음·깨진 XML)는 exit 2 — 하한 아래(exit 1)와 구별되게 —
  이고 요약·주석에 사유를 남긴다.

하한선은 **래칫**이다 — 오르면 상수를 올리는 PR 을 내고, 내리지 않는다. 처음부터 목표치(80% 같은)를
걸면 첫날부터 빨갛거나 아무도 못 지키는 숫자가 되어 결국 게이트를 끄게 된다. 측정한 기준선에서 시작한다.

`COVERAGE_ADVISORY=1` 이면 막지 않는다 — 하한 아래·판정 못 함 모두 exit 0(develop push·릴리스 PR 용 — 켜는 조건은
backend-ci.yml. 막으면 이미 머지된 코드의 이미지 발행·운영 승격이 멈춘다). GitHub Actions 안에서는 실패 사유를 커밋 체크 주석으로도 낸다 —
막는 모드는 `::error::`, advisory 는 `::warning::`.

Gradle 내장 `JacocoCoverageVerification` 을 쓰지 않은 이유: 모듈마다 검증 태스크를 등록하면 모듈별 바닥도
표현은 된다. 다만 판정이 모듈 수만큼 흩어지고, 전체·모듈 실패 사유와 표를 잡 요약 한 곳에 모으려면 어차피
요약 스크립트가 필요하다. 그래서 판정과 요약을 한 스크립트에 두고, 모듈 소유는 컴파일된 클래스 파일에서 읽는다.

검사: `python3 -m unittest scripts/test_coverage_gate.py`
"""

import math
import os
import pathlib
import re
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

BACKEND = pathlib.Path(__file__).resolve().parent.parent

# 합산 리포트에 안 들어가도 되는 모듈 — app 이 testImplementation 으로만 쓰는 테스트 하네스다.
NOT_AGGREGATED = {"common/test-support"}

# 소유를 못 찾은 클래스는 이만큼만 이름을 보이고 나머지는 개수로 — 넓게 깨지면 수백 줄이 되어 원인이 묻힌다.
UNOWNED_SHOWN = 5


def counter(element, kind):
    for c in element.findall("counter"):
        if c.get("type") == kind:
            return int(c.get("covered")), int(c.get("missed"))
    return 0, 0


def pct(covered, missed):
    """측정 대상이 없으면(분기 없는 모듈 등) None — 0% 로 보이면 가장 나쁜 모듈처럼 맨 위에 온다."""
    total = covered + missed
    return 100.0 * covered / total if total else None


def down(value, digits):
    """표시는 반올림이 아니라 **버림** — 판정은 원값이라, 반올림하면 93.96% 가 "94.0% ❌ (하한 94%)" 로 보인다."""
    scale = 10 ** digits
    return f"{math.floor(value * scale) / scale:.{digits}f}"


def fmt(value, floor):
    if value is None:
        return "n/a"
    return f"{down(value, 1)}%" + (" ❌" if value < floor else "")


def settings_modules(backend=BACKEND):
    """settings.gradle.kts 가 include 한 모듈 디렉터리(`modules/trip` 등) — 빌드가 실제로 아는 모듈."""
    text = (backend / "settings.gradle.kts").read_text(encoding="utf-8")
    # include(":a") 와 include(":a", ":b") 모두. 주석 처리된 줄은 뺀다.
    calls = re.findall(r'^\s*include\s*\(([^)]*)\)', text, re.M)
    return {m.lstrip(":").replace(":", "/") for call in calls for m in re.findall(r'"([^"]+)"', call)}


def class_owners(backend=BACKEND, modules=None):
    """클래스(`com/trippilot/.../X`, 내부 클래스 포함) → 그 클래스 파일을 컴파일한 Gradle 모듈들.

    settings 에 있는 모듈의 build 만 본다 — 모듈을 옮기거나 지운 뒤 남은 옛 build 폴더(gitignore 라 남는다)를
    세면 이관된 클래스가 "두 모듈에 있다"로 거짓 실패한다.
    """
    modules = settings_modules(backend) if modules is None else modules
    owners = defaultdict(set)
    for module in modules:
        for classes in (backend / module / "build" / "classes").glob("*/main"):
            for f in classes.rglob("*.class"):
                owners[f.relative_to(classes).with_suffix("").as_posix()].add(module)
    return owners


def evaluate(root, owners, expected=None):
    """(전체 비율, 모듈별 비율, 실패 사유 목록). 전체 비율이 None 이면 측정 대상이 없는 것이다.

    expected: 리포트에 있어야 할 모듈들(settings 의 모듈 − NOT_AGGREGATED). 주면 빠진 모듈도 실패로 낸다 —
    app 이 implementation(project) 로 잇지 않은 모듈은 합산에서 조용히 빠져 모듈 바닥을 안 받는다.
    """
    sums = defaultdict(lambda: {k: [0, 0] for k in KINDS})
    for cls in root.iter("class"):
        found = owners.get(cls.get("name"), set())
        # 못 찾았거나 두 모듈이 가지면 판정할 수 없다 — 조용히 어느 모듈에 붙이면 그 모듈 수치가 엉뚱해진다.
        module = next(iter(found)) if len(found) == 1 else f"?{cls.get('name')}"
        for kind in KINDS:
            covered, missed = counter(cls, kind)
            sums[module][kind][0] += covered
            sums[module][kind][1] += missed

    totals = {k: pct(*counter(root, k)) for k in KINDS}
    modules = {m: {k: pct(*c[k]) for k in KINDS} for m, c in sums.items()}
    # 측정 대상이 없는 것을 0% 로 바꾸면 "커버리지 하락"으로 보고된다 — 원인(합산 대상·계측 범위)이 따로 있다.
    # 실패 사유의 수치는 소수 둘째 자리까지 — 판정은 원값이라 .1f 면 "94.0% < 하한 94%" 처럼 자기모순으로 보인다.
    failures = [f"전체 {k} 측정 대상이 없다(합산 대상·계측 범위 설정을 본다)" for k in KINDS if totals[k] is None]
    failures += [f"전체 {k} {down(totals[k], 2)}% < 하한 {TOTAL_FLOORS[k]:g}%" for k in KINDS
                 if totals[k] is not None and totals[k] < TOTAL_FLOORS[k]]
    unowned = sorted(m[1:] for m in modules if m.startswith("?"))
    if unowned:
        shown = ", ".join(unowned[:UNOWNED_SHOWN]) + (f" 외 {len(unowned) - UNOWNED_SHOWN}개" if len(unowned) > UNOWNED_SHOWN else "")
        failures.append(f"클래스 {len(unowned)}개의 소유 모듈을 하나로 정할 수 없다"
                        f"(settings 모듈의 build/classes 에 없거나 두 모듈에 있다): {shown}")
    if expected is not None:
        missing = sorted(set(expected) - set(modules))
        failures += [f"{m}: 합산 리포트에 없다(app 이 implementation(project) 로 잇는지, 실행 코드가 있는지 본다 — "
                     "JaCoCo 는 실행 코드 없는 클래스(인터페이스만 등)를 리포트에 넣지 않는다)" for m in missing]
    failures += [
        f"{m} {k} {down(p[k], 2)}% < 모듈 바닥 {MODULE_FLOORS[k]:g}%"
        for m, p in sorted(modules.items()) for k in KINDS
        if not m.startswith("?") and p[k] is not None and p[k] < MODULE_FLOORS[k]
    ]
    return totals, modules, failures


def margin(p):
    """바닥 대비 가장 작은 여유 — 라인만 어긴 모듈도 분기만 어긴 모듈도 맨 위에 오게 정렬한다."""
    gaps = [p[k] - MODULE_FLOORS[k] for k in KINDS if p[k] is not None]
    return min(gaps) if gaps else float("inf")


def render(totals, modules, failures):
    # 소유를 못 찾은 '?' 항목은 실패 목록에만 둔다 — 표에 넣으면 모듈 바닥 위반(❌)처럼 읽힌다.
    rows = sorted(((m, p) for m, p in modules.items() if not m.startswith("?")), key=lambda kv: margin(kv[1]))
    lines = [
        "### 백엔드 커버리지 — " + " · ".join(f"{k} {fmt(totals[k], TOTAL_FLOORS[k])} (하한 {TOTAL_FLOORS[k]:g}%)" for k in KINDS),
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


def write_summary(text):
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf-8") as f:
            f.write(text + "\n")


def annotate(failures, advisory):
    """GitHub Actions 안에서만 실패 사유를 커밋 체크 주석으로 낸다(로컬에서는 잡음)."""
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return
    level, title = ("warning", "커버리지 게이트(막지 않음)") if advisory else ("error", "커버리지 게이트")
    for f in failures:
        print(f"::{level} title={title}::{f}")


def undecidable(reason, advisory):
    """판정 자체를 못 하는 경우 — 하한 아래(exit 1)와 구별되게 exit 2, 요약·주석에 사유를 남긴다."""
    print(reason, file=sys.stderr)
    write_summary(f"### 백엔드 커버리지 — 판정 못 함\n\n**실패:**\n- {reason}")
    annotate([reason], advisory)
    return 0 if advisory else 2


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    advisory = os.environ.get("COVERAGE_ADVISORY") == "1"
    if len(argv) != 1:
        return undecidable("리포트 경로가 필요하다 — `./gradlew :app:coverageGate` 로 부른다(리포트를 만들고 그 경로를 넘긴다).",
                           advisory)
    path = argv[0]
    if not os.path.exists(path):
        # coverageGate 는 옛 XML 을 지우고 리포트를 다시 만든다. 그래도 없으면 실행 데이터가 없어 리포트가 생략된 것이다.
        return undecidable(f"리포트가 없다: {path} — 테스트 실행 데이터(.exec)가 없어 리포트가 생략됐을 수 있다. "
                           "`./gradlew build :app:coverageGate` 로 테스트부터 돌린다.", advisory)
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as e:
        return undecidable(f"리포트를 읽지 못했다: {path} — {e}", advisory)

    # BACKEND 를 호출 시점에 넘긴다 — 기본 인자는 정의 시점에 묶여 테스트가 임시 트리로 바꿔도 실제 리포를 읽었다.
    expected = settings_modules(BACKEND) - NOT_AGGREGATED
    totals, modules, failures = evaluate(root, class_owners(BACKEND, modules=expected), expected)
    report = render(totals, modules, failures)
    print(report)
    write_summary(report)
    for k in KINDS:
        if totals[k] is not None and totals[k] >= TOTAL_FLOORS[k] + 2:
            print(f"\n{k} 하한선을 {int(totals[k]) - 1}% 로 올릴 수 있다(TOTAL_FLOORS — 버림에서 1p 여유).")
    annotate(failures, advisory)
    if advisory:
        return 0
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
