"""취향 → 가볼 지역 고르기(도우미 RECOMMEND_REGION) — 순수 함수, LLM 0.

지역은 `region_centers` 표 이름(닫힌 집합, INV-1) 중 성격표(`data/region_profiles.json`)에 있는 곳이고, 성격은 관광공사 장소의
종류별 전국 대비 배수다(만드는 법·한계는 `scripts/chatbot/build_region_profiles.py`). 취향 7축(`styles`)·활동(`activities`)과
발화 주제(theme)를 종류 가중치로 바꿔 log(배수) 합으로 줄 세운다 — 배수 1.0(전국 평균·모름)은 점수 0 이라 없는 성격을 지어내지 않는다.

ponytail: 손으로 적은 가중표·낱말표다. 지역 성격이 관광공사 수집 범위에 기댄다(지방 소도시는 표본 100곳 안팎) — 정밀한 추천이
필요해지면 지역 문서(KB)·인기 신호를 더한다.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_PROFILES = Path(__file__).resolve().parents[3] / "data/region_profiles.json"

# 동네·권역(시 안의 한 곳)은 "가볼 지역" 후보가 아니다 — 그 도시(서울·부산·제주)가 후보다. 동네는 장소 탐색의 앵커로만 쓴다
NEIGHBORHOODS: frozenset[str] = frozenset({
    "강남", "홍대", "명동", "종로", "이태원", "성수", "잠실", "여의도",
    "해운대", "광안리", "남포", "기장", "서귀포", "애월", "성산", "중문", "우도",
})

# 백엔드 취향 어휘 → 종류 가중치. styles 7종(`persona.TASTE_TOKENS`)·activities 8종(`persona.ACTIVITY_LABELS`)
_PREF_WEIGHTS: Mapping[str, Mapping[str, float]] = {
    "휴양": {"NATURE": 1.0, "CAFE": 0.6}, "관광": {"SIGHT": 1.0, "CULTURE": 0.4}, "액티비티": {"ACTIVITY": 1.0},
    "미식": {"FOOD": 1.0, "CAFE": 0.3}, "쇼핑": {"SHOPPING": 1.0}, "자연": {"NATURE": 1.0}, "문화예술": {"CULTURE": 1.0, "SIGHT": 0.3},
    "역사문화": {"CULTURE": 1.0, "SIGHT": 0.6}, "테마파크": {"ACTIVITY": 1.0}, "맛집투어": {"FOOD": 1.0},
    "카페": {"CAFE": 1.0}, "전시": {"CULTURE": 1.0}, "야경": {"SIGHT": 0.3},  # 야경은 관광공사에 거의 없다 — 명소로 약하게
}
# 발화 주제 낱말 → 종류(취향보다 2배 무겁다 — 이번에 말한 것이 이긴다)
_THEME_WORDS: tuple[tuple[re.Pattern, str], ...] = tuple((re.compile(p), c) for p, c in (
    (r"바다|해변|해수욕|섬|산|숲|계곡|호수|자연|힐링|조용|한적|트레킹|등산|캠핑|온천", "NATURE"),
    (r"맛집|먹|음식|미식|해산물|회|시장", "FOOD"), (r"카페|커피|디저트|빵", "CAFE"),
    (r"역사|문화|박물관|미술|전시|한옥|유적|고궁|절|사찰", "CULTURE"), (r"쇼핑|아울렛|면세", "SHOPPING"),
    (r"액티비티|레포츠|체험|서핑|스키|레저|놀이|테마파크|래프팅|패러", "ACTIVITY"), (r"명소|관광|구경|사진|야경|인생샷", "SIGHT"),
))
_THEME_WEIGHT = 2.0
_REASON_MIN_LIFT = 1.15  # 이보다 낮으면 "많은 편"이라 말하지 않는다
_LABELS: Mapping[str, str] = {
    "SIGHT": "명소", "FOOD": "맛집", "CAFE": "카페", "NATURE": "자연", "SHOPPING": "쇼핑", "CULTURE": "문화·역사",
    "ACTIVITY": "체험·액티비티",
}


@dataclass(frozen=True, slots=True)
class RegionPick:
    name: str
    reasons: tuple[str, ...]  # "자연"·"체험·액티비티" — 취향과 맞고 전국보다 많은 종류(많은 순)
    score: float


@lru_cache(maxsize=1)
def region_profiles() -> Mapping[str, Mapping[str, float]]:
    """지역 → 종류별 배수. 파일이 없으면 빈 표(지역 추천이 '고를 수 없음'으로 정직하게 끝난다)."""
    try:
        regions = json.loads(_PROFILES.read_text(encoding="utf-8"))["regions"]
    except (OSError, ValueError, KeyError):
        return {}
    return {name: dict(v["lift"]) for name, v in regions.items() if name not in NEIGHBORHOODS}


def preference_weights(styles: Iterable[str] = (), activities: Iterable[str] = (), theme: str | None = None) -> dict[str, float]:
    """취향·주제 → 종류 가중치. 모르는 값은 건너뛴다. 비면 {} — 호출측이 "어떤 여행을 좋아하는지" 되묻는다."""
    w: dict[str, float] = {}
    for label in (*styles, *activities):
        for cat, x in _PREF_WEIGHTS.get(label.strip(), {}).items():
            w[cat] = w.get(cat, 0.0) + x
    for pattern, cat in _THEME_WORDS if theme else ():
        if pattern.search(theme):
            w[cat] = w.get(cat, 0.0) + _THEME_WEIGHT
    return w


def recommend_regions(weights: Mapping[str, float], count: int, *, exclude: Iterable[str] = (),
                      profiles: Mapping[str, Mapping[str, float]] | None = None) -> list[RegionPick]:
    """가중치와 맞는 지역 상위 count 곳 — 점수 ≤ 0(맞는 성격이 전국 평균 이하)은 내지 않는다. 동점은 이름순(결정론)."""
    table = region_profiles() if profiles is None else profiles
    skip = set(exclude)
    picks = []
    for name, lift in table.items():
        if name in skip:
            continue
        parts = {c: x * math.log(lift.get(c, 1.0)) for c, x in weights.items()}
        score = sum(parts.values())
        if score <= 0:
            continue
        reasons = tuple(_LABELS[c] for c, s in sorted(parts.items(), key=lambda kv: (-kv[1], kv[0]))
                        if s > 0 and lift.get(c, 1.0) >= _REASON_MIN_LIFT and c in _LABELS)[:2]
        if reasons:
            picks.append(RegionPick(name, reasons, round(score, 4)))
    picks.sort(key=lambda p: (-p.score, p.name))
    return picks[:count]


if __name__ == "__main__":  # 자가 점검 — 자연·액티비티 취향이면 자연·체험이 많은 곳이, 맛집 주제면 맛집이 많은 곳이 앞선다
    demo = {"가평": {"ACTIVITY": 2.0, "NATURE": 0.8}, "단양": {"NATURE": 1.4, "ACTIVITY": 1.3},
            "전주": {"CULTURE": 1.5, "FOOD": 1.2}, "강릉": {"FOOD": 1.6, "CAFE": 1.4}}
    assert [p.name for p in recommend_regions(preference_weights(["자연", "액티비티"]), 2, profiles=demo)] == ["단양", "가평"]
    assert recommend_regions(preference_weights(theme="맛집 투어"), 1, profiles=demo)[0].name == "강릉"
    assert recommend_regions({}, 3, profiles=demo) == []
    print("ok")
