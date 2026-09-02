# TripPilot AI 데이터 설계

> 짝 문서: [ai-architecture.md](./ai-architecture.md) §2 (M7 Place Data).
> 본 문서는 AI 파이프라인의 **데이터 계층(M7)** — POI 스키마·closed-set 후보 풀 생성·캐싱 전략을 정의한다.

---

## 1. M7 Place Data 역할

M7은 AI 파이프라인의 **그라운딩 토대**다. LLM이 환각을 낼 수 없는 이유는 M7이 만든 closed-set 후보 풀 밖의 ID를 C1 출구 게이트가 드롭하기 때문이다(INV-1).

```
M7 책임:
  1. POI 정본 관리 (좌표·영업시간·카테고리·체류 기본값)
  2. closed-set 후보 풀 생성 (여행 조건 기반 필터링)
  3. 영업시간·휴무 변경 감지 (Plan-B 트리거 입력)
  4. 저장 장소 우선 소싱 (Plan-B 재계획 RAG 그라운딩)
  5. 웹 후보 소싱·수집 게이트 (커버리지 부족 보강, 백그라운드 — AI-D03)
  6. 엔티티 해소 (지역·POI명 fuzzy match → poi_id, AI-D04)
```

---

## 2. POI 핵심 스키마

```python
@dataclass
class Poi:
    # 식별
    poi_id: str                    # 전역 고유 ID (UUID v4)
    source: PoiSource              # KAKAO | NAVER | GOOGLE | WEB | MANUAL
    source_id: str                 # 원본 플랫폼 ID
    source_url: str | None         # WEB 소싱 시 출처 URL (AI-D03)

    # 위치
    name: str
    address: str
    location: GeoPoint             # (lat, lng)

    # 영업 정보
    category: PoiCategory          # 아래 §2.1 참조
    open_hours: list[OpenHour]     # 요일별 영업시간
    is_closed_today: bool          # 당일 휴무 여부 (배치 갱신)
    avg_cost: int | None           # 평균 비용 (원). None = 미확인

    # AI 파이프라인용
    default_stay_minutes: int      # 체류 기본값 (카테고리 테이블, G51)
    tags: list[str]                # 취향 매칭용 태그 (자연·도시·음식 등)
    rating: float | None           # 0.0~5.0. None = 미확인

    # 메타
    data_quality: DataQuality      # FULL | PARTIAL | MINIMAL
    confidence: float | None       # WEB 소싱 신뢰도 0.0~1.0 (수집 게이트, AI-D03). None=정본 소스
    last_verified_at: datetime
```

### 2.1 PoiCategory 택소노미

> **정정 (2026-08-25, TRIP-530)**: 아래 구 택소노미(소문자 13종)는 **폐기**다. 구현·경계 정본은
> `src/trippilot/domain/poi.py::PoiCategory` — **경계 8종 대문자 + 내부 전용 `STAY`** (TRIP-281).
> 경계 8종은 백엔드 `/internal/pois` read 포트가 내보내는 코드와 값·집합이 **동일**하다
> (한↔영 매핑은 백엔드가 이미 수행해 영문 코드로 내보내므로 AI 쪽에 매핑이 없다).

```python
class PoiCategory(Enum):
    # 경계 8종 — 백엔드 /internal/pois 와 값·집합 동일 (괄호는 백엔드 한글 정본)
    FOOD = "FOOD"                   # 맛집
    CAFE = "CAFE"                   # 카페
    SIGHT = "SIGHT"                 # 명소
    NIGHT_VIEW = "NIGHT_VIEW"       # 야경
    NATURE = "NATURE"               # 자연
    CULTURE = "CULTURE"             # 문화
    ACTIVITY = "ACTIVITY"           # 액티비티
    SHOPPING = "SHOPPING"           # 쇼핑

    # 내부 전용 — 숙소 앵커·체류시간 계산. 경계 8종에 포함되지 않으며
    # /internal/pois 응답에 등장하지 않는다 (PR #104 회신).
    STAY = "STAY"
```

구 13종 → 현 8종 접힘: `RESTAURANT`→`FOOD` · `BAR`→(FOOD/CULTURE 흡수) · `ATTRACTION`→`SIGHT` ·
`MUSEUM`·`HISTORIC`→`CULTURE` · `PARK`→`NATURE` · `MARKET`→`SHOPPING` · `ENTERTAINMENT`→`ACTIVITY` ·
`ACCOMMODATION`→`STAY`(내부 전용). 신설: `NIGHT_VIEW`(구 표에 대응 없음).

### 2.2 체류 기본값 테이블 (G51)

카테고리별 기본 체류 시간. 출시 후 실측 보정 예정.

> **ML 후보 2순위 (AI-D05)**: 이 정적 테이블은 **체류 시간 예측 회귀 모델**의 폴백이다. 실측(POI+유저+시간대 → 실제 체류 분)이 쌓이면 회귀로 대체해 시간 예산을 정밀화하되, 실패 시 이 테이블로 폴백(INV-4).

**정정 (2026-08-25, TRIP-530)**: 아래 표는 현 8종+`STAY` 기준으로 재도출했다. 구현 정본은
`assembly_engine/config.py::STAY_DEFAULT_MIN` — `PoiCategory` **전 값을 덮어야 한다**(직접 dict 조회라
누락 시 `KeyError`). 신규 3종의 도출 근거는 구 표(세분 택소노미)를 현 8종으로 접은 것이다.

| 카테고리 | 기본 체류 (분) | 비고 |
|---|---|---|
| FOOD | 60 | 식사 시간 (구 RESTAURANT) |
| CAFE | 45 | |
| SIGHT | 75 | 구 ATTRACTION 90 → 관람 동선 기준 재조정 |
| NIGHT_VIEW | 60 | **신규** — 구 표에 대응 없음. 전망대·야경 포인트는 조망 중심 단일 지점이라 SIGHT(75)보다 짧고 CAFE(45)보다 길다 |
| NATURE | 90 | **신규(접힘)** — 구 PARK 60(도심 공원)이 하한이나 '자연'은 산·해변·산책로를 함께 담아 이동 반경이 넓다 → SIGHT(75) 위, 시간 고정형 ACTIVITY(120) 아래 |
| CULTURE | 90 | **신규(접힘)** — 구 MUSEUM 120 + HISTORIC 60을 함께 담는 상위 묶음이라 그 중간값 |
| ACTIVITY | 120 | |
| SHOPPING | 60 | 구 MARKET 45 흡수 |
| STAY | 30 | 내부 전용(숙소 앵커) — 경계 8종 아님 |

<details><summary>구 13종 기준 원표 (폐기 — 위 8종 도출 근거로만 보존)</summary>

| 카테고리 | 기본 체류 (분) | 비고 |
|---|---|---|
| RESTAURANT | 60 | 식사 시간 |
| CAFE | 45 | |
| ATTRACTION | 90 | |
| MUSEUM | 120 | |
| PARK | 60 | |
| SHOPPING | 60 | |
| MARKET | 45 | |
| ACTIVITY | 120 | |
| HISTORIC | 60 | |
| ENTERTAINMENT | 90 | |

</details>

---

## 3. closed-set 후보 풀 생성

M7이 여행 조건을 받아 **C1에 넘길 후보 POI 집합**을 만든다. 이 집합이 INV-1의 화이트리스트다. **웹 소싱 POI(AI-D03)는 수집 게이트를 통과해 M7에 등록된 것만** 이 파이프라인에 들어온다 — 격리(quarantine)된 원본은 후보 풀에 절대 포함되지 않는다.

### 3.1 필터링 파이프라인

```python
def get_candidate_pool(request: CandidatePoolRequest) -> CandidatePool:
    """
    입력: 여행 조건 (숙소 위치·날짜·예산·동반자·이동수단)
    출력: CandidatePool (poi_ids + 메타)
    """
    pois = (
        _filter_by_radius(request.anchor, request.radius_km)   # 1단계: 반경
        |> _filter_by_budget(request.budget_level)              # 2단계: 예산
        |> _filter_by_open(request.dates)                       # 3단계: 영업일
        |> _filter_by_data_quality()                            # 4단계: 데이터 품질
        |> _rank_by_popularity()                                 # 5단계: 인기도 정렬
        |> _limit(MAX_CANDIDATES)                               # 6단계: 상한 (5천, G142)
    )
    return CandidatePool(
        poi_ids=frozenset(p.poi_id for p in pois),
        pois=pois,
        generated_at=datetime.now(),
    )
```

### 3.2 필터 상세

**1단계 — 반경 필터**
```python
# 숙소(앵커)에서 이동 가능한 반경
# 이동수단별 기본 반경 (remote config)
RADIUS_KM = {
    TransportMode.WALK:    2.0,
    TransportMode.PUBLIC:  10.0,
    TransportMode.CAR:     20.0,
}
# 다일 여행: 반경 × 0.7 (이동 부담 감소)
```

**2단계 — 예산 필터**
```python
BUDGET_COST_LIMIT = {
    BudgetLevel.LOW:    15_000,   # 평균 비용 상한 (원)
    BudgetLevel.MID:    40_000,
    BudgetLevel.HIGH:   None,     # 상한 없음
}
# avg_cost=None인 POI는 예산 필터 통과 (미확인 = 배제 안 함)
```

**3단계 — 영업일 필터**
```python
# 여행 날짜 중 하루라도 영업하는 POI만 포함
# is_closed_today는 당일 아침 배치 갱신 (Plan-B 트리거 입력)
```

**4단계 — 데이터 품질 필터**
```python
# MINIMAL(좌표만 있음)은 후보 풀 제외
# 좌표 95% · 영업시간 70% 커버리지 게이트 (G192)
ALLOWED_QUALITY = {DataQuality.FULL, DataQuality.PARTIAL}
```

### 3.3 CandidatePool 구조

```python
@dataclass(frozen=True)
class CandidatePool:
    poi_ids: frozenset[str]        # C1 closed-set 화이트리스트
    pois: list[Poi]                # C2 어셈블리용 상세 데이터
    generated_at: datetime
    anchor: GeoPoint
    radius_km: float

    def contains(self, poi_id: str) -> bool:
        return poi_id in self.poi_ids  # O(1) — 출구 게이트에서 호출
```

---

## 4. 영업시간 스키마

```python
@dataclass
class OpenHour:
    day_of_week: int               # 0=월 ~ 6=일
    open_time: time                # 영업 시작
    close_time: time               # 영업 종료
    is_closed: bool = False        # 정기 휴무

@dataclass
class OpenHourOverride:
    """임시 휴무·특별 영업시간 (공휴일·이벤트)"""
    date: date
    is_closed: bool
    open_time: time | None = None
    close_time: time | None = None
    reason: str = ""               # "설날 연휴" 등
```

**HC1 검증용 영업시간 조회**:
```python
def get_open_window(poi: Poi, visit_date: date) -> tuple[time, time] | None:
    """
    반환: (open_time, close_time) 또는 None (휴무)
    우선순위: OpenHourOverride > OpenHour
    """
```

---

## 5. 저장 장소 (Plan-B RAG 그라운딩)

Plan-B 재계획 시 M7은 **사용자가 저장한 장소를 우선 소싱**한다.

```python
@dataclass
class SavedPlace:
    poi_id: str
    user_id: str
    saved_at: datetime
    memo: str | None

def get_replan_candidates(
    user_id: str,
    anchor: GeoPoint,
    radius_km: float,
    excluded_poi_ids: set[str],    # 이미 방문했거나 현재 일정에 있는 POI
) -> list[Poi]:
    """
    우선순위:
    1. 사용자 저장 장소 (saved_places) — RAG 그라운딩
    2. 반경 내 인기 POI
    excluded_poi_ids는 결과에서 제외
    """
```

---

## 6. 캐싱 전략

| 데이터 | TTL | 캐싱 금지 조건 | 근거 |
|---|---|---|---|
| POI 기본 정보 (좌표·카테고리·태그) | 24시간 | — | D13 |
| 영업시간 | 6시간 | — | D13 |
| 가격 정보 (avg_cost) | **캐싱 금지** | 항상 최신 조회 | G195 |
| 당일 휴무 (is_closed_today) | 당일 아침 1회 갱신 | — | D27 |
| closed-set 후보 풀 | 여행 생성 세션 단위 | 영업시간 변경 감지 시 무효화 | — |

> 웹 소싱 POI(AI-D03)도 동일 TTL·가격 미캐싱 정책을 따르며, `confidence`가 낮으면 재검증 주기를 짧게 둔다.

---

## 7. 데이터 커버리지 게이트 (G192)

출시 전 필수 충족 기준:

| 항목 | 기준 | 측정 방법 |
|---|---|---|
| 좌표 보유율 | ≥ 95% | `location != null` 비율 |
| 영업시간 보유율 | ≥ 70% | `open_hours` 비어있지 않은 비율 |
| 카테고리 분류율 | ≥ 90% | `category != UNKNOWN` 비율 |
| 체류 기본값 보유율 | 100% | 카테고리 테이블 완비 |

커버리지 미달 시 AI 감지 범위가 비례해 축소된다 — 후보 풀이 작아지면 일정 품질이 저하된다. 부족 지역·카테고리는 **웹 소싱(Places API→자유 웹, AI-D03)으로 백그라운드 보강**해 커버리지를 끌어올리되, **수집 게이트를 통과한 데이터만** 반영한다.

---

## 8. 엔티티 해소 (AI-D04)

사용자 입력의 지역·POI명 오타·표기 흔들림을 **결정론적 fuzzy match**로 실제 항목에 매핑한다(입력단 closed-set 그라운딩). LLM 교정이 아니라 M7 대조다.

```python
class EntityKind(Enum):
    REGION = "region"
    POI    = "poi"

def fuzzy_match(name: str, kind: EntityKind) -> tuple[Poi | Region | None, float]:
    """
    edit-distance(+자모 유사) 기반, 결정론.
    반환: (최근접 항목, 신뢰도 0.0~1.0)
    호출측(라우터 §3.4)이 신뢰도로 자동확정/확인/미해소를 가른다.
    미해소(M7에 없음)는 AI-D03 웹 소싱 후보로 넘긴다.
    """
```

- 의도·자유문장 오타는 라우터 LLM이 흡수하므로 **별도 교정 단계 없음**(D11).
- 임계값(자동확정·확인 컷)은 remote config로 캘리브레이션.
