"""POI 도메인 타입 (domain-entities.md §1).

가격 캐싱 금지 (business-rules.md §6): `to_cacheable_dict()`는 avg_cost를 제외 —
CachePort에 저장되는 직렬화 경로에서 구조적으로 차단.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from enum import Enum

from trippilot.domain.common import GeoPoint, PoiId


# 밤에 노는 곳(댄스 클럽·칵테일바·와인바·재즈바·루프탑바·이자카야·호프) — 경계 8종엔 칸이 없어 태그로 싣는다
# (2026-10-15 사용자 결정 "클럽·바를 수집해 액티비티로"). 다시 짜기 "밤에 놀기" 지시와 추정 영업시간이 이 태그를 본다.
# 2026-10-21: 이름을 `나이트라이프` 에서 `술집` 으로 바꿨다(TRIP-1537) — 정식 카테고리 승격(후속) 때 같은 이름을 쓴다.
NIGHTLIFE_TAG = "술집"
# 웹 검색으로 "요즘 많이 가는 곳"이라 확인한 장소(`data/curated_popular_places.json`, 항목마다 근거 URL).
# 규칙 점수의 인기 항 바닥을 올린다(`scorer._popularity_norm`) — 인앱 저장 수가 아직 전부 0이라 대역이다.
TRENDING_TAG = "요즘 인기"
# 지도 앱 평판에서 뽑은 파생 태그(2026-10-21, TRIP-1537) — 원자료는 서버에 올리지 않고 구간만 싣는다.
# `인기1`~`인기5`: 리뷰 수 구간(100·190·330·570·1,100건 경계), `평점높음`: 별점 4.8 이상이고 리뷰 100건 이상.
# 태그가 없는 곳은 "나쁘다"가 아니라 "모른다"다 — 중립으로 둔다(`reputation_bonus`).
POPULARITY_TAG_PREFIX = "인기"
HIGH_RATING_TAG = "평점높음"


def popularity_grade(tags: tuple[str, ...]) -> int | None:
    """`인기1`~`인기5` 태그의 등급(1~5). 없으면 None — 모른다."""
    for t in tags:
        if t.startswith(POPULARITY_TAG_PREFIX) and t[len(POPULARITY_TAG_PREFIX):] in ("1", "2", "3", "4", "5"):
            return int(t[len(POPULARITY_TAG_PREFIX):])
    return None


# 지도 앱 평판 태그(`인기1`~`인기5`·`평점높음`) 보정 — 작게 둔다. 범위 -0.06 ~ +0.10(폭 0.16)이라 같은 카테고리 안의 순서를
# 주로 가르고, 카테고리 가중 한 단(0.1) 차이는 등급이 가장 벌어질 때만 뒤집는다. 태그가 없으면 0(중립) — 모르는 곳을 깎지 않는다(TRIP-1537).
REPUTATION_STEP = 0.03     # 인기 등급 한 단 — 3등급이 기준선
HIGH_RATING_BONUS = 0.04


def reputation_bonus(tags: tuple[str, ...]) -> float:
    """인기 등급과 높은 평점 태그 → -0.06 ~ +0.10. 태그가 하나도 없으면 0.0."""
    grade = popularity_grade(tags)
    bonus = 0.0 if grade is None else (grade - 3) * REPUTATION_STEP
    return bonus + (HIGH_RATING_BONUS if HIGH_RATING_TAG in tags else 0.0)


class PoiCategory(Enum):
    """경계 카테고리 10종 + 내부 전용 STAY (TRIP-281, 미술·술집 신설 TRIP-1545).

    앞 10종은 백엔드 `/internal/pois` read 포트가 내보내는 경계 코드와 값·집합이 동일하다
    (`backend/.../placedata/domain/Poi.kt` 한글 정본 ↔ `PoiInternalController.boundaryCode()`:
    명소=SIGHT · 맛집=FOOD · 카페=CAFE · 야경=NIGHT_VIEW · 자연=NATURE · 쇼핑=SHOPPING ·
    문화=CULTURE · 액티비티=ACTIVITY · 미술=ART · 술집=BAR).

    한↔영 매핑은 **백엔드 리버스 read 포트(BE-5)가 이미 수행**해 영문 코드로 내보내므로
    이 모듈에는 매핑이 필요 없다. 다만 한글 값을 그대로 받는 다른 경계(예: DB 직접 조회·
    레거시 응답)가 생기면 매핑 어댑터가 필요하며, 그 위치는 U5 경계 어댑터 소관이다.
    """

    FOOD = "FOOD"
    CAFE = "CAFE"
    SIGHT = "SIGHT"
    NIGHT_VIEW = "NIGHT_VIEW"
    NATURE = "NATURE"
    CULTURE = "CULTURE"
    ACTIVITY = "ACTIVITY"
    SHOPPING = "SHOPPING"
    # 2026-10-21 신설(TRIP-1545): 문화에서 갤러리·미술관을, 액티비티·맛집에서 술집을 분리했다. 데이터는 그동안
    # 태그(`갤러리`·`술집`)로 실려 왔고, 승격 뒤에도 `술집` 태그(NIGHTLIFE_TAG)는 그대로 둔다 — 밤 시간대 규칙이 본다.
    ART = "ART"
    BAR = "BAR"
    # 내부 전용(숙소 앵커·체류시간 계산). 경계 카테고리 10종에 포함되지 않으며
    # `/internal/pois` 응답에 등장하지 않는다 (PR #104 회신).
    STAY = "STAY"


# 먹자골목·음식 골목은 TourAPI 가 액티비티로 주지만 실질은 식당 밀집이다 — 계열 판정
# (agents/schedule/family.py)과 조립의 FOOD 하루 상한이 같이 쓴다('자갈치 양곱창 골목'이
# '자갈치 크루즈'를 눌렀다). '…거리·…타운' 은 **음식 단어가 붙은 꼴만** 잡는다 — '거리|타운$'
# 전체는 '영화의 거리'·'로데오거리'·'가구거리'·'패션타운'까지 잡는다(2026-10-03 실측: 비FOOD
# 124곳 중 음식 거리 30곳, 이 규칙은 그 30곳만 잡고 오탐 0). 괄호 접미·공백을 뗀 이름에 건다.
EATERY_NAME = re.compile(
    r"골목$|먹자|먹거리|카페거리"
    r"|(음식|맛집|푸드|포차)[가-힣]*(거리|타운)$"
    r"|(탕|국|찜|밥|구이|불고기|통닭|대게|한우|홍어|삼겹살|떡볶이|한식)(특화)?(거리|타운)$")
_NAME_NOISE = re.compile(r"\([^)]*\)|\[[^\]]*\]|\s+")


def counts_as_food(poi: Poi) -> bool:
    """FOOD 이거나 이름이 음식 골목인 POI — 조립의 FOOD 하루 상한이 세는 기준."""
    return (poi.category is PoiCategory.FOOD
            or EATERY_NAME.search(_NAME_NOISE.sub("", poi.name)) is not None)


# ── 공휴일 휴무 (상황 감지 H1 · BR-SA-17) ─────────────────────────────────
# 휴일 규칙 토큰의 닫힌 집합. 태그는 특일 달력(`ports.holiday_calendar_port`)이 그 날에 붙이는 어휘와 같고,
# 날짜 명시형 "MM-DD"(`1월 1일`·`성탄절`)는 달력 없이도 그 날을 닫는다. 규칙은 휴무 원문에서
# `poi_curation.sourcing.holiday_rules` 가 읽는다. 명절 튜플은 (전날, 당일, 다음날) 순 — 파서의 한정자와
# 달력의 연속 3일이 같은 자리를 쓴다.
PUBLIC_HOLIDAY = "PUBLIC"
SEOLLAL = ("SEOLLAL_EVE", "SEOLLAL_DAY", "SEOLLAL_NEXT")
CHUSEOK = ("CHUSEOK_EVE", "CHUSEOK_DAY", "CHUSEOK_NEXT")
BUDDHA = "BUDDHA"
HOLIDAY_TAGS = frozenset({PUBLIC_HOLIDAY, *SEOLLAL, *CHUSEOK, BUDDHA})
_DATED_RULE = re.compile(r"\d{2}-\d{2}")

# 날짜 → 그 날 태그 (특일 달력). None 이 아니라 **빈 매핑**이면 모드는 켜졌는데 달력을 못 읽은 것이다
# (실패·키 미등록) — 그때도 날짜 명시형 규칙은 산다.
HolidayCalendar = Mapping[date, frozenset[str]]


def is_holiday_rule(token: str) -> bool:
    """닫힌 집합 — 태그 8종 또는 실제로 있는 날짜의 "MM-DD"(윤일 02-29 포함)."""
    if token in HOLIDAY_TAGS:
        return True
    if not _DATED_RULE.fullmatch(token):
        return False
    try:
        date(2000, int(token[:2]), int(token[3:]))  # 2000 = 윤년
    except ValueError:
        return False
    return True


def closed_by_holiday(poi: Poi, day: date, holidays: HolidayCalendar | None) -> bool:
    """휴일 규칙이 그 날을 닫는가 — 날짜 명시형이 그 날이거나 규칙이 달력 태그와 겹친다. None(모드 off)이면 거짓."""
    if holidays is None or not poi.holiday_rules:
        return False
    return (f"{day:%m-%d}" in poi.holiday_rules
            or not poi.holiday_rules.isdisjoint(holidays.get(day, ())))


def open_windows_on(
    poi: Poi, day: date, holidays: HolidayCalendar | None = None,
) -> tuple[OpenHour, ...] | None:
    """그 날 영업 창 — None = 모름(영업정보 없음, 막지 않는다), () = 그 날 휴무가 **증명**됐다.

    HC1 검증과 조립 전 경로(그 날 창·필수 방문 정의역·차선책·후보 거르기)가 **이것 하나**를 본다 — 규칙이
    둘이면 조립이 둔 핀을 검증이 거부한다. `day` 는 날짜다(datetime 이 아니라 — 달력 키가 날짜다).

    `holidays` None(`HOLIDAY_CLOSURE_MODE=off`)이면 공휴일을 보지 않는다 — 종전 요일 판정과 같다.
    매핑이 오면 휴일 규칙이 그 날을 닫는 곳은 주간 영업정보가 없어도 () 다(휴무 원문이 그 날 닫는다고 말했다).
    정기 휴무(그 요일 창 없음)는 공휴일과 무관하게 종전대로다.
    """
    if closed_by_holiday(poi, day, holidays):
        return ()
    if not poi.open_hours:
        return None
    return tuple(oh for oh in poi.open_hours if oh.day_of_week == day.weekday())


class DataQuality(Enum):
    """MINIMAL은 후보 풀에서 제외 (M7 필터). 순서 = 품질 오름차순."""

    MINIMAL = "MINIMAL"
    PARTIAL = "PARTIAL"
    FULL = "FULL"


class PoiSource(Enum):
    SEED = "SEED"
    PLACES_API = "PLACES_API"
    WEB = "WEB"  # WEB은 confidence 필수 (아래 Poi.__post_init__)


@dataclass(frozen=True, slots=True)
class OpenHour:
    """영업시간. close_min은 1440 초과 허용(자정 초과 방문, 시작일 귀속)."""

    day_of_week: int  # 0~6 (월=0)
    open_min: int
    close_min: int

    def __post_init__(self) -> None:
        if not 0 <= self.day_of_week <= 6:
            raise ValueError(f"day_of_week 범위 밖 [0,6]: {self.day_of_week}")
        if self.open_min < 0:
            raise ValueError(f"open_min 음수: {self.open_min}")
        if not self.open_min < self.close_min:
            raise ValueError(f"open<close 위반: {self.open_min} !< {self.close_min}")

    def to_dict(self) -> dict:
        return {
            "day_of_week": self.day_of_week,
            "open_min": self.open_min,
            "close_min": self.close_min,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "OpenHour":
        return cls(
            day_of_week=d["day_of_week"],
            open_min=d["open_min"],
            close_min=d["close_min"],
        )


@dataclass(frozen=True, slots=True)
class Poi:
    poi_id: PoiId
    name: str
    category: PoiCategory
    coord: GeoPoint
    open_hours: tuple[OpenHour, ...]
    avg_cost: int | None  # None → 예산 필터 통과. 가격 캐싱 금지 대상 필드
    rating: float | None
    quality: DataQuality
    source: PoiSource
    confidence: float | None
    saved_count: int = 0  # 인앱 저장(좋아요) 수 = 인기 신호. 별점(rating)과 별개 소스
    # 벤더 세분류 (TourAPI cat2/cat3 명칭 — "역사관광지"·"카페/전통찻집"·"한식").
    # `category` 8종으로는 못 가르는 축을 모델에게 주기 위한 것이다 — 우천 판정표가
    # FOOD·SIGHT 를 중립으로 두는 이유가 "실내외 혼재"인데(assembly_engine/config.py),
    # 혼재를 푸는 정보가 바로 여기 있다(유적지=야외 ↔ 박물관=실내).
    # 백엔드 `poi.tags text[]` 정본. 미노출 경계에서는 빈 튜플 — 그래서 후미 기본값이다.
    tags: tuple[str, ...] = ()
    # 벤더 항목 식별자 (TourAPI contentid). **KB-5 장소 지식의 조인 키다** —
    # AI 가 자기 파생 지식을 자기 스토어에 들고 이 번호로 런타임 후보에 붙인다.
    # 백엔드가 2026-09-16 에 내부 read DTO 로 열었다(`PoiReadResponse.sourceRef`).
    # POI 정본은 여전히 백엔드 단독 소유다 — 우리가 드는 건 POI 가 아니라 파생 지식이다.
    source_ref: str | None = None
    # 휴일 규칙 (상황 감지 H1) — 휴무 원문이 말한 공휴일·명절·날짜 휴무. 런타임 적재(backend_poi_db)가 원문
    # 칸에서 읽어 채우고, 판정은 `open_windows_on` 이 달력과 함께 한다. 모드 off 면 읽어도 무력하다.
    holiday_rules: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        if not self.poi_id:
            raise ValueError("poi_id는 비어있을 수 없음")
        if self.source is PoiSource.WEB and self.confidence is None:
            raise ValueError("WEB 소스는 confidence 필수 (INV-1 수집 게이트)")
        if self.avg_cost is not None and self.avg_cost < 0:
            raise ValueError(f"avg_cost 음수: {self.avg_cost}")
        if self.saved_count < 0:
            raise ValueError(f"saved_count 음수: {self.saved_count}")
        bad = sorted(r for r in self.holiday_rules if not is_holiday_rule(r))
        if bad:
            raise ValueError(f"휴일 규칙 토큰이 닫힌 집합 밖: {bad}")

    def to_dict(self) -> dict:
        d = {
            "poi_id": str(self.poi_id),
            "name": self.name,
            "category": self.category.value,
            "coord": self.coord.to_dict(),
            "open_hours": [oh.to_dict() for oh in self.open_hours],
            "avg_cost": self.avg_cost,
            "rating": self.rating,
            "saved_count": self.saved_count,
            "quality": self.quality.value,
            "source": self.source.value,
            "confidence": self.confidence,
            "tags": list(self.tags),
            "source_ref": self.source_ref,
        }
        # 규칙이 없으면 키를 싣지 않는다 — 수집 제안 문서(백엔드 수신 `PoiProposalDocument`·공유본)가 이 직렬화를
        # 그대로 싣는다. 규칙은 런타임 적재만 채우므로 그 와이어·공유본 모양은 바뀌지 않는다.
        if self.holiday_rules:
            d["holiday_rules"] = sorted(self.holiday_rules)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Poi":
        return cls(
            poi_id=PoiId(d["poi_id"]),
            name=d["name"],
            category=PoiCategory(d["category"]),
            coord=GeoPoint.from_dict(d["coord"]),
            open_hours=tuple(OpenHour.from_dict(x) for x in d["open_hours"]),
            avg_cost=d["avg_cost"],
            rating=d["rating"],
            saved_count=d.get("saved_count", 0),  # 구 캐시 호환
            quality=DataQuality(d["quality"]),
            source=PoiSource(d["source"]),
            confidence=d["confidence"],
            tags=tuple(d.get("tags") or ()),  # 구 캐시 호환 (saved_count 선례)
            source_ref=d.get("source_ref"),
            holiday_rules=frozenset(d.get("holiday_rules") or ()),  # 키 없는 옛 직렬화본 = 규칙 없음
        )

    def to_cacheable_dict(self) -> dict:
        """캐시 저장용 — 가격(avg_cost) 제외 (business-rules.md §6)."""
        d = self.to_dict()
        del d["avg_cost"]
        return d


@dataclass(frozen=True, slots=True)
class ExtractedPlace:
    """자유 웹 추출 원시 후보 (프롬프트 정본 §2.5, 수집 게이트 전 단계).

    SourcedPoi(coord·category 필수)보다 앞선 형태 — 문서에 없는 필드는 null 보존
    ("추측·창작 금지" 가드레일). 수집 게이트(U6 sourcing)가 지오코딩·검증 후 승격.
    """

    name: str
    address: str | None
    coord: GeoPoint | None  # 좌표 임의 생성 금지 — 주소만 있으면 None
    hours: str | None
    category_raw: str | None  # PoiCategory 매핑은 게이트 몫
    confidence: float  # 0.0~1.0 (게이트에서 클램프)
    source_url: str

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "address": self.address,
            "coord": self.coord.to_dict() if self.coord else None,
            "hours": self.hours,
            "category_raw": self.category_raw,
            "confidence": self.confidence,
            "source_url": self.source_url,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ExtractedPlace":
        return cls(
            name=d["name"],
            address=d["address"],
            coord=GeoPoint.from_dict(d["coord"]) if d.get("coord") else None,
            hours=d["hours"],
            category_raw=d["category_raw"],
            confidence=d["confidence"],
            source_url=d["source_url"],
        )


@dataclass(frozen=True, slots=True)
class SourcedPoi:
    """웹 소싱 원시 후보 (PlacesPort 반환, M7 수집 게이트 전 단계).

    ※ domain-entities.md의 PlacesPort(§2.3) 시그니처가 참조하나 엔티티 표엔 미정의 —
    U1에서 최소 형태로 도입. M7 등록 게이트(U6)를 통과해야 Poi로 승격.
    """

    name: str
    coord: GeoPoint
    category: PoiCategory
    source_url: str | None
    raw_confidence: float | None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "coord": self.coord.to_dict(),
            "category": self.category.value,
            "source_url": self.source_url,
            "raw_confidence": self.raw_confidence,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "SourcedPoi":
        return cls(
            name=d["name"],
            coord=GeoPoint.from_dict(d["coord"]),
            category=PoiCategory(d["category"]),
            source_url=d["source_url"],
            raw_confidence=d["raw_confidence"],
        )
