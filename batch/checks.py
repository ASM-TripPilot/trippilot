"""수집 산출물 검증 — 게시 **전에** 돈다. 실패 사유가 하나라도 있으면 게시하지 않는다.

Airflow 에 의존하지 않는다(DAG 는 이 함수들을 부르기만 한다) — 그래서 Airflow 없이 단위 테스트로 지킨다.

막으려는 실제 사고 두 건:
- 2026-10-20 #1427: 수집 공유본 병합에 시도명이 잘린 주소 2건(`부산광역 …`, `제주특별자치 …`)이 섞여 백엔드
  적재 테스트(지역 미판정 0건)가 develop 에서 깨졌다 → check_pois 의 지역 판정.
- 2026-10-10 cce8c508: 배포가 8월에 커밋된 행사 사본을 구워, 그날 유효한 행사가 346건이 아니라 10건이었다
  → check_events 의 "그날 유효 건수"와 check_freshness.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REGION_SEED = REPO / "backend/app/src/main/resources/db/migration/R__seed_region_catalog.sql"


def sido_names(seed: Path = REGION_SEED) -> set[str]:
    """시도 정식 이름 — 백엔드 지역 카탈로그 시드가 정본이다(여기에 목록을 따로 적으면 갈라진다)."""
    names = set(re.findall(r"\('\d+',\s*'([^']+)',\s*'\d+',\s*'[^']+',\s*'SIDO'", seed.read_text(encoding="utf-8")))
    if not names:
        raise ValueError(f"시도 목록을 읽지 못했다: {seed}")
    return names


def backend_reads(address: str | None, sidos: set[str]) -> bool:
    """백엔드 RegionResolver 가 이 주소의 시도를 정할 수 있는가 — 첫 낱말이 시도 정식 이름과 **정확히** 같아야 한다.
    약칭·잘린 이름은 수집 병합 단계(ai `expand_sido_abbrev`)가 펴서 보내는 것이 정본 설계다 — 여기서 받아 주면
    펴지 못한 문서가 게이트를 지나 백엔드에서 깨진다(#1427 이 그 모양이었다). 백엔드처럼 ASCII 공백으로만 자른다."""
    tokens = re.split(r"[ \t\n\r\f\v]+", (address or "").strip())
    return bool(tokens and tokens[0] in sidos)


def check_pois(doc: dict, sidos: set[str], min_count: int) -> list[str]:
    """POI 등록 제안 문서. 반환 = 실패 사유(빈 목록이면 게시해도 된다)."""
    proposals = doc.get("proposals")
    if not isinstance(proposals, list):
        return ["proposals 목록이 없다 — 문서 모양이 바뀌었다"]
    failures = []
    if len(proposals) < min_count:
        failures.append(f"제안 {len(proposals):,}건 < 하한 {min_count:,}건 — 수집이 잘렸거나 키가 막혔다")
    unresolved = [p for p in proposals if not backend_reads((p.get("provenance") or {}).get("address"), sidos)]
    if unresolved:
        samples = ", ".join(f"{(p.get('poi') or {}).get('name')}({(p.get('provenance') or {}).get('address')})"
                            for p in unresolved[:3])
        failures.append(f"시도를 정할 수 없는 주소 {len(unresolved)}건 — 백엔드 적재에서 지역 미판정이 된다: {samples}")
    nameless = sum(1 for p in proposals if not (p.get("poi") or {}).get("name"))
    if nameless:
        failures.append(f"이름 없는 제안 {nameless}건")
    return failures


def valid_on(event: dict, day: date) -> bool:
    try:
        return date.fromisoformat(event["start"]) <= day <= date.fromisoformat(event["end"])
    except (KeyError, TypeError, ValueError):
        return False


def check_events(doc: dict, day: date, min_valid: int) -> list[str]:
    """행사 저장소. 건수가 아니라 **그날 유효한 건수**를 본다 — 낡은 사본도 전체 건수는 멀쩡하다."""
    events = doc.get("events")
    if not isinstance(events, list):
        return ["events 목록이 없다 — 문서 모양이 바뀌었다"]
    valid = sum(1 for e in events if valid_on(e, day))
    if valid < min_valid:
        return [f"{day} 에 유효한 행사 {valid}건 < 하한 {min_valid}건 (전체 {len(events)}건) — 낡은 사본일 수 있다"]
    return []


def last_collected(events_doc: dict) -> str | None:
    """행사 저장소의 마지막 수집 시각 — 지역별 마지막 수집(`coverage`)의 최댓값.
    행사별 `collected_at` 은 **새 행사가 들어올 때만** 찍혀, 매일 돌아도 신규가 없는 날이면 늙어 보인다(실측 간격 2일).
    문자열 최댓값이 아니라 시각으로 비교한다 — 오프셋이 섞이면 문자열 순서가 틀린다."""
    stamps = [v for v in (events_doc.get("coverage") or {}).values() if isinstance(v, str)]
    return max(stamps, key=datetime.fromisoformat, default=None)


def check_freshness(collected_at: str | None, now: datetime, max_age: timedelta) -> list[str]:
    """마지막으로 게시된 수집이 너무 오래됐는가 — 수집이 조용히 멈춘 것을 잡는다."""
    if not collected_at:
        return ["collected_at 이 없다 — 언제 수집했는지 알 수 없다"]
    age = now - datetime.fromisoformat(collected_at)
    if age > max_age:
        return [f"마지막 수집이 {age} 전({collected_at}) — 한도 {max_age} 를 넘었다"]
    return []
