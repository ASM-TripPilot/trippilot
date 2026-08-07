"""PreferenceScoring 입력 컨텍스트 (U4 FD domain-entities §2, 프롬프트 정본 §2.1).

KB-2 페르소나 전체가 아니라 점수 산정에 필요한 최소 요약만 (G181 — 필드 최소화).
7축 택소노미는 프롬프트 정본 §2.1을 채택 (미결 #3 해소) — 온보딩 설계 변경 시 이 enum만 개정.
"""

from __future__ import annotations

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
    SOLO = "SOLO"
    COUPLE = "COUPLE"
    FAMILY = "FAMILY"
    FRIENDS = "FRIENDS"


@dataclass(frozen=True, slots=True)
class PersonaSummary:
    taste_tags: tuple[TasteTag, ...]
    companion: CompanionType
    budget: BudgetLevel

    def to_dict(self) -> dict:
        return {
            "taste_tags": [t.value for t in self.taste_tags],
            "companion": self.companion.value,
            "budget": self.budget.value,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PersonaSummary":
        return cls(
            taste_tags=tuple(TasteTag(t) for t in d["taste_tags"]),
            companion=CompanionType(d["companion"]),
            budget=BudgetLevel(d["budget"]),
        )
