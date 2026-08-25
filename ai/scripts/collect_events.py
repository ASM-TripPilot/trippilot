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
import re
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
# 스니펫에 날짜가 언급됐는지 — "8월 15일", "2026-09-01", "9/1~9/3" 류를 넓게 잡는다.
# 정밀 파싱이 아니라 **관측용 지표**다 (날짜 없는 스니펫은 추출될 수 없다).
_DATE_HINT_RE = re.compile(r"\d{1,2}\s*월|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}|\d{1,2}\s*일")

HORIZON_DAYS = 60      # 수집 지평 — 오늘부터 이 일수 안의 행사만 노린다
SNIPPET_CAP = 80       # 워커 입력 상한 (프롬프트 비대 방지)
# 60 → 80 (2026-08-25). 쿼리를 5 → 9 건으로 늘리면서 함께 올린다 — 캡을 그대로 두면
# 늘어난 스니펫이 **먼저 들어온 순서대로 잘려** 새 쿼리의 결과가 통째로 버려진다.
# 비용: 실측 스니펫 60개 ≈ 입력 4,936 토큰(지역당)이라 80개면 지역당 +30% 안팎.
# 하루 17콜 기준 9.5만 → 12만 토큰 수준. 호출 수는 안 변한다.
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
    """지역당 검색 9건 — (종류, 쿼리).

    5건에서 늘렸다(2026-08-25). 근거는 실측이다 — 5건으로 모이는 **유니크 스니펫이
    46~50개**에서 정체했고 SNIPPET_CAP(60)에 닿지도 않았다. 즉 그때까지 천장은 캡이
    아니라 **쿼리 다양성**이었다. 같은 어휘("축제·행사·전시·공연")만 반복해 검색하면
    같은 문서가 다시 걸릴 뿐이라, 어휘와 출처 성격을 갈라 4건을 더한다:
      - 공공 주최 정보원(문화재단) — 보도자료성 일정이 여기 몰린다
      - 생활 표현("주말 가볼만한") — 블로그가 쓰는 말은 공식 표현과 다르다
      - 전시·박람회 계열 — 축제 어휘로는 안 걸리는 종류
      - 뉴스의 다른 표현("일정 안내")

    LLM 호출 수는 안 늘어난다 — 추출은 지역당 1콜이고 스니펫은 프롬프트 안에 들어간다.
    늘어나는 것은 네이버 호출(무료 쿼터의 0.5% → 0.8% 수준)과 프롬프트 토큰이다.
    """
    nxt = today.replace(day=1) + dt.timedelta(days=32)  # 다음 달 (수집 지평 60일 안)
    return (
        ("webkr", f"{region} 축제 {today.year}년 {today.month}월"),
        ("webkr", f"{region} 축제 {nxt.year}년 {nxt.month}월"),
        ("webkr", f"{region} 행사 전시 공연 일정"),
        ("news", f"{region} 축제 개막 개최"),
        ("blog", f"{region} 이번 달 축제 행사"),
        ("webkr", f"{region} 문화재단 행사 안내"),
        ("webkr", f"{region} 전시회 박람회 {today.year}년 {today.month}월"),
        ("news", f"{region} 행사 일정 안내"),
        ("blog", f"{region} 주말 가볼만한 축제"),
    )


# 주소 꼬리 — 지오코더가 못 읽는 군더더기. "OO 일원", "A, B, C 외", "(부제)", 우편번호.
_ADDR_TAIL_RE = re.compile(r"\s*(일원|일대|외|등)\s*$")
_ADDR_PAREN_RE = re.compile(r"\([^)]*\)")
_ADDR_ZIP_RE = re.compile(r"^\d{5}\s+")
# 행정단위 접미사 — 토큰이 **전부** 이걸로 끝나야 "행정단위만 있는 주소"다.
# (접미사를 선택으로 두면 '경기아트센터'·'레인보우힐링관광지' 까지 잡는 오탐이 난다)
_ADMIN_SUFFIX_RE = re.compile(r"(특별자치시|특별자치도|특별시|광역시|자치시|자치구|시|군|구|도)$")
_DETAIL_HINT_RE = re.compile(r"(읍|면|동|리|로|길|가)\s|\d")


def clean_address(address: str) -> str:
    """지오코더에 넣기 전 꼬리 정리. 실측 예: '레인보우힐링관광지 일원' → '레인보우힐링관광지',
    '53281 경남 거제시 둔덕면 하둔리 644-2 둔덕가족생활체육공원 일원' → 우편번호·꼬리 제거."""
    text = _ADDR_ZIP_RE.sub("", _ADDR_PAREN_RE.sub(" ", address)).strip()
    text = text.split(",")[0].strip()          # "A, B, C" 나열은 첫 항목만
    return _ADDR_TAIL_RE.sub("", text).strip()


def is_admin_only(address: str) -> bool:
    """'경상북도 예천군'·'울산광역시 남구' 처럼 **행정단위로만 끝나는** 주소인가.

    이런 주소를 지오코딩하면 시·군·구청 대표점이 나온다 — 행사 위치가 아니다.
    그런데 부착 반경이 1km(`event_affinity.ATTACH_RADIUS_KM`)라 **시청 주변 POI 에
    근거 없는 보너스**를 준다. 좌표율 지표만 올리고 추천 품질은 떨어뜨리는 거래라
    받지 않는다 (2026-08-25 실측: 좌표 보유 27건 중 8건이 이 부류였다).
    """
    text = clean_address(address)
    if _DETAIL_HINT_RE.search(text):
        return False          # 번지·도로명·읍면동이 있으면 실제 위치다
    tokens = text.split()
    if not tokens or len(tokens) > 3:
        return False
    if len(tokens) == 1 and tokens[0] in DEFAULT_REGIONS:
        return True           # "대구" 처럼 접미사 없는 광역명 단독
    return all(_ADMIN_SUFFIX_RE.search(t) for t in tokens)


def _geocode(event, region: str, client: NaverSearchClient, kakao) -> object:
    """행사 좌표 확보 체인 (TRIP-421 — 실측 기반 순서).

    ① 네이버 지역검색 "지역+행사명" → ② 카카오 주소검색(주소 있으면, 정식
    지오코더) → ③ 카카오 키워드검색 → ④ 네이버 지역검색 주소(카카오 미배선 시).
    예산 소진은 그 자리에서 중단 — 좌표만 포기, 행사 등록은 계속.
    """
    def _naver(query: str):
        items = client.search("local", query, display=1)
        return coord_from_local_item(items[0]) if items else None

    # 행정단위로만 된 주소는 아예 안 쓴다 — 시·군·구청 대표점이 나오기 때문이다.
    # 행사명으로 실제 장소를 찾는 경로는 그대로 남는다.
    addr = clean_address(event.address) if event.address else ""
    if addr and is_admin_only(addr):
        print(f"[events] 행정단위 주소 무시({region}: {addr}) — 대표점은 행사 위치가 아니다",
              file=sys.stderr)
        addr = ""

    steps = [lambda: _naver(f"{region} {event.name}")]
    if kakao is not None:
        if addr:
            steps.append(lambda: kakao.address_to_coord(addr))
            # 주소를 **키워드검색에도** 넘긴다. address.json 은 행정주소 파서라
            # '경기아트센터'·'DDP'·'수원월드컵경기장' 같은 시설명에는 빈손이고,
            # 그 시설명들이 정작 장소 DB(keyword.json)에는 있다 — 그런데 한때
            # 키워드검색은 항상 `{지역} {행사명}` 만 받아 주소를 한 번도 못 봤다
            # (2026-08-25 조사: 시설명 주소 17건 + 모호 주소 14건이 통째로 미시도).
            steps.append(lambda: kakao.keyword_to_coord(f"{region} {addr}"))
        steps.append(lambda: kakao.keyword_to_coord(f"{region} {event.name}"))
    elif addr:
        steps.append(lambda: _naver(addr))
    for step in steps:
        try:
            coord = step()
        except CallBudgetExceeded as e:
            # 침묵하면 남은 전 행사가 이유 없이 좌표를 잃는다 — 어느 클라이언트가
            # 소진됐는지까지 남긴다 (INV-4: 침묵 실패 금지).
            print(f"[events] 좌표 확보 중단 — 호출 예산 소진: {e}", file=sys.stderr)
            return None
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
    raw_pairs = len(pairs)
    pairs = pairs[:SNIPPET_CAP]
    # 왜 이 지역이 0건인지 물으면 답할 수 있어야 한다. 스니펫 **개수**만으로는
    # 부족했다 — 대전은 개수(47~49)가 남들과 같은데 입력 토큰이 최저였다(내용이
    # 빈약). 날짜 문자열이 없는 스니펫은 프롬프트 규칙·게이트가 원천 배제하므로
    # 그 비율이 곧 추출 가능성이다. (2026-08-25 조사)
    dated = sum(1 for t, d in pairs if _DATE_HINT_RE.search(f"{t} {d}"))
    chars = sum(len(t) + len(d) for t, d in pairs)
    print(f"[events] {region} 입력: 스니펫 {len(pairs)}"
          + (f" (캡에 잘림, 원본 {raw_pairs})" if raw_pairs > len(pairs) else "")
          + f" · 날짜언급 {dated} · 총 {chars:,}자", file=sys.stderr)

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

    stats["added"], stats["backfilled"] = store.upsert(region, enriched, now)
    return stats


def main() -> int:
    if len(sys.argv) >= 3 and sys.argv[1] == "--summary":
        run = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        print("## 행사 웹소싱 배치 (NAVER API HUB × EVENT_EXTRACTION)")
        if run.get("kakao_calls_used") is not None:
            print(f"- 카카오 지오코딩 호출 {run['kakao_calls_used']}건")
        print(f"- 호출 {run['calls_used']}/{run['max_calls']} (하드캡) · "
              f"만료 청소 {run['purged']}건 · 저장소 총 {run['store_events']}건")
        print()
        print("| 지역 | 스니펫 | 추출 | 좌표 | 신규 | 좌표백필 |")
        print("|---|---|---|---|---|---|")
        for r in run["regions"]:
            print(f"| {r['region']} | {r['snippets']} | {r['extracted']} "
                  f"| {r['geocoded']} | {r['added']} | {r.get('backfilled', 0)} |")
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
              f"(좌표 {stats['geocoded']}, 신규 {stats['added']}"
              + (f", 좌표백필 {stats['backfilled']}" if stats.get("backfilled") else "") + ")"
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
           # 카카오 실사용은 어디에도 안 찍혀서 상한(80,000)이 적정한지 판단할 근거가
           # 없었다 — "정확히 무료까지만"이라는 계약을 검증할 수단부터 만든다.
           "kakao_calls_used": getattr(kakao, "calls_used", None),
           "regions": region_stats, "budget_stopped": budget_stopped,
           "store_events": store.counts()["events"]}
    Path("collect_events_run.json").write_text(
        json.dumps(run, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[events] 완료 — 호출 {client.calls_used}/{max_calls}, 만료 청소 {purged}건, "
          f"저장소 총 {run['store_events']}건 → {store_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
