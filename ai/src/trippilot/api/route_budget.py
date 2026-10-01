"""조립 뒤 화면 거리 — 남은 시한 안에서만 실경로, 못 끝난 구간만 직선 추정 (TRIP-1179).

조립(solve)이 끝난 뒤 슬롯·차선책 거리를 실경로 API 로 구간마다 순차 호출하던 시간은
어떤 시한 회계에도 들어가지 않았다(한 단계 ≈18건 × 호출당 10s 타임아웃 → 백스톱 504).
사용자 결정(2026-10-01): 병렬화 + 남은 시한 안에서만. 시한 안에 못 끝난 구간만
하버사인×우회계수 추정으로 채우고, 화면은 거리만(INV-3). '항상 직선'은 기각.

기존 `_distance_ranges`·`_alternatives_for` 의 순회를 **복제하지 않는다** — 1차로
`LegRecorder` 를 끼워 구간 목록만 받아 적고(외부 호출 0), `measure_within` 으로 병렬
실측한 뒤, 2차로 `MeasuredTable` 을 끼워 같은 함수가 같은 순서로 렌더한다.
어셈블리는 계속 TravelEstimator 를 쓴다 — 바뀌는 것은 표시 거리 문자열뿐이다(INV-2).
"""

from __future__ import annotations

from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass
from typing import Protocol

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.domain.travel import TravelEstimate
from trippilot.ports.travel_port import TravelPort

POST_ASSEMBLY_CAP_MS = 1_500   # 시한 미전송(600s)에서도 이 이상 안 쓴다 — ②′ 실재 검증과 같은 값
RESPONSE_MARGIN_MS = 300       # 응답 직렬화·홉 여유
ROUTE_WORKERS = 8              # 실측: 34구간 순차 5,135ms → n=8 686ms, 429 0건(단일 요청)

# 프로세스 공유 풀 — 이 크기가 **프로세스 전체** 실경로 동시 호출 상한이다. 요청마다 풀을
# 만들면 ① 동시 요청 N 개가 N×8 호출을 낸다(리뷰 실측 80) ② 요청마다 스레드를 새로
# 띄우느라 GIL 경합 때 submit 만 수백 ms 를 쓴다(4 스레드 부하 p50 319ms > 여유 300ms).
# 스레드는 첫 사용 때 뜨고 이후 재사용된다. 대가: 늦은 호출이 HTTP 타임아웃까지 워커를
# 쥐면 뒤 요청은 줄을 서다 예산을 넘겨 더 많이 추정된다 — '못 끝난 구간은 추정'(사용자
# 결정) 범위 안이고 사유에 budget 으로 남는다.
_POOL = ThreadPoolExecutor(max_workers=ROUTE_WORKERS, thread_name_prefix="route-budget")

Leg = tuple[GeoPoint, GeoPoint, TransportMode]


class _Clock(Protocol):
    def monotonic_ms(self) -> int: ...


def post_assembly_budget_ms(deadline_ms: int, elapsed_ms: int) -> int:
    """잔여(시한 − 경과) − 여유, 상한 CAP. 음수는 0 — 0 이면 실경로 호출을 하지 않는다."""
    return max(0, min(POST_ASSEMBLY_CAP_MS, deadline_ms - elapsed_ms - RESPONSE_MARGIN_MS))


class LegRecorder:
    """TravelPort 모양 — 구간을 받아 적고 추정값을 돌려준다(1차 패스, 외부 호출 0)."""

    def __init__(self, fallback: TravelPort) -> None:
        self._fallback = fallback
        self.legs: dict[Leg, None] = {}   # 삽입 순서 보존 + 중복 제거

    def estimate(self, from_: GeoPoint, to: GeoPoint, mode: TransportMode) -> TravelEstimate:
        self.legs.setdefault((from_, to, mode), None)
        return self._fallback.estimate(from_, to, mode)


@dataclass(frozen=True)
class RouteReport:
    total: int
    measured: int          # 실경로
    vendor_estimated: int  # 시한 안에 끝났지만 벤더 실패(예외·체인 폴백) → 추정
    budget_estimated: int  # 시한 안에 못 끝남 → 여기서 추정으로 채움

    @property
    def estimated(self) -> int:
        return self.vendor_estimated + self.budget_estimated


class MeasuredTable:
    """TravelPort 모양 — 실측표에 있으면 그 값, 없으면 추정(2차 패스)."""

    def __init__(self, table: dict[Leg, TravelEstimate], fallback: TravelPort) -> None:
        self._table = table
        self._fallback = fallback

    def estimate(self, from_: GeoPoint, to: GeoPoint, mode: TransportMode) -> TravelEstimate:
        hit = self._table.get((from_, to, mode))
        return hit if hit is not None else self._fallback.estimate(from_, to, mode)


def measure_within(
    legs: Iterable[Leg],
    port: TravelPort,
    fallback: TravelPort,
    *,
    budget_ms: int,
    clock: _Clock,
) -> tuple[MeasuredTable, RouteReport]:
    """구간들을 병렬로 재되 budget_ms 안에 끝난 것만 쓴다. 예산 0 이면 호출 0.

    경과와 마감을 **같은 주입 시계**로 잰다 — 호출측의 잔여 계산과 원점이 갈리지 않게.
    상한은 부드럽다: CPU·GIL 경합에서는 wait 가 늦게 깨 예산을 수십~수백 ms 넘길 수 있다
    (백스톱 시한+5s 와는 거리가 멀다).
    """
    legs = list(dict.fromkeys(legs))
    table: dict[Leg, TravelEstimate] = {}
    measured = vendor = 0
    if budget_ms > 0 and legs:
        # 마감은 submit **전에** 잡는다 — submit 자체가 시간을 쓴다(첫 사용 스레드 기동·
        # GIL 경합). wait 타임아웃을 예산 그대로 주면 그만큼 넘친다.
        end_ms = clock.monotonic_ms() + budget_ms
        futures = {_POOL.submit(port.estimate, *leg): leg for leg in legs}
        done, pending = wait(futures, timeout=max(0, end_ms - clock.monotonic_ms()) / 1000.0)
        # 늦은 호출은 기다리지 않는다 — 줄 선 것은 취소하고, 이미 도는 것은 결과를 버린다.
        for f in pending:
            f.cancel()
        for f in done:
            try:
                est = f.result()
            except Exception:   # 던지는 포트도 생성을 죽이면 안 된다 — 벤더 실패로 센다
                vendor += 1
                continue
            table[futures[f]] = est
            if est.is_estimated:
                vendor += 1
            else:
                measured += 1
    return MeasuredTable(table, fallback), RouteReport(
        total=len(legs), measured=measured, vendor_estimated=vendor,
        budget_estimated=len(legs) - measured - vendor)
