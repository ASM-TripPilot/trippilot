"""PlaceSqlLookup — 도우미 장소 탐색의 NL2SQL 한 번: 말 → (DIALOGUE_SQL) 검사된 SELECT → (PgPlaceSql) 보여 줄 칸만 담은 행.

핸들러(`dialogue_handlers._plan_explore`)는 이 객체를 `HandlerPorts.place_sql` 로 받아 반경 탐색과 **나란히** 부른다 — 이쪽이
실패·0건이면 반경 결과를 쓴다(INV-4). 실패는 삼키지 않고 한 줄 남긴다(SQL·발화 원문은 싣지 않는다 — 사유 라벨·행 수·시간만).
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections.abc import Callable, Mapping
from concurrent.futures import Future
from datetime import datetime

from trippilot.domain.common import TraceId
from trippilot.domain.region_centers import region_center, region_pair
from trippilot.orchestrator.intent_router import normalize
from trippilot.llm_gateway.workers.dialogue_sql import DialogueSqlWorker
from trippilot.poi_curation.adapters.pg_place_sql import PgPlaceSql, PlaceRow

log = logging.getLogger(__name__)

# 같은 말·같은 조건(발화 + 분류 인자 region·category·theme)의 SQL 은 다시 쓰지 않는다 — "서울 요즘 핫한 곳"처럼 사용자마다 같은 말이 잦고,
# 키에 발화를 넣는 이유: 인자만으로는 넓은 지역 아래의 동네("망원 카페" ↔ "서울 카페", 둘 다 {서울, 카페})·"~말고" 제외·개수가 갈리지
# 않는다 — 앞 사용자의 SQL 이 1시간 동안 다른 사용자 말에 실렸다(2026-10-20 Codex 리뷰 확정, 재현).
# NL2SQL LLM 은 실측 1.2~1.5s 에 꼬리가 2.8s 를 넘는다(2026-10-20 테스트 화면 6회 중 2회). 행은 캐시하지 않는다(DB 는 30ms 미만·늘 최신).
# ponytail: 프로세스 메모리 캐시 — 파드·워커마다 따로 데워진다. 공유가 필요하면 Redis.
CACHE_TTL_S, CACHE_MAX = 3600, 512

# 미리 받기(prefetch) — 분류 LLM(1~4s)이 끝난 뒤 SQL 을 쓰기 시작하면 팬아웃 시한(min(3s, 잔여×0.4))에 걸려 반경 탐색으로 떨어졌다
# (2026-10-21 테스트 화면 "서울 요즘 핫한 곳": 분류 3.8s → SQL 시한 2.08s 초과). 지역 이름 + 장소 찾기 말이면 분류와 **나란히** SQL 작성을
# 시작하고, 탐색으로 분류되면 `lookup` 이 그 결과를 기다려 쓴다. 오탐(탐색이 아닌 말)이면 LLM 한 번이 버려진다 — 그 대신 미탐 없이 빠르다.
PREFETCH_TIMEOUT_S, PREFETCH_MAX = 6.0, 256
_PLACE_ASK = re.compile(r"가\s?볼|갈\s?만한|갈\s?(?:데|곳)|핫한|핫플|인기|뜨는|요즘|추천|구경|놀\s?거리|볼거리|어디|카페|맛집|명소|박물관|미술관"
                        r"|공원|바다|야경|산책|데이트|쇼핑")
Submit = Callable[[Callable[[], object]], Future]


def asks_for_places(text: str) -> bool:
    """장소 찾기 말인가(가볼·맛집·카페·추천…) — 미리 받기와 탐색의 이어 묻기(앞 요청 찾기)가 같이 쓴다."""
    return _PLACE_ASK.search(text) is not None


def looks_like_place_query(utterance: str) -> bool:
    """지역 표 이름 + 장소 찾기 말 — 분류를 기다리지 않고 SQL 작성을 미리 시작할 만한가. 탐색 핸들러도 지역을 말했을 때만 SQL 을 쓴다.
    두 곳 사이("홍대와 이태원 사이")는 SQL 을 쓰지 않으니(위치가 아니라 이름을 읽는다 — 너무 먼 짝도 답하지 않는다) 미리 쓰지 않는다.
    짝 판정은 핸들러와 같게 정규화한 글로 본다."""
    return (region_center(utterance) is not None and region_pair(normalize(utterance)) is None
            and asks_for_places(utterance))


class PlaceSqlLookup:
    def __init__(self, worker: DialogueSqlWorker | None, executor: PgPlaceSql, *, clock=time.monotonic) -> None:
        # worker 없음 = DIALOGUE_SQL 미배정 — NL2SQL 탐색은 끄고 이름 찾기(`find_place`, LLM 없음)만 쓴다
        self._worker, self._executor, self._clock = worker, executor, clock
        self._cache: dict[tuple, tuple[float, str]] = {}
        self._prefetched: dict[str, tuple[str, Future]] = {}  # trace_id → (정리한 발화, SQL 작성 Future)
        self._lock = threading.Lock()

    @property
    def writes_sql(self) -> bool:
        return self._worker is not None

    def _cached(self, key: tuple) -> str | None:
        with self._lock:
            hit = self._cache.get(key)
            if hit is None or hit[0] <= self._clock():
                self._cache.pop(key, None)
                return None
            return hit[1]

    def _remember(self, key: tuple, sql: str) -> None:
        with self._lock:
            if len(self._cache) >= CACHE_MAX:
                self._cache.pop(next(iter(self._cache)))  # 가장 먼저 넣은 것부터
            self._cache[key] = (self._clock() + CACHE_TTL_S, sql)

    def prefetch(self, utterance: str, trace_id: TraceId, now: datetime, submit: Submit) -> None:
        """분류와 나란히 SQL 작성을 시작한다(인자 없이 발화만). `submit` 은 오케스트레이터 풀(호출 수를 세는 컨텍스트째 넘긴다)."""
        said = " ".join(utterance.split())
        if self._worker is None or not looks_like_place_query(said) or self._cached((said,)):
            return
        future = submit(lambda: self._worker.write(utterance, {}, trace_id, now, timeout_sec=PREFETCH_TIMEOUT_S))
        with self._lock:
            if len(self._prefetched) >= PREFETCH_MAX:
                self._prefetched.pop(next(iter(self._prefetched)))  # 탐색으로 안 간 턴의 것 — 끝났거나 곧 끝난다
            self._prefetched[str(trace_id)] = (said, future)

    def _take_prefetch(self, trace_id: TraceId, said: str) -> Future | None:
        with self._lock:
            entry = self._prefetched.pop(str(trace_id), None)
        return entry[1] if entry is not None and entry[0] == said else None  # 계획 경로(발화 "")는 쓰지 않는다

    def lookup(self, utterance: str, arguments: Mapping[str, str], trace_id: TraceId, now: datetime,
               *, timeout_sec: float) -> list[PlaceRow] | None:
        """None = 쓸 결과 없음(LLM 폴백·장소 조회 아님·DB 오류) — 호출측은 반경 탐색 결과로 간다. 빈 목록 = 조회는 됐고 0건."""
        started = time.monotonic()
        said = " ".join(utterance.split())
        args = tuple(sorted((k, v) for k, v in arguments.items() if v))
        key = (said, *args) if args else ()  # 계획 경로(발화 "")는 인자만 — 발화 키와 따로 산다
        sql = self._cached(key) if key else None
        pending = self._take_prefetch(trace_id, said)
        if sql is None and pending is not None:
            try:
                result = pending.result(timeout=timeout_sec)
            except Exception:  # noqa: BLE001 — 시한(TimeoutError)·작성 예외 — 다시 쓸 시간은 없다, 반경 탐색으로
                log.info("place_sql skip trace=%s reason=prefetch_timeout", trace_id)
                return None
            if result.is_fallback or not result.value:
                log.info("place_sql skip trace=%s reason=%s", trace_id, result.error or "not_a_place_query")
                return None
            sql = result.value
            self._remember((said,), sql)
            if key:
                self._remember(key, sql)
        if sql is None and said:
            sql = self._cached((said,))  # 같은 말을 앞서 미리 받아 둔 것
        if sql is None:
            if self._worker is None:
                return None
            result = self._worker.write(utterance, arguments, trace_id, now, timeout_sec=timeout_sec)
            if result.is_fallback or not result.value:
                log.info("place_sql skip trace=%s reason=%s", trace_id, result.error or "not_a_place_query")
                return None
            sql = result.value
            if key:
                self._remember(key, sql)
        try:
            rows = self._executor.run(sql)
        except Exception as e:  # noqa: BLE001 — DB 오류·시한은 반경 탐색으로 수렴(INV-4), 사유는 예외 타입까지(키·SQL 비노출)
            log.warning("place_sql db_error trace=%s error=%s — 반경 탐색으로", trace_id, type(e).__name__)
            return None
        log.info("place_sql ok trace=%s rows=%d ms=%d", trace_id, len(rows), int((time.monotonic() - started) * 1000))
        return rows

    def find_place(self, name: str, area: str | None, trace_id: TraceId) -> PlaceRow | None:
        """일정 밖 장소를 이름으로 — LLM 없이 매개변수 SQL 한 번. DB 오류는 None(일정 안내로 수렴, INV-4) + 한 줄."""
        try:
            return self._executor.find_by_name(name, area)
        except Exception as e:  # noqa: BLE001 — 사유는 예외 타입까지(이름 원문 비노출)
            log.warning("place_find db_error trace=%s error=%s", trace_id, type(e).__name__)
            return None
