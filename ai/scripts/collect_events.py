"""행사 웹소싱 새벽 배치 — 검색 → LLM 추출 → 게이트 → 저장소 (TRIP-421).

파이프라인 (AI-D03 동형 — 실시간 경로 밖, background 계층):
  ① NAVER API HUB 검색(웹문서·블로그)으로 지역별 행사 스니펫 수집
  ② C1 EVENT_EXTRACTION 워커(LLM) — 스니펫 → 구조화 행사 (게이트가 환각 드롭)
  ③ 지역 검색으로 행사장 좌표 부여 (규칙 — 실패해도 행사는 유효, 부착만 제외)
  ④ JsonEventStore 등록(dedup) + 만료 청소 + 커버리지·로테이션 포인터 갱신

환경변수:
  NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET   필수 — API HUB 키
  NAVER_MAX_CALLS        일일 호출 하드캡 (기본 300 — "정확히 무료까지만")
  EVENT_REGIONS          쉼표 지역 목록 (기본 광역 17) · EVENT_REGIONS_PER_RUN (기본 3)
  EVENTS_STORE           저장소 경로 (기본 collected_events.json — collect-state 브랜치 영속)
  LLM_PROVIDER 등        어댑터 조립은 smoke_llm 재사용 (AZUREAPIKEY 등)

하드캡 규약: 상한 도달 시 그 자리에서 수집을 멈추고 **정상 종료**한다 — 진행 중이던
지역은 포인터를 안 넘겨 내일 재시도(중복은 저장소 dedup이 흡수). 상한 초과 호출 0건.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # smoke_llm 동일 디렉토리 import

from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.event_extraction import EventExtractionGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.prompts import PromptRegistry
from trippilot.llm_gateway.workers.event_extraction import EventExtractionWorker
from trippilot.background.event_store import JsonEventStore
from trippilot.background.naver_search import (
    CallBudgetExceeded,
    NaverSearchClient,
    UrllibHttpClient,
    coord_from_local_item,
    strip_tags,
)
from trippilot.domain.common import TraceId
from trippilot.domain.llm import ModelTier

KST = dt.timezone(dt.timedelta(hours=9))
HORIZON_DAYS = 60      # 수집 지평 — 오늘부터 이 일수 안의 행사만 노린다
SNIPPET_CAP = 60       # 워커 입력 상한 (프롬프트 비대 방지)
EXTRACT_TIMEOUT_SEC = 30.0  # 배치는 지연 예산이 없다 — 넉넉히

# 광역 17개 — 검색 쿼리용 지역명 (TourAPI 코드 순회와 같은 공평 순회 정신)
DEFAULT_REGIONS = ("서울", "인천", "대전", "대구", "광주", "부산", "울산", "세종",
                   "경기", "강원", "충북", "충남", "경북", "경남", "전북", "전남", "제주")

# 지역 대략 경계 (lat_min, lat_max, lng_min, lng_max) — 지오코딩 오매칭 차단용
# (실측 2026-08-21: 서울 "동대문구 맥주축제"가 부산 좌표를 받았다). 목적이 "다른
# 광역을 잡은 명백한 오매칭 차단"이라 경계는 후하게 — 접경 오차는 허용한다.
REGION_BOUNDS = {
    "서울": (37.40, 37.72, 126.75, 127.20),
    "인천": (37.00, 37.99, 124.50, 126.90),   # 서해 도서 포함
    "대전": (36.15, 36.55, 127.20, 127.60),
    "대구": (35.55, 36.40, 128.30, 128.80),   # 군위 편입 포함
    "광주": (35.00, 35.30, 126.60, 127.05),
    "부산": (34.85, 35.45, 128.70, 129.35),
    "울산": (35.25, 35.80, 128.90, 129.50),
    "세종": (36.35, 36.80, 127.05, 127.45),
    "경기": (36.80, 38.35, 126.30, 127.90),
    "강원": (36.95, 38.70, 127.00, 129.45),
    "충북": (35.95, 37.30, 127.20, 128.70),
    "충남": (35.90, 37.10, 125.85, 127.70),
    "경북": (35.50, 37.60, 127.75, 131.05),   # 울릉·독도 포함
    "경남": (34.50, 36.00, 127.50, 129.35),
    "전북": (35.25, 36.20, 125.85, 127.95),
    "전남": (33.85, 35.55, 124.95, 127.60),
    "제주": (33.05, 34.10, 126.05, 127.05),
}


def coord_in_region(region: str, coord) -> bool:
    """좌표가 수집 지역의 대략 경계 안인가 — 미지 지역명은 통과(막을 근거 없음)."""
    bounds = REGION_BOUNDS.get(region)
    if bounds is None or coord is None:
        return True
    lat_min, lat_max, lng_min, lng_max = bounds
    return lat_min <= coord.lat <= lat_max and lng_min <= coord.lng <= lng_max


# 저품질 이름 필터 (실측 2026-08-21: "콘서트-광주"·"마을축제"·"복합문화행사") —
# 정규화 후 일반어 조합뿐이면 어떤 행사인지 식별 불가라 등록 가치가 없다.
_GENERIC_WORDS = frozenset({
    "축제", "공연", "전시", "행사", "콘서트", "페스티벌", "마켓", "문화",
    "복합", "마을", "지역", "이번", "주말",
})


def is_generic_name(name: str, region: str) -> bool:
    from trippilot.background.event_store import normalize_name

    text = normalize_name(name).replace(region, "")
    if len(text) < 4:
        return True  # 지역명 빼고 3자 이하 — 식별 불가
    remainder = text
    for word in _GENERIC_WORDS:
        remainder = remainder.replace(word, "")
    return len(remainder) < 2  # 일반어를 걷어내면 남는 게 없다


def _optional(name: str) -> str | None:
    return os.environ.get(name) or None


class _StderrTrace:
    def emit(self, event: object) -> None:
        try:
            print(f"[trace] {event}", file=sys.stderr)
        except Exception:
            pass


def _queries(region: str, today: dt.date) -> tuple[tuple[str, str], ...]:
    """지역당 검색 5건 — (종류, 쿼리). 80% 캡 상향(2026-08-21)으로 재현율 확대."""
    nxt = today.replace(day=1) + dt.timedelta(days=32)  # 다음 달 (수집 지평 60일 안)
    return (
        ("webkr", f"{region} 축제 {today.year}년 {today.month}월"),
        ("webkr", f"{region} 축제 {nxt.year}년 {nxt.month}월"),
        ("webkr", f"{region} 행사 전시 공연 일정"),
        ("news", f"{region} 축제 개막 개최"),
        ("blog", f"{region} 이번 달 축제 행사"),
    )


def _geocode(event, region: str, client: NaverSearchClient, kakao) -> object:
    """행사 좌표 확보 체인 (TRIP-421 — 실측 기반 순서).

    ① 네이버 지역검색 "지역+행사명" → ② 카카오 주소검색(주소 있으면, 정식
    지오코더) → ③ 카카오 키워드검색 → ④ 네이버 지역검색 주소(카카오 미배선 시).
    예산 소진은 그 자리에서 중단 — 좌표만 포기, 행사 등록은 계속.
    """
    def _naver(query: str):
        items = client.search("local", query, display=1)
        return coord_from_local_item(items[0]) if items else None

    steps = [lambda: _naver(f"{region} {event.name}")]
    if kakao is not None:
        if event.address:
            steps.append(lambda: kakao.address_to_coord(event.address))
        steps.append(lambda: kakao.keyword_to_coord(f"{region} {event.name}"))
    elif event.address:
        steps.append(lambda: _naver(event.address))
    for step in steps:
        try:
            coord = step()
        except CallBudgetExceeded:
            return None  # 예산 소진 — 체인 종료
        except Exception as e:
            # 지오코딩 실패(403·타임아웃 등)는 배치를 죽이면 안 된다 — 좌표만
            # 포기하고 다음 단계로 (2026-08-21 실측: 카카오맵 미활성 403이 배치
            # 전체를 중단시켰다. 침묵은 아니다 — stderr 기록).
            print(f"[events] 지오코딩 단계 실패({type(e).__name__}: {e}) — 다음 단계로",
                  file=sys.stderr)
            continue
        if coord is not None and not coord_in_region(region, coord):
            # 다른 광역을 잡은 오매칭 (실측: 서울 행사 → 부산 좌표) — 버리고 다음 단계
            print(f"[events] 지역 정합 위반 좌표 폐기({region}: {coord.lat:.3f},{coord.lng:.3f})",
                  file=sys.stderr)
            continue
        if coord is not None:
            return coord
    return None


def collect_region(
    region: str,
    *,
    client: NaverSearchClient,
    worker: EventExtractionWorker,
    store: JsonEventStore,
    today: dt.date,
    now: dt.datetime,
    kakao=None,  # KakaoLocalClient | None (지오코딩 보강 — 키 없으면 네이버만)
) -> dict:
    """지역 1곳 수집 — 통계 dict 반환. CallBudgetExceeded는 위로 전파(포인터 미전진)."""
    pairs: list[tuple[str, str]] = []
    for kind, query in _queries(region, today):
        for item in client.search(kind, query):
            pair = (strip_tags(item.get("title", "")),
                    strip_tags(item.get("description", "")))
            if pair[0] and pair not in pairs:
                pairs.append(pair)
    pairs = pairs[:SNIPPET_CAP]

    result = worker.extract(
        region, today, today + dt.timedelta(days=HORIZON_DAYS), pairs,
        TraceId(f"event-collect-{today.isoformat()}-{region}"), now,
        timeout_sec=EXTRACT_TIMEOUT_SEC,
    )
    extracted = tuple(result.value or ())
    stats = {"region": region, "snippets": len(pairs), "extracted": len(extracted),
             "generic_dropped": 0, "geocoded": 0, "added": 0,
             "fallback": bool(result.is_fallback), "error": result.error}
    # 저품질 이름 필터 — 일반어뿐인 이름은 식별 불가 (게이트는 환각 방어 소유,
    # 품질 컷은 배치 규칙 소유)
    kept = tuple(e for e in extracted if not is_generic_name(e.name, region))
    stats["generic_dropped"] = len(extracted) - len(kept)
    extracted = kept

    # ③ 좌표 부여 — _geocode 체인 (네이버 → 카카오 주소/키워드). 좌표 없는 행사도
    #    유효하다 — POI 부착(보너스)만 제외.
    enriched = []
    for event in extracted:
        coord = _geocode(event, region, client, kakao)
        if coord is not None:
            stats["geocoded"] += 1
            event = dataclasses.replace(event, coord=coord)
        enriched.append(event)

    stats["added"] = store.upsert(region, enriched, now)
    return stats


def main() -> int:
    if len(sys.argv) >= 3 and sys.argv[1] == "--summary":
        run = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        print("## 행사 웹소싱 배치 (NAVER API HUB × EVENT_EXTRACTION)")
        print(f"- 호출 {run['calls_used']}/{run['max_calls']} (하드캡) · "
              f"만료 청소 {run['purged']}건 · 저장소 총 {run['store_events']}건")
        print()
        print("| 지역 | 스니펫 | 추출 | 좌표 | 신규 |")
        print("|---|---|---|---|---|")
        for r in run["regions"]:
            print(f"| {r['region']} | {r['snippets']} | {r['extracted']} "
                  f"| {r['geocoded']} | {r['added']} |")
        if run.get("budget_stopped"):
            print()
            print(f"- ⏸ 하드캡 도달로 조기 종료 — `{run['budget_stopped']}` 지역부터 내일 재개")
        return 0

    client_id = _optional("NAVER_SEARCH_CLIENT_ID")
    client_secret = _optional("NAVER_SEARCH_CLIENT_SECRET")
    if not (client_id and client_secret):
        raise SystemExit("NAVER_SEARCH_CLIENT_ID/SECRET 필요 (사용법: 스크립트 docstring)")
    max_calls = int(_optional("NAVER_MAX_CALLS") or "300")
    per_run = int(_optional("EVENT_REGIONS_PER_RUN") or "3")
    regions = tuple(
        r.strip() for r in (_optional("EVENT_REGIONS") or "").split(",") if r.strip()
    ) or DEFAULT_REGIONS
    store_path = Path(_optional("EVENTS_STORE") or "collected_events.json")

    now = dt.datetime.now(KST)
    today = now.date()

    from smoke_llm import _build_adapter  # 어댑터 조립 재사용 (중복 구현 금지)
    adapter, model_id = _build_adapter()
    prompts_root = Path(__file__).resolve().parents[1] / "prompts"
    worker = EventExtractionWorker(GatewayFacade(
        adapter, PromptRegistry(prompts_root), EventExtractionGate(),
        # max_tokens 4096 — 기본 1024에서 행사 다수 지역(서울·경기) 출력이 잘려
        # parse_error 재현 (2026-08-21 풀 배치 실측). 배치 전용 — 실시간 경로 무변.
        C1Config(model_ids={ModelTier.LIGHT: model_id, ModelTier.HEAVY: model_id},
                 max_tokens=4096),
        _StderrTrace(),
    ))
    client = NaverSearchClient(UrllibHttpClient(), client_id, client_secret, max_calls)
    # 카카오 지오코딩 보강 (TRIP-421) — 키 없으면 네이버 체인만 (기능 부재 ≠ 실패)
    kakao = None
    kakao_key = _optional("KAKAO_REST_API_KEY")
    if kakao_key:
        from trippilot.background.kakao_local import KakaoLocalClient

        kakao = KakaoLocalClient(
            UrllibHttpClient(), kakao_key,
            int(_optional("KAKAO_MAX_CALLS") or "300"),
        )
        print("[events] 카카오 지오코딩 활성 (주소검색·키워드검색 폴백)")
    store = JsonEventStore(store_path)

    start = store.pointer % len(regions)
    todo = [regions[(start + i) % len(regions)] for i in range(min(per_run, len(regions)))]
    print(f"[events] 지역 {len(regions)}곳 로테이션 — 이번 실행: {', '.join(todo)} "
          f"(포인터 {start}, 하드캡 {max_calls}호출)")

    region_stats: list[dict] = []
    budget_stopped: str | None = None
    completed = 0
    for region in todo:
        try:
            stats = collect_region(region, client=client, worker=worker,
                                   store=store, today=today, now=now, kakao=kakao)
        except CallBudgetExceeded:
            budget_stopped = region  # 이 지역은 포인터 미전진 — 내일 여기부터
            print(f"[events] 하드캡 도달 — {region} 수집은 내일 재개")
            break
        completed += 1
        region_stats.append(stats)
        print(f"[events] {region}: 스니펫 {stats['snippets']} → 추출 {stats['extracted']} "
              f"(좌표 {stats['geocoded']}, 신규 {stats['added']})"
              + (f" · fallback: {stats['error']}" if stats["fallback"] else ""))

    store.pointer = (start + completed) % len(regions)
    purged = store.purge_expired(today)
    # 기존 레코드 소급 정리 (TRIP-421 품질 3종 — 규칙 강화 이전 등록분에 재적용)
    cleaned = store.sanitize(
        drop_event=lambda region, e: is_generic_name(e.name, region),
        coord_ok=coord_in_region,
    )
    if any(cleaned.values()):
        print(f"[events] 소급 정리 — 저품질 삭제 {cleaned['dropped']} · "
              f"오매칭 좌표 제거 {cleaned['coord_cleared']} · 변형 중복 제거 {cleaned['deduped']}")
    store.save()

    run = {"calls_used": client.calls_used, "max_calls": max_calls, "purged": purged,
           "regions": region_stats, "budget_stopped": budget_stopped,
           "store_events": store.counts()["events"]}
    Path("collect_events_run.json").write_text(
        json.dumps(run, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[events] 완료 — 호출 {client.calls_used}/{max_calls}, 만료 청소 {purged}건, "
          f"저장소 총 {run['store_events']}건 → {store_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
