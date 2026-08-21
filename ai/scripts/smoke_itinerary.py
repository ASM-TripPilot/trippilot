"""수집 POI 일정 생성 리허설 — 실데이터 × 실LLM × 솔버 일일 스모크 (TRIP-372).

수집 배치(ai-poi-collect)가 남긴 등록 제안 JSON에서 시군구 하나를 날짜 시드로
골라, 앵커 반경 안 POI 6~8개로 실제 일정 생성을 관통시킨다 — 수집 데이터 품질
(좌표·카테고리·밀도)의 조기 경보이자 전 구간(어댑터→오케스트레이터→솔버) 리허설.

**pytest 대상이 아니다** — CI 실 호출 0건(D37)은 그대로 유지되고, 실 LLM 호출은
사람이 손으로 실행하거나 스케줄 워크플로(ai-llm-smoke.yml)가 실행할 때만.
순수 선택 로직(지역·앵커·반경 샘플)은 import 가능한 함수로 분리되어
tests/test_smoke_itinerary.py 가 fake 데이터로만 검증한다 (실 호출 0).

랜덤이되 결정론: `random.Random(SMOKE_DATE + region)` 식 날짜 시드 — 날마다 다른
선택, 같은 날 재실행은 같은 선택 (실패 재현·디버깅 가능).

사용법:
    cd ai
    COLLECTED_POIS=collected_pois.json \
    LLM_PROVIDER=openai OPENAI_API_KEY=... OPENAI_BASE_URL=... \
    OPENAI_MODEL=gpt-5.6-terra OPENAI_API=responses \
    uv run python scripts/smoke_itinerary.py

    # 잡 서머리용 시각표 표 (기존 산출 JSON을 읽기만 — 호출 0건)
    uv run python scripts/smoke_itinerary.py --summary rehearsal_result.json

환경변수:
    COLLECTED_POIS    필수 — 수집 제안 JSON 경로 (collect_pois.py 산출물)
    SMOKE_REGION      선택 — 시군구 강제 (예: "해운대구"). 설정 시 그 한 곳만.
    SMOKE_REGIONS     선택 — 실행당 지역 수 (기본 3). SMOKE_REGION 설정 시 무시.
    SMOKE_DATE        YYYY-MM-DD, 기본 오늘 KST 날짜 (CLI라 wall-clock 직접 호출 허용
                      — smoke_llm·collect_pois와 같은 관례)
    REHEARSAL_OUTPUT  기본 "rehearsal_result.json" — 기록용 1건 JSON
    LLM env           smoke_llm.py 와 동일 (LLM_PROVIDER/OPENAI_*/AZURE_*/ANTHROPIC_*)
                      — 어댑터 조립은 smoke_llm._build_adapter 를 그대로 재사용
    TMAP_API_KEY      선택 (TRIP-382) — 있으면 생성 성공 후 인접 슬롯 쌍(~6건)을
                      TMAP 실경로로 실측해 기록 JSON에 legs(추정 대 실측 오차)를
                      추가한다. 키 부재·API 실패는 검증만 생략(WARNING) — 리허설
                      성패와 분리. 실측 호출은 리허설 실행시에만 (D37 — pytest는 fake)

종료 코드: 0 = 생성 200 + 검사(슬롯≥1 · INV-1 · INV-3) 통과 — LLM 실패로 규칙 점수
강등돼도 성공(정직한 강등, INV-4). 1 = 선택 불가·생성 실패·검사 위반 (원인 출력).
"""

from __future__ import annotations

import datetime as dt
import json
import os
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from trippilot.api.app import create_app
from trippilot.api.wiring import (
    KST,
    StaticPersonaStore,
    StaticPoiDb,
    build_orchestrator,
)
from trippilot.llm_gateway.config import C1Config
from trippilot.solver_engine.config import SolverConfig
from trippilot.solver_engine.travel import TravelEstimator, haversine_km
from trippilot.domain.common import BudgetLevel, TransportMode
from trippilot.domain.llm import ModelTier
from trippilot.domain.persona import CompanionType, PersonaSummary
from trippilot.domain.poi import Poi
from trippilot.ports.llm_port import LlmPort, LlmRequest, LlmResponse
from trippilot.ports.travel_time_port import TravelTimeError, TravelTimePort

# 앵커 반경(km) — 후보풀 반경(M7 PUBLIC 10km)보다 좁게 잡아 "흩어진 POI로 후보 0"
# 함정을 회피한다. 샘플 6~8개는 1일 일정 슬롯 수(대략 4~6)보다 여유 있는 최소 풀.
RADIUS_KM = 8.0
# 리허설 여행 일수 기본값 — 다일 실측 축적(TRIP-476). SMOKE_DAYS env로 오버라이드
# (busan-2day 실험 브랜치와 같은 손잡이). MIN/MAX_POIS는 **1일 기준**이고 선택
# 시점에 일수를 곱한다.
REHEARSAL_DAYS = 3
MIN_POIS = 6
MAX_POIS = 8
MAX_ATTEMPTS = 5  # 반경 내 POI 부족 시 다른 시군구 재시도 상한
# 실행당 리허설 지역 수 — 하루 한 곳만 보면 17개 시도 중 어디가 못 쓸 상태인지
# 며칠이 지나야 드러난다. SMOKE_REGIONS env 로 오버라이드.
REHEARSAL_REGIONS = 3


class SelectionError(Exception):
    """선택 불가 — 어느 시군구에서도 반경 내 최소 POI를 못 모았다 (침묵 금지)."""


@dataclass(frozen=True, slots=True)
class Selection:
    """리허설 대상 선택 결과. pois 는 앵커 포함 6~8개 (전부 앵커 반경 8km 안)."""

    region: str
    anchor: Poi
    pois: tuple[Poi, ...]


# ── 순수 선택 로직 (테스트 대상 — 실 호출·파일 I/O 없음) ─────────────


def load_proposals(doc: dict) -> tuple[tuple[Poi, str | None], ...]:
    """제안 문서 → (Poi, region) 목록. poi_id 중복은 첫 항목만 (결정론)."""
    seen: set[str] = set()
    out: list[tuple[Poi, str | None]] = []
    for proposal in doc["proposals"]:
        poi = Poi.from_dict(proposal["poi"])
        if str(poi.poi_id) in seen:
            continue
        seen.add(str(poi.poi_id))
        out.append((poi, proposal.get("region")))
    return tuple(out)


def select_rehearsal_pois(
    entries: tuple[tuple[Poi, str | None], ...],
    smoke_date: str,
    *,
    radius_km: float = RADIUS_KM,
    min_pois: int = MIN_POIS,
    max_pois: int = MAX_POIS,
    max_attempts: int = MAX_ATTEMPTS,
    region: str | None = None,
) -> Selection:
    """날짜 시드 랜덤 선택 — 같은 (날짜, 데이터)는 항상 같은 결과.

    `region`(SMOKE_REGION)을 주면 **그 시군구만** 시도한다 — 날짜 시드는 어느 지역이
    걸릴지 고를 수 없어서, 특정 지역의 수집 품질을 보거나 그 지역에서 난 실패를
    재현할 방법이 없었다(부산 2일 리허설을 돌리려고 스크립트를 임시로 고쳐야 했다).
    반경 풀은 그대로 전체 수집분에서 뽑는다 — 강제 대상은 앵커가 서는 시군구뿐이다.

    ① region 목록에서 날짜 시드로 시군구 후보 순서를 뽑고(최대 max_attempts곳)
    ② 그 시군구 POI 중 앵커 1개 랜덤 → **전체 수집 POI** 중 앵커 반경 radius_km
       이내에서 min~max개 샘플 (반경 풀은 시군구 경계를 넘을 수 있다 — 인접
       시군구 POI도 실제 일정에선 유효한 후보다).
    반경 내가 min 미만이면 다음 시군구로 재시도, 전부 실패면 SelectionError.
    """
    by_region: dict[str, list[Poi]] = {}
    for poi, poi_region in entries:   # region 은 파라미터 — 루프 변수로 가리지 않는다
        if poi_region:  # region 추출 실패(null)는 시군구 선택 대상에서 제외
            by_region.setdefault(poi_region, []).append(poi)
    if not by_region:
        raise SelectionError("region 있는 제안이 0건 — 수집 JSON 확인 필요")

    # 시드에 들어가는 순서를 안정화 — JSON 항목 순서가 바뀌어도 같은 선택
    regions = sorted(by_region)
    all_pois = sorted((p for p, _ in entries), key=lambda p: str(p.poi_id))
    if region is not None:
        if region not in by_region:
            raise SelectionError(
                f"지역 {region!r} 이 수집분에 없다 — 후보 {len(regions)}곳")
        attempts = [region]
    else:
        region_rng = random.Random(smoke_date)
        attempts = region_rng.sample(regions, min(max_attempts, len(regions)))

    tried: list[str] = []
    for region in attempts:
        rng = random.Random(smoke_date + region)
        anchor = rng.choice(sorted(by_region[region], key=lambda p: str(p.poi_id)))
        nearby = [
            p for p in all_pois if haversine_km(anchor.coord, p.coord) <= radius_km
        ]
        if len(nearby) < min_pois:
            tried.append(f"{region}(반경내 {len(nearby)}개)")
            continue
        others = [p for p in nearby if p.poi_id != anchor.poi_id]
        count = rng.randint(min_pois, min(max_pois, len(others) + 1))
        sampled = [anchor] + rng.sample(others, count - 1)
        return Selection(
            region=region,
            anchor=anchor,
            pois=tuple(sorted(sampled, key=lambda p: str(p.poi_id))),
        )
    raise SelectionError(
        f"{len(attempts)}개 시군구 전부 반경 {radius_km}km 내 {min_pois}개 미만 — "
        f"시도: {', '.join(tried)}"
    )


def select_rehearsal_batch(
    entries: tuple[tuple[Poi, str | None], ...],
    smoke_date: str,
    *,
    count: int,
    **kwargs,
) -> list[Selection]:
    """서로 다른 시군구 count 곳을 날짜 시드로 골라 각각 Selection 을 만든다.

    하루 한 지역만 보면 커버리지가 얇다 — 수집은 17개 시도로 퍼져 있는데 검증은
    한 곳뿐이라, 어느 지역의 데이터가 못 쓸 상태인지 며칠이 지나야 드러난다.
    반경 미달로 실패한 지역은 건너뛰고 다음 후보로 — count 를 못 채워도 확보한
    만큼 돌린다(부분 성공). 전부 실패해야 SelectionError.

    같은 날 재실행은 같은 지역 집합 — 순서까지 결정론이라 실패 재현이 된다.
    """
    regions = sorted({r for _, r in entries if r})
    if not regions:
        raise SelectionError("region 있는 제안이 0건 — 수집 JSON 확인 필요")
    order = random.Random(smoke_date).sample(regions, len(regions))

    picked: list[Selection] = []
    skipped: list[str] = []
    for region in order:
        if len(picked) >= count:
            break
        try:
            picked.append(select_rehearsal_pois(
                entries, smoke_date, region=region, **kwargs))
        except SelectionError as e:
            skipped.append(str(e))
    if not picked:
        raise SelectionError(
            f"{len(order)}개 시군구 전부 선택 불가 — 예: {skipped[0] if skipped else '?'}")
    return picked


# ── 생성 관통 (in-process TestClient — 서버 프로세스 불필요) ─────────


class RecordingLlm:
    """주입 LLM 계측 래퍼 — 성공 호출 수로 llm_used 를 판정한다 (동작 무변경)."""

    def __init__(self, inner: LlmPort) -> None:
        self._inner = inner
        self.ok_calls = 0

    def invoke(self, request: LlmRequest) -> LlmResponse:
        response = self._inner.invoke(request)  # 실패는 그대로 전파 → 게이트웨이 폴백
        self.ok_calls += 1
        return response


class RecordingWeather:
    """주입 날씨 포트 계측 래퍼 (TRIP-409) — 오케스트레이터가 실제 쓴 예보를
    가로채 기록한다 (추가 API 호출 0, 동작 무변경). 실패는 그대로 전파 →
    오케스트레이터 Degradation 경로."""

    def __init__(self, inner) -> None:
        self._inner = inner
        self.forecast: dict[str, int] | None = None

    def daily_forecast(self, coord, days):
        result = self._inner.daily_forecast(coord, days)
        self.forecast = {d.isoformat(): pop for d, pop in result.items()}
        return result


class RehearsalError(Exception):
    """생성 실패 또는 검사(슬롯≥1 · INV-1 · INV-3) 위반."""


def _request_body(
    selection: Selection, smoke_date: dt.date, deadline_ms: int | None,
    days: int = REHEARSAL_DAYS,
) -> dict:
    """내일부터 days일 여행 — 앵커=선택 앵커 좌표(매일 동일·숙소 가정), 09~20시.

    deadline_ms=None이면 request_meta에서 생략 — 시간제약 없음(TRIP-473 계약).
    """
    dates = [(smoke_date + dt.timedelta(days=1 + i)).isoformat() for i in range(days)]
    anchor = selection.anchor.coord
    return {
        "trip_id": f"rehearsal-{smoke_date.isoformat()}",
        "generation_mode": "FULLY_AI",
        "trip_context": {
            "destinations": [selection.region],
            "start_date": dates[0],
            "end_date": dates[-1],
            "companion_type": "혼자",
            "budget_level": "중간",
        },
        "anchors": [
            {"date": d, "lat": anchor.lat, "lng": anchor.lng} for d in dates
        ],
        "time_windows": [
            {"date": d, "start": "09:00", "end": "20:00"} for d in dates
        ],
        "fixed_blocks": [],
        "preference_profile": {
            "styles": [],
            "activities": [],
            "food_tastes": [],
            "transport_modes": ["대중교통"],
            "pace": None,
            "companion_types": ["혼자"],
            "pet_friendly": False,
            "budget_tier": "중간",
        },
        "recommendation_strength": None,
        "request_meta": {
            "request_id": f"rehearsal-{smoke_date.isoformat()}",
            # CLI 스크립트만 wall-clock 직접 호출 허용 (smoke_llm·collect_pois 관례)
            "requested_at": dt.datetime.now(KST).isoformat(),
            # deadline_ms 미지정 = 무제한 (TRIP-473) — 다일 리허설은 종전 20s를 넘을 수 있다
            **({"deadline_ms": deadline_ms} if deadline_ms is not None else {}),
        },
        "excluded_poi_ids": [],
    }


def run_rehearsal(
    selection: Selection,
    *,
    llm: LlmPort,
    model_id: str,
    smoke_date: dt.date,
    deadline_ms: int | None = None,  # None=무제한 (TRIP-473) — 다일 LLM은 20s 초과 가능
    days: int = REHEARSAL_DAYS,
    weather=None,  # WeatherPort | None (TRIP-409) — 미주입=날씨 보정 없이 기존 그대로
    events=None,   # EventPort | None (TRIP-421) — 미주입=행사 보너스 없이 기존 그대로
) -> dict:
    """선택 POI로 실 조립 관통 1건 → 기록용 결과 dict. 위반은 RehearsalError.

    검사: 200 · 슬롯 ≥ 1 · 슬롯 poi_id ⊆ 선택 집합(INV-1) · 응답 원문에 duration
    토큰 부재(INV-3). LLM 실패로 규칙 점수 강등돼도 성공(정직한 강등, INV-4) —
    solve_mode·is_fallback·llm_used 로 기록만 남긴다.
    """
    from fastapi.testclient import TestClient  # dev 의존(httpx) — 스크립트 실행시만

    recorder = RecordingLlm(llm)
    weather_recorder = RecordingWeather(weather) if weather is not None else None
    orchestrator = build_orchestrator(
        llm=recorder,
        poi_db=StaticPoiDb(selection.pois),
        context_store=StaticPersonaStore(
            PersonaSummary(taste_tags=(), companion=CompanionType.SOLO,
                           budget=BudgetLevel.MID)
        ),
        c1_config=C1Config(
            model_ids={ModelTier.LIGHT: model_id, ModelTier.HEAVY: model_id}
        ),
        weather=weather_recorder,  # 선택 주입 (TRIP-409) — None이면 무보정
        events=events,  # 선택 주입 (TRIP-421) — None이면 행사 보너스 없음
    )
    client = TestClient(create_app(orchestrator), raise_server_exceptions=False)

    started = time.monotonic()
    response = client.post(
        "/ai/v1/itinerary/generate",
        json=_request_body(selection, smoke_date, deadline_ms, days=days),
    )
    latency_ms = int((time.monotonic() - started) * 1000)

    if response.status_code != 200:
        raise RehearsalError(f"생성 {response.status_code}: {response.text[:500]}")
    if "duration" in response.text.lower():
        raise RehearsalError("응답 원문에 duration 토큰 — INV-3 위반")
    body = response.json()
    slots = [(day["date"], s) for day in body["days"] for s in day["slots"]]
    if not slots:
        raise RehearsalError("슬롯 0건 — 일정이 비었다")
    selected_ids = {str(p.poi_id) for p in selection.pois}
    placed_ids = {s["poi_id"] for _, s in slots}
    if not placed_ids <= selected_ids:
        raise RehearsalError(
            f"선택 집합 밖 POI 배치 — INV-1 위반: {sorted(placed_ids - selected_ids)}"
        )

    names = {str(p.poi_id): p.name for p in selection.pois}
    return {
        "date": smoke_date.isoformat(),
        "region": selection.region,
        "anchor": {
            "poi_id": str(selection.anchor.poi_id),
            "name": selection.anchor.name,
            "lat": selection.anchor.coord.lat,
            "lng": selection.anchor.coord.lng,
        },
        "poi_names": [p.name for p in selection.pois],
        "slots": [
            # poi_id 는 인접 슬롯 실경로 검증(TRIP-382)의 좌표 역참조용 — name 은
            # 중복 가능해 키로 못 쓴다. date 는 다일 검토·일경계 leg 제외용 (TRIP-476)
            {"date": day, "start": s["start_at"], "end": s["end_at"],
             "name": names[s["poi_id"]], "poi_id": s["poi_id"]}
            for day, s in slots
        ],
        "solve_mode": body["solve_mode"],
        "is_fallback": body["is_fallback"],
        "llm_used": recorder.ok_calls > 0,
        # 오케스트레이터가 실제 쓴 예보 (TRIP-409) — 미주입·조회 실패면 None
        "weather": weather_recorder.forecast if weather_recorder else None,
        "latency_ms": latency_ms,
    }


# ── 인접 슬롯 실경로 검증 (TRIP-382 — 추정 오차 축적, 2단계 캘리브레이션 재료) ──

# 실측 상한 — 1일 일정(슬롯 4~6) 기준 앵커→첫 슬롯 포함 인접 쌍 ~6건이면 전량,
# 그 이상은 API 한도 아끼기로 절단한다.
MAX_LEGS = 6
# 리허설 요청은 transport_modes=["대중교통"] — 솔버 PUBLIC 모드.
# 실측 검증은 대중교통 우선 시도 → 403(상품 미구독 등) 시 자동차 → 보행 순 폴백.
LEG_MODE_CHAIN: list[TransportMode] = [
    TransportMode.PUBLIC,
    TransportMode.CAR,
    TransportMode.WALK,
]


def build_leg_pairs(
    selection: Selection, slots: list[dict], max_legs: int = MAX_LEGS
) -> list[tuple[Poi, Poi]]:
    """확정 슬롯 순서의 인접 쌍 — 앵커→첫 슬롯 포함, 같은 POI 연속은 제외(0거리).

    다일 일정에서는 **일 경계를 넘는 인접쌍을 제외**한다(TRIP-476) — 마지막 슬롯→
    다음날 첫 슬롯은 실제 이동이 아니라(숙소 복귀 사이) 오차 통계를 오염시킨다.
    date 없는 슬롯(구형 기록)은 전부 같은 날로 취급 — 기존 동작 그대로.
    """
    by_id = {str(p.poi_id): p for p in selection.pois}
    first_date = slots[0].get("date") if slots else None
    chain = [(selection.anchor, first_date)] + [
        (by_id[s["poi_id"]], s.get("date")) for s in slots
    ]
    pairs = [
        (a, b) for (a, da), (b, db) in zip(chain, chain[1:])
        if a.poi_id != b.poi_id and da == db
    ]
    return pairs[:max_legs]


def _is_forbidden(error: TravelTimeError) -> bool:
    """403 Forbidden 여부 — 상품 미구독·키 권한 부족 등 재시도 무의미한 거절."""
    return "403" in str(error)


def measure_legs(
    pairs: list[tuple[Poi, Poi]],
    *,
    travel: TravelTimePort,
    estimator: TravelEstimator,
    mode: TransportMode | None = None,
) -> tuple[list[dict], str | None]:
    """쌍별 (솔버 추정 est_min, 실측 real_min, 오차 err_pct) — 오차 축적용 legs.

    mode가 None이면 LEG_MODE_CHAIN을 쓴다 — 403(상품 미구독·키 권한)이 나오면
    **같은 쌍을 다음 수단으로 재시도**해 수단을 확정한다. 별도 프로빙 호출은 하지
    않는다: 프로브는 첫 쌍을 이중 호출해 API 한도(MAX_LEGS 절단의 이유)를 낭비하고,
    성공 1회 예산을 프로브가 소진하면 부분 실측이 통째로 사라진다.
    err_pct = (est − real) / real × 100 (양수 = 과대추정). real 0(동일 좌표 등)은
    비율이 정의 불가라 None. 403 외 실패는 그 지점에서 중단하고 (부분 legs, 사유)를
    반환한다 — 죽은 키·한도 초과에 남은 호출을 반복하지 않는다.
    """
    remaining = [mode] if mode is not None else list(LEG_MODE_CHAIN)
    mode = remaining.pop(0)
    legs: list[dict] = []
    for from_poi, to_poi in pairs:
        while True:
            est_min = estimator.estimate(
                from_poi.coord, to_poi.coord, mode).internal_minutes
            try:
                real = travel.measure(from_poi.coord, to_poi.coord, mode)
            except TravelTimeError as e:
                if _is_forbidden(e) and remaining:
                    print(f"[rehearsal] TMAP {mode.value} 403 — 다음 수단으로 폴백")
                    mode = remaining.pop(0)
                    continue
                return legs, str(e)
            break
        err_pct = (
            round((est_min - real.real_minutes) / real.real_minutes * 100, 1)
            if real.real_minutes > 0 else None
        )
        legs.append({
            "from": from_poi.name,
            "to": to_poi.name,
            "mode": mode.value,
            "est_min": est_min,
            "real_min": real.real_minutes,
            "err_pct": err_pct,
        })
    return legs, None


def attach_leg_verification(
    result: dict,
    selection: Selection,
    travel: TravelTimePort | None,
    estimator: TravelEstimator,
) -> None:
    """생성 성공 후 선택 단계 — result에 legs 추가 + stdout 표.

    travel=None(키 부재)·API 실패는 검증만 생략(WARNING) — 리허설 성패와 분리
    (반환값 없음, 예외 없음). 부분 실측이라도 legs 는 기록한다 (축적이 목적).
    """
    if travel is None:
        print("[rehearsal] WARNING TMAP_API_KEY 없음 — 실경로 검증 생략 (TRIP-382)")
        return
    legs, failure = measure_legs(
        build_leg_pairs(selection, result["slots"]), travel=travel, estimator=estimator
    )
    if failure is not None:
        print(f"[rehearsal] WARNING TMAP 실측 실패({len(legs)}건까지 기록): {failure}")
    if not legs:
        return
    result["legs"] = legs
    print(f"[rehearsal] 실경로 검증 {len(legs)}건 (TMAP 실측)")
    print(f"[rehearsal]   {'구간':<30} est(분)  real(분)  err%")
    for leg in legs:
        err = f"{leg['err_pct']:+.1f}%" if leg["err_pct"] is not None else "n/a"
        print(f"[rehearsal]   {leg['from']}→{leg['to']:<20} "
              f"{leg['est_min']:>5}  {leg['real_min']:>7.1f}  {err:>7}")


# ── CLI ──────────────────────────────────────────────────────────────


def _optional(name: str) -> str | None:
    """빈 문자열도 미설정으로 취급 — GH Actions는 비운 input을 ''로 주입한다."""
    return os.environ.get(name) or None


def _print_summary(json_path: str) -> int:
    """결과 JSON → 잡 서머리용 마크다운 표 (GITHUB_STEP_SUMMARY 리다이렉트 용도).

    산출은 지역별 결과의 배열이다. 단일 객체(다지역 이전 산출)도 읽는다 — 예전
    artifact 를 다시 요약할 때 죽지 않게.
    """
    doc = json.loads(Path(json_path).read_text(encoding="utf-8"))
    results = doc if isinstance(doc, list) else [doc]
    for i, result in enumerate(results):
        if i:
            print()
        _print_one(result)
    return 0


def _print_one(result: dict) -> None:
    print("## 일정 생성 리허설 (수집 POI × 실 LLM × 솔버)")
    print(f"- 날짜 {result['date']} · 지역 **{result['region']}** · "
          f"앵커 {result['anchor']['name']}")
    print(f"- solve_mode `{result['solve_mode']}` · 폴백 {result['is_fallback']} · "
          f"LLM 사용 {result['llm_used']} · {result['latency_ms']}ms")
    if result.get("weather"):  # 날씨 주입이 돌았을 때만 (TRIP-409)
        pops = " · ".join(f"{d} {p}%" for d, p in sorted(result["weather"].items()))
        print(f"- 예보(강수확률): {pops}")
    print()
    print("| 시각 | 장소 |")
    print("|---|---|")
    for slot in result["slots"]:
        print(f"| {slot['start']}–{slot['end']} | {slot['name']} |")
    if result.get("legs"):  # 실경로 검증이 돌았을 때만 (TRIP-382)
        print()
        print("### 인접 슬롯 실경로 검증 (TMAP · PUBLIC=대중교통 실측)")
        print("| 구간 | 추정(분) | 실측(분) | 오차 |")
        print("|---|---|---|---|")
        for leg in result["legs"]:
            err = f"{leg['err_pct']:+.1f}%" if leg["err_pct"] is not None else "n/a"
            print(f"| {leg['from']} → {leg['to']} | {leg['est_min']} "
                  f"| {leg['real_min']} | {err} |")


def main() -> int:
    if len(sys.argv) >= 3 and sys.argv[1] == "--summary":
        return _print_summary(sys.argv[2])

    # 어댑터 조립은 smoke_llm 재사용 (중복 구현 금지) — scripts/ 동일 디렉토리 import
    from smoke_llm import _build_adapter

    pois_path = _optional("COLLECTED_POIS")
    if not pois_path:
        raise SystemExit("환경변수 COLLECTED_POIS 필요 (사용법: 스크립트 docstring)")
    smoke_date_str = _optional("SMOKE_DATE") or dt.datetime.now(KST).date().isoformat()
    smoke_date = dt.date.fromisoformat(smoke_date_str)
    output = _optional("REHEARSAL_OUTPUT") or "rehearsal_result.json"

    doc = json.loads(Path(pois_path).read_text(encoding="utf-8"))
    entries = load_proposals(doc)
    days = int(_optional("SMOKE_DAYS") or REHEARSAL_DAYS)
    print(f"[rehearsal] 수집 POI {len(entries)}건 로드 — 날짜 시드 {smoke_date_str} · {days}일 일정")
    forced = _optional("SMOKE_REGION")
    wanted = 1 if forced else int(_optional("SMOKE_REGIONS") or REHEARSAL_REGIONS)
    picker = dict(min_pois=MIN_POIS * days, max_pois=MAX_POIS * days)
    try:
        if forced:
            selections = [select_rehearsal_pois(
                entries, smoke_date_str, region=forced, **picker)]
        else:
            selections = select_rehearsal_batch(
                entries, smoke_date_str, count=wanted, **picker)
    except SelectionError as e:
        print(f"[rehearsal] FAIL 선택 불가: {e}")
        return 1
    if len(selections) < wanted:
        print(f"[rehearsal] WARNING 지역 {wanted}곳 요청 — {len(selections)}곳만 확보 "
              f"(나머지는 반경 내 POI 부족)")
    for sel in selections:
        print(f"[rehearsal] 지역 {sel.region} · 앵커 {sel.anchor.name} · "
              f"POI {len(sel.pois)}개: " + ", ".join(p.name for p in sel.pois))

    adapter, model_id = _build_adapter()
    print(f"[rehearsal] provider={os.environ.get('LLM_PROVIDER', 'openai')} "
          f"model={model_id}")

    # 날씨 주입 (TRIP-409) — 키 있을 때만 실 어댑터 조립 (main.py _kma_weather 선례).
    # 조회 실패는 오케스트레이터 Degradation 경로 — 리허설 성패와 분리.
    weather = None
    weather_key = _optional("WEATHER_API")
    if weather_key:
        from trippilot.poi_curation.adapters.kma_weather import KmaWeatherAdapter
        from trippilot.poi_curation.sourcing.tourapi import UrllibHttpClient

        weather = KmaWeatherAdapter(UrllibHttpClient(), weather_key)
        print("[rehearsal] 날씨 주입: KMA 단기예보 (WEATHER_API)")
    else:
        print("[rehearsal] WEATHER_API 없음 — 날씨 보정 없이 진행")

    # 행사 저장소 (TRIP-421) — 웹소싱 배치 산출물이 있으면 주입 (미설정=기능 부재)
    events = None
    events_path = _optional("EVENTS_STORE")
    if events_path and Path(events_path).exists():
        from trippilot.background.event_store import JsonEventStore

        events = JsonEventStore(Path(events_path))
        print(f"[rehearsal] 행사 저장소 주입: {events.counts()['events']}건 "
              f"({events.counts()['regions_covered']}개 지역 커버)")
    else:
        print("[rehearsal] EVENTS_STORE 없음 — 행사 보너스 없이 진행")

    # 인접 슬롯 실경로 검증 (TRIP-382) — 키 있을 때만, 실패해도 리허설은 성공 유지.
    # 어댑터·실 HTTP 조립은 여기(리허설 실행)에서만 — pytest는 fake (D37).
    tmap_key = _optional("TMAP_API_KEY")
    travel = None
    if tmap_key:
        from trippilot.solver_engine.adapters.tmap import (
            TmapRouteAdapter,
            UrllibHttpClient,
        )

        travel = TmapRouteAdapter(UrllibHttpClient(), tmap_key)
    # wiring 기본 조립(build_orchestrator의 SolverConfig() 기본값)과 동일한 추정기 —
    # 리허설 응답에 실제로 쓰인 추정과 같은 값이어야 오차 축적이 유효하다
    estimator = TravelEstimator(SolverConfig())

    # 지역 하나가 실패해도 나머지는 돌린다 — 한 지역의 데이터 문제로 그날 검증을
    # 통째로 잃으면, 정작 그 지역이 문제라는 사실도 못 남는다. 전부 실패해야 FAIL.
    results: list[dict] = []
    failures: list[str] = []
    for sel in selections:
        try:
            result = run_rehearsal(
                sel, llm=adapter, model_id=model_id, smoke_date=smoke_date,
                weather=weather, events=events, days=days,
            )
        except RehearsalError as e:
            print(f"[rehearsal] FAIL {sel.region}: {e}")
            failures.append(f"{sel.region}: {e}")
            continue
        if result.get("weather"):
            print(f"[rehearsal] 예보(강수확률%): {result['weather']}")
        attach_leg_verification(result, sel, travel, estimator)
        results.append(result)
        print(f"[rehearsal] PASS {sel.region} solve_mode={result['solve_mode']} "
              f"is_fallback={result['is_fallback']} llm_used={result['llm_used']} "
              f"latency={result['latency_ms']}ms")
        for slot in result["slots"]:
            print(f"[rehearsal]   {slot['start']}–{slot['end']}  {slot['name']}")

    if not results:
        print(f"[rehearsal] FAIL 지역 {len(selections)}곳 전부 실패")
        return 1
    if failures:
        print(f"[rehearsal] WARNING {len(failures)}/{len(selections)}곳 실패 — "
              + " | ".join(failures))

    Path(output).write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[rehearsal] {len(results)}곳 기록 → {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
