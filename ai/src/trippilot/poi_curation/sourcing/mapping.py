"""TourAPI 분류·영업시간 → 도메인 매핑 (TRIP-246).

카테고리 매핑표는 아래 상수에 명시한다. 매핑 불가는 게이트로 보내지 않고
파이프라인이 드롭+카운트한다. NIGHT_VIEW는 TourAPI 분류축에 대응 코드가
없어 이 소싱 경로에서는 생산되지 않는다 (드롭이 아니라 원천 부재).

영업시간은 **파싱 가능한 것만** OpenHour로 만든다 — "정보 없음 ≠ 배제"
원칙에 따라 파싱 불가는 open_hours=() 로 두고, 절대 지어내지 않는다
(계절별·격주·명절 휴무 등 주간 스케줄로 표현 불가한 원문은 통째로 포기).
"""

from __future__ import annotations

import re

from trippilot.domain.poi import OpenHour, PoiCategory

# ── 카테고리 매핑표 ──────────────────────────────────────────────
# TourAPI contentTypeId → PoiCategory (경계 8종). cat 코드로 세분:
#   12 관광지:  cat1 A01(자연) → NATURE
#               cat1 A02(인문) → SIGHT, 단 cat2 A0206(문화시설) → CULTURE ·
#                 A0203(체험관광지) → ACTIVITY · A0207/A0208(축제·공연행사) → CULTURE
#               cat1 A03(레포츠) → ACTIVITY · A04(쇼핑) → SHOPPING · A05(음식) → FOOD
#   14 문화시설: CULTURE
#   28 레포츠:   ACTIVITY
#   38 쇼핑:     SHOPPING
#   39 음식점:   FOOD, 단 cat3 A05020900(카페/전통찻집) → CAFE
# 그 외(15 축제공연행사·25 여행코스·32 숙박 등) → None(매핑 불가 — 드롭+카운트).
_CAFE_CAT3 = "A05020900"

_KIND_DIRECT: dict[str, PoiCategory] = {
    "14": PoiCategory.CULTURE,
    "28": PoiCategory.ACTIVITY,
    "38": PoiCategory.SHOPPING,
}

_SIGHT_CAT2_OVERRIDE: dict[str, PoiCategory] = {
    "A0206": PoiCategory.CULTURE,
    "A0203": PoiCategory.ACTIVITY,
    "A0207": PoiCategory.CULTURE,
    "A0208": PoiCategory.CULTURE,
}

_CAT1_FOR_TOURIST_SPOT: dict[str, PoiCategory] = {
    "A01": PoiCategory.NATURE,
    "A03": PoiCategory.ACTIVITY,
    "A04": PoiCategory.SHOPPING,
    "A05": PoiCategory.FOOD,
}


def map_category(kind: str, category_codes: tuple[str, ...]) -> PoiCategory | None:
    """TourAPI 분류 → PoiCategory. 매핑 불가 None (호출측이 드롭+카운트)."""
    if kind == "39":
        return PoiCategory.CAFE if _CAFE_CAT3 in category_codes else PoiCategory.FOOD
    if kind in _KIND_DIRECT:
        return _KIND_DIRECT[kind]
    if kind == "12":
        cat1 = next((c for c in category_codes if re.fullmatch(r"A\d{2}", c)), None)
        cat2 = next((c for c in category_codes if re.fullmatch(r"A\d{4}", c)), None)
        if cat1 == "A02":
            if cat2 in _SIGHT_CAT2_OVERRIDE:
                return _SIGHT_CAT2_OVERRIDE[cat2]
            return PoiCategory.SIGHT
        if cat1 in _CAT1_FOR_TOURIST_SPOT:
            if cat1 == "A05" and _CAFE_CAT3 in category_codes:
                return PoiCategory.CAFE
            return _CAT1_FOR_TOURIST_SPOT[cat1]
        return None
    return None


# ── 태그 (backend `poi.tags text[]` — 열린 집합, V2.5) ───────────────
# TourAPI cat2/cat3 코드 → 사람이 읽는 분류 **명칭**. 호출 예산을 아끼려고
# categoryCode2 API 조회 대신 주요 코드를 정적 사전으로 내장한다 — 미지 코드는
# 태그를 만들지 않는다(빈 태그 — 코드값을 태그로 지어내지 않음).
_CAT_LABELS: dict[str, str] = {
    # cat2
    "A0101": "자연관광지", "A0102": "관광자원",
    "A0201": "역사관광지", "A0202": "휴양관광지", "A0203": "체험관광지",
    "A0204": "산업관광지", "A0205": "건축/조형물", "A0206": "문화시설",
    "A0207": "축제", "A0208": "공연/행사",
    "A0301": "레포츠소개", "A0302": "육상 레포츠", "A0303": "수상 레포츠",
    "A0304": "항공 레포츠", "A0305": "복합 레포츠",
    "A0401": "쇼핑", "A0502": "음식점",
    # cat3 — 자연(A01)
    "A01010100": "국립공원", "A01010200": "도립공원", "A01010300": "군립공원",
    "A01010400": "산", "A01010500": "자연생태관광지", "A01010600": "자연휴양림",
    "A01010700": "수목원", "A01010800": "폭포", "A01010900": "계곡",
    "A01011100": "해안절경", "A01011200": "해수욕장", "A01011300": "섬",
    "A01011400": "항구/포구", "A01011600": "등대", "A01011700": "호수",
    "A01011800": "강", "A01011900": "동굴", "A01020200": "기암괴석",
    # cat3 — 인문(A02)
    "A02010100": "고궁", "A02010200": "성", "A02010400": "고택",
    "A02010500": "생가", "A02010600": "민속마을", "A02010700": "유적지/사적지",
    "A02010800": "사찰", "A02010900": "종교성지",
    "A02020300": "온천/욕장/스파", "A02020600": "테마공원", "A02020700": "공원",
    "A02020800": "유람선/잠수함관광",
    "A02030100": "농산어촌 체험", "A02030200": "전통체험", "A02030400": "이색체험",
    "A02030600": "이색거리",
    "A02050100": "다리/대교", "A02050200": "기념탑/기념비/전망대",
    "A02050600": "유명건물",
    "A02060100": "박물관", "A02060200": "기념관", "A02060300": "전시관",
    "A02060500": "미술관/화랑", "A02060600": "공연장", "A02060700": "문화원",
    "A02060900": "도서관",
    # cat3 — 쇼핑(A04)
    "A04010100": "5일장", "A04010200": "상설시장", "A04010300": "백화점",
    "A04010400": "면세점", "A04010500": "대형마트", "A04010600": "전문매장/상가",
    "A04010700": "공예/공방",
    # cat3 — 음식(A05)
    "A05020100": "한식", "A05020200": "서양식", "A05020300": "일식",
    "A05020400": "중식", "A05020700": "이색음식점", "A05020900": "카페/전통찻집",
    "A05021000": "클럽",
}


def category_tags(category_codes: tuple[str, ...]) -> tuple[str, ...]:
    """cat2/cat3 코드 → 태그 명칭 (미지 코드 스킵, 입력 순서 보존·중복 제거)."""
    tags: list[str] = []
    for code in category_codes:
        label = _CAT_LABELS.get(code)
        if label is not None and label not in tags:
            tags.append(label)
    return tuple(tags)


# ── 지역 추출 (backend `poi.region varchar(60)` — 시·군·구) ──────────
_PROVINCE_SUFFIXES = ("특별자치도", "특별자치시", "특별시", "광역시", "도")
_REGION_RE = re.compile(r".+(시|군|구)$")


def extract_region(address: str | None) -> str | None:
    """addr1 → 시·군·구 1개 ("제주특별자치도 서귀포시 …" → "서귀포시").

    광역 단위(…특별자치도 등)는 건너뛰고 처음 만나는 시·군·구 토큰을 취한다.
    추출 실패는 None — 지어내기 금지.
    """
    if not address:
        return None
    for token in address.split():
        if token.endswith(_PROVINCE_SUFFIXES):
            continue
        if _REGION_RE.fullmatch(token):
            return token
    return None


# ── 영업시간 파싱 ────────────────────────────────────────────────
_TIME_RE = re.compile(r"([01]?\d|2[0-3]):([0-5]\d)")
_WEEKDAY_RE = re.compile(r"(월|화|수|목|금|토|일)요일")
_WEEKDAY_INDEX = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6}
# 주간 스케줄(OpenHour)로 표현할 수 없는 휴무 패턴 — 있으면 통째로 파싱 포기
_UNREPRESENTABLE_REST = re.compile(r"첫째|둘째|셋째|넷째|다섯째|격주|짝수|홀수|공휴일|명절|설날|추석|법정")
_NO_REST_TOKENS = frozenset({"연중무휴", "없음", "무휴", "연중 무휴"})


def parse_open_hours(hours_raw: str | None, rest_raw: str | None) -> tuple[OpenHour, ...]:
    """영업시간 원문 → 주간 OpenHour. 확신할 수 없으면 () (지어내기 금지).

    - hours_raw에서 HH:MM이 **정확히 2회** 등장할 때만 개점~폐점으로 읽는다
      (계절별 시간 등 3회 이상은 어느 창이 맞는지 확정 불가 → 포기).
    - 폐점 ≤ 개점이면 자정 초과 영업으로 보고 +24h (OpenHour 계약).
    - rest_raw는 "매주 X요일" 류만 해석 — 주차·명절 등 가변 휴무가 섞이면
      해당 요일이 실제로 여는지 확정 불가 → 전체 포기.
    """
    if not hours_raw:
        return ()
    times = _TIME_RE.findall(hours_raw)
    if len(times) != 2:
        return ()
    open_min = int(times[0][0]) * 60 + int(times[0][1])
    close_min = int(times[1][0]) * 60 + int(times[1][1])
    if close_min <= open_min:
        close_min += 24 * 60  # 자정 초과 영업 (시작일 귀속)

    closed_days = _parse_rest_days(rest_raw)
    if closed_days is None:
        return ()
    return tuple(
        OpenHour(day_of_week=d, open_min=open_min, close_min=close_min)
        for d in range(7)
        if d not in closed_days
    )


def _parse_rest_days(rest_raw: str | None) -> frozenset[int] | None:
    """휴무일 원문 → 휴무 요일 집합. 해석 불가면 None (호출측이 전체 포기)."""
    if rest_raw is None:
        return frozenset()
    text = rest_raw.strip()
    if not text or text in _NO_REST_TOKENS:
        return frozenset()
    if _UNREPRESENTABLE_REST.search(text):
        return None
    days = {_WEEKDAY_INDEX[m] for m in _WEEKDAY_RE.findall(text)}
    if not days:
        return None  # 비어있지 않은데 요일도 못 읽음 — 확신 없음
    return frozenset(days)
