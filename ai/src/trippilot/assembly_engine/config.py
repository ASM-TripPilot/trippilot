"""C2 어셈블리 설정 (U2 FD domain-entities §1 — AI-D07·G106·G51 확정 초기값).

실체는 remote config — 이 타입은 주입 컨테이너. 하드코딩 사용 금지(항상 주입).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from trippilot.domain.common import Pace, TransportMode
from trippilot.domain.poi import Poi, PoiCategory, counts_as_food


def _default_speeds() -> dict[TransportMode, float]:
    # AI-D07 ③
    return {TransportMode.WALK: 4.0, TransportMode.PUBLIC: 20.0, TransportMode.CAR: 30.0}


def _default_long_speeds() -> dict[TransportMode, float]:
    # `long_leg_km` 을 넘는 도로 구간의 속도 — 도시 정차·신호가 없는 시외 구간이다. 대중교통 50 은
    # 제주 간선·급행(번영로·일주동로) 감각값이고, ODsay 실측이 쌓이면 갈아 끼운다. 도보는 그대로.
    return {TransportMode.WALK: 4.0, TransportMode.PUBLIC: 50.0, TransportMode.CAR: 60.0}


def _default_safety() -> dict[TransportMode, float]:
    # G106
    return {TransportMode.WALK: 1.4, TransportMode.PUBLIC: 1.5, TransportMode.CAR: 1.5}


# G51 — 카테고리 기본 체류시간(분). B-1(체류시간 ML)의 폴백 테이블.
# PoiCategory 전 값을 덮어야 한다(직접 dict 조회 — 누락 시 KeyError).
# 신규 3종은 G51 원표(ai-data-design.md §2.2, 세분 택소노미)를 현 8종으로 접어서 도출:
#   NIGHT_VIEW 60 — 원표에 대응 행 없음. 전망대·야경 포인트는 조망 중심 단일 지점이라
#                   관람 동선이 있는 SIGHT(75)보다 짧고 CAFE(45)보다는 길다.
#   NATURE     90 — 원표 PARK 60(도심 공원)이 하한이나 '자연'은 산·해변·산책로를 함께 담아
#                   이동 반경이 넓다 → SIGHT(75) 위, 시간 고정형 ACTIVITY(120) 아래.
#   CULTURE    90 — 원표 MUSEUM 120 + HISTORIC 60을 함께 담는 상위 묶음이라 그 중간값.
STAY_DEFAULT_MIN: dict[PoiCategory, int] = {
    PoiCategory.FOOD: 60,
    PoiCategory.CAFE: 45,
    PoiCategory.SIGHT: 75,
    PoiCategory.NIGHT_VIEW: 60,
    PoiCategory.NATURE: 90,
    PoiCategory.CULTURE: 90,
    PoiCategory.ART: 75,       # 갤러리·미술관 — 문화(90)보다 짧다: 박물관·유적이 빠지고 전시 한두 곳을 도는 체류
    PoiCategory.BAR: 90,       # 술집 — 한 곳에서 한 잔·한 끼 이어 머무는 시간
    PoiCategory.ACTIVITY: 120,
    PoiCategory.SHOPPING: 60,
    PoiCategory.STAY: 30,
}


# TRIP-906 — 여행 속도(pace) → 체류시간 정수비.
#
# **정수비인 이유**: CP-SAT 변수가 정수(분)이고, 부동소수 곱은 반올림 규칙에 따라
# 플랫폼별로 갈릴 수 있다. 분자/분모로 두면 `stay * num // den` 한 줄로 확정된다.
#
# **크기의 근거 — 실측**(후보 20곳·하루 09~21시·PUBLIC, OR-Tools 와 규칙 폴백 각각):
#
#     배율   OR슬롯  폴백슬롯
#     0.90     9       8
#     1.00     8       8      ← 현행
#     1.40     7       6
#
# 두 엔진 모두 배율에 대해 단조였다(비단조 0건). 극단 간 하루 3~4슬롯 차이가 나므로
# "느긋하게"와 "알차게"가 눈에 보이게 갈린다.
#
# **알차게를 더 밀지 않은 이유**: 체류를 더 줄이면 실행가능 공간이 넓어져 CP-SAT 이
# 3초 벽시계 안에 첫 해를 못 찾는 구간이 생긴다 — 후보 40곳에서 ×0.75 는 3/3 해없음
# 이었고, 그러면 규칙 폴백으로 강등돼 **알차게를 고른 사용자가 오히려 품질 낮은
# 그리디 일정을 받는다.** ×0.90 은 후보 25·40곳에서 3/3 정상이었다. 더 공격적인 값은
# 벽시계 여유(`or_tools_limit_ms`)를 같이 올리지 않는 한 손해다. (TRIP-1176 전 실측 —
# 해없음의 원인은 불완전 힌트·무의미한 상계였다. 배율을 더 밀려면 다시 잰다.)
PACE_STAY_RATIO: dict[Pace, tuple[int, int]] = {
    Pace.SLOW: (7, 5),        # ×1.4
    Pace.BALANCED: (1, 1),    # 무보정 — 현행과 동일
    Pace.PACKED: (9, 10),     # ×0.9
}

# 체류 하한(분). 비를 먹여도 이 아래로는 안 내려간다 — 15분짜리 방문은 이동시간보다
# 짧아 일정으로서 의미가 없고, 0 에 수렴하면 하루에 무한정 담기는 퇴화가 생긴다.
_STAY_FLOOR_MIN = 20


def stay_for(category: PoiCategory, pace: "Pace | None") -> int:
    """카테고리 기본 체류에 pace 비를 먹인 분(分). `pace=None` 이면 기본값 그대로.

    **고정 블록에는 쓰지 않는다.** 고정 블록의 체류는 사용자가 정한 창에서 역산하며
    (HC3 시각 정확 일치), 거기에 비를 먹이면 확정 예약 시각이 흔들린다.
    """
    base = STAY_DEFAULT_MIN[category]
    if pace is None:
        return base
    num, den = PACE_STAY_RATIO[pace]
    return max(_STAY_FLOOR_MIN, base * num // den)


# TRIP-383 — 날씨 보정의 실외/실내 판정표 (경계 카테고리 10종 기준).
# 실외: 자연·야경·액티비티 — 강수에 체험이 직접 훼손되는 축.
# 실내: 문화(박물관류)·미술·카페·쇼핑·술집 — 강수 대피처로 기능하는 축.
# FOOD·SIGHT·STAY는 중립 — 실내외 혼재(식당/명소)라 어느 쪽으로도 밀지 않는다.
RAIN_OUTDOOR: frozenset[PoiCategory] = frozenset(
    {PoiCategory.NATURE, PoiCategory.NIGHT_VIEW, PoiCategory.ACTIVITY}
)
RAIN_INDOOR: frozenset[PoiCategory] = frozenset(
    {PoiCategory.CULTURE, PoiCategory.ART, PoiCategory.CAFE, PoiCategory.SHOPPING, PoiCategory.BAR}
)

# 재계획 "숙소 근처에서 끝내기"(`ItineraryProblem.end_near`) — 마지막 방문지 → 숙소 도로 km 당
# 점수 축 감점. 사용자 LESS_MOVE 경로 감점(0.05/km)과 같은 크기다. 같은 집합 안의 순서는 점수를
# 안 바꾸므로 크기와 무관하게 숙소에 가까운 곳이 마지막이 되고, 크기는 집합을 바꿀지만 정한다.
END_NEAR_WEIGHT = 0.05


# 대중교통 여행에서 걸어가는 구간의 절대 상한(도로 km) — 이 이상은 어떤 설정으로도 걷지 않는다(2026-10-19 사용자).
WALK_HARD_MAX_KM = 1.1
# 방문 시작의 상한(그날 0시부터의 분) — 자정을 넘는 하루 창(익일 01:00)에서도 시작은 그날 안, 끝만 넘는다.
# 백엔드 슬롯은 시작 시각 + `ends_next_day` 로 저장돼 자정 뒤 **시작**은 표현이 없다(2026-10-20).
LAST_START_MIN = 24 * 60 - 1
# 액티비티 취향 사용자의 도보 상한(도로 km) — 기본 700m 보다 조금 더 걷게 한다(2026-10-19 사용자). 1.1 미만.
ACTIVE_WALK_MAX_KM = 1.0


@dataclass(frozen=True, slots=True)
class AssemblyConfig:
    # 일자당 **벽시계 백스톱**(TRIP-1176). 탐색을 멈추는 것은 아래 결정론 한도이고, 이것이
    # 먼저 걸리면 결정론이 깨진다. 규칙: or_tools_limit_ms ≥ det × 3.5초 — 운영 파드의 보장
    # CPU(requests 500m)에서 잰 wall/det 최대가 2.75(arm)·2.92(amd64 에뮬)였다. 실측(실 덤프
    # 39건 × 2회): CPU 0.5 몫·det 2.0 에서 3000ms 는 50/78 회를 벽시계가 끊었고 1/39 건이 두
    # 실행 결과가 달랐다. 7000ms 는 끊김 0/78·한 코어 결과와 78/78 동일(일자당 중앙 2.9s·
    # 최대 3.9s, amd64 에뮬 중앙 3.9s·최대 5.2s). 한 코어(--cpus 2)면 지연은 그대로 det 가
    # 정한다(중앙 1.7s·p95 2.2s). 동시 요청 둘이 0.5 CPU 를 나누면(wall/det 최대 5.2) 어떤
    # det 로도 못 지킨다 — `_solve_day` 의 백스톱 경고로 빈도를 보고 requests.cpu 를 올린다.
    or_tools_limit_ms: int = 7000
    # CP-SAT max_deterministic_time(결정론 작업량 단위 — 초가 아니다). 일자당 탐색을 **이것**이
    # 멈추게 해서 같은 입력이 부하와 무관하게 같은 해를 낸다(위 백스톱이 안 걸리는 한).
    # 2.0 근거(TRIP-1160 실 덤프 39건 × 2회 재생): 해 없음 0·HC 위반 0·반복 동일 39/39.
    # det 1.0 대비 5/39 건 점수가 높다(점수합 +0.08~1.29), 3.0 은 3/39 건만 더 오른다.
    or_tools_det_limit: float = 2.0
    # 재정렬(B 단계, TRIP-1178)의 일자당 벽시계 백스톱 — **일자 몫과 무관한 고정값**이다(남은
    # 몫으로 줄이면 몫 경계에서 같은 입력이 부하에 따라 다른 순서가 된다). 대가로 일자 몫을 B
    # 소요만큼 넘길 수 있고, 최악(부하)은 이 값의 두 배다(경로 완성 풀이·본 풀이가 각자 이 한도).
    # 0 이면 B 를 돌리지 않는다(A 해 그대로).
    # 실측: 실 덤프 39건 B 최대 36ms(중앙 32ms, 한 코어) × wall/det 최대 2.92 ≈ 105ms → 약 3배.
    or_tools_reorder_ms: int = 300
    or_tools_min_ms: int = 500          # 이보다 잔여가 적으면 OR-Tools 단계 스킵 (DL-2)
    llm_stage_timeout_ms: int = 2500    # LLM 2차 요구 시간 (DL-2)
    local_search_min_remaining_ms: int = 3000
    buffer_min: int = 15                # G106 어셈블리 내부 버퍼
    detour_factor: float = 1.3          # 직선거리 우회계수
    # 대중교통 요청이라도 이 거리(**도로**, km — 화면에 "약 N km" 로 보이는 값) 이하는 걷고, 넘으면 대중교통이다.
    # 계산상 대중교통이 빨라도 걷고(사람은 600m 를 버스로 가지 않는다), 계산상 도보가 빨라도 넘으면 타고 간다.
    # 2026-10-19 사용자 결정: "700 이하만 도보, 나머지는 다 대중교통. 1km 이상이 도보인 건 말이 안 된다" —
    # 종전 기준은 직선 700m(#1414)라 도로 0.9km 가 "도보"로 보였고, "도보가 빠르면 도보" 규칙도 있었다.
    # 활동형 사용자는 올려도 되지만 **1.1km 이상은 도보 금지**(`WALK_HARD_MAX_KM`, 아래 검증).
    # ODsay 는 직선 700m 이내를 -98 로 거절한다 — 그 사이(도로 0.7~0.91km)는 추정기의 대중교통 추정이 맡는다.
    # 자차 여행도 같은 값으로 주차 거점을 묶는다(assembly_engine/parking, 2026-10-21 사용자 "대중교통과 같게").
    public_walk_max_km: float = 0.7
    # 도보 여행이라도 이 거리(도로 km) 이상은 대중교통으로 가고, 시각도 대중교통 추정으로 잡는다(2026-10-20 사용자:
    # "아무리 도보를 선택했어도 1.5km 이상이면 대중교통 태우게 해"). 3km 를 70분 걸어 하루에 두세 곳만 들어갔다.
    walk_transit_from_km: float = 1.5
    speeds_kmph: dict[TransportMode, float] = field(default_factory=_default_speeds)
    # 긴 구간은 앞 `long_leg_km` 만 도시 속도, 나머지는 `long_speeds_kmph` 로 잰다(구간별 합 — 경계에서
    # 시간이 튀지 않는다). 도시 속도로만 재면 제주시 → 성산 38km 가 240분(실제 약 1.5~2시간)이라 이동
    # 한 번이 오전을 다 먹었다(DEV 2026-10-14, 09:00~12:55 공백). 도시 안 구간(≤15km 도로)은 종전과 같다.
    long_leg_km: float = 15.0
    long_speeds_kmph: dict[TransportMode, float] = field(default_factory=_default_long_speeds)
    safety: dict[TransportMode, float] = field(default_factory=_default_safety)
    # ── 식사 시간대 소프트 보정 (TRIP-379 신설 — 정본에 기존 규칙 없음:
    # ai-data-design.md §2.2는 RESTAURANT 기본 체류 60분만 정의하고, 카테고리-시간대
    # 적합성 규칙은 이 티켓이 처음 도입한다. 하드 제약(HC) 아님 — 식당 0개 풀에서도
    # 일정은 나온다("정보 없음 ≠ 배제").)
    # 창은 분-of-day [시작, 끝]: 점심 11:00~14:00, 저녁 17:00~20:00.
    lunch_window_min: tuple[int, int] = (11 * 60, 14 * 60)
    dinner_window_min: tuple[int, int] = (17 * 60, 20 * 60)
    # 가중 단위 = 선호 점수와 동일 축(score ∈ [0,1]). 보조적 크기 원칙:
    # 취향 점수 갭이 한 단(≥0.3) 이상이면 점수 서열이 그대로 이기고, 동률·근소 갭에서만
    # 식사 리듬이 개입한다 — 보정이 취향 점수를 압도하지 않도록.
    meal_bonus: float = 0.3             # 식사 창에 FOOD 1개 배치 시 창당 보상
    meal_penalty: float = 0.2           # 창 밖 FOOD 배치 억제 (건당)
    # FOOD→FOOD 인접(식당 바로 다음 식당) 억제 — 건당, 점수 축 [0,1] 전체라 어떤 취향 갭으로도
    # 식당 바로 다음 식당이 이득이 되지 않는다. 종전엔 meal_penalty(0.2)를 같이 써서 점수 차가
    # 크면 그대로 놓였다(QA 6회차 후속 실측, 로컬 full 스택 10일: 태안 2일차 점심 12:26 식당 →
    # 13:31 식당 — 두 번째는 끝이 점심창 밖이라 창 상쇄 대상도 아니었다). 폴백은 이미 연속 FOOD 를
    # 후순위로 미뤄(food-first 는 직전이 FOOD 가 아닐 때만) 이 모양을 안 낸다 — OR 을 그 의미에
    # 맞춘다. 사이에 다른 장소가 하나라도 끼면 감점 없음. 하드 제약 아님(목적함수만) — 식당만
    # 있는 풀도 비지 않는다. 0 이면 이 항만 꺼진다(폴백의 후순위는 남는다).
    food_adjacent_penalty: float = 1.0
    # ── 날씨 소프트 보정 (TRIP-383 — TRIP-379 식사 보정과 동형의 결정론 규칙).
    # 하드 배제 금지: 비가 와도 실외 배치는 가능하고, 실외만 남은 풀에서도 일정은
    # 나온다. problem.daily_rain_prob이 None이면 항 자체가 생기지 않아 종전과 동일.
    rain_threshold_pct: int = 60        # 이 강수확률(%) 이상인 날짜만 보정 대상
    # 가중 단위 = 선호 점수와 동일 축(score ∈ [0,1]) — 식사 보정 스케일 근거 그대로:
    # 실외 억제 0.2는 meal_penalty와 같은 "한 단 미만" 크기라 취향 점수 갭이 한 단
    # (≥0.3) 이상이면 점수 서열이 그대로 이기고, 동률·근소 갭에서만 실내로 재배치된다.
    # 실내 보상 0.1은 억제의 절반(소폭) — 보상까지 크면 우천일 실내가 취향을 압도한다.
    rain_outdoor_penalty: float = 0.2   # 우천일 실외(NATURE·NIGHT_VIEW·ACTIVITY) 억제
    rain_indoor_bonus: float = 0.1      # 우천일 실내(CULTURE·CAFE·SHOPPING) 소폭 보상
    # ── 행사 근접 보너스 (TRIP-421 — 양수만, 감점 경로 없음).
    # problem.event_bonus 값 [0,1](적합도×거리감쇠)에 이 스케일을 곱한다 —
    # 최대치(1.0×0.15)가 rain_indoor_bonus급 "한 단 미만" 크기: 근소 갭에서만
    # 행사 근접 POI가 유리해지고, 취향 점수 갭이 크면 서열 그대로.
    event_bonus_scale: float = 0.15
    # ── 일별 동일 카테고리 체감 페널티 (TRIP-531 — 결정3).
    # 편중 풀에서 같은 카테고리가 한 날에 뭉치는 것(청주 FOOD 7연속·순창 SIGHT
    # 4연속 실측)을 억제한다. 식사 보정과 직교 — 그쪽은 시각·인접, 이쪽은 **개수**.
    # 하드 제약 아님: 자유 허용치까지 무페널티, 초과 1개당 감점. 취향 점수 갭이
    # 한 단(≥0.3) 이상이면 서열이 그대로 이긴다(음식 중심 페르소나의 맛집 투어
    # 유지). 단일 카테고리만 남은 풀에서도 일정은 나온다(감점일 뿐 배제 아님).
    # 기능 전체를 끄려면 category_free_count를 크게 둘 것 — penalty=0은 OR-Tools
    # 항만 끄고 폴백의 쿼터 재정렬은 남는다(폴백엔 페널티 개념이 없어 게이트 불가).
    category_free_count: int = 2        # 하루 같은 카테고리 이만큼까지는 무페널티
    category_excess_penalty: float = 0.3  # 초과 1개당 감점 (점수 축 [0,1])
    # ── FOOD 하루 상한 (위 결정3 의 "맛집 투어 유지"를 하루 3곳까지로 좁히는 개정).
    # 실측(2026-10-02, 로컬 full 스택 POI 18,605건, 부산 미식 4판): 하루 4~7곳 전부 FOOD·
    # 관광지 0(한 판 2일차 맛집 7연속). 중립·액티비티 취향은 하루 1~2곳으로 정상. 원인 두 겹:
    # 백엔드가 일자별 days=1 로 불러 위 공정 몫 허용치가 후보 전량이 되고(항이 꺼짐), 0.3 은
    # 미식 점수 간격(~0.6)보다 작다(식사 보정 0.3·0.2 도 같은 이유로 진다). 점수 단계는 두고
    # 하루 구성은 조립이 책임진다 — 위 체감 항·공정 몫 바닥은 그대로(다일 캐스케이드 방지).
    # 세는 것: FOOD + 이름이 음식 골목인 POI(`domain.poi.counts_as_food`), 그날 고정 블록 포함.
    # 하드 제약 아님: OR 은 초과 1곳당 감점(목적함수만), 폴백은 초과분 FOOD 를 후순위(배제
    # 아님 — FOOD 만 남으면 배치). 끄려면 food_daily_max 를 크게 — penalty=0 은 OR 항만 끈다.
    food_daily_max: int = 3             # 점심·저녁 + 1(간식·야식 한 곳)
    # 한 곳이 얻을 수 있는 이득 전부(점수 ≤1 + 식사창 0.3 + 우천 실내 0.1 + 행사 0.15 = 1.55)보다
    # 크다 — 점수 축 [0,1] 기준으로 어떤 취향 갭·보너스로도 초과분이 이득이 되지 않는다(규칙 점수는
    # 클램프가 없어 1 을 넘을 수 있다 — 그 여유는 위 체감 항이 함께 막는다). 종전 1.0 은 저녁창
    # FOOD(0.9+0.3)가 상한을 넘었다(아래 카테고리 상한이 비FOOD 를 묶자 남는 시간에 드러남).
    # 아래 카테고리 하루 상한에도 같은 값을 쓴다(이름은 FOOD 상한이 먼저 생긴 흔적).
    food_excess_penalty: float = 2.0
    # ── 카테고리 하루 상한 (FOOD 상한과 같은 기구를 전 카테고리로 — 2026-10-14).
    # 실측(로컬, 종로 연인·취향 문화예술/미식/쇼핑/관광 + 카페/전시/맛집투어): 하루 7곳 중 문화 5곳
    # (DEV 같은 스냅숏은 카페 연속 4곳). 취향 상대 가점이 원하는 카테고리끼리 점수 차를 벌리면 위
    # 체감 항(0.3)은 못 막는다 — 취향은 "비중을 늘리라"는 뜻이지 하루를 한 카테고리로 덮으라는
    # 뜻이 아니다. 세는 것: 그 카테고리(FOOD 는 위 food_daily_max 가 counts_as_food 로 센다),
    # 그날 고정 블록·필수 방문 포함. 감점·후순위·끄는 법은 FOOD 상한과 같다(크게 두면 꺼진다).
    cafe_daily_max: int = 2             # 카페는 체류가 짧아 하루에 쉽게 몰린다
    category_daily_max: int = 3         # 그 밖의 비FOOD 카테고리

    def daily_caps(self, poi: Poi) -> tuple[tuple[object, int], ...]:
        """POI 가 속한 하루 상한 묶음 (키, 상한) — OR 감점·폴백 후순위·프리필터 몫이 같이 쓴다.
        음식 골목 ACTIVITY 는 FOOD 와 ACTIVITY 양쪽에 든다."""
        caps: tuple[tuple[object, int], ...] = ()
        if poi.category is not PoiCategory.FOOD:
            caps = ((poi.category, self.cafe_daily_max if poi.category is PoiCategory.CAFE
                     else self.category_daily_max),)
        if counts_as_food(poi):
            caps += (("food", self.food_daily_max),)
        return caps

    def __post_init__(self) -> None:
        for name in ("or_tools_limit_ms", "or_tools_reorder_ms", "or_tools_min_ms",
                     "llm_stage_timeout_ms", "local_search_min_remaining_ms", "buffer_min"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} 음수 불가")
        if self.or_tools_det_limit <= 0:
            raise ValueError("or_tools_det_limit 양수 필요")
        if self.detour_factor <= 0:
            raise ValueError("detour_factor 양수 필요")
        if not 0 <= self.public_walk_max_km < WALK_HARD_MAX_KM:
            raise ValueError(f"public_walk_max_km 는 0 이상 {WALK_HARD_MAX_KM}km 미만: {self.public_walk_max_km}")
        if self.long_leg_km < 0:
            raise ValueError("long_leg_km 음수 불가")
        if any(self.long_speeds_kmph.get(m, 0) <= 0 for m in TransportMode):
            raise ValueError("long_speeds_kmph 는 모든 수단에 양수 필요")
        for name in ("lunch_window_min", "dinner_window_min"):
            lo, hi = getattr(self, name)
            if not (0 <= lo < hi <= 1440):
                raise ValueError(f"{name} 은 0 ≤ 시작 < 끝 ≤ 1440 분이어야 함")
        for name in ("meal_bonus", "meal_penalty", "food_adjacent_penalty",
                     "rain_outdoor_penalty", "rain_indoor_bonus",
                     "event_bonus_scale",
                     "category_free_count", "category_excess_penalty",
                     "food_daily_max", "food_excess_penalty",
                     "cafe_daily_max", "category_daily_max"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} 음수 불가")
        if not 0 <= self.rain_threshold_pct <= 100:
            raise ValueError(
                f"rain_threshold_pct 범위 밖 [0,100]: {self.rain_threshold_pct}")
