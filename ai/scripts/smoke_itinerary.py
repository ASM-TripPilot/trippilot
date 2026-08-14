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
    SMOKE_DATE        YYYY-MM-DD, 기본 오늘 KST 날짜 (CLI라 wall-clock 직접 호출 허용
                      — smoke_llm·collect_pois와 같은 관례)
    REHEARSAL_OUTPUT  기본 "rehearsal_result.json" — 기록용 1건 JSON
    LLM env           smoke_llm.py 와 동일 (LLM_PROVIDER/OPENAI_*/AZURE_*/ANTHROPIC_*)
                      — 어댑터 조립은 smoke_llm._build_adapter 를 그대로 재사용

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
from trippilot.solver_engine.travel import haversine_km
from trippilot.domain.common import BudgetLevel
from trippilot.domain.llm import ModelTier
from trippilot.domain.persona import CompanionType, PersonaSummary
from trippilot.domain.poi import Poi
from trippilot.ports.llm_port import LlmPort, LlmRequest, LlmResponse

# 앵커 반경(km) — 후보풀 반경(M7 PUBLIC 10km)보다 좁게 잡아 "흩어진 POI로 후보 0"
# 함정을 회피한다. 샘플 6~8개는 1일 일정 슬롯 수(대략 4~6)보다 여유 있는 최소 풀.
RADIUS_KM = 8.0
MIN_POIS = 6
MAX_POIS = 8
MAX_ATTEMPTS = 5  # 반경 내 POI 부족 시 다른 시군구 재시도 상한


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
) -> Selection:
    """날짜 시드 랜덤 선택 — 같은 (날짜, 데이터)는 항상 같은 결과.

    ① region 목록에서 날짜 시드로 시군구 후보 순서를 뽑고(최대 max_attempts곳)
    ② 그 시군구 POI 중 앵커 1개 랜덤 → **전체 수집 POI** 중 앵커 반경 radius_km
       이내에서 min~max개 샘플 (반경 풀은 시군구 경계를 넘을 수 있다 — 인접
       시군구 POI도 실제 일정에선 유효한 후보다).
    반경 내가 min 미만이면 다음 시군구로 재시도, 전부 실패면 SelectionError.
    """
    by_region: dict[str, list[Poi]] = {}
    for poi, region in entries:
        if region:  # region 추출 실패(null)는 시군구 선택 대상에서 제외
            by_region.setdefault(region, []).append(poi)
    if not by_region:
        raise SelectionError("region 있는 제안이 0건 — 수집 JSON 확인 필요")

    # 시드에 들어가는 순서를 안정화 — JSON 항목 순서가 바뀌어도 같은 선택
    regions = sorted(by_region)
    all_pois = sorted((p for p, _ in entries), key=lambda p: str(p.poi_id))
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


class RehearsalError(Exception):
    """생성 실패 또는 검사(슬롯≥1 · INV-1 · INV-3) 위반."""


def _request_body(selection: Selection, smoke_date: dt.date, deadline_ms: int) -> dict:
    """내일 날짜 1일 여행 — 앵커=선택 앵커 좌표, 09~20시 (백엔드 와이어 형태)."""
    trip_date = (smoke_date + dt.timedelta(days=1)).isoformat()
    anchor = selection.anchor.coord
    return {
        "trip_id": f"rehearsal-{smoke_date.isoformat()}",
        "generation_mode": "FULLY_AI",
        "trip_context": {
            "destinations": [selection.region],
            "start_date": trip_date,
            "end_date": trip_date,
            "companion_type": "혼자",
            "budget_level": "중간",
        },
        "anchors": [{"date": trip_date, "lat": anchor.lat, "lng": anchor.lng}],
        "time_windows": [{"date": trip_date, "start": "09:00", "end": "20:00"}],
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
            "deadline_ms": deadline_ms,
        },
        "excluded_poi_ids": [],
    }


def run_rehearsal(
    selection: Selection,
    *,
    llm: LlmPort,
    model_id: str,
    smoke_date: dt.date,
    deadline_ms: int = 20_000,
) -> dict:
    """선택 POI로 실 조립 관통 1건 → 기록용 결과 dict. 위반은 RehearsalError.

    검사: 200 · 슬롯 ≥ 1 · 슬롯 poi_id ⊆ 선택 집합(INV-1) · 응답 원문에 duration
    토큰 부재(INV-3). LLM 실패로 규칙 점수 강등돼도 성공(정직한 강등, INV-4) —
    solve_mode·is_fallback·llm_used 로 기록만 남긴다.
    """
    from fastapi.testclient import TestClient  # dev 의존(httpx) — 스크립트 실행시만

    recorder = RecordingLlm(llm)
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
    )
    client = TestClient(create_app(orchestrator), raise_server_exceptions=False)

    started = time.monotonic()
    response = client.post(
        "/ai/v1/itinerary/generate",
        json=_request_body(selection, smoke_date, deadline_ms),
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
            {"start": s["start_at"], "end": s["end_at"], "name": names[s["poi_id"]]}
            for _, s in slots
        ],
        "solve_mode": body["solve_mode"],
        "is_fallback": body["is_fallback"],
        "llm_used": recorder.ok_calls > 0,
        "latency_ms": latency_ms,
    }


# ── CLI ──────────────────────────────────────────────────────────────


def _optional(name: str) -> str | None:
    """빈 문자열도 미설정으로 취급 — GH Actions는 비운 input을 ''로 주입한다."""
    return os.environ.get(name) or None


def _print_summary(json_path: str) -> int:
    """결과 JSON → 잡 서머리용 마크다운 표 (GITHUB_STEP_SUMMARY 리다이렉트 용도)."""
    result = json.loads(Path(json_path).read_text(encoding="utf-8"))
    print("## 일정 생성 리허설 (수집 POI × 실 LLM × 솔버)")
    print(f"- 날짜 {result['date']} · 지역 **{result['region']}** · "
          f"앵커 {result['anchor']['name']}")
    print(f"- solve_mode `{result['solve_mode']}` · 폴백 {result['is_fallback']} · "
          f"LLM 사용 {result['llm_used']} · {result['latency_ms']}ms")
    print()
    print("| 시각 | 장소 |")
    print("|---|---|")
    for slot in result["slots"]:
        print(f"| {slot['start']}–{slot['end']} | {slot['name']} |")
    return 0


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
    print(f"[rehearsal] 수집 POI {len(entries)}건 로드 — 날짜 시드 {smoke_date_str}")
    try:
        selection = select_rehearsal_pois(entries, smoke_date_str)
    except SelectionError as e:
        print(f"[rehearsal] FAIL 선택 불가: {e}")
        return 1
    print(f"[rehearsal] 지역 {selection.region} · 앵커 {selection.anchor.name} · "
          f"POI {len(selection.pois)}개: "
          + ", ".join(p.name for p in selection.pois))

    adapter, model_id = _build_adapter()
    print(f"[rehearsal] provider={os.environ.get('LLM_PROVIDER', 'openai')} "
          f"model={model_id}")
    try:
        result = run_rehearsal(
            selection, llm=adapter, model_id=model_id, smoke_date=smoke_date
        )
    except RehearsalError as e:
        print(f"[rehearsal] FAIL {e}")
        return 1

    Path(output).write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[rehearsal] PASS solve_mode={result['solve_mode']} "
          f"is_fallback={result['is_fallback']} llm_used={result['llm_used']} "
          f"latency={result['latency_ms']}ms → {output}")
    for slot in result["slots"]:
        print(f"[rehearsal]   {slot['start']}–{slot['end']}  {slot['name']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
