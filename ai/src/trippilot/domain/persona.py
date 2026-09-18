"""PreferenceScoring 입력 컨텍스트 (U4 FD domain-entities §2, 프롬프트 정본 §2.1).

KB-2 페르소나 전체가 아니라 점수 산정에 필요한 최소 요약만 (G181 — 필드 최소화).
7축 택소노미는 프롬프트 정본 §2.1을 채택 (미결 #3 해소) — 온보딩 설계 변경 시 이 enum만 개정.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from enum import Enum

from trippilot.domain.common import BudgetLevel


class TasteTag(Enum):
    """취향 7축 (자연/도시/음식/문화/쇼핑/액티비티/휴식)."""

    NATURE = "NATURE"
    CITY = "CITY"
    FOOD = "FOOD"
    CULTURE = "CULTURE"
    SHOPPING = "SHOPPING"
    ACTIVITY = "ACTIVITY"
    REST = "REST"


class CompanionType(Enum):
    """동행 — 백엔드 5종을 접지 않고 받되, 조합이 뜻을 만들면 우리 값으로 승격한다.

    백엔드 `preference_set.companion_types` 는 **다중 선택**(혼자·커플·친구·가족·부모님)이고
    우리는 단일 값을 쓴다. 겹칠 때 하나로 접는 규칙이 곧 "이 사용자를 어떤 여행자로 볼
    것인가"라 값을 줄이는 쪽으로 풀지 않았다 — `부모님` 은 제 자리를 갖고,
    `부모님+가족` 은 둘 중 하나를 버리는 대신 `MULTIGEN` 으로 올라간다.
    """

    SOLO = "SOLO"
    COUPLE = "COUPLE"
    FAMILY = "FAMILY"
    FRIENDS = "FRIENDS"
    PARENTS = "PARENTS"      # 부모님 — 보행 속도·휴식 간격이 다른 동행
    MULTIGEN = "MULTIGEN"    # 부모님+가족 = 3세대 — 양쪽 제약이 동시에 걸린다


@dataclass(frozen=True, slots=True)
class PersonaSummary:
    """취향 요약 — 프롬프트에 실리는 최소 필드(G181).

    `companion` 이 `None` 인 것은 **"혼자"가 아니라 "미설정"** 이다. 백엔드가
    미설정 축에 중립 기본값을 주입하지 않고 빈 목록을 그대로 내기 때문에
    (`PersonaInternalController` — "소프트 가중치·중립 처리는 AI 지능이 소유한다"),
    여기서 SOLO 로 채우면 선택하지 않은 사람을 혼자 여행자로 단정하게 된다.
    프롬프트는 `taste_tags` 빈 경우와 같이 "미설정"으로 적는다.
    """

    taste_tags: tuple[TasteTag, ...]
    companion: CompanionType | None
    budget: BudgetLevel

    def to_dict(self) -> dict:
        return {
            "taste_tags": [t.value for t in self.taste_tags],
            "companion": self.companion.value if self.companion else None,
            "budget": self.budget.value,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PersonaSummary":
        return cls(
            taste_tags=tuple(TasteTag(t) for t in d["taste_tags"]),
            companion=(CompanionType(d["companion"])
                       if d["companion"] is not None else None),
            budget=BudgetLevel(d["budget"]),
        )


# ─────────────────────────────────────────────────────────────────────────────
# 백엔드 온보딩 어휘 → 도메인 값 (TRIP-434)
#
# 백엔드는 **자기 어휘를 그대로 낸다**(`휴양`·`혼자`·`저가`) — 접기 판단을 AI 가
# 소유하기 위해서다(`PersonaInternalController` 주석). 그 접기 규칙이 여기 있다.
# 정본은 백엔드 `PreferenceSet` 의 허용값 집합(DB CHECK 와 일치, INV-PR2)이다.
# ─────────────────────────────────────────────────────────────────────────────

# 취향 7축 ← 백엔드 `styles` 7종. **1:1 대응이라 판단이 끼지 않는다.**
#
# `activities`(8종)·`food_tastes`(5종)는 **일부러 안 싣는다** — 7축을 이미 styles 가
# 덮고 있어 같은 신호가 두 번 들어갈 뿐이고(예: 맛집투어 → FOOD 는 미식과 중복),
# 프롬프트 입력은 최소화가 규칙이다(G181). 더 잘게 쓸 일이 생기면 그때 별도 축으로
# 올린다 — 7축에 욱여넣지 않는다.
TASTE_TOKENS: dict[str, TasteTag] = {
    "휴양": TasteTag.REST,
    "관광": TasteTag.CITY,
    "액티비티": TasteTag.ACTIVITY,
    "미식": TasteTag.FOOD,
    "쇼핑": TasteTag.SHOPPING,
    "자연": TasteTag.NATURE,
    "문화예술": TasteTag.CULTURE,
}

COMPANION_TOKENS: dict[str, CompanionType] = {
    "혼자": CompanionType.SOLO,
    "커플": CompanionType.COUPLE,
    "친구": CompanionType.FRIENDS,
    "가족": CompanionType.FAMILY,
    "부모님": CompanionType.PARENTS,
}

# 조합 승격 — 둘 중 하나를 버리는 대신 우리 값을 만든다.
_COMPANION_COMBINATIONS: dict[frozenset[CompanionType], CompanionType] = {
    frozenset({CompanionType.PARENTS, CompanionType.FAMILY}): CompanionType.MULTIGEN,
}

# 승격 규칙이 없는 조합에서 남길 값의 순서 — **제약이 큰 쪽을 남긴다.**
# 여유 있는 동행에게 느긋한 일정은 불편이지만, 제약 있는 동행에게 빠른 일정은
# 아예 못 가는 일정이다. 틀리는 방향을 고를 수 있으면 덜 다치는 쪽으로 튼다.
_COMPANION_PRIORITY: tuple[CompanionType, ...] = (
    CompanionType.MULTIGEN,
    CompanionType.PARENTS,
    CompanionType.FAMILY,
    CompanionType.COUPLE,
    CompanionType.FRIENDS,
    CompanionType.SOLO,
)


def taste_tags_from(styles: Iterable[str]) -> tuple[TasteTag, ...]:
    """백엔드 `styles` → 7축. 모르는 값은 건너뛴다(축이 늘어도 조회가 죽지 않는다).

    입력 순서와 무관하게 **enum 정의 순서**로 돌려준다 — 프롬프트 문자열이 흔들리면
    같은 사용자가 요청마다 다른 캐시 키를 만든다(`preference_cache`).
    """
    found = {TASTE_TOKENS[s.strip()] for s in styles if s.strip() in TASTE_TOKENS}
    return tuple(t for t in TasteTag if t in found)


def companion_from(labels: Iterable[str]) -> CompanionType | None:
    """백엔드 `companion_types`(다중) → 단일 동행. 빈 목록·전부 미인식이면 None.

    None 은 **"혼자"가 아니라 "미설정"** 이다 — 선택하지 않은 사람을 혼자 여행자로
    단정하지 않는다(`PersonaSummary` 주석).
    """
    picked = {COMPANION_TOKENS[x.strip()] for x in labels if x.strip() in COMPANION_TOKENS}
    if not picked:
        return None
    if len(picked) == 1:
        return next(iter(picked))
    for combo, promoted in _COMPANION_COMBINATIONS.items():
        if combo <= picked:
            picked = (picked - combo) | {promoted}
    for candidate in _COMPANION_PRIORITY:
        if candidate in picked:
            return candidate
    return None
