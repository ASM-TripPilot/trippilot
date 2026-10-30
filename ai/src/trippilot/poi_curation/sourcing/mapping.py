"""TourAPI 분류·영업시간 → 도메인 매핑 (TRIP-246).

카테고리 매핑표는 아래 상수에 명시한다. 매핑 불가는 게이트로 보내지 않고
파이프라인이 드롭+카운트한다. NIGHT_VIEW는 TourAPI 분류축에 대응 코드가
없어 이 소싱 경로에서는 생산되지 않는다 (드롭이 아니라 원천 부재).

영업시간은 **파싱 가능한 것만** OpenHour로 만든다 — "정보 없음 ≠ 배제"
원칙에 따라 파싱 불가는 open_hours=() 로 두고, 절대 지어내지 않는다
(계절별 시간·요일 없는 휴무 안내 등 주간 스케줄로 못 읽는 원문은 통째로 포기).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence

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

# ── 새 분류 체계(lclsSystm1~3) — 옛 cat 코드가 빈 항목용 (2026-10-19) ──────────
# KorService2 가 분류를 lclsSystm 으로 옮기면서 **수정된 항목은 cat1~3 이 비어** 온다 — 지역 코드
# (areacode → lDongRegnCd, #1350)와 같은 이관이다. 실측: 서울 관광지 100건 중 57건이 cat 빈 값,
# 경복궁(HS/HS01)·해운대해수욕장(NA/NA02)·남산서울타워(VE/VE01)·천지연폭포(NA/NA01) 전부.
# 그 57건이 cat 으로만 판정해 `category_unmapped` 로 버려졌다(10-19 서울·부산·제주 관광지 993건 중 99%).
# 대응은 **옛 cat 판정과 같은 결과**가 나오게 잡는다 — 같은 장소가 체계만 바뀌어 카테고리가 뒤집히지
# 않게: 역사(HS)·문화관광(VE) ≈ 인문 A02 → SIGHT, 단 전시·공연·행사·교육시설(VE06~09) ≈ 문화시설 A0206
# → CULTURE, 레저시설 VE10·체험 EX ≈ A0203 → ACTIVITY(산업관광 EX06 ≈ A0204 → SIGHT), 축제·공연·행사
# EV ≈ A0207/8 → CULTURE. 숙박(AC)·추천코스(C01)는 옛 체계처럼 매핑하지 않는다.
# 코드표 출처: lclsSystmCode2 실호출(scripts/probe/probe_tourapi_lcls.py).
_LCLS1: dict[str, PoiCategory] = {
    "NA": PoiCategory.NATURE, "HS": PoiCategory.SIGHT, "VE": PoiCategory.SIGHT,
    "EX": PoiCategory.ACTIVITY, "LS": PoiCategory.ACTIVITY, "SH": PoiCategory.SHOPPING,
    "FD": PoiCategory.FOOD, "EV": PoiCategory.CULTURE,
}
_LCLS2_OVERRIDE: dict[str, PoiCategory] = {
    "VE06": PoiCategory.CULTURE, "VE07": PoiCategory.CULTURE, "VE08": PoiCategory.CULTURE,
    "VE09": PoiCategory.CULTURE, "VE10": PoiCategory.ACTIVITY, "EX06": PoiCategory.SIGHT,
    "FD05": PoiCategory.CAFE,
}
_CAFE_LCLS2 = "FD05"


def _lcls(codes: tuple[str, ...]) -> tuple[str | None, str | None]:
    """category_codes 에서 lclsSystm1(영문 2자)·lclsSystm2(영문 2자+숫자 2자)."""
    one = next((c for c in codes if re.fullmatch(r"[A-Z]{2}", c)), None)
    two = next((c for c in codes if re.fullmatch(r"[A-Z]{2}\d{2}", c)), None)
    return one, two


def map_category(kind: str, category_codes: tuple[str, ...]) -> PoiCategory | None:
    """TourAPI 분류 → PoiCategory. 매핑 불가 None (호출측이 드롭+카운트)."""
    lcls1, lcls2 = _lcls(category_codes)
    if kind == "39":
        cafe = _CAFE_CAT3 in category_codes or lcls2 == _CAFE_LCLS2
        return PoiCategory.CAFE if cafe else PoiCategory.FOOD
    if kind in _KIND_DIRECT:
        return _KIND_DIRECT[kind]
    if kind == "12":
        cat1 = next((c for c in category_codes if re.fullmatch(r"A\d{2}", c)), None)
        if cat1 is None and lcls1 is not None:   # 옛 cat 이 빈 항목 — 새 분류로(위 표)
            return _LCLS2_OVERRIDE.get(lcls2 or "") or _LCLS1.get(lcls1)
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
    # 새 분류 체계 중분류(lclsSystm2) — 옛 cat 이 빈 항목의 태그(위 `_LCLS1` 주석, lclsSystmCode2 실호출)
    "EV01": "축제", "EV02": "공연", "EV03": "행사",
    "EX01": "전통체험", "EX02": "공예체험", "EX03": "농산어촌 체험", "EX04": "산사체험",
    "EX05": "웰니스관광", "EX06": "산업관광", "EX07": "기타체험",
    "FD01": "한식", "FD02": "외국식", "FD03": "간이음식", "FD04": "주점", "FD05": "카페/찻집",
    "HS01": "역사유적지", "HS02": "역사유물", "HS03": "종교성지", "HS04": "안보관광지",
    "LS01": "육상 레포츠", "LS02": "수상 레포츠", "LS03": "항공 레포츠", "LS04": "복합 레포츠",
    "NA01": "자연경관(산)", "NA02": "자연경관(하천·해양)", "NA03": "자연생태", "NA04": "자연공원",
    "NA05": "기타자연관광",
    "SH01": "백화점", "SH02": "쇼핑몰", "SH03": "대형마트", "SH04": "면세점", "SH05": "전문매장/상가",
    "SH06": "시장", "SH07": "기타쇼핑시설",
    "VE01": "랜드마크", "VE02": "테마공원", "VE03": "도시공원", "VE04": "도시·지역문화관광",
    "VE05": "복합관광시설", "VE06": "공연시설", "VE07": "전시시설", "VE08": "행사시설",
    "VE09": "교육시설", "VE10": "레저스포츠시설", "VE11": "교통시설", "VE12": "기타문화관광지",
}


def category_tags(category_codes: tuple[str, ...]) -> tuple[str, ...]:
    """cat2/cat3 코드 → 태그 명칭 (미지 코드 스킵, 입력 순서 보존·중복 제거).

    옛 cat 코드가 있으면 그것만 쓴다 — 새 분류(lclsSystm) 태그는 cat 이 빈 항목에만 붙인다.
    둘 다 붙이면 같은 장소에 `해수욕장`·`자연경관(하천·해양)` 처럼 겹친 태그가 생기고, 재수집될 때마다
    기존 행의 태그가 바뀐다.
    """
    if any(re.fullmatch(r"A\d+", c) for c in category_codes):
        category_codes = tuple(c for c in category_codes if re.fullmatch(r"A\d+", c))
    tags: list[str] = []
    for code in category_codes:
        label = _CAT_LABELS.get(code)
        if label is not None and label not in tags:
            tags.append(label)
    return tuple(tags)


# ── 지역 추출 (backend `poi.region varchar(60)` — 시·군·구) ──────────
# ── 여행지가 아닌 것 — 이름으로 확실한 것만 (TRIP-686) ──────────────────
# 출처가 셋으로 늘면서 카테고리가 거친 것(Overture `shopping`·`landmark_and_
# historical_building`)이 편의점·아파트를 실어 왔다. 제주 실측: SHOPPING 241건
# 중 편의점 11·대형마트 4·통신 3, SIGHT 317건 중 **아파트 29**.
#
# **오탐 0 을 실데이터로 확인한 규칙만 둔다.** 한국 상호는 말장난이 많고
# (오랑우탄면사무소·돈사무소·조은미의원·꿀단지 — 전부 식당) 역사 건물은
# 기관명을 단다(구 인천우체국·고려대학교 본관 — 등록문화재). 느슨한 규칙은
# 진짜 여행지를 죽인다. `학원|대학교` 같은 것은 시험해 보니 걸린 26건이 거의
# 전부 대학 박물관이었다 — 폐기. `주공`은 제주**공**항점에, `단지`는 관광단지에
# 걸린다 — 폐기. 여기 남은 것은 접두·접미를 엄격히 잡아 그런 일이 없는 것들이다.
_NON_TRAVEL: tuple[tuple[str, re.Pattern[str]], ...] = (
    # 편의점 — 체인명이 이름 맨 앞이거나 '편의점'이 들어간다.
    # `CU` 만 뒤에 공백을 요구한다(`CUBE 카페` 같은 로마자 상호). 나머지 체인명은
    # 그 자체로 유일해 `이마트24강릉여고점`(공백 없음)도 잡는다 — 안 그러면
    # 대형마트 규칙으로 흘러 드롭은 되지만 통계 사유가 틀린다.
    ("convenience_store",
     re.compile(r"^CU(\s|$)|^(GS\s?25|세븐일레븐|7-?ELEVEN|이마트24|미니스톱|씨스페이스)|편의점",
                re.IGNORECASE)),
    # 대형마트 — 체인명으로 시작해 '○○점'으로 끝나는 것만. `봉채국수 탑동이마트점`
    # (마트 안 식당)은 체인명이 앞에 없어 안 걸린다.
    ("hypermarket",
     re.compile(r"^(롯데마트|홈플러스|코스트코|하나로마트|이마트|트레이더스)\s*\S*점$")),
    # 통신 — 통신사 접두 또는 AS센터 접미. **`KT` 접두는 뺐다** — KT 가 경기장·
    # 공연장 스폰서라 `KT 위즈파크`(수원 야구장, 진짜 ACTIVITY)가 통신으로
    # 떨어진다. 대신 `텔레콤` 문자열로 잡는다 — `KT 동원텔레콤한림점` 은 여전히
    # 걸리고 `KT&G 상상마당` 은 안 걸린다.
    ("telecom",
     re.compile(r"^(SKT|SK텔레콤|LG\s?U\+|T\s?world)(\s|$)|텔레콤|AS\s?센터$", re.IGNORECASE)),
    # 대리점 — 종묘·산삼·의류 무엇이든 "대리점"은 딜러이지 방문지가 아니다.
    # 실측: 산삼배양근대리점 · 모슬포흥농종묘대리점 · Lacoste 제주 대리점.
    ("dealership", re.compile(r"대리점$")),
    # 아파트·오피스텔 — **이름 끝**일 때만. 처음엔 낱말 단위로 잡았다가
    # `아파트 카페`(카페 상호)가 걸려 좁혔다. 실측 26건 중 그 1건이 오탐이었다.
    ("apartment", re.compile(r"(아파트|오피스텔)$")),
    # 단지 관리 주체 — 조직이지 가 볼 곳이 아니다. 아파트 규칙(위)이 이름 끝만 보기
    # 때문에 `…아파트관리사무소`·`…입주자대표회의` 는 끝이 조직명이라 통째로 빠져나갔다.
    # 공유본 57,002 에 돌려 걸린 5곳이 전부 그 모양이고 오탐 0 (2026-10-14).
    ("complex_management",
     re.compile(r"입주자\s*대표회의?|자치관리위원회|관리사무소|관리단$")),
    # 소방·경찰 — 이름 끝 + **앞에 글자가 있을 때만**. 맨 이름이 그 낱말인 것은
    # 상호다(`지구대` — 제천의 실제 카페. 이게 유일한 오탐이라 `지구대` 자체를 뺐다).
    ("public_safety", re.compile(r"(?<=.)(소방서|소방센터|경찰서|파출소)$")),
)


# ── 이름: 전국 치킨·버거·피자·카페 체인 ──────────────────────────────
# **왜 빼나.** 어디에나 있어 여행지에서 먹을 이유가 없고, 앵커당 12자리를 지역 음식점에서
# 뺏는다. 사용자 결정 2026-10-14("노브랜드 버거나 bhc 같은 대규모 치킨버거집 프랜차이즈
# 체인점은 빼자"). 결정 당시 산출 11,005곳 중 113곳이 여기 걸렸고, 그중 '기타' 보충분은
# 7곳뿐이라 보충 경로가 아니라 **전 행에 거는 것이 맞다**.
#
# **범주어가 아니라 브랜드명만 적는다.** `_NOT_A_MEAL_STOP` 이 겪은 함정(`학교`·`CC` 를
# 걸었다가 육식사관학교·씨씨엘치킨이 죽는 것)을 피하는 길은 추측하지 않는 것뿐이다. 아래
# 목록은 실제 산출 11,005곳에 돌려 걸린 113곳을 **전수 눈검사**해 고정했고, 거기서 드러난
# 오탐 두 종을 아래처럼 좁혔다:
#   · `처갓집` → 처갓집상회·처갓집씨암탉(지역 한식당)이 죽어 `처갓집 (양념)치킨` 으로
#   · `BBQ|비비큐` → 강촌비비큐하우스(BBQ house)·소노캄제주BBQ(숯불구이집)가 죽어
#     **상호 맨 앞**이거나 `비비큐치킨` 일 때만
#
# **전국 카페 체인도 같은 이유로 뺀다** (LOCALDATA 휴게음식점 카페 수집, 사용자 결정 2026-10-19 —
# 사용자가 지목한 15개 브랜드 + 첫 산출 눈검사에서 앵커 몫을 10곳 이상 차지한 전국 카페·디저트 체인
# 12개 — 세라젬은 안마의자 매장인데 커피숍으로 등록돼 있다). 이 규칙은 모든 출처에 걸리므로
# 휴게음식점·일반음식점 영업 중 전 행과 공유본에 돌려 **상호 중간에** 걸린 것을 전수 눈검사했다.
# 대부분 법인 접두(`(주)커피빈코리아`)·휴게소·영화관 안 지점이었고, 오탐은 좁혔다:
# `서아이디야`(아이디어 말장난) → `(?<!아)이디야` · `Jalisco(할리스코)`(멕시코 식당) → `할리스(?!코)` ·
# `커피빈스`·`커피빈's`·`커피빈준스`·`커피빈우`(지역 카페) → `커피빈(?![스'준우])`, 영문 `Coffee Bean` 은
# 낱말이 흔해(`킹 Coffee Bean`) 아예 안 적었다 · `달설빙수` → `설빙(?!수)` · `커피베이커리`·`폼폼커피베이비`
# → `커피베이(?![커비])` · `카페베네치아` → `카페베네(?!치)` · `투썸가든` · `컴포즈파크에비뉴`.
# 표기 변주(`엔젤리너스`·`투썸`·`컴포즈`·`TOM N TOMS`)는 산출에 실제로 남아 있던 것이다.
# 공유본에서 새로 걸리는 것은 다음 병합(`merge_pois_docs.drop_non_travel`)에 빠진다 — 수는 PR 본문.
#
# **다른 가게와 한 상호로 묶인 것은 남긴다**(`&`·`,`). `무창포 먹거리식당&자담치킨`,
# `청정횟집&비에이치씨치킨…`, `비에이치씨 완주대둔산점 & 연꽃메밀막국수` 는 체인이 곁다리인
# 지역 식당이다. 체인끼리 묶인 몇 곳(`미스터피자&비비큐치킨밸리점`)이 같이 남지만,
# 지역 식당을 죽이는 쪽이 더 비싸다 — 이 모듈의 "의심스러우면 통과" 원칙 그대로다.
_FRANCHISE = re.compile(
    r"(?:^(?:BBQ|비비큐)|비비큐\s*치킨|^BBQ)"
    r"|(?<![A-Za-z])bhc(?![A-Za-z])|비에이치씨"
    r"|교촌\s*치킨|굽네|네네치킨|페리카나|멕시카나|또래오래|자담치킨|푸라닭|노랑통닭"
    r"|처갓집\s*(?:양념)?\s*치킨|호식이두마리|치킨플러스|지코바|60계\s*치킨|오븐에\s*빠진닭"
    r"|맘스터치|롯데리아|맥도날드|McDonald|버거킹|노브랜드\s*버거|(?<![A-Za-z])KFC(?![A-Za-z])"
    r"|써브웨이|Subway|미스터피자|도미노\s*피자|피자헛|파파존스|피자스쿨|피자마루|반올림피자"
    r"|스타벅스|Starbucks|투썸(?!가든)|Twosome|(?<!아)이디야|Ediya|메가\s*(?:엠지씨|MGC)?\s*커피|컴포즈(?!파크)"
    r"|빽다방|할리스(?!코)|Hollys|커피빈(?![스'준우])|폴\s*바셋|Paul\s*Bassett|파스쿠찌|Pascucci"
    r"|엔[제젤]리너스|탐\s*앤\s*탐스|Tom\s*N\s*Toms|매머드\s*(?:익스프레스|커피)|더\s*벤티|공차|Gong\s*cha"
    r"|설빙(?!수)|요거프레소|디저트\s*39|하삼동\s*커피|텐퍼센트|에이바우트|커피베이(?![커비])|천씨씨\s*커피"
    r"|더리터|카페베네(?!치)|드롭탑|세라젬",
    re.IGNORECASE,
)
# 한 상호에 두 가게가 묶인 표기. 로마자 사이 `&` 는 낱말 안이다 — `스타벅스 HD현대R&D센터` 가 `D센터` 조각에
# 살아남아 공유본에 남았다(2026-10-23).
_JOINED = re.compile(r",|(?<![A-Za-z])&|&(?![A-Za-z])")


# ── 이름: 체인이지만 지점 자체가 가 볼 곳인 매장 — 체인 규칙보다 먼저 본다 ─────────────
# 사용자 결정 2026-10-23("광장마켓에 있는 스타벅스나 경주의 기와로 된 스타벅스 같은 거는 남겨").
# 지점마다 웹 근거가 있다(`data/curated_popular_places.json` evidence) — 여기엔 이름 조각만 둔다.
# 공백을 지우고 소문자로 비교한다(카카오 `스타벅스 더북한강R점`·`올리브영N 성수`).
_DISTINCTIVE_BRANCHES = (
    "스타벅스경주대릉원", "스타벅스광장마켓", "스타벅스경동1960", "스타벅스대구종로고택",
    "스타벅스문경새재", "스타벅스환구단", "스타벅스더북한강", "스타벅스더양평",
    "올리브영n성수",
)


def is_distinctive_branch(name: str | None) -> bool:
    n = re.sub(r"\s", "", name or "").lower()
    return any(k in n for k in _DISTINCTIVE_BRANCHES)


# ── 이름: 어디에나 있는 소매 체인 지점 (사용자 결정 2026-10-23 "다이소 같은 건 다 빼") ─────
# TourAPI 쇼핑(38)이 법정동 이관 뒤 브랜드 매장을 대량으로 싣는다 — 공유본 106,541 중 올리브영 229·
# 롯데하이마트 104·노브랜드 67·다이소 27(+Overture 3). 목록은 공유본 쇼핑 행의 `<브랜드> <지점>점` 꼴을
# 브랜드별로 세어 **전수 눈검사**해 고정했다(음식 체인 규칙과 같은 방식 — 범주어가 아니라 브랜드명만).
# **브랜드가 이름 맨 앞이고 뒤에 공백·괄호·끝이 올 때만** 본다 — `게스트하우스`(게스)·`폴더 커피`(폴더)
# 같은 낱말 겹침을 막는다. 그래서 `폴더`·`비너스`·`웰메이드` 처럼 흔한 낱말 상호는 아예 안 적었다.
_RETAIL_CHAIN = re.compile(
    r"^(?:다이소|Daiso|올리브영|Olive\s*Young|(?:롯데)?하이마트|노브랜드|LG전자\s*베스트샵|삼성\s*디지털\s*프라자"
    r"|전자랜드(?:\s*파워센터)?|아트박스|다비치안경|정관장|유니클로|UNIQLO|스파오|탑텐|에잇세컨즈"
    r"|나이키(?:\s*골프|\s*키즈)?|Nike|아디다스|뉴발란스(?:\s*키즈)?|노스페이스(?:\s*화이트라벨)?|라이프워크"
    r"|디스커버리|코오롱스포츠|블랙야크|네파(?:\s*키즈)?|K2|데상트|엄브로|아식스|언더아머|스케쳐스|크록스|반스"
    r"|게스|MLB|지오다노|로엠|미쏘|후아유|지오지아|슈펜|슈퍼드라이|라코스테|내셔널지오그래픽|원더플레이스"
    r"|ABC\s*마트(?:\s*(?:ST|GS|SP))?|슈마커(?:\s*플러스)?|금강제화|엠픽|로이드|미니골드|골든듀|구구스"
    r"|아리따움|이니스프리|네이처리퍼블릭|토니모리|미샤|홀리카\s*홀리카|렌즈미|오렌즈"
    r"|골프존마켓|골프프렌드\s*골때려골프|골프파트너앤코스모|미즈노|에메필|세라워크|버터샵|세컨페이스"
    r"|핫트랙스|교보문고|세이브존|메가마트)"
    r"(?:(?:\s+\S+){0,2}점|\s*\([^)]*\))?$",
    re.IGNORECASE,
)


# ── 이름: 백화점·아울렛·몰 안의 브랜드 매장 ───────────────────────────────
# `골든듀 롯데백화점 강남점`·`나이키 롯데프리미엄아울렛 이천점` — 가 볼 곳은 백화점이지 그 안의 매장이
# 아니다. 브랜드가 수백 개라 목록으로는 못 따라간다(공유본 쇼핑 체인 접두 244개 중 대부분이 이 꼴).
# **백화점·아울렛 자체(`신세계백화점 센텀시티점`·`롯데프리미엄아울렛 기흥점`)는 남긴다** — 그 앞에
# 운영사 말(`롯데`·`프리미엄`)만 있으면 매장이 아니라 그 백화점이다.
_MALL = re.compile(r"백화점|아울렛|스타필드|롯데몰|AK\s*플라자|아이파크몰")
_MALL_OPERATOR = re.compile(r"^(?:롯데|현대|신세계|신세계사이먼|갤러리아|현대시티|NC|AK|모다|뉴코아|더현대|프리미엄)$")


def _shop_in_mall(name: str) -> bool:
    if not name.endswith("점"):
        return False
    toks = name.split()
    for i in range(1, len(toks)):
        if _MALL.search(toks[i]):
            return any(not _MALL_OPERATOR.match(t) for t in toks[:i])
    return False


def is_franchise(name: str) -> bool:
    """전국 체인 지점이면 True — **단, 묶인 상호는 체인 아닌 쪽이 하나라도 있으면 남긴다.**

    `무창포 먹거리식당&자담치킨` 은 체인이 곁다리인 지역 식당이라 지켜야 하고,
    `미스터피자&비비큐치킨밸리점` 은 양쪽 다 체인이라 지킬 지역 식당이 없다. 그래서
    묶음을 쪼개 **전부 체인일 때만** 뺀다. 가 볼 만한 지점(`is_distinctive_branch`)은 남긴다.
    """
    n = (name or "").strip()
    if not n or is_distinctive_branch(n):
        return False
    parts = [p for p in (s.strip() for s in _JOINED.split(n)) if p]
    # 구분자만 있는 이름(`&`)은 조각이 0개다 — `all([])` 은 참이라 체인으로 빠졌다(PBT 반례).
    return bool(parts) and all(_FRANCHISE.search(p) is not None for p in parts)


def non_travel_reason(name: str | None, category: PoiCategory | str | None = None) -> str | None:
    """이름만으로 여행지가 아님이 확실하면 그 사유, 아니면 None.

    None 은 "여행지다"가 아니라 **"이름으로는 모른다"** 다. 판정은 보수적이다 —
    의심스러우면 통과시키고, 확실한 것만 떨어뜨린다. `category` 는 쇼핑 행 전용 규칙
    (`chain_store`·`shop_in_mall`)에만 쓴다 — 안 주면 그 둘은 걸리지 않는다.
    """
    if not name:
        return None
    n = name.strip()
    for reason, rx in _NON_TRAVEL:
        if rx.search(n):
            return reason
    if is_distinctive_branch(n):
        return None
    # 전국 체인은 정규식 하나로 안 끝난다(묶인 상호를 쪼개 본다) — 별도 함수로 둔다.
    if is_franchise(n):
        return "franchise"
    # 소매 체인·몰 안 매장은 **쇼핑 행에만** — 몰 안 식당(`을밀대 롯데백화점잠실점`)·놀거리(`볼베어파크
    # 롯데몰 은평점`)·`별마당도서관 스타필드 수원점` 은 끼니·갈 곳이고, `디스커버리 네이처스케이프`(명소)·
    # 맨 `교보문고`(문화) 도 이름만으로는 갈린다(공유본 실측 2026-10-23, 쇼핑 밖 오탐 106건 → 0).
    if getattr(category, "value", category) == "SHOPPING":
        if _RETAIL_CHAIN.search(n):
            return "chain_store"
        if _shop_in_mall(n):
            return "shop_in_mall"
    return None


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
# "상시 개방" 류 — 시간 표기가 없어 _TIME_RE 로는 0회 매치라 통째로 버려지던 형태.
# 수집 8,043건 중 파싱 실패 3,475건의 절반(1,771건)이 이 한 문구였다 (공원·해변·
# 자연관광지). 시간을 모르는 게 아니라 **항상 열려 있다**는 뜻이므로 지어내기가 아니다.
_ALWAYS_OPEN_RE = re.compile(r"상시\s*개방|24\s*시간\s*개방|연중\s*개방")
_ALL_DAY = (0, 24 * 60)
_WEEKDAY_RE = re.compile(r"(월|화|수|목|금|토|일)요일")
_WEEKDAY_INDEX = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6}
# ── 휴무 원문 (TRIP-1230) — 규칙은 _parse_rest_days, 근거는 data/README 「휴무를 해석 못 하는 POI」
# 범위는 한 줄 안에서만 — `\s` 로 두면 `<br>` 줄바꿈을 넘어 두 줄의 요일을 범위로 잇는다.
# 양끝 `요일` 은 생략될 수 있다(`매주 월~목요일` — 종전엔 목요일만 닫혔다, 영업 쪽 한정자와 같은 형태).
# 맨 글자는 한글·숫자에 붙어 있지 않을 때만 요일이다(`3월~`·`매월~` 의 월).
_DAY_RANGE_RE = re.compile(
    r"(?:([월화수목금토일])요일|(?<![가-힣\d])([월화수목금토일]))[ \t]*[~∼～〜\-–—][ \t]*"
    r"([월화수목금토일])(?:요일|(?![가-힣]))")
# `주말만 운영`·`주말에만 개장` 의 주말은 여는 날이다 — 쉬는 날로 읽으면 뒤집힌다
_REST_WEEKEND_RE = re.compile(r"주말(?!\s*(?:에\s*)?만)")
_REST_PAREN = re.compile(r"[(（][^)）]*[)）]")
_REST_REMARK = re.compile(r"※[^\n]*")   # 비고는 그 줄 끝까지 — 다음 줄은 본문이다
_REST_BREAK = re.compile(r"<br\s*/?>", re.I)
_REST_CLAUSE_SEP = re.compile(r"[/,\n]")
_REST_PLACEHOLDER = re.compile(r"[-–—]+|없음|해당\s*없음")
_NO_REST_RE = re.compile(r"무휴|휴무\s*일?\s*없음")
# 가게마다 다르다 — 시장·쇼핑몰은 열고 휴무는 개별 점포 몫이라 시설에는 매주 쉬는 날이 없다(2026-10-05 결정,
# 쇼핑 표본의 절반 68/135). 공연·전시·행사·체험별 상이는 그 프로그램이 있어야 여는 곳이라 여전히 모른다.
# **절 전체가 이 문구일 때만**(fullmatch) — `점포별 상이·동절기 휴장`·`공연 및 매장별 상이` 처럼 다른 말이 붙으면
# 그 말의 뜻을 모르므로 휴무 없음으로 확정하지 않는다.
_STORE_VARIES = re.compile(r"(?:각\s*|입점\s*)?(?:점포|매장|상점)\s*(?:별로?|마다)\s*상이(?:함|합니다)?\.?")
# 주간 스케줄로 못 쓰는 비정기 휴일 — 연 단위(명절·공휴일·날짜·기념일·기관장 지정일)와
# 요일 없는 월 단위("월 1회"). 실물 표본에 나온 표기만 넣었다(감으로 늘리지 말 것 — 영업 쪽
# _NOT_OPEN_SEGMENT 의 교훈). 넓은 낱말은 넣지 않는다 — '설' 단독은 "시설별 상이" 에,
# '당일'·'휴관일'·'지정' 은 "당일 사정에 따라 휴무"·"휴관일: 홈페이지 참조" 에 걸려 모르는 글이 휴무
# 없음으로 확정된다.
_IRREGULAR_REST = re.compile(
    r"설날|설\s*당일|추석|명절|공휴일|국경일|성탄|부처님|석가|연휴|\d{1,2}\s*월\s*\d{1,2}\s*일|"
    r"임시\s*휴|(?:지정|정)(?:한|하는)\s*날|기념일|월\s*\d\s*회|근로자의\s*날")
# 앞 절의 명절에 붙은 꼬리 — `설·추석 전날, 당일` 의 `당일` 처럼 홀로 떨어진 절. **절 전체일 때만**
# (`당일 사정에 따라 휴무` 는 모르는 글이다)
_HOLIDAY_TAIL = re.compile(r"(?:전날|당일|다음날|연휴)")
# 기간 표지 — `11월 1일 ~ 3월 31일 휴장`·`3월 1일부터 휴관` 은 날짜가 있어도 비정기 휴일이 아니라 장기 휴장이다
_REST_PERIOD = re.compile(r"[~∼～〜]|부터|까지")


# 영업시간이 **아닌** 시각이 붙는 줄 — 빼고 읽지 않으면 휴게시간이 개점시간이 된다.
# 실물: `09:00~17:00 / 휴게시간 12:00~13:00 / 입장 마감 16:30`
# ⚠️ 실데이터에서 라벨 빈도를 세어 넣었다 — `준비시간` 이 **1,100건으로 1위**다.
# 감으로 목록을 만들었을 때 이게 빠져서 `10:00~18:00 (준비시간 12:00~13:00)` 이
# **12:00~13:00 으로 읽혔다.** 목록은 반드시 실물 빈도로 채운다.
_NOT_OPEN_SEGMENT = re.compile(
    r"준비\s*시간|휴게|브레이크|점심\s*시간|마감|주문|라스트\s*오더|정비|청소|"
    r"\d+\s*항차|\d+\s*회차|대관|예약|상담|입실|퇴실")
# 시설·구역이 여럿이면 **어느 것이 이 장소의 시간인지 모른다** — 통째로 포기한다.
# 실물: `[사우나] 06:00~21:00 [아쿠아나] 실내 10:00~18:00 야외 12:00~17:00`
_SECTION_HEAD = re.compile(r"\[[^\]]{1,20}\]")
_RANGE_RE = re.compile(r"(\d{1,2}):(\d{2})\s*[~\-–—]\s*(\d{1,2}):(\d{2})")
# 이보다 좁으면 회차·교육 세션을 영업시간으로 읽은 것이다 (실측으로 정한 값).
_MIN_WINDOW_MIN = 120
_SEGMENT_SPLIT = re.compile(r"[\n<>()（）\[\]※/]|·|-(?!\s*\d)")
# 날짜가 든 ※ 비고는 기간 한정 안내다(`※ 2025년 07월 22일~08월 31일 10:00~20:00`) — 그 범위가 평소 창
# 후보가 되면 나머지 요일의 창이 넓어진다(실물 1건). 비고만 뺀다 — 본문의 `3월 1일 ~ 10월 31일 09:00~18:00`
# 은 그 장소의 시간이다.
_DATED_REMARK = re.compile(r"※[^※\n<]*?(?:\d{4}\s*년|\d{1,2}\s*월\s*\d{1,2}\s*일)[^※\n<]*")
# 영업 구간 머리의 요일 한정자 — `평일`(`주중`)·`주말`·`X(요일)`·`X(요일)~Y(요일)`(사이 요일까지, 주를 넘어도),
# 그리고 그것들을 `·`·`/`·`,` 로 이은 목록(`토·일요일`·`화요일 / 목요일~금요일`).
# 머리 **전체**가 한정자여야 한다 — `하절기 평일` 은 요일 구간이 아니다(종전 규칙으로 간다). `공휴일` 은 요일이
# 아니라 목록 안에서는 무시하고(`주말·공휴일` = 토·일), 홀로면 한정자이되 요일이 없다(그 범위는 어느 요일 것도 아니다).
_DAY_ITEM_RE = re.compile(
    r"(평일|주중)|(주말)|([월화수목금토일])(?:요일)?(?:[ \t]*[~∼～〜\-–—][ \t]*([월화수목금토일])(?:요일)?)?"
    r"|(?:법정[ \t]*)?공휴일")
_DAY_ITEM = rf"(?:{_DAY_ITEM_RE.pattern})"
_DAY_QUALIFIER = re.compile(rf"[\s\-:,]*{_DAY_ITEM}(?:[ \t]*[·/,、][ \t]*{_DAY_ITEM})*[\s:]*")
# 구간 분할(`·`·`/`·숫자 앞 아닌 `-`)이 요일 목록·범위를 먼저 자르지 않게 미리 `,`·`~` 로 바꿔 둔다 —
# 안 그러면 `토·일요일 10:00~18:00` 의 `토` 가 떨어져 나가 마지막 토큰만 한정자가 된다(공유본 11건),
# `월-금 07:30 - 20:30` 은 `월` 과 `금` 으로 갈렸다(7건). 한글·숫자에 붙은 글자(`매일`·`3월` 의 월)는 요일이 아니다.
_DAY_EXPR = re.compile(rf"(?<![가-힣\d]){_DAY_ITEM}(?:[ \t]*[·/,、][ \t]*{_DAY_ITEM})*(?![가-힣])")
_DAY_LIST_SEP = re.compile(r"[ \t]*[·/,、][ \t]*")
_DAY_RANGE_DASH = re.compile(r"[ \t]*[~∼～〜\-–—][ \t]*")
# 영업 원문 안의 명시 휴무 절(`- 일요일 휴무`) — 시각이 없는 줄만 본다(`_hours_rest_days`).
_HOURS_REST_WORD = re.compile(r"휴무|휴관|휴업|휴점|정기\s*휴일")


def _hours_rest_days(hours_raw: str) -> frozenset[int]:
    """영업 원문 안의 명시 휴무 절이 닫는 요일 — 시각 범위 없이 휴무 낱말이 든 **줄**을 휴무 원문과 같은 규칙
    (`_parse_rest_days`)으로 읽는다. 못 읽는 줄은 무시한다(그 줄 때문에 영업시간까지 버리지 않는다).

    종전엔 괄호·`/`·`·` 로 자른 조각마다 요일을 주웠다 — `(일요일이 공휴일인 경우 월요일 휴무)` 같은 조건
    단서가 매주 휴무가 됐고, `휴관일(매주 월요일)` 은 낱말과 요일이 다른 조각으로 갈려 놓쳤다. 줄째 넘기면
    괄호 단서는 `_parse_rest_days` 가 걷어 낸다. 시각 2회 원문(`10:00 ~ 17:00<br>매주 월요일 휴관 …`, 실물
    어깨동무스토리움)에도 적용한다 — 종전엔 요일별 갈래에서만 읽어 휴무 원문 `연중무휴` 에 월요일이 열렸다.
    """
    days: set[int] = set()
    for line in _REST_BREAK.sub("\n", hours_raw).split("\n"):
        if not _RANGE_RE.search(line) and _HOURS_REST_WORD.search(line):
            days |= _parse_rest_days(line) or frozenset()
    return frozenset(days)


def _weekday_windows(text: str) -> tuple[dict[int, tuple[int, int]], tuple[int, int] | None] | None:
    """요일 한정자가 붙은 구간이 있으면 (요일별 창, 나머지 요일의 창). 없으면 None.

    `- 평일 12:00~21:30<br>- 토요일 12:00~19:00` 을 첫 범위·이른 폐점(계절 보정)으로 읽으면 7일 전부
    12:00~19:00 이 됐다 — 요일 구분을 계절 변형으로 오인해 평일 마감을 잘랐다(2026-10-12 실물).

    - 한정자는 **바로 뒤 범위**를 그 요일들에 준다. 한 구간에 한정자가 여럿이면(`화~금 10:00~21:00, 토~일
      9:00~18:00`·`10:00~21:00, 월 10:00~19:00`) 각자 제 범위를 받는다. 한정자 뒤의 한정자 없는 범위는 그
      요일의 부가 안내라 버린다. 2시간 이하면 회차로 보고 포기(None).
    - 같은 요일이 두 번 나오면 어느 것이 그 요일의 시간인지 모른다 → None(종전 규칙).
    - 한정자 **없는** 구간끼리는 종전 규칙(첫 범위·이른 폐점)으로 **나머지 요일의 창**을 만든다 —
      계절 보정은 한정자 없는 구간 사이에서만 산다(하절기/동절기 함정이 되살아나지 않게).
    - **원문이 말하지 않은 요일 ≠ 휴무.** 나머지 요일의 창은 한정자 없는 구간이 없으면 원문 전체의 종전
      창이다 — 그 요일들은 이 수정 전과 같다. 닫는 것은 영업 원문 안의 명시 휴무 절과 휴무 원문뿐이다.
      추론 휴무가 틀리면 그 요일 후보가 통째로 빠진다(HC1 은 요일 행이 없으면 닫힌 날로 본다).
    - **구역 머리가 전부 요일이면**(`[평일 / 토요일]<br>- 08:00~19:30<br>…[일요일]<br>- 08:00~15:30`) 머리가 곧
      한정자다 — 구역 본문마다 종전 규칙(첫 범위·이른 폐점·2시간·비영업 라벨)으로 읽어 그 요일들에 준다. 종전엔
      구역 머리가 둘 이상이라 통째로 포기했다(공유본 386건). 하나라도 요일이 아니면(`[사우나]`) 어느 구역이
      장소 전체인지 모른다 — 종전대로 포기. 구역 창을 못 읽거나 같은 요일이 두 머리에 나와도 포기.
    """
    heads = list(_SECTION_HEAD.finditer(text))
    sections = [(_qualifier_days(_protect_days(h[0][1:-1])), text[h.end():end])
                for h, end in zip(heads, [h.start() for h in heads[1:]] + [len(text)])]
    if sections and all(days is not None for days, _ in sections):
        preamble = text[:heads[0].start()]
    elif len(heads) > 1:
        return None
    else:
        sections, preamble = [], text
    by_day: dict[int, tuple[int, int]] = {}
    for days, body in sections:
        window = _first_range_window([span for ranges in _open_ranges(body) for _, span in ranges])
        if window is None or any(d in by_day for d in days):
            return None
        by_day.update(dict.fromkeys(days, window))
    rest: list[tuple[int, int]] = []
    for ranges in _open_ranges(preamble):
        qualified = False
        for head, (start, end) in ranges:
            days = _qualifier_days(head)
            if days is None:
                # 한정자 뒤의 한정자 없는 범위는 그 요일의 부가 안내다(`평일 10:00~17:30휴계시간 12:30~13:30` — 오타
                # 라벨이 비영업 줄 검사를 빠져나간 실물). 나머지 요일의 창으로 새면 안 된다.
                if not qualified:
                    rest.append((start, end))
                continue
            qualified = True
            if days and end - start <= _MIN_WINDOW_MIN or any(d in by_day for d in days):
                return None
            by_day.update(dict.fromkeys(days, (start, end)))
    if not by_day:
        return None
    # 한정자 없는 구간의 창이 2시간 이하로 기각돼도 종전 규칙으로 되돌아간다 — None 이면
    # 7일을 못 채워 영업시간을 통째로 잃는다("평일 …<br>- 휴계시간 12:30~13:30"). 항상 종전
    # 규칙으로 가면 이 수정이 고친 오독이 되살아난다(공유본 19건, #1054 리뷰).
    # 구역 머리를 요일로 읽었으면 그 머리는 종전 규칙의 포기 사유(어느 구역이 장소 전체인지)가 아니다.
    others = (_first_range_window(rest) if rest else None) or _first_range_window(
        [span for ranges in _open_ranges(text) for _, span in ranges])
    return by_day, others


def _multi_range_window(text: str) -> tuple[int, int] | None:
    """시각이 3회 이상인 원문에서 영업 창을 고른다. 확신 없으면 None.

    종전에는 통째로 포기했다("어느 창이 맞는지 확정 불가"). 실측(2026-09-26,
    공유본 18,605건): 결측 13,367건 중 **4,764건이 원문에 시각을 갖고 있었다.**

    **첫 범위를 쓴다.** 원문이 대개 "대표 시간 → 부가 안내" 순서라 첫 범위가 그
    장소의 시간이다. 두 규칙을 실데이터로 비교해 골랐다 — 읽어내는 양은 같은데
    오독이 한 자리 적다:

        규칙        읽힘    2시간 이하(의심)
        교집합       839        120
        첫 범위      851          4      ← 채택

    교집합은 `09:00~19:00 … 야시장 18:00~22:00` 처럼 **무관한 시설**과 겹쳐 18~19시로
    좁아졌다. 첫 범위는 그 함정을 안 밟는다.

    보정 둘:
      · **같은 개점의 다른 폐점**(하절기/동절기)이 있으면 **이른 폐점**을 쓴다 —
        넓게 잡으면 닫힌 시간에 일정을 넣는다. 좁으면 후보에서 빠질 뿐이다.
      · 창이 **2시간 이하면 포기** — 회차·교육 세션을 영업시간으로 읽은 흔적이다.

    포기하는 경우: 구역 머리(`[사우나]`)가 둘 이상 — 어느 구역이 장소 전체인지 모른다.
    """
    if len(_SECTION_HEAD.findall(text)) > 1:
        return None
    return _first_range_window([span for ranges in _open_ranges(text) for _, span in ranges])


def _qualifier_days(head: str) -> list[int] | None:
    """범위 앞 머리가 요일 한정자(목록)면 그 요일들(공휴일뿐이면 빈 목록), 아니면 None."""
    if not _DAY_QUALIFIER.fullmatch(head):
        return None
    days: list[int] = []
    for weekday, weekend, a, b in _DAY_ITEM_RE.findall(head):
        if weekday:
            days += range(5)
        elif weekend:
            days += (5, 6)
        elif a:
            first, last = _WEEKDAY_INDEX[a], _WEEKDAY_INDEX[b or a]
            days += ((first + k) % 7 for k in range((last - first) % 7 + 1))
    return days


def _protect_days(text: str) -> str:
    """요일 목록·범위의 이음표를 분할에 안 걸리는 `,`·`~` 로 바꾼다(`_DAY_EXPR` 주석)."""
    return _DAY_EXPR.sub(lambda m: _DAY_LIST_SEP.sub(",", _DAY_RANGE_DASH.sub("~", m[0])), text)


def _open_ranges(text: str) -> list[list[tuple[str, tuple[int, int]]]]:
    """비영업 줄을 뺀 구간마다 [(범위 앞 머리, (개점, 폐점)) …]. 머리는 구간 첫머리나 앞 범위 끝부터다.
    범위 없는 구간은 뺀다."""
    # 괄호도 경계다 — `(준비시간 12:00~13:00)` 이 앞 범위와 한 덩어리로 남으면
    # 라벨 검사가 줄 전체를 버려 정상 범위까지 함께 사라진다.
    # 줄바꿈 없는 글머리표(`- 09:00~21:00- 마지막 주문 20:30`)·※ 비고·`/` 도 경계다 — 벤더가 `<br>` 을
    # 빼고 한 줄로 고쳐 쓴 원문이 늘었다(2026-10-05 되감기 첫 배치 1,691건 중 27건이 이 모양으로 창을 잃었다).
    # 숫자 앞의 `-` 는 시각 범위(`09:00-18:00`)라 끊지 않는다.
    out: list[list[tuple[str, tuple[int, int]]]] = []
    for seg in _SEGMENT_SPLIT.split(_protect_days(_DATED_REMARK.sub(" ", text))):
        # 라벨부터 구간 끝까지만 버린다 — 라벨 **앞**의 범위는 영업시간이다(`10:00~18:00 입장 마감 19:30`·
        # `11:00~22:00준비시간 14:30~16:30`). 구간째 버리면 그 장소의 시간을 잃었다(공유본 5건).
        # 한계: 라벨이 앞 범위를 설명하는 어순(`15:00~17:00 브레이크타임`, 47구간)도 범위가 남는다 — 그것이 원문
        # 첫 범위면 창이 된다. 공유본에서 첫 범위인 1건은 그 범위가 영업시간이었다(`11:00~21:00 브레이크 타임(…)`).
        label = _NOT_OPEN_SEGMENT.search(seg)
        if label:
            seg = seg[:label.start()]
        ranges: list[tuple[str, tuple[int, int]]] = []
        prev = 0
        for m in _RANGE_RE.finditer(seg):
            start, end = int(m[1]) * 60 + int(m[2]), int(m[3]) * 60 + int(m[4])
            if end <= start:
                end += 24 * 60          # 자정 초과 (OpenHour 계약과 동일)
            ranges.append((seg[prev:m.start()], (start, end)))
            prev = m.end()
        if ranges:
            out.append(ranges)
    return out


def _first_range_window(spans: list[tuple[int, int]]) -> tuple[int, int] | None:
    """첫 범위 + 같은 개점의 이른 폐점 + 2시간 상한 — `_multi_range_window` 독스트링의 규칙."""
    # **하나만 남아도 쓴다.** 비영업 줄을 걷어내면 정상 범위가 하나만 남는 것이
    # 흔하다(`09:00~17:00` + 휴게 + 입장마감 → 하나). 둘 이상을 요구하면 가장
    # 잘 읽히는 모양을 통째로 버린다 — 실제로 그렇게 짰다가 테스트가 잡았다.
    if not spans:
        return None
    start = spans[0][0]
    end = min(e for s, e in spans if s == start)   # 계절 변형 중 이른 폐점
    return (start, end) if end - start > _MIN_WINDOW_MIN else None


def parse_open_hours(hours_raw: str | None, rest_raw: str | None) -> tuple[OpenHour, ...]:
    """영업시간 원문 → 주간 OpenHour. 확신할 수 없으면 () (지어내기 금지).

    - hours_raw에서 HH:MM이 **정확히 2회** 등장할 때만 개점~폐점으로 읽는다
      (계절별 시간 등 3회 이상은 어느 창이 맞는지 확정 불가 → 포기).
    - 폐점 ≤ 개점이면 자정 초과 영업으로 보고 +24h (OpenHour 계약).
    - rest_raw 해석은 `_parse_rest_days` — 요일을 못 읽고 무휴·비정기 휴일·점포별 상이도 아닌
      글("동절기 휴장"·"공연 별로 상이함")이면 어느 날 닫는지 모른다 → 전체 포기.
    - 영업 원문 안의 명시 휴무 절(`매주 월요일 휴관`)도 닫는다 — `_hours_rest_days`, 모든 갈래에 같이.
    """
    if not hours_raw:
        return ()
    said_closed = _hours_rest_days(hours_raw)
    always_open = _ALWAYS_OPEN_RE.search(hours_raw) is not None
    if always_open:
        open_min, close_min = _ALL_DAY
    else:
        times = _TIME_RE.findall(hours_raw)
        if len(times) == 2:
            open_min = int(times[0][0]) * 60 + int(times[0][1])
            close_min = int(times[1][0]) * 60 + int(times[1][1])
            if close_min <= open_min:
                close_min += 24 * 60  # 자정 초과 영업 (시작일 귀속)
        elif len(times) > 2:
            split = _weekday_windows(hours_raw)
            if split is not None:
                by_day, others = split
                closed_days = _parse_rest_days(rest_raw)
                if closed_days is None or (others is None and len(by_day) < 7):
                    return ()   # 휴무를 모르거나, 원문이 말하지 않은 요일의 창을 모른다 — 지어내지 않는다
                return tuple(
                    OpenHour(day_of_week=d, open_min=o, close_min=c)
                    for d in range(7)
                    if d not in closed_days and d not in said_closed
                    for o, c in [by_day.get(d) or others]
                )
            window = _multi_range_window(hours_raw)
            if window is None:
                return ()
            open_min, close_min = window
        else:
            return ()

    closed_days = _parse_rest_days(rest_raw)
    if closed_days is None:
        # 휴무를 확신 못 하면 포기 — 단 "상시 개방"은 원문이 이미 휴무 없음을
        # 말하고 있으므로 읽히지 않는 휴무 문구(동절기 휴장 등)에 통째로 지지 않는다.
        if not always_open:
            return ()
        closed_days = frozenset()
    return tuple(
        OpenHour(day_of_week=d, open_min=open_min, close_min=close_min)
        for d in range(7)
        if d not in closed_days and d not in said_closed
    )


def _parse_rest_days(rest_raw: str | None) -> frozenset[int] | None:
    """휴무일 원문 → 매주 쉬는 요일 집합. 해석 불가면 None (호출측이 전체 포기).

    종전엔 명절·공휴일·"첫째 주"가 섞이면 통째로 포기했다 — 박물관 전형 `매주 월요일 / 1월 1일 /
    설·추석 당일` 이 영업시간 창까지 잃었다(표본 584건 중 38.5% 포기). 지금 규칙(TRIP-1230):

    - **요일이 나오면 매주 쉰다고 본다.** `매월 둘째·넷째 월요일` 같은 월 단위도 매주로 넓혀 읽는다 —
      열린 월요일 몇 번을 놓치는 쪽이 닫힌 월요일에 보내는 쪽보다 낫다. 범위(`월요일~수요일`)는
      사이 요일까지(종전엔 양끝만 읽었다), `주말` 은 토·일.
    - **비정기 휴일은 무시한다** — 연 단위(설·추석·1월 1일·공휴일·지정일)와 요일 없는 월 단위.
      주간 스케줄로 못 쓰고, 버리면 창까지 잃는다. `-` 같은 자리표시자는 휴무 없음.
    - **괄호 단서와 ※ 비고는 먼저 빼고 읽는다** — `(단, 월요일이 공휴일이면 다음 평일)`·`(토요일·일요일과
      겹치면 휴관)` 의 요일이 휴무로 잡힌다. 그 밖에 요일이 없을 때만 원문 전체에서 읽는다
      (`연중무휴 (단 매주 월요일 휴무)`). 구역 머리(`[경매] … [판매] …`)가 둘이면 포기.
    - 요일 없는 글은 무휴·비정기 휴일·`점포별 상이`**뿐**이어야 휴무 없음이다. 모르는 글(`동절기 휴장`·
      `공연 별로 상이함`·전화 문의 안내)이나 기간(`11월 1일 ~ 3월 31일 휴장`)이 섞이면 여전히 모른다.
      비고뿐이면 비고는 `점포별 상이` 만 받는다(`※ 점포 별로 상이함`) — 그 밖의 비고는 종전대로 모른다.
    """
    if rest_raw is None:
        return frozenset()
    text = _REST_BREAK.sub("\n", rest_raw).strip()
    if not text or _REST_PLACEHOLDER.fullmatch(text):
        return frozenset()
    if len(_SECTION_HEAD.findall(text)) > 1:
        return None
    body = _REST_REMARK.sub("", _REST_PAREN.sub(" ", text))
    # 단서·비고 밖에 요일이 없으면 원문 전체에서 읽는다 — `연중무휴 (단 매주 월요일 휴무)`·
    # `휴관일(매주 월요일)` 처럼 휴무 요일이 괄호·비고에만 있는 문구가 있다. 종전 파서가 읽던 요일을
    # 놓치면 닫힌 날에 일정이 들어간다(넓게 읽는 쪽이 안전하다).
    days = _rest_weekdays(body) or _rest_weekdays(text)
    if days:
        return frozenset(days)
    clauses = _rest_clauses(body)
    if not clauses:
        # 비고뿐 — `점포별 상이` 만 받는다(2026-10-05 결정의 범위). ※ 마다 끊어 한 줄의 두 비고가 섞이지 않게.
        remarks = _rest_clauses(_REST_PAREN.sub(" ", text).replace("※", "\n"))
        return frozenset() if remarks and all(_STORE_VARIES.fullmatch(c) for c in remarks) else None
    if all((_NO_REST_RE.search(c) or _IRREGULAR_REST.search(c) or _STORE_VARIES.fullmatch(c)
            or _HOLIDAY_TAIL.fullmatch(c))
           and not _REST_PERIOD.search(c) for c in clauses):
        return frozenset()  # 무휴·비정기 휴일·점포별 상이뿐 — 매주 쉬는 요일은 없다
    return None  # 모르는 글이 섞였다(`동절기 휴장`·`공연 별로 상이함`·전화 문의 안내) — 확신 없음


def _rest_clauses(text: str) -> list[str]:
    return [c for c in (c.strip(" -") for c in _REST_CLAUSE_SEP.split(text)) if c]


def _rest_weekdays(text: str) -> set[int]:
    """휴무 문구 안의 요일 — `X요일`, 범위 `X(요일)~Y(요일)`(사이 요일까지, 주를 넘어도), `주말`."""
    days = {_WEEKDAY_INDEX[m] for m in _WEEKDAY_RE.findall(text)}
    for a, bare, b in _DAY_RANGE_RE.findall(text):
        start, end = _WEEKDAY_INDEX[a or bare], _WEEKDAY_INDEX[b]
        days.update((start + k) % 7 for k in range((end - start) % 7 + 1))
    if _REST_WEEKEND_RE.search(text):
        days.update((5, 6))
    return days


# ── 영업시간 원문 칸 (backend `poi.opening_hours varchar(200)`, TRIP-1226) ──────
# 백엔드는 원문 한 칸만 저장하고(PoiProposalDtos.toCommand) AI 는 런타임에 그 칸을
# 다시 파싱한다(backend_poi_db). 휴무 원문(restdate류)을 실을 칸이 따로 없어 영업 원문
# 뒤에 붙인다 — 영업 원문만 실었을 때는 수집 때 반영한 주간 휴무가 런타임에 사라져
# 휴무일에도 영업으로 읽혔다(2026-10-02 실측: 주간 휴무 FOOD 312건).
#
# 이 칸은 화면에도 그대로 나간다(FE 장소 상세가 `<br>` 만 줄바꿈으로 바꿔 그린다) —
# 그래서 구분자를 읽히는 모양(줄바꿈 + `휴무: `)으로 정했다. 영업 원문에 같은 문자열이
# 있으면 한 칸을 띄워 무력화하므로(파싱 결과는 그대로) **첫 등장이 곧 구분자**다.
# 구분자는 앞머리와 꼬리가 겹치지 않는 문자열이라 경계에 걸친 가짜 등장도 없다.
OPENING_HOURS_MAX = 200  # backend poi.opening_hours varchar(200)
REST_SEP = "\n휴무: "
_REST_SEP_DEFUSED = "\n휴무 : "


def join_opening_hours_raw(
    hours_raw: str | None, rest_raw: str | None, limit: int = OPENING_HOURS_MAX,
) -> str | None:
    """영업·휴무 원문 → 원문 칸 하나. 상한을 넘으면 **휴무를 보존하고 영업을 먼저 자른다**.

    휴무 원문이 비었거나 영업 원문이 없으면 종전과 같다(영업 원문 절단만). 영업 원문
    없이 휴무만 싣지 않는 이유: 백엔드가 이 칸의 유무로 "영업시간 확인됨"을 판정한다
    (`SlotSurfaceAssembler.openingHoursKnown`).

    파서가 해석 못 하는 휴무(`동절기 휴장`·`공연 별로 상이함` …)도 싣는다. 빼면 런타임이 7일
    영업으로 읽어 이 칸이 수집 파싱의 입력을 잃는 원래 결함이 되살아나고, 벤더 문구가
    남지 않아 파서를 고쳐도 다시 받아야 한다. 대가로 그런 POI 는 런타임에도 "정보 없음"
    (HC1 미적용)이다 — 건수는 수집 stats `rest_unparsed`, 결정·실측은 ai/data/README.md.
    """
    if not hours_raw:
        return hours_raw
    hours = hours_raw.replace(REST_SEP, _REST_SEP_DEFUSED)
    rest = (rest_raw or "").strip()
    if not rest or not hours.strip():
        return _truncate(hours, limit)
    tail = REST_SEP + rest
    # 영업을 먼저 자르되 절반 아래로는 안 내린다 — 긴 휴무 원문이 영업시간을 통째로 밀어내지 않게.
    hours = _truncate(hours.rstrip(), max(limit - len(tail), limit // 2))
    return hours + _truncate(tail, limit - len(hours))


_DAY_LABEL = "월화수목금토일"


def render_open_hours(hours: Sequence[OpenHour]) -> str | None:
    """주간 OpenHour → **우리 형식의 영업 원문.** `parse_open_hours` 의 역이다.

    **왜 필요한가.** 수신 계약(`PoiProposalDtos.ProposalItem`)은 영업시간을
    `opening_hours_raw` **한 칸으로만** 받는다 — `poi.open_hours` 는 `ProposalPoi` 가
    name·category·coord 만 읽어 조용히 버려진다. 그래서 파싱값만 채우면 DB 에 아무것도
    안 들어간다(2026-10-14 실측: 3,996곳이 적재돼도 런타임에 안 보였다).

    **다른 데서 받은 글자를 그대로 넣지 않으려고 만든다.** 원문 칸은 우리가 읽어 다시
    파싱하는 자리이므로, 남의 표기를 그대로 두면 그 표기의 버릇까지 우리 파서가 떠안는다.
    파싱한 뒤 **우리 표기로 다시 적으면** 왕복이 보장되고(테스트가 고정) 칸의 뜻도 지켜진다.

    같은 시간대가 이어지는 요일은 범위로 묶는다 — `월~금 09:30~23:30, 토~일 08:00~22:00`.

    **자정 넘김은 되감아 적는다** — `close_min=1740` 은 `11:00~05:00` 이지 `11:00~29:00`
    이 아니다. 파서의 시각 정규식은 `2[0-3]:[0-5]\\d` 까지만 읽으므로 29시를 적으면 그
    줄을 통째로 다르게 읽는다(왕복 PBT 가 잡았다). 닫는 쪽이 여는 쪽보다 이르면 파서가
    1440 을 더해 되살린다 — 그게 수집 때와 같은 해석이다.
    """
    if not hours:
        return None
    by_day = {h.day_of_week: (h.open_min, h.close_min) for h in hours}
    parts: list[str] = []
    start = None
    for day in range(8):      # 8 번째 바퀴에서 마지막 묶음을 닫는다
        cur = by_day.get(day)
        if start is not None and cur == by_day.get(start):
            continue
        if start is not None:
            o, c = by_day[start]
            c %= 24 * 60      # 자정 넘김은 되감아 적는다 — 위 주석 참조
            span = _DAY_LABEL[start] if day - 1 == start else f"{_DAY_LABEL[start]}~{_DAY_LABEL[day - 1]}"
            parts.append(f"{span} {o // 60:02d}:{o % 60:02d}~{c // 60:02d}:{c % 60:02d}")
        start = day if cur is not None else None
    return ", ".join(parts) or None


def rest_phrase(days: Iterable[int]) -> str:
    """휴무 요일 → 파서가 읽는 정형 문구. `{0, 2}` → `매주 월요일, 수요일`.

    `render_open_hours` 와 **짝이다** — 영업 원문만 쓰면 파서가 부분 주간을 7일로 펼쳐
    쉬는 날이 사라진다(실데이터 3,991건 성립률 54% → 휴무를 붙이면 100%). 둘을 같은
    모듈에 두는 이유다. 종전엔 `scripts/collect/backfill_rest_days.py` 에 있었다.
    """
    return "매주 " + ", ".join(f"{_DAY_LABEL[d]}요일" for d in sorted(days))


def split_opening_hours_raw(text: str | None) -> tuple[str | None, str | None]:
    """원문 칸 → (영업 원문, 휴무 원문). 구분자가 없는 옛 원문은 (원문, None) — 종전 해석 그대로."""
    if not text:
        return text, None
    hours, sep, rest = text.partition(REST_SEP)
    return (hours, rest) if sep else (text, None)


def parse_opening_hours_raw(text: str | None) -> tuple[OpenHour, ...]:
    """원문 칸 → 주간 OpenHour. 수집 때와 같은 두 입력(영업·휴무)으로 같은 파서를 부른다."""
    return parse_open_hours(*split_opening_hours_raw(text))


def _truncate(text: str | None, limit: int) -> str | None:
    """저장 상한에 맞춰 자른다(거부 아님) — 잘림은 말줄임표로 드러낸다 (안티패턴 로그)."""
    if text is None or len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


# ── 교차 출처 동일성 판정 (TRIP-682) ──────────────────────────────────────
# 출처가 둘 이상이 되면 같은 가게가 서로 다른 source_ref 로 두 번 들어온다.
# 좌표만으로는 부족하다 — 실측(TourAPI × LOCALDATA 동일 가게 6,886쌍): 중앙값
# 7.8m 로 대부분 겹치지만 p95 가 52.0m 라 [[collection_gate]] 3단의 50m 반경이
# 94.7% 에서 끊기고, 최대 8.4km 짜리(한쪽 좌표 오류)까지 있다. 주소는 좌표
# 오차와 무관하므로 반경을 넓히는 대신 주소 키를 쓴다 (반경을 넓히면 옆 가게를
# 병합한다).
#
# 규칙 자체는 `scripts/classify/match_business_status.py` 의 폐업 대조에서 검증된 것과
# 같다(주소 키 83.3%, 주소O이름X 는 붙이지 않음). 다만 **정의가 지금 두 곳에
# 있다** — 그쪽은 stdlib 만으로 도는 독립 스크립트이고 자체 테스트가 물고 있어
# 이번 변경에서 건드리지 않았다. 두 곳이 갈라지면 "폐업으로 붙인 가게"와
# "중복으로 병합한 가게"의 판정이 어긋나므로, LOCALDATA 를 POI 원천으로
# 승격할 때(그때 두 경로가 실제로 같은 데이터를 본다) 스크립트가 여기를
# 가져다 쓰도록 합친다.

_ADDR_PAREN = re.compile(r"[(（][^)）]*[)）]")
_ADDR_SPACE = re.compile(r"\s+")
# 읍·면·동이 한쪽에만 있는 표기 차를 `.*?` 로 건너뛴다 — 이것이 매칭률을
# 35.5% → 83.3% 로 올린 조각이다 (2026-09-08 실측).
_ADDR_ROAD = re.compile(
    r"^(?P<sido>\S+?[시도])\s+(?P<sgg>\S+?[시군구])\s+.*?"
    r"(?P<road>\S*[로길])\s+(?P<bldg>\d+(?:-\d+)?)"
)
# 상호 꼬리표만 뗀다. 지역명+점("강남점")은 **떼지 않는다** — 떼면 50m 안의
# 다른 지점끼리 병합된다.
_NAME_SUFFIX = re.compile(r"(본점|직영점|\d+호점)$")


def addr_key(address: str | None) -> tuple[str, str, str, str] | None:
    """도로명주소 → (시도2자, 시군구, 도로명, 건물번호). 해석 불가면 None.

    None 은 "주소가 다르다"가 아니라 **"모른다"** 다 — 호출측이 동일성 근거로
    쓰면 안 된다 (관광단지 내 주소 등 4.4% 가 여기 떨어진다).
    """
    if not address:
        return None
    cleaned = _ADDR_SPACE.sub(" ", _ADDR_PAREN.sub(" ", address).split(",")[0]).strip()
    m = _ADDR_ROAD.search(cleaned)
    if m is None:
        return None
    return (m["sido"][:2], m["sgg"], m["road"], m["bldg"])


def normalize_business_name(name: str | None) -> str:
    """상호 정규화 — 공백·괄호 제거 + 꼬리표 절단. 비교 전용."""
    return _NAME_SUFFIX.sub("", _ADDR_SPACE.sub("", _ADDR_PAREN.sub("", name or "")))


def same_business_name(a: str | None, b: str | None) -> bool:
    """정규화 상호가 같거나 한쪽이 다른 쪽에 포함되면 같은 가게로 본다.

    포함 판정에 2자 하한을 두는 이유: 1자 상호가 아무 이름에나 걸린다.
    **주소가 같다는 전제에서만** 쓸 것 — 주소 없이 쓰면 전국의 동명 가게가
    붙는다 (이름 유사도 단독 판정이 실측에서 전부 오병합이었다, [[entity_resolver]]).
    """
    na, nb = normalize_business_name(a), normalize_business_name(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    return len(na) >= 2 and len(nb) >= 2 and (na in nb or nb in na)
