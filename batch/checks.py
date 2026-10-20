"""수집 산출물 검증 — 게시 **전에** 돈다. 실패 사유가 하나라도 있으면 게시하지 않는다.

Airflow 에 의존하지 않는다(DAG 는 이 함수들을 부르기만 한다) — 그래서 Airflow 없이 단위 테스트로 지킨다.

막으려는 실제 사고 두 건:
- 2026-10-20 #1427: 수집 공유본 병합에 시도명이 잘린 주소 2건(`부산광역 …`, `제주특별자치 …`)이 섞여 백엔드
  적재 테스트(지역 미판정 0건)가 develop 에서 깨졌다 → check_pois 의 지역 판정.
- 2026-10-10 cce8c508: 배포가 8월에 커밋된 행사 사본을 구워, 그날 유효한 행사가 346건이 아니라 10건이었다
  → check_events 의 "그날 유효 건수".
"""

from __future__ import annotations

import ast
import logging
import re
import unicodedata
from datetime import date, datetime
from pathlib import Path

from pipeline import REPO  # noqa: E402  (경로 정본은 pipeline 하나 — Airflow 에 의존하지 않는다)

REGION_SEED = REPO / "backend/app/src/main/resources/db/migration/R__seed_region_catalog.sql"
EVENT_COLLECTOR = REPO / "ai/scripts/collect/collect_events.py"
log = logging.getLogger(__name__)

# Kotlin `String.trim()` 이 자르는 문자 = Char.isWhitespace = Java Character.isWhitespace || isSpaceChar
# (Zs·Zl·Zp + 제어문자 \t \n \v \f \r \x1c-\x1f). Python str.strip() 은 여기에 없는 U+0085(NEL)까지 잘라
# 게이트가 백엔드보다 느슨해진다(jshell 실측: Kotlin 은 NEL 을 남긴다) — 그래서 잘라 낼 집합을 명시한다.
# JDK 25 의 Character.isWhitespace||isSpaceChar 와 BMP 전수(0~FFFF) 비교해 28자 그대로 같다(테스트가 목록을 고정한다).
KOTLIN_TRIM = "".join(c for c in map(chr, range(0x10000))
                      if unicodedata.category(c) in ("Zs", "Zl", "Zp") or c in "\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f")


def sido_names(seed: Path = REGION_SEED) -> set[str]:
    """시도 정식 이름 — 백엔드 지역 카탈로그 시드가 정본이다(여기에 목록을 따로 적으면 갈라진다)."""
    names = set(re.findall(r"\('\d+',\s*'([^']+)',\s*'\d+',\s*'[^']+',\s*'SIDO'", seed.read_text(encoding="utf-8")))
    if not names:
        raise ValueError(f"시도 목록을 읽지 못했다: {seed}")
    return names


def event_regions(script: Path = EVENT_COLLECTOR) -> tuple[str, ...]:
    """운영 행사 수집 지역 — 수집기의 `DEFAULT_REGIONS` 가 정본이다(여기에 목록을 따로 적으면 갈라진다).
    수집기를 import 하지 않는다(ai 패키지 의존성이 배치 환경에 없다) — 그 리터럴을 ast 로 읽는다."""
    for node in ast.parse(script.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "DEFAULT_REGIONS" for t in node.targets):
            return tuple(ast.literal_eval(node.value))
    raise ValueError(f"DEFAULT_REGIONS 를 읽지 못했다: {script}")


def backend_reads(address: str | None, sidos: set[str]) -> bool:
    """백엔드 RegionResolver 가 이 주소의 시도를 정할 수 있는가 — 첫 낱말이 시도 정식 이름과 **정확히** 같아야 한다.
    약칭·잘린 이름은 수집 병합 단계(ai `expand_sido_abbrev`)가 펴서 보내는 것이 정본 설계다 — 여기서 받아 주면
    펴지 못한 문서가 게이트를 지나 백엔드에서 깨진다(#1427 이 그 모양이었다). 양끝은 Kotlin trim() 과 같은 집합으로,
    가운데는 백엔드처럼 ASCII 공백으로만 자른다."""
    tokens = re.split(r"[ \t\n\r\f\v]+", (address or "").strip(KOTLIN_TRIM))
    return bool(tokens and tokens[0] in sidos)


def check_pois(doc: dict, sidos: set[str], min_count: int) -> list[str]:
    """POI 등록 제안 문서. 반환 = 실패 사유(빈 목록이면 게시해도 된다)."""
    proposals = doc.get("proposals")
    if not isinstance(proposals, list):
        return ["proposals 목록이 없다 — 문서 모양이 바뀌었다"]
    failures = []
    if len(proposals) < min_count:
        failures.append(f"제안 {len(proposals):,}건 < 하한 {min_count:,}건 — 문서가 (거의) 비었다. 하한은 통째로 빈 문서만 잡는다(부분 잘림은 못 잡는다)")
    unresolved = [p for p in proposals if not backend_reads((p.get("provenance") or {}).get("address"), sidos)]
    if unresolved:
        samples = ", ".join(f"{(p.get('poi') or {}).get('name')}({(p.get('provenance') or {}).get('address')})"
                            for p in unresolved[:3])
        failures.append(f"시도를 정할 수 없는 주소 {len(unresolved)}건 — 백엔드가 이 주소로는 시도를 못 읽는다: {samples}")
    nameless = sum(1 for p in proposals if not (p.get("poi") or {}).get("name"))
    if nameless:
        failures.append(f"이름 없는 제안 {nameless}건")
    return failures


def valid_on(event: dict, day: date) -> bool:
    try:
        return date.fromisoformat(event["start"]) <= day <= date.fromisoformat(event["end"])
    except (KeyError, TypeError, ValueError):
        return False


def oldest_collected(doc: dict, regions: tuple[str, ...]) -> date | None:
    """**운영 수집 지역**(`regions`) 중 가장 오래 수집되지 않은 지역의 마지막 수집 날짜 — `coverage`(지역 → 마지막 수집 시각)
    에서 가장 이른 것. 가장 늦은 것(max)을 보면 전체가 멈춰도 한 지역만 돌면 계속 통과한다 — 허용 날수(event_collect 의
    `max_age_days`)는 가장 오래된 지역에 건다. 운영 지역이 아닌 키는 보지 않는다: 저장소는 키를 지우지 않고 수동 실행의
    지역 입력은 자유 텍스트라, 한 번 들어간 다른 이름(예 "서울특별시")은 다시 찍히지 않아 영영 막는다.
    운영 지역 하나라도 없거나 시각을 읽을 수 없으면 None — 그 지역이 언제 수집됐는지 모르면 신선하다고 볼 수 없다."""
    coverage = doc.get("coverage")
    if not isinstance(coverage, dict):
        return None
    try:
        return min(datetime.fromisoformat(coverage[r]).date() for r in regions)   # 시각의 오프셋(+09:00) 기준 날짜
    except (KeyError, TypeError, ValueError):
        return None


def check_events(doc: dict, day: date, min_valid: int, max_age_days: int, regions: tuple[str, ...]) -> list[str]:
    """행사 저장소. 두 가지를 본다.
    - **그날 유효한 건수** — 낡은 사본도 전체 건수는 멀쩡하다(cce8c508).
    - **가장 오래된 운영 지역의 마지막 수집 뒤 지난 날수** — 수집이 멈춰도 사본에 미래 행사가 남아 있으면 유효 건수는 몇 주
      동안 하한 위에 머문다(실측: 2026-10-19 사본은 12-07 에야 하한 아래로 떨어진다). 그래서 수집 시각을 따로 본다.
    `regions` = 운영 수집 지역(`event_regions()`)."""
    events = doc.get("events")
    if not isinstance(events, list):
        return ["events 목록이 없다 — 문서 모양이 바뀌었다"]
    failures = []
    valid = sum(1 for e in events if valid_on(e, day))
    if valid < min_valid:
        failures.append(f"{day} 에 유효한 행사 {valid}건 < 하한 {min_valid}건 (전체 {len(events)}건) — 낡은 사본일 수 있다")
    coverage = doc.get("coverage") if isinstance(doc.get("coverage"), dict) else {}
    ignored = sorted(set(coverage) - set(regions))
    if ignored:
        log.warning("운영 수집 지역이 아닌 coverage 키 %d개는 신선도에서 뺀다: %s", len(ignored), ", ".join(ignored))
    missing = [r for r in regions if r not in coverage]
    oldest = oldest_collected(doc, regions)
    if missing:
        failures.append(f"coverage 에 운영 수집 지역 {len(missing)}곳이 없다({', '.join(missing)}) — 그 지역은 수집된 적이 없다")
    elif oldest is None:
        failures.append("coverage 에 지역별 마지막 수집 시각을 읽을 수 없다 — 언제 수집했는지 알 수 없다")
    elif (day - oldest).days > max_age_days:
        note = f" (운영 지역이 아닌 키 {', '.join(ignored)} 는 보지 않았다)" if ignored else ""
        failures.append(f"가장 오래된 지역의 마지막 수집 {oldest} — {day} 기준 {(day - oldest).days}일 전 > 허용 {max_age_days}일. "
                        "수집이 멈췄거나(사본이 낡았거나) 그 지역이 수집 때마다 폴백해 coverage 가 찍히지 않는다" + note)
    return failures
