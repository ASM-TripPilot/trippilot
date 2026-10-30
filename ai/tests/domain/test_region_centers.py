"""지역 중심 표 — 가장 구체적인 이름이 이기고, 표에 없는 지역은 지어내지 않는다."""

from trippilot.domain.common import GeoPoint
import pytest

from trippilot.domain.region_centers import region_center, region_mentions, region_pair


def test_most_specific_name_wins_and_unknown_is_none() -> None:
    assert region_center("부산 해운대") == ("해운대", GeoPoint(35.1631, 129.1635), 3.0)  # 반경이 작은(구체적인) 쪽
    assert region_center("제주 애월") == ("애월", GeoPoint(33.4628, 126.3316), 4.0)  # 같은 두 글자 — 길이로는 못 가른다
    assert region_center("서울특별시 22:00") == region_center("서울")  # 이름은 표의 것 — 발화 원문이 아니다
    assert region_center("강원도") is None  # 도 이름은 한 점으로 대표할 수 없다
    assert region_center("") is None


def test_pair_needs_the_word_between_and_two_names_and_keeps_the_said_order() -> None:
    (a, pa), (b, pb) = region_pair("홍대와 이태원 사이에 가볼만한 곳 알려줘")
    assert (a, pa) == region_center("홍대")[:2] and (b, pb) == region_center("이태원")[:2]
    assert [n for n, _ in region_pair("이태원역이랑 홍대입구역 사이")] == ["이태원", "홍대"]  # 말한 순서
    assert [n for n, _ in region_pair("서울 홍대 이태원 사이 카페")] == ["홍대", "이태원"]  # 셋이면 구체적인 둘
    assert region_pair("홍대 사이 카페") is None and region_pair("홍대 이태원 맛집") is None  # 이름 하나 · '사이' 없음
    assert region_pair("홍대 이태원 사이다 맛집") is None and region_pair("부산 해운대 중간 가격") is None
    # 관계의 '사이'는 이름 앞이다 — 두 곳 사이가 아니다
    assert region_pair("현지인 사이에서 유명한 제주 애월 카페") is None
    assert region_pair("요즘 20대 사이에서 핫한 부산 해운대 맛집") is None


@pytest.mark.parametrize("text", [
    "이태원역이랑 홍대 입구역 사이에 가볼만한 곳", "홍대 입구역이랑 이태원 역 사이", "홍대랑 이태원 그 사이", "홍대와 이태원, 그 사이에 있는 곳",
    "홍대 쪽이랑 이태원 쪽 사이", "홍대 근처랑 이태원 근처 사이", "홍대랑 이태원 사이는 뭐 있어?", "홍대랑 이태원 사이?", "홍대랑 이태원 사이요",
    "홍대랑 이태원 사이도 알려줘", "홍대와이태원사이에", "애월이랑 성산 사이에 가볼만한 곳", "성수동이랑 홍대 사이",
])
def test_pair_reads_spaced_suffixes_particles_and_glued_forms(text: str) -> None:
    assert region_pair(text) is not None


@pytest.mark.parametrize("text", [
    "제주 애월현지인 사이에서", "부산 해운대20대 사이에서 핫한 맛집", "커플 사이에 인기 많은 홍대 이태원 카페",  # 관계의 사이
    "홍대랑 서울대 사이 카페", "인천공항이랑 홍대 사이", "해운대랑 부산대 사이 맛집",  # 이름 속 지역 — 서울대·인천공항·부산대
    "홍대랑 성산동 사이 카페", "세종문화회관이랑 명동 사이",  # 성산동은 서울 마포, 세종문화회관은 세종시가 아니다
    "종로랑 평창동 사이 카페", "해운대랑 거제동 사이 맛집",  # 평창동은 서울 종로, 거제동은 부산 연제
    "홍대랑 이태원 사이에서 고민 중이야",  # 고르는 사이
])
def test_pair_ignores_relations_and_names_that_only_contain_a_region(text: str) -> None:
    assert region_pair(text) is None


@pytest.mark.parametrize("text", ["제주 애월 가는 길에 카페 추천해줘", "서울 홍대 가는 길에 들를 곳", "부산 해운대 가는 길에 맛집", "홍대 이태원 가는 길에",
                                  "서울에서 홍대 가는 길에 들를 곳", "부산에서 해운대 가는 길에 맛집", "제주 공항에서 애월 가는 길에 카페",
                                  "해운대에서 부산역 가는 길", "홍대에서 서울역 가는 길", "애월에서 제주 가는 길",  # 거꾸로도 — 시청 한 점이 끝이 된다
                                  "홍대 말고, 이태원 가는 길에 카페", "홍대 아니고 이태원 가는 길에 들를 곳", "홍대는 됐고 이태원 가는 길에"])
def test_route_pair_needs_a_departure_marker_and_not_a_city_to_its_own_district(text: str) -> None:
    assert region_pair(text) is None  # 시·도가 동네를 꾸민 말 · 시·도와 그 안의 동네 · 배제("말고")는 출발이 아니다


@pytest.mark.parametrize("text", ["애월에서 성산 가는 길", "홍대 찍고 이태원 가는 길에 들를 곳", "홍대 들렀다 이태원 가는 길에", "홍대 구경하고 이태원 가는 길에",
                                  "홍대 놀다가 이태원 가는 길에", "홍대 들러서 이태원 가는 중에", "홍대 보고, 이태원 가는 길에"])
def test_route_pair_with_a_departure_marker_is_a_pair(text: str) -> None:
    assert region_pair(text) is not None


def test_plain_region_is_a_table_name_plus_particles_only() -> None:
    from trippilot.domain.region_centers import plain_region

    assert plain_region("홍대에") == "홍대" and plain_region("이태원") == "이태원" and plain_region("제주도") == "제주"  # '도'는 조사로도 읽힌다 — 지역 낱말이긴 하다
    assert plain_region("서울역") is None and plain_region("해운대해수욕장") is None and plain_region("서울숲") is None


def test_mentions_are_regions_said_not_names_that_contain_one() -> None:
    assert [n for _, n in region_mentions("서울 전주비빔밥 맛집")] == ["서울"]
    assert region_mentions("성수기에도 한적한 곳") == [] and region_mentions("세종대왕 동상 근처") == []
    assert region_mentions("명동교자 말고 다른 데는?") == []
    assert [n for _, n in region_mentions("부산 사람들이 자주 가는 제주 맛집")] == ["부산", "제주"]  # 말한 순서
    assert [n for _, n in region_mentions("홍대입구역에서 서귀포시까지")] == ["홍대", "서귀포"]
    assert [n for _, n in region_mentions("서울엔 요즘 핫한 곳 어디야? 부산에선 강릉에서는")] == ["서울", "부산", "강릉"]  # 겹친 조사


@pytest.mark.parametrize("text", ["제주랑 부산 사이에서 여행지 고민 중이야 가볼 만한 곳", "제주랑 부산 사이에서 어디 갈지 고민 중이야",
                                  "홍대랑 이태원 사이에서 고민 중인데 어디가 더 재밌어?", "강릉이랑 속초 사이에서 아직 결정 못 했어"])
def test_choosing_between_two_places_is_not_a_place_between(text: str) -> None:
    assert region_pair(text) is None


def test_asking_for_a_pick_between_two_places_is_still_between() -> None:
    assert [n for n, _ in region_pair("홍대랑 이태원 사이에서 맛집 골라 줘")] == ["홍대", "이태원"]


@pytest.mark.parametrize("text", ["홍대 보고나서 이태원 가는 길에", "홍대 먹고 나서 이태원 가는 길에", "홍대 다음에 이태원 가는 길에"])
def test_route_departure_markers_include_after_and_next(text: str) -> None:
    assert [n for n, _ in region_pair(text)] == ["홍대", "이태원"]
