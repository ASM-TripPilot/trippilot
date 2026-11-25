"""TmapRouteAdapter — TMAP 경로 API TravelTimePort 구현 (TRIP-382).

HTTP 클라이언트는 생성자 주입 — 테스트는 fake, 실행은 UrllibHttpClient(표준
라이브러리, 새 의존 없음). **메서드 1회 = HTTP 호출 정확히 1건**, 재시도 없음
(일일 한도 아끼기 — TourApiAdapter 선례).

**키 여러 개를 번갈아 쓴다** (2026-11-25 사용자 지시 — 팀원이 받은 두 번째 키). 키를 목록으로 주면
수단마다 호출할 때 다음 키부터 시작하는 라운드로빈이다 — 다른 계정에서 받은 키면 일 한도가 따로라 그만큼
더 잰다(같은 계정의 추가 키도 한도를 따로 받는지는 재지 않았다). 그 키만의 문제(`_KEY_STATUS` —
401·403·429)로 실패하면 같은 호출 안에서 쉬지 않는 남은 키를 한 번씩 더 묻고(이때만 HTTP 가 1건을
넘는다), 실패한 (키, 수단)은 `_KEY_REST_S` 동안 쉰다. 타임아웃·5xx·400 은 어느 키든 같아 넘기지 않는다.
키 하나만 주면 종전과 같다. `AnthropicAdapter` 의 키 순환을 본떴지만 세 곳이 다르다 — 429 도 쉰다(TMAP 의
429 는 분 단위 제한이 아니라 일 한도로 본다: 동시 24건에도 안 났다), 쉬는 키는 그 호출에서 건너뛴다(맨 뒤로
돌려 끝까지 묻지 않는다), 쉼이 (키, 수단)별이다.

응답 형태는 TMAP 문서 기준으로 고정했다 — POST, 헤더 `appKey`. 자동차·보행은
`/tmap/routes[/pedestrian]` 응답 `features[].properties` 중 `totalTime`(초)·
`totalDistance`(미터). 대중교통(TRIP-405)은 별도 상품 `/transit/routes` 응답
`metaData.plan.itineraries[]` 중 `totalTime`(초) — 거리는 `totalDistance` 우선,
없으면 `legs[].distance` 합산. **실 응답과의 드리프트는 실키 첫 실행
(scripts/smoke/smoke_itinerary.py 수동/스케줄)에서 검증**한다 (TourAPI 어댑터
선례 — 픽스처는 문서 기준, 실키 스모크가 계약을 확정).

실패 시 다른 수단으로 조용히 폴백하지 않는다 — TravelTimeError 승격(INV-4).
(v1의 PUBLIC→보행 근사는 TRIP-405에서 제거 — 실측 2일치에서 장거리 −50~60%
편향 확인, 근사가 캘리브레이션 재료로 부적합.)
"""

from __future__ import annotations

import itertools
import json
import logging
import threading
import time
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from typing import Protocol

from trippilot.domain.common import GeoPoint, TransportMode
from trippilot.ports.travel_time_port import MeasuredTravel, TravelTimeError

_log = logging.getLogger(__name__)

_BASE = "https://apis.openapi.sk.com"
# 그 키만의 문제를 뜻하는 HTTP 상태 — 다른 키는 될 수 있으니 다음 키로 넘긴다. 게이트웨이는 무효 키와 상품 미구독을
# 둘 다 403 `INVALID_API_KEY` 로 준다(2026-11-25 실호출). 403 이 상품(경로)별이라 쉼도 (키, 수단)별이다 —
# 대중교통 미구독 키도 자동차·보행은 된다.
_KEY_STATUS = frozenset({401, 403, 429})
# 키 문제로 실패한 (키, 수단)을 쉬게 두는 시간 — 라운드로빈이라 그대로 두면 막힌 키 차례마다 실패 한 번이
# 조립 뒤 거리 시한(≤1.5s) 안에 먼저 얹힌다. `anthropic_adapter._KEY_REST_S` 와 같은 값.
_KEY_REST_S = 600.0

# 수단 → (엔드포인트 경로, source 표기) — 근사 없음, 전 수단 실측 (TRIP-405)
_ROUTE: Mapping[TransportMode, tuple[str, str]] = {
    TransportMode.CAR: ("/tmap/routes", "tmap_car"),
    TransportMode.WALK: ("/tmap/routes/pedestrian", "tmap_pedestrian"),
    TransportMode.PUBLIC: ("/transit/routes", "tmap_transit"),
}


class HttpPostJson(Protocol):
    """POST(JSON body) + JSON 파싱 1건. 실패는 예외로 (어댑터가 TravelTimeError로 감싼다)."""

    def post_json(
        self, url: str, headers: Mapping[str, str], body: Mapping[str, object]
    ) -> object: ...


class UrllibHttpClient:
    """표준 라이브러리 구현 — 스크립트 실행용. 테스트에서는 사용하지 않는다(실 호출 0)."""

    def __init__(self, timeout_sec: float = 10.0) -> None:
        self._timeout = timeout_sec

    def post_json(
        self, url: str, headers: Mapping[str, str], body: Mapping[str, object]
    ) -> object:
        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", **headers},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self._timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))


class TmapRouteAdapter:
    """TravelTimePort 구현 — 좌표쌍 1건 → 실이동 소요분·거리 (조회 전용)."""

    def __init__(self, http: HttpPostJson, app_key: str | Sequence[str], *,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._http = http
        self._keys = (app_key,) if isinstance(app_key, str) else tuple(app_key)
        if not self._keys:
            raise ValueError("app_key 가 하나도 없다")
        # 순번은 수단별 — 한도가 상품(수단)별이라, 수단이 번갈아 들어와도 수단마다 키를 고르게 쓴다.
        # next() 는 CPython 에서 원자적이라 스레드풀의 동시 호출이 같은 키로 몰리지 않는다
        self._turns = {mode: itertools.count() for mode in _ROUTE}
        self._clock = clock
        # (키 순번, 수단) → 쉼이 끝나는 시각. 칸 하나 읽기·쓰기라 경합해도 실패 한 번 더일 뿐이다
        self._resting: dict[tuple[int, TransportMode], float] = {}
        self._lock = threading.Lock()  # 쉬러 가는 순간(경고 한 줄)을 한 호출만 보게 — 조립 뒤 거리는 스레드풀에서 부른다

    def measure(
        self, from_: GeoPoint, to: GeoPoint, mode: TransportMode
    ) -> MeasuredTravel:
        path, source = _ROUTE[mode]
        # TMAP 좌표는 X=경도, Y=위도 (문자열).
        body: dict[str, object] = {
            "startX": str(from_.lng),
            "startY": str(from_.lat),
            "endX": str(to.lng),
            "endY": str(to.lat),
        }
        if mode is TransportMode.PUBLIC:
            body["count"] = 1  # 최적 경로 1건이면 충분 — 응답 절약
        else:
            # 자동차·보행 API 필수 필드. 보행 start/endName은 표기용이라 고정 라벨.
            body.update({"version": "1", "startName": "start", "endName": "end"})
        payload = self._post(path, mode, body)
        if mode is TransportMode.PUBLIC:
            total_time_sec, total_distance_m = self._transit_totals(payload, path)
        else:
            total_time_sec, total_distance_m = self._totals(payload, path)
        return MeasuredTravel(
            real_minutes=round(total_time_sec / 60.0, 1),
            distance_km=round(total_distance_m / 1000.0, 3),
            source=source,
            approximated=False,
        )

    def _post(self, path: str, mode: TransportMode, body: Mapping[str, object]) -> object:
        """HTTP 1건 — 키 문제로 실패하면 쉬지 않는 남은 키로 같은 요청을 한 번씩 더.

        모든 키가 쉬는 중이어도 차례인 키 하나는 묻는다(호출 1건 = HTTP 1건, 키 하나일 때의 종전 동작).
        한도가 풀렸는지·상품을 구독했는지는 불러 봐야 알고, 답한 키는 바로 쉼에서 돌아온다. 쉼이 끝난 키는
        다시 넘김 대상이라, 전부 막힌 채 쉼이 끝나면 그때 한 번은 키 수만큼 묻는다(10분마다 다시 확인하는 값).
        """
        n = len(self._keys)
        first = next(self._turns[mode]) % n
        now = self._clock()
        order = [(first + k) % n for k in range(n)]
        live = [i for i in order if self._resting.get((i, mode), 0.0) <= now] or order[:1]
        for attempt, idx in enumerate(live):
            try:
                payload = self._http.post_json(f"{_BASE}{path}", {"appKey": self._keys[idx]}, body)
            except Exception as e:  # urllib·JSON 파싱 등 — 원인 보존해 상위 로그로
                status = getattr(e, "code", None)  # urllib HTTPError — 다른 예외의 code(문자열 등)는 상태가 아니다
                if isinstance(status, int) and status in _KEY_STATUS:
                    failed_at = self._clock()
                    with self._lock:
                        newly = self._resting.get((idx, mode), 0.0) <= failed_at
                        self._resting[(idx, mode)] = failed_at + _KEY_REST_S
                    if attempt < len(live) - 1:
                        # 다음 키가 살리면 호출은 성공이라 체인 경고(travel_primary_failed)가 안 남는다 — 한도 소진은 이 줄로만
                        # 보인다. 깨어 있던 키가 쉬러 가는 순간에만 찍는다 — 스레드풀의 동시 호출이 같은 막힌 키를 만나도
                        # 한 줄이다(넘김은 호출마다 한다). 키 값은 싣지 않는다(순번만). 칸 이름을 `key=` 로 두지 않는다 —
                        # 로그 덤프의 자격 가림(`runtime_kb._CREDENTIAL`)이 `KEY…=값` 꼴을 지운다.
                        if newly:
                            _log.warning("tmap_key_failover slot=%d/%d mode=%s status=%s — 이 키는 %d분 쉬고 다음 키로",
                                         idx + 1, n, mode.name, status, _KEY_REST_S // 60)
                        continue
                raise TravelTimeError(f"{path} 호출 실패: {type(e).__name__}: {e}") from e
            self._resting.pop((idx, mode), None)
            return payload
        raise AssertionError("unreachable")  # live 는 비지 않고, 마지막 시도는 반환하거나 던진다

    @staticmethod
    def _totals(payload: object, path: str) -> tuple[float, float]:
        """features[].properties 중 totalTime 있는 첫 항목 — 없으면 형식 오류로 승격."""
        if not isinstance(payload, dict):
            raise TravelTimeError(f"{path} 응답이 JSON 객체가 아님")
        features = payload.get("features")
        if not isinstance(features, list):
            raise TravelTimeError(f"{path} features 없음")
        for feature in features:
            if not isinstance(feature, dict):
                continue
            props = feature.get("properties")
            if not isinstance(props, dict):
                continue
            time_sec = props.get("totalTime")
            dist_m = props.get("totalDistance")
            if isinstance(time_sec, (int, float)) and not isinstance(time_sec, bool):
                if not (isinstance(dist_m, (int, float)) and not isinstance(dist_m, bool)):
                    raise TravelTimeError(f"{path} totalDistance 없음/형식 오류")
                return float(time_sec), float(dist_m)
        raise TravelTimeError(f"{path} totalTime 있는 feature 없음")

    @staticmethod
    def _transit_totals(payload: object, path: str) -> tuple[float, float]:
        """metaData.plan.itineraries[] 중 totalTime 있는 첫 경로 (TRIP-405).

        거리는 totalDistance 우선, 없으면 legs[].distance 합산 — 문서상 경로별
        거리 표기가 갈려 방어적으로 둘 다 받는다. 시간도 거리도 없으면 형식
        오류로 승격 (조용한 0 반환 금지).
        """
        if not isinstance(payload, dict):
            raise TravelTimeError(f"{path} 응답이 JSON 객체가 아님")
        plan = payload.get("metaData", {})
        plan = plan.get("plan", {}) if isinstance(plan, dict) else {}
        itineraries = plan.get("itineraries") if isinstance(plan, dict) else None
        if not isinstance(itineraries, list):
            # 경로 없음·상품 미활성 등은 result.message로 온다 — 사유 보존
            detail = payload.get("result")
            raise TravelTimeError(f"{path} itineraries 없음 (result={detail})")
        for itinerary in itineraries:
            if not isinstance(itinerary, dict):
                continue
            time_sec = itinerary.get("totalTime")
            if not (isinstance(time_sec, (int, float)) and not isinstance(time_sec, bool)):
                continue
            dist_m = itinerary.get("totalDistance")
            if not (isinstance(dist_m, (int, float)) and not isinstance(dist_m, bool)):
                legs = itinerary.get("legs")
                dist_m = sum(
                    leg["distance"] for leg in legs
                    if isinstance(leg, dict)
                    and isinstance(leg.get("distance"), (int, float))
                    and not isinstance(leg.get("distance"), bool)
                ) if isinstance(legs, list) else 0
                if not dist_m:
                    raise TravelTimeError(f"{path} 거리 정보 없음 (totalDistance·legs 모두)")
            return float(time_sec), float(dist_m)
        raise TravelTimeError(f"{path} totalTime 있는 itinerary 없음")
