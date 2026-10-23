"""RecommendationAgent — 추천의 고르기 판단 (2026-10-23 사용자 결정, assistant-orchestrator BR-AO-30·31).

```
RecommendTask(PLACES)  ─▶ 쓸 후보 고르기   반경 풀이 있으면 그것(요즘 인기 → 저장 수 → 별점, 탐색 순서 그대로)
                                          없을 때만 NL2SQL 행 — '요즘 인기' 먼저 다시 세운다(안정 정렬, 나머지는 SQL 순서)
                    ─▶ 개수              말한 개수(1~5), 없으면 3 — 자르기는 조립 뒤 카드·버튼과 함께(핸들러)
RecommendTask(REGIONS) ─▶ 근거 가중치      취향 두 축 + 말한 바람(`preference_weights`) — 비면 되묻기(ask_taste)
                    ─▶ 지역 고르기        성격표 × 가중치 상위 n 곳(`recommend_regions`) · 근거 이름(basis)
```

반경 풀을 먼저 쓰는 이유: NL2SQL 행의 인기 신호는 '요즘 인기' 태그 하나라 고르기 순서로 약하다(2026-10-20 테스트 화면 — "서울 카페
추천"이 가나다순·법인명 카페로 나왔다). 지역 표에 없는 동네처럼 반경 결과가 없을 때만 SQL 행으로 고른다.

`run()` 은 예외를 밖으로 던지지 않는다(DL-5) — 고르기가 예외로 끝나면(재료 모양 위반·성격표 손상 — 버그) `error` 에 사유를 싣는다.
"고를 것 없음"과 모양이 같으면 핸들러가 고르지 않은 SQL 순서 그대로 추천하거나 "취향에 맞는 지역 없음"으로 답해 보고가 사라졌다
(2026-10-23 리뷰 재현) — 핸들러가 `error` 를 턴 실패로 올려 오케스트레이터가 범위 밖 + 이벤트로 보고한다(INV-4, 고르기가 핸들러에
있던 때와 같은 갈래).
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass

from trippilot.domain.region_recommend import RegionPick, preference_weights, recommend_regions

log = logging.getLogger(__name__)

PLACES, REGIONS = "PLACES", "REGIONS"
DEFAULT_COUNT = 3
_COUNTS = {"1", "2", "3", "4", "5"}
_POPULAR = "요즘 인기"


@dataclass(frozen=True, slots=True)
class RecommendTask:
    """경계 → RecommendationAgent 재료 봉투.

    - `count`: 사용자가 말한 개수 인자 원문 — "1"~"5" 밖이면 기본 3
    - PLACES: `radius`·`sql` — 핸들러가 모은 후보 묶음(상태가 OK 인 것만, 아니면 빈 튜플). 항목 모양은 핸들러 몫이고 에이전트는
      `reason` 칸만 읽는다
    - REGIONS: `styles`·`activities` — 대화 문맥의 계정 취향 두 축, `theme` — 이번에 말한 바람(취향보다 무겁다)
    """

    kind: str
    count: str | None = None
    radius: tuple[Mapping, ...] = ()
    sql: tuple[Mapping, ...] = ()
    styles: tuple[str, ...] = ()
    activities: tuple[str, ...] = ()
    theme: str | None = None

    def __post_init__(self) -> None:
        if self.kind not in (PLACES, REGIONS):
            raise ValueError(f"kind 는 {PLACES}·{REGIONS} 중 하나: {self.kind!r}")
        if self.count is not None and not isinstance(self.count, str):  # 게이트가 인자를 문자열로만 넘긴다 — 그 밖은 버그
            raise ValueError(f"count 는 str 또는 None: {type(self.count).__name__}")


@dataclass(frozen=True, slots=True)
class RecommendOutcome:
    """`run()` 의 결과 — 무엇을 몇 곳 고를지.

    - `count`: 고를 개수(1~5)
    - PLACES: `source` — "radius"·"sql"·None(둘 다 비었다), `candidates` — 그 묶음을 고른 순서로(자르지 않는다)
    - REGIONS: `regions` — 고른 지역(많아야 count) · `basis` — 무엇을 기준으로 골랐는지 · `ask_taste` — 고를 근거가 없어 되묻는다
    - `error`: 고르기가 예외로 끝났다 — 그 타입 이름. 다른 칸은 비어 있다(호출측이 턴 실패로 보고한다)
    """

    count: int = DEFAULT_COUNT
    source: str | None = None
    candidates: tuple[Mapping, ...] = ()
    regions: tuple[RegionPick, ...] = ()
    basis: str | None = None
    ask_taste: bool = False
    error: str | None = None

    def __post_init__(self) -> None:
        if not 1 <= self.count <= 5:
            raise ValueError(f"count 는 1..5: {self.count}")
        if self.source not in (None, "radius", "sql"):
            raise ValueError(f"source 는 radius·sql·None: {self.source!r}")
        if self.ask_taste and self.regions:
            raise ValueError("되묻는데 고른 지역이 있을 수 없다")
        if self.error is not None and (self.source or self.candidates or self.regions or self.basis or self.ask_taste):
            raise ValueError("실패한 고르기는 고른 것이 없다")


class RecommendationAgent:
    """생성자 인자 없음 — 재료는 전부 과제로 온다(LLM·저장소 0). 지역 성격표는 `domain.region_recommend` 가 한 번 읽어 둔다."""

    def run(self, task: RecommendTask) -> RecommendOutcome:
        """고르기 판단. 예외를 던지지 않는다 — 실패는 `error` 에 사유를 실은 결과 + WARN(DL-5, 보고는 호출측)."""
        try:
            count = int(task.count) if task.count in _COUNTS else DEFAULT_COUNT
            return self._places(task, count) if task.kind == PLACES else self._regions(task, count)
        except Exception as e:  # noqa: BLE001 — 재료 모양 위반·성격표 손상(버그). 호출측이 턴 실패로 올려 보고한다
            log.warning("recommendation run_failed kind=%s error=%s", task.kind, type(e).__name__)
            return RecommendOutcome(error=type(e).__name__)

    @staticmethod
    def _places(task: RecommendTask, count: int) -> RecommendOutcome:
        if task.radius:
            return RecommendOutcome(count=count, source="radius", candidates=tuple(task.radius))
        if task.sql:
            ranked = sorted(task.sql, key=lambda c: c.get("reason") != _POPULAR)  # 안정 정렬 — 나머지는 SQL 순서
            return RecommendOutcome(count=count, source="sql", candidates=tuple(ranked))
        return RecommendOutcome(count=count)

    @staticmethod
    def _regions(task: RecommendTask, count: int) -> RecommendOutcome:
        weights = preference_weights(task.styles, task.activities, task.theme)
        if not weights:  # 고를 근거가 없다 — 묻는다
            return RecommendOutcome(count=count, ask_taste=True)
        taste = bool(task.styles or task.activities)
        basis = "말한 바람과 취향" if task.theme and taste else ("말한 바람" if task.theme else "저장된 취향")
        return RecommendOutcome(count=count, regions=tuple(recommend_regions(weights, count)), basis=basis)
