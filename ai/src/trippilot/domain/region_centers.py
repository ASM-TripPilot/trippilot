"""지역명 → 탐색 앵커 좌표(중심 + 반경) — 도우미 장소 탐색(EXPLORE_PLACES) 전용 최소 표.

AI 에는 지역명 → 좌표 경로가 없다(`PlacesPort.geocode` 는 프로토콜뿐, 구현 0건). 백엔드는 지역 표(`RegionLookupFacade`)를
갖지만 AI 가 부를 내부 경계가 없어 여기 상수로 둔다.
ponytail: 대도시·주요 관광 권역 수십 곳의 손 좌표(시청·번화가 근처)다. 도(道) 이름은 넣지 않았다 — 한 점으로 대표할 수 없다.
표에 없는 지역은 None 이고 호출측이 "그 지역은 아직 못 찾는다"로 답한다(지어내지 않는다). 넓히려면 백엔드 지역 표를 내부 경계로 연다.
"""

from __future__ import annotations

import re

from trippilot.domain.common import GeoPoint

# 이름: (위도, 경도, 반경 km). 반경은 그 권역이 걸어 다니는 범위 정도 — 넓히면 BE 반경 조회가 팬아웃 예산(≤3s)을 넘는다.
_CENTERS: dict[str, tuple[float, float, float]] = {
    # 광역시·특별시
    "서울": (37.5665, 126.9780, 5.0), "부산": (35.1577, 129.0596, 7.0), "대구": (35.8714, 128.6014, 5.0),
    "인천": (37.4563, 126.7052, 6.0), "광주": (35.1595, 126.8526, 5.0), "대전": (36.3504, 127.3845, 5.0),
    "울산": (35.5384, 129.3114, 6.0), "세종": (36.4800, 127.2890, 5.0),
    # 서울 권역
    "강남": (37.4979, 127.0276, 3.0), "홍대": (37.5563, 126.9220, 2.0), "명동": (37.5636, 126.9834, 2.0),
    "종로": (37.5720, 126.9794, 3.0), "이태원": (37.5345, 126.9946, 2.0), "성수": (37.5446, 127.0559, 2.0),
    "잠실": (37.5133, 127.1001, 3.0), "여의도": (37.5219, 126.9245, 2.0),
    # 부산 권역
    "해운대": (35.1631, 129.1635, 3.0), "광안리": (35.1532, 129.1186, 3.0), "남포": (35.0979, 129.0306, 3.0),
    "기장": (35.2446, 129.2222, 5.0),
    # 제주
    "제주": (33.4996, 126.5312, 8.0), "서귀포": (33.2541, 126.5600, 6.0), "애월": (33.4628, 126.3316, 4.0),
    "성산": (33.4580, 126.9420, 4.0), "중문": (33.2490, 126.4120, 4.0), "우도": (33.5060, 126.9530, 3.0),
    # 시·군 관광지
    "강릉": (37.7519, 128.8761, 5.0), "속초": (38.2070, 128.5918, 5.0), "춘천": (37.8813, 127.7298, 5.0),
    "양양": (38.0754, 128.6190, 5.0), "평창": (37.3705, 128.3900, 8.0), "경주": (35.8562, 129.2247, 5.0),
    "전주": (35.8242, 127.1480, 4.0), "여수": (34.7604, 127.6622, 5.0), "순천": (34.9506, 127.4872, 5.0),
    "목포": (34.8118, 126.3922, 5.0), "통영": (34.8544, 128.4331, 5.0), "거제": (34.8806, 128.6211, 8.0),
    "남해": (34.8376, 127.8924, 8.0), "안동": (36.5684, 128.7294, 5.0), "포항": (36.0190, 129.3435, 6.0),
    "수원": (37.2636, 127.0286, 4.0), "가평": (37.8315, 127.5105, 8.0), "파주": (37.7599, 126.7802, 6.0),
    "단양": (36.9846, 128.3655, 6.0), "태안": (36.7456, 126.2980, 8.0), "군산": (35.9676, 126.7366, 5.0),
    "담양": (35.3211, 126.9882, 5.0), "보령": (36.3334, 126.6129, 6.0), "창원": (35.2280, 128.6811, 6.0),
    "청주": (36.6424, 127.4890, 5.0), "천안": (36.8151, 127.1139, 5.0),
}


def region_center(text: str) -> tuple[str, GeoPoint, float] | None:
    """발화 속 지역 표현 → (표 이름, 중심, 반경 km). 표 이름이 **들어 있으면** 맞다고 본다("서울특별시"·"부산 해운대"·"강남역") —
    여럿이면 반경이 가장 작은(구체적인) 곳("제주 애월" → 애월; 이름 길이로는 둘 다 두 글자라 못 가른다), 같으면 뒤에 나온 것.
    없으면 None. 이름은 표의 것을 돌려준다 — 발화 원문(시각·지시가 섞일 수 있다)을 사실 칸에 옮기지 않게."""
    hits = [(-_CENTERS[name][2], text.rfind(name), name) for name in _CENTERS if name in text]
    if not hits:
        return None
    name = max(hits)[2]
    lat, lng, km = _CENTERS[name]
    return name, GeoPoint(lat, lng), km


# 표 이름 뒤에 와도 되는 말 — 그 지역을 가리키는 접미 + 조사(홍대입구역이랑·제주도·서울에서). 다른 한글이 붙으면 다른 낱말이다
# (성수기·세종대왕·서울대·인천공항·전주비빔밥·명동교자). 성산동은 서울 마포라 제주 성산이 아니다
_MENTION_TAIL = re.compile(r"(?:특별시|광역시|특별자치도|특별자치시|입구역|입구|해수욕장|해변|시내|시|도|군|구|동|읍|면|역|섬|항|쪽|근처|일대)?"
                           r"(?:에서|에선|엔|에|의|으로|로|이랑|랑|하고|와|과|이나|나|인데|이야|은|는|이|가|을|를|도|만|까지|부터|요){0,2}")
# '…동'이 다른 곳인 이름 — 서울 성산동·평창동, 부산 거제동, 성남 여수동
_NOT_WITH_DONG = frozenset({"성산", "평창", "거제", "여수"})
# 두 번째 이름 뒤(역·입구역·쪽·근처·까지·의 같은 접미 낱말과 '그·둘'을 사이에 두어도 된다)의 '사이' — 사이다·사이즈·사이판·사이트는
# 아니다. 관계의 사이("현지인 사이에서 유명한 제주 애월")는 이름 앞이라 아니다. '중간'은 뺐다 — "부산 해운대 중간 가격"
_BETWEEN_AFTER = re.compile(r"(?:\s?(?:역|입구역|입구|쪽|근처|까지|의))*\s?,?\s?(?:(?:그|둘)\s?)?사이(?![다즈판트드렌클버언])"
                            r"(?!에서\s?(?:고민|망설|고르|골라|결정|갈등))")  # "A랑 B 사이에서 고민" — 고르는 사이다


def region_mentions(text: str) -> list[tuple[int, str]]:
    """발화가 말한 표 지역 — (자리, 표 이름)을 발화 순서로. 표 이름(+접미·조사) 뒤에 다른 낱말이 붙은 것은 지역을 말한 게 아니다
    (성수기·전주비빔밥). 붙여 쓴 "홍대와이태원사이에"처럼 다른 표 이름이나 '사이'가 바로 오는 것은 받는다."""
    def free(rest: str) -> bool:  # 낱말이 끝났거나, 다른 표 이름·'사이'가 바로 온다
        return not rest or not "가" <= rest[0] <= "힣" or rest.startswith("사이") or any(rest.startswith(n) for n in _CENTERS)

    found = []
    for name in _CENTERS:
        at = text.find(name)
        while at >= 0:
            start = at + len(name)
            longest = _MENTION_TAIL.match(text, start).end()  # 긴 꼬리부터 — "홍대와이태원"의 '와이'는 조사가 아니다
            ends = (e for e in range(longest, start - 1, -1) if _MENTION_TAIL.fullmatch(text, start, e) and free(text[e:]))
            dong = text.startswith("동", start) and name in _NOT_WITH_DONG
            if not dong and next(ends, None) is not None:
                found.append((at, name))
            at = text.find(name, at + 1)
    return sorted(found)


def bare_region(text: str) -> str | None:
    """글 전체가 표 이름(+접미·조사) 하나인가 — 그 표 이름. "제주"·"제주도"·"홍대입구역"은 맞고 "제주문학관"은 아니다."""
    squashed = text.replace(" ", "")
    return next((name for name in _CENTERS if squashed.startswith(name)
                 and _MENTION_TAIL.fullmatch(squashed, len(name))), None)


def region_pair(text: str) -> tuple[tuple[str, GeoPoint], tuple[str, GeoPoint]] | None:
    """"홍대와 이태원 사이"·"홍대 입구역이랑 이태원 사이는" — 말한 표 지역이 둘 이상이고 뒤의 것 뒤에 '사이'가 오면 가장 구체적인
    (반경이 작은) 둘을 발화 순서로. 아니면 None. 한 곳만 고르는 `region_center` 는 둘 중 뒤의 것(이태원)만 잡는다. 거리는 보지 않는다 —
    너무 먼 짝은 호출측이 가린다."""
    hits = sorted((_CENTERS[name][2], at, name) for at, name in region_mentions(text))
    names = list(dict.fromkeys(name for _, _, name in hits))[:2]
    if len(names) < 2:
        return None
    first, second = sorted((next(h for h in hits if h[2] == n) for n in names), key=lambda h: h[1])
    after = text[second[1] + len(second[2]):]
    if not _BETWEEN_AFTER.match(after, _MENTION_TAIL.match(after).end()):
        return None
    return tuple((name, GeoPoint(*_CENTERS[name][:2])) for _, _, name in (first, second))
