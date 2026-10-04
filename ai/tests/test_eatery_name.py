"""음식 골목·거리 이름 판정(`domain.poi.EATERY_NAME`) — FOOD 하루 상한·같은 장소 계열이 함께 쓴다.

실측(2026-10-03, 로컬 POI 18,605건 · #860 뒤 서울 미식 판): '세종마을 음식문화거리'·'낙원동 아구찜
거리'·'신당동 떡볶이타운'·'노량진컵밥거리'가 ACTIVITY 로 분류돼 FOOD 상한 집계를 빠져나갔다
(하루 음식 장소 4~5곳). 음식 단어 + 거리/타운 꼴만 더한다 — '거리|타운$' 전체는 '영화의 거리'·
'로데오거리'·'가구거리'·'패션타운'까지 잡는다(비FOOD 124곳 중 음식은 30곳, 실측).
"""

import pytest

from trippilot.domain.poi import EATERY_NAME, _NAME_NOISE


def _hit(name: str) -> bool:
    return EATERY_NAME.search(_NAME_NOISE.sub("", name)) is not None


@pytest.mark.parametrize("name", [
    "국제시장 먹자골목", "공덕동 족발골목", "금정산성마을 먹거리촌", "상수동 카페거리",
    "세종마을 음식문화거리", "낙원동 아구찜 거리", "신당동 떡볶이타운", "노량진컵밥거리",
    "남원 추어탕 거리", "수원통닭거리", "광양불고기특화거리", "글로벌푸드타운", "낭만포차거리",
    "서현시범 맛집거리", "국제음식문화거리(INTERNATIONAL FOOD STREET)", "속리산 산채비빔밥 거리",
])
def test_food_streets_count_as_eatery(name: str) -> None:
    assert _hit(name)


@pytest.mark.parametrize("name", [
    "군산 영화의 거리", "압구정 로데오거리", "논현 가구거리", "신평화패션타운", "대림동 차이나타운",
    "인사동 문화의 거리", "전농로 벚꽃거리", "하동명품배거리", "둔산전자타운", "경의선책거리",
])
def test_non_food_streets_do_not(name: str) -> None:
    assert not _hit(name)
