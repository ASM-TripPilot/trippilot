"""수집 커서 상태 — 매일 1페이지부터 재시작하는 낭비 제거 (TRIP-348).

일일 수집이 실행 간 상태를 남긴다: 지역·contentType별 커서(다음 시작 페이지,
완주 여부) + 기제안 색인(contentid → modifiedtime). 다음 실행은 커서 지점부터
재개하고, 색인에 있으며 modifiedtime이 같은 항목은 목록 단계에서 스킵한다
(상세 호출도 안 나감 — 쿼터 절약의 본체).

**파일 I/O는 스크립트 소관, 전송(브랜치 커밋·푸시)은 워크플로 소관** — 여기는
파싱·직렬화와 스크립트가 부르는 load 헬퍼만 둔다. 시각은 인자로 받는다
(wall-clock 직접 호출 금지 관례 — CLI 스크립트가 datetime.now로 넘긴다).

파싱은 전부-아니면-전무: 일부라도 손상이면 상태 전체를 버리고 처음부터
(안티패턴 로그 — 쓰기 경로 입력의 관용 파싱 금지). 상태 유실의 대가는
중복 확인 낭비뿐이다 — 게이트·백엔드 정본이 중복 등록을 막는다.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

STATE_VERSION = 1


@dataclass(frozen=True, slots=True)
class KindCursor:
    """(지역, contentType) 하나의 순회 위치."""

    next_page: int = 1       # 다음 실행이 시작할 pageNo
    completed: bool = False  # 페이지 소진 완주 여부 — 완주면 처음부터 재순회(색인 스킵으로 싸게)


@dataclass(frozen=True, slots=True)
class CollectState:
    """실행 간 이어지는 수집 상태 (불변 — 파이프라인은 새 상태를 만들어 반환)."""

    cursors: Mapping[tuple[str, str], KindCursor] = field(default_factory=dict)
    proposed: Mapping[str, str] = field(default_factory=dict)  # contentid → modifiedtime
    # 다지역 라운드로빈 포인터 — 다음 실행이 시작할 지역 코드 (TRIP-246 후속).
    # None(구버전 상태 포함) 또는 현재 목록에 없는 코드면 목록 처음부터.
    next_area: str | None = None


def empty_state() -> CollectState:
    return CollectState()


def parse_state(text: str) -> CollectState:
    """상태 JSON 파싱 — 전부-아니면-전무. 손상·버전 불일치는 ValueError."""
    doc = json.loads(text)
    if not isinstance(doc, dict):
        raise ValueError("상태 문서가 JSON 객체가 아님")
    if doc.get("schema_version") != STATE_VERSION:
        raise ValueError(f"상태 schema_version 불일치: {doc.get('schema_version')!r}")
    cursors: dict[tuple[str, str], KindCursor] = {}
    raw_cursors = doc.get("cursors", {})
    if not isinstance(raw_cursors, dict):
        raise ValueError("cursors가 객체가 아님")
    for area, by_kind in raw_cursors.items():
        if not isinstance(area, str) or not isinstance(by_kind, dict):
            raise ValueError(f"cursors[{area!r}] 형식 오류")
        for kind, cur in by_kind.items():
            if not isinstance(kind, str) or not isinstance(cur, dict):
                raise ValueError(f"cursors[{area!r}][{kind!r}] 형식 오류")
            next_page = cur.get("next_page")
            completed = cur.get("completed")
            if not isinstance(next_page, int) or isinstance(next_page, bool) \
                    or next_page < 1 or not isinstance(completed, bool):
                raise ValueError(f"커서 값 오류: {area}/{kind} → {cur!r}")
            cursors[(area, kind)] = KindCursor(next_page=next_page, completed=completed)
    raw_proposed = doc.get("proposed", {})
    if not isinstance(raw_proposed, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in raw_proposed.items()
    ):
        raise ValueError("proposed 색인 형식 오류")
    next_area = doc.get("next_area")  # 구버전 상태에는 없음 — None 허용 (하위호환)
    if next_area is not None and not isinstance(next_area, str):
        raise ValueError(f"next_area 형식 오류: {next_area!r}")
    return CollectState(cursors=cursors, proposed=dict(raw_proposed),
                        next_area=next_area)


def state_to_dict(state: CollectState, *, last_run: Mapping[str, object]) -> dict:
    """직렬화 (json.dumps 가능). last_run 메타(시각 포함)는 호출자가 넘긴다."""
    nested: dict[str, dict[str, dict]] = {}
    for (area, kind), cur in sorted(state.cursors.items()):
        nested.setdefault(area, {})[kind] = {
            "next_page": cur.next_page,
            "completed": cur.completed,
        }
    return {
        "schema_version": STATE_VERSION,
        "cursors": nested,
        "proposed": dict(sorted(state.proposed.items())),
        "next_area": state.next_area,
        "last_run": dict(last_run),
    }


def load_state(path: Path) -> CollectState:
    """스크립트용 로드 — 없거나 손상이면 빈 상태 + WARNING (우아한 강등, 침묵 금지)."""
    if not path.is_file():
        logger.warning("상태 파일 없음(%s) — 처음부터 수집", path)
        return empty_state()
    try:
        return parse_state(path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as e:
        logger.warning("상태 파일 손상(%s) — 무시하고 처음부터 수집: %s", path, e)
        return empty_state()
