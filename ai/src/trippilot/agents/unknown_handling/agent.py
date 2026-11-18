"""UnknownHandlingAgent — 도우미가 "미확인"으로 답하던 칸을 벤더 웹 검색으로 그때그때 찾는다(2026-10-22 사용자 결정).

에이전트는 **워커를 감싸는 객체**다 — 조회 워커(`PlaceFactLookupWorker`)와 저장소를 생성자로 받아 들고 있고, 경계는
`run(UnknownTask)` 하나만 안다. "저장된 값을 보고 → 없으면 뒤에서 찾기를 낸다"는 순서 판단은 경계가 아니라 에이전트 몫이다
(2026-10-22 넷과 같은 꼴로 편입 — 종전 `orchestrator/unknown_handling.py` 의 `known`·`request` 두 진입점을 하나로).

웹 검색은 7~12s 라(2026-10-22 실측) 도우미 턴 시한(9s, 팬아웃 ≤3s) 안에 못 끝난다. 그래서 **먼저 답하고 뒤에서 찾는다**
(사용자 선택): 물은 칸이 미확인이면 이번 턴은 "찾아보는 중"으로 답하고 조회를 뒤에서 낸다. 결과는 저장소(ai_kb
`place_fact_cache` — 파드가 둘이라 프로세스 메모리로는 다시 물은 턴이 다른 파드에 가면 못 찾는다)에 두고, 다시 물으면 그 값을
출처와 함께 답한다.

```
UnknownTask ─▶ ① 저장된 결과 조회   물은 칸을 다 찾아봤으면 찾음 → facts(다시 찾을 때가 지났으면 뒤에서 새로 찾아 덮는다)
                                   (물은 칸에 값이 있을 때 — 없으면 ②) / 못 찾음(다시 찾을 때 전) → 없음
                                   안 찾아본 칸이 있거나 묵은 못 찾음이면 저장된 칸까지 함께 ② / 저장소 장애 → 없는 것으로 보고 ② (INV-4)
            ─▶ ② 뒤에서 찾기 제출   냈거나 이미 찾는 중 → pending / 하루 상한·제출 실패 → 없음 (이번 턴은 기다리지 않는다)
            ─▶ (뒤에서) 워커 lookup → 1차 실패(벤더 장애·unsupported·timeout)면 2차(Claude)로 한 번 더(2026-10-30, 벤더 폴백) →
               출처 있는 값만 저장 · 기록은 지우지 않고 쌓는다(다시 찾을 때: 찾음 7일·못 찾음 1일) ·
               쌓아 둔 값을 새 조회가 하나도 못 건지면 그 값을 그대로 두고 하루 뒤 다시 찾는다 ·
               시한·형식·출처 없음은 저장하지 않고 다음에 다시 찾는다(미리 찾기는 같은 곳을 다시 사지 않게 '찾아본 칸 없음' 표지만)
PrefetchTask ─▶ (뒤에서) 기록이 아직 없는 곳만 빈 칸과 그곳의 지역을 묻고 → 빈 칸이 있으면 ② (미리 찾기 몫 상한) / 이번 턴 답은 없음
KnowledgeTask ─▶ 지식 워커 answer(이번 턴, 웹 검색 없음) → answer / 모른다고 닫음·실패·미배선 → 없음
```

**쌓기와 미리 찾기**(2026-11-08 사용자 결정 — "사용자가 찾다가 나온 장소의 빈 칸은 웹으로 채우고, 검색 결과는 우리 DB 에 쌓고"):
찾은 값은 지우지 않는다(`expires_at` 은 다시 찾을 때). 다시 찾을 때가 지난 값도 답에 쓰고 뒤에서 새로 찾는다 — 웹 확인 값이라는 각주가 늘
붙는다. 찾은 지 `DISPLAY_MAX_AGE` 를 넘긴 값은 답에 쓰지 않는다. 검색·추천·대신 갈 곳 답에 나온 앞쪽 장소 가운데 **한 번도 찾아본 적 없는
곳**은 묻기 전에 미리 찾는다(`PrefetchTask`) — 묵은 값을 새로 찾는 일은 사용자가 물을 때만 한다. 묻지 않은 조회라 하루 상한을 따로 작게
두고(`PROACTIVE_DAILY_CAP`), 사용자가 물은 조회 몫 한 자리를 남긴다. 어떤 장소·칸을 미리 찾을지는 상류(핸들러)가 고른다 — 20곳 실측에서
맛집·카페·술집은 11곳 중 영업시간 1곳(블로그뿐이라 게이트가 버린다), 명소·문화·자연은 7곳 중 6곳이 무언가를 찾았다.

**일반 지식 즉답**(2026-10-23 사용자 결정 — "이런 건 우리가 모르는 거니까 unknown handling agent 로"): "부산은 언제 가는 게 좋아?"처럼
조회 도구로 답할 게 없는 여행 일반 지식을 LLM 일반 지식으로 **이번 턴에** 답한다(`KnowledgeTask`). 장소 사실 확인과 달리 기다릴 만큼
짧고(~2s) 저장하지 않는다. 가격·특정 날짜·연도는 출구 게이트가 막고, 등록되지 않은 장소 이름·시각은 호출측(오케스트레이터)이
스냅샷과 대조해 막는다.

지키는 것:
- 장소는 이미 등록된 곳(poi_id)이다 — 새 장소를 고르지 않는다(INV-1). 값은 도우미 답에만 쓰고 일정 조립에는 넣지 않는다(INV-2).
- 출처는 검색이 단 인용 URL 에서만(게이트) — 출처 없는 값은 저장하지 않는다. 못 찾음도 짧게 저장해 같은 곳을 거듭 찾지 않는다.
- 조회는 뒤에서 돌아 턴 `llm_calls` 에 들지 않는다 — 대신 프로세스당 하루 상한(`DAILY_CAP`)과 장소별 중복 제거로 묶는다.
- `run()` 은 예외를 밖으로 던지지 않는다 — 저장소·제출 실패는 "없음"으로 수렴한다(DL-5, INV-4).
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta

from trippilot.domain.common import TraceId
from trippilot.llm_gateway.workers.dialogue.dialogue_knowledge import DialogueKnowledgeWorker
from trippilot.llm_gateway.workers.place_fact_lookup import PlaceFactLookupWorker
from trippilot.ports.place_fact_store_port import FIELDS, FactRecord, PlaceFacts, PlaceFactStore

log = logging.getLogger(__name__)

# 다시 찾을 때 — 찾은 값은 일주일, 못 찾음은 하루(사용자가 물을 때). 미리 찾기는 기록이 있는 곳을 다시 사지 않는다(`_prefetch`)
FOUND_TTL, MISS_TTL = timedelta(days=7), timedelta(days=1)
# ponytail: 프로세스당 상한·중복 제거 — 프로세스는 파드 × uvicorn 워커 2(운영 파드 2, HPA 최대 4)라 실제 한도는 그 배수다.
# 비용이 문제면 저장소에 하루 사용량 행을 둔다.
DAILY_CAP, MAX_INFLIGHT, LOOKUP_TIMEOUT_S = 300, 2, 25.0
PROACTIVE_DAILY_CAP = 5  # 미리 찾기(묻지 않은 조회) 몫 — 조회당 토큰 약 3센트 + 검색료(2026-11-08 20곳 실측), 운영 4프로세스면 하루 20건
DISPLAY_MAX_AGE = timedelta(days=90)  # 찾은 지 이보다 오래된 값은 답에 쓰지 않는다(`_usable`) — 기록은 남는다


@dataclass(frozen=True, slots=True)
class UnknownTask:
    """경계 → UnknownHandlingAgent 재료 봉투 (ReflectTask·EditTask 선례 — 시각·추적도 필드로).

    - `fields`: 물은 칸 중 카드가 모르는 것만(`hours`·`last_entry`·`closed`·`fee`) — 고르는 건 상류(핸들러)다.
    - `on`: 영업 여부를 물은 날 — 워커가 그날 기준으로 찾는다.
    - `proactive`: 묻지 않고 미리 찾는 조회(`PrefetchTask` 가 낸다) — 하루 상한이 따로고, 폴백이면 표지를 남긴다.
    """

    poi_id: str
    place: str
    fields: tuple[str, ...]
    on: date
    trace_id: TraceId
    now: datetime
    proactive: bool = False


@dataclass(frozen=True, slots=True)
class PrefetchTask:
    """검색·추천·대신 갈 곳 답에 나온 등록 장소들 — 빈 칸이 있으면 뒤에서 미리 찾는다. 이번 턴 답에는 아무것도 하지 않는다.

    - `poi_ids`: 화면 앞쪽 몇 곳(상류가 고른다)
    - `gaps`: 기록이 없는 poi_id 들 → (조회에 쓸 이름 + 그곳의 지역, 빈 칸). 등록 정보 조회(DB)라 **뒤에서** 부른다 — 빈 칸이 없거나
      대상 종류가 아니거나 그곳의 지역을 모르면 빠진다
    """

    poi_ids: tuple[str, ...]
    gaps: Callable[[tuple[str, ...]], Mapping[str, tuple[str, tuple[str, ...]]]]
    on: date
    trace_id: TraceId
    now: datetime


@dataclass(frozen=True, slots=True)
class KnowledgeTask:
    """경계 → 일반 지식 즉답 재료 봉투 — 2‴ 계획이 gap KNOWLEDGE 로 닫은 말 하나.

    - `history`: 최근 대화 창(`.role`·`.text` — 오케스트레이터 `RecentTurn` 모양, 오케스트레이터가 자른 그대로 싣는다)
    - `memory_lines`: 꺼낸 기억 줄(`$memory`) · `trip_summary`: 여행 상황 한 줄(`$trip`)
    - `timeout_sec`: 오케스트레이터가 턴 잔여에서 내린 시한(DL-4) — 에이전트는 시계를 갖지 않는다
    """

    question: str
    history: tuple
    memory_lines: tuple[str, ...]
    trip_summary: str
    trace_id: TraceId
    now: datetime
    timeout_sec: float

    def __post_init__(self) -> None:
        if not self.question.strip():
            raise ValueError("question 이 비었다")
        if self.timeout_sec <= 0:
            raise ValueError(f"timeout_sec > 0: {self.timeout_sec}")


@dataclass(frozen=True, slots=True)
class UnknownOutcome:
    """`run()` 의 결과 — 넷 중 하나이고 서로 거짓말하지 못한다(핸들러가 각주·칩을 이걸로 가른다).

    - 찾았음: `facts` 있음 — 저장된 값이다, 이번 턴에 찾은 것이 아니다
    - 찾는 중: `facts` 없음 · `pending` — 이번 턴에 냈거나 이미 돌고 있다 → "찾아보는 중" 각주와 [다시 묻기] 칩
    - 지식 답: `answer` 있음 — `KnowledgeTask` 에만, 게이트를 지난 문장(각주는 호출측이 결정론으로)
    - 없음:   전부 비었다 — 못 찾음이 저장돼 있거나 하루 상한·제출 실패·모른다고 닫음·미배선 → 종전대로("미확인"·범위 밖).
              `error` 는 없음의 사유 하나 — 지식 워커가 게이트웨이에 닿기 전에 던진 예외(프롬프트 변수 누락 등)의 타입 이름. 게이트웨이가
              보고하지 못한 실패라 호출측이 FallbackEvent 를 낸다(INV-4 — 모른다고 닫음과 가르지 못하면 침묵 실패다, 2026-10-23 리뷰 재현)
    """

    facts: PlaceFacts | None = None
    pending: bool = False
    answer: str | None = None
    error: str | None = None

    def __post_init__(self) -> None:
        if (self.facts is not None) + self.pending + (self.answer is not None) + (self.error is not None) > 1:
            raise ValueError("찾았음·찾는 중·지식 답·실패 사유는 동시에 설 수 없다")
        if self.answer is not None and not self.answer.strip():
            raise ValueError("빈 지식 답")


def _seen(record: FactRecord) -> frozenset[str]:
    """저장된 기록이 찾아본 칸 — 그 조회가 찾은 칸과 값이 있는 칸(2026-10-30 전 행은 searched 가 비어 값으로만 안다).
    다시 찾을 때까지(찾음 7일·못 찾음 1일) 그대로다 — 찾은 기록 안의 빈 칸(입장 마감 없음 등)을 따로 일찍 풀면 영업시간 물음마다 다시 찾는다."""
    return frozenset(record.searched) | {f for f in FIELDS if record.facts is not None and getattr(record.facts, f)}


class UnknownHandlingAgent:
    """`worker`(장소 사실 웹 확인, PLACE_FACT_LOOKUP)·`knowledge`(일반 지식 즉답, DIALOGUE_KNOWLEDGE)는 각자 배정이 곧 켜기라 둘 다
    없을 수 있다 — 없는 쪽 일은 "없음"으로 답한다(기능 부재는 강등이 아니다). `knows_general` 은 호출측이 지식 답을 시도할지 가르는 창."""

    def __init__(self, worker: PlaceFactLookupWorker | None, store: PlaceFactStore | None, *,
                 knowledge: DialogueKnowledgeWorker | None = None,
                 submit: Callable[..., object] | None = None) -> None:
        self._worker, self._store, self._knowledge = worker, store, knowledge
        self.knows_general = knowledge is not None
        self._pool = ThreadPoolExecutor(MAX_INFLIGHT, thread_name_prefix="unknown-handling") if submit is None else None
        self._submit = submit or self._pool.submit  # type: ignore[union-attr]
        self._inflight: set[str] = set()
        self._spent: tuple[date, int] = (date.min, 0)
        self._proactive: tuple[date, int] = (date.min, 0)
        self._lock = threading.Lock()

    def run(self, task: UnknownTask | KnowledgeTask | PrefetchTask) -> UnknownOutcome:
        """장소 사실: 저장된 값이 있으면 그것, 없으면 뒤에서 찾기를 내고 "찾는 중"(이번 턴은 기다리지 않는다). 미리 찾기: 뒤에서 내고
        이번 턴은 없음. 일반 지식: 이번 턴에 답하거나 없음. 예외를 던지지 않는다 (INV-4 · DL-5 — 저장소·제출·워커 실패는 "없음"으로 수렴)."""
        if isinstance(task, KnowledgeTask):
            return self._answer(task)
        if self._worker is None or self._store is None:  # 장소 사실 웹 확인 미배선(지식만 켜진 조립) — 종전 "미확인"
            return UnknownOutcome()
        if isinstance(task, PrefetchTask):
            self._prefetch_later(task)
            return UnknownOutcome()
        stored = self._usable(self._known(task.poi_id, task.now), task.now)
        seen = _seen(stored) if stored is not None else frozenset()
        if stored is not None and seen >= set(task.fields):  # 물은 칸을 다 찾아봤다
            if stored.expires_at > task.now:  # 다시 찾을 때 전 — 못 찾음이면 그대로 "미확인"(못 찾음은 하루 뒤 다시 찾는다)
                return UnknownOutcome(facts=stored.facts)
            if stored.facts is not None and any(getattr(stored.facts, f) for f in task.fields):
                # 쌓아 둔 값이 묵었다 — 물은 칸에 값이 있으면 그 값으로 답하고 뒤에서 새로 찾아 덮는다(없으면 아래서 "찾는 중")
                self._request(replace(task, fields=tuple(f for f in FIELDS if f in seen)))
                return UnknownOutcome(facts=stored.facts)
        # 기록이 없거나·안 찾아본 칸이 있거나·묵은 못 찾음 — 저장된 칸까지 함께 찾아 한 번에 덮는다(출처 칸이 하나라 두 조회의 값을 섞지 않는다)
        fields = tuple(f for f in FIELDS if f in seen or f in task.fields)
        return UnknownOutcome(pending=self._request(replace(task, fields=fields)))

    @staticmethod
    def _usable(stored: FactRecord | None, now: datetime) -> FactRecord | None:
        """답에 쓸 수 있는 기록 — 찾은 지 `DISPLAY_MAX_AGE` 를 넘긴 값은 못 찾음처럼 본다. 영업시간은 가장 빨리 낡는 값이라(KB-5 담당 권고
        2026-11-08) 쌓아 두되 그 뒤로는 답에 쓰지 않고, 다시 찾을 때가 되면 새로 찾는다. 값은 지우지 않는다."""
        if stored is None or stored.facts is None or now - stored.fetched_at <= DISPLAY_MAX_AGE:
            return stored
        return replace(stored, facts=None)

    def _answer(self, task: KnowledgeTask) -> UnknownOutcome:
        """일반 지식 즉답 — 게이트를 지난 문장이면 answer, 모른다고 닫았거나 실패면 없음. 실패의 FallbackEvent 는 게이트웨이가 냈다
        (워커 예외만 `error` 에 싣는다 — 게이트웨이를 부르지 못한 것이라 호출측이 이벤트를 낸다)."""
        if self._knowledge is None:
            return UnknownOutcome()
        try:
            result = self._knowledge.answer(task.question, task.history, task.memory_lines, task.trip_summary,
                                            task.trace_id, task.now, timeout_sec=task.timeout_sec)
        except Exception as e:  # noqa: BLE001 — 프롬프트 미등록 ValueError 는 게이트웨이 render 가 호출보다 먼저 던진다
            log.warning("unknown_handling knowledge_error trace=%s error=%s", task.trace_id, type(e).__name__)
            return UnknownOutcome(error=type(e).__name__)
        draft = result.value
        if result.is_fallback or draft is None:
            return UnknownOutcome()
        return UnknownOutcome(answer=draft.text)

    def _known(self, poi_id: str, now: datetime) -> FactRecord | None:
        """저장된 결과(만료 전). 저장소 장애는 없는 것과 같다 — 카드는 종전대로 "미확인"(INV-4)."""
        try:
            return self._store.get(poi_id, now)
        except Exception as e:  # noqa: BLE001
            log.warning("unknown_handling store_get_failed error=%s", type(e).__name__)
            return None

    def _request(self, task: UnknownTask) -> bool:
        """뒤에서 찾기를 낸다 — 이미 찾는 중이거나 오늘 상한이면 내지 않는다(False). 이번 턴은 기다리지 않는다.
        미리 찾기는 따로 작은 상한(`PROACTIVE_DAILY_CAP`) 안에서, 사용자가 물은 조회 몫 한 자리를 남길 때만 낸다."""
        with self._lock:
            # ponytail: 찾는 중은 장소 단위 — 그곳의 다른 칸을 찾는 중이면 이번 칸은 다음 물음에 낸다("찾는 중"이 한 번 더).
            # 같은 곳을 다른 칸으로 겹쳐 묻는 일이 잦으면 찾는 칸까지 들고 있다가 모자라면 뒤이어 낸다.
            if task.poi_id in self._inflight:
                return True  # 찾는 중이면 "찾는 중"이 맞다
            today = task.now.date()
            if task.proactive:
                day, spent = self._proactive if self._proactive[0] == today else (today, 0)
                if spent >= PROACTIVE_DAILY_CAP or len(self._inflight) >= MAX_INFLIGHT - 1:
                    return False
                self._proactive = (day, spent + 1)
            else:
                day, spent = self._spent if self._spent[0] == today else (today, 0)
                if spent >= DAILY_CAP:
                    return False  # 상한이면 "찾는 중"이라 말하지 않는다
                self._spent = (day, spent + 1)
            self._inflight.add(task.poi_id)
        try:
            self._submit(self._lookup, task)
        except Exception as e:  # noqa: BLE001 — 풀이 닫혔다 등. 못 냈으면 "찾는 중"이라 말하지 않는다
            with self._lock:
                self._inflight.discard(task.poi_id)
            log.warning("unknown_handling submit_failed error=%s", type(e).__name__)
            return False
        log.info("unknown_handling lookup_started trace=%s fields=%s proactive=%s", task.trace_id, ",".join(task.fields),
                 task.proactive)
        return True

    def _lookup(self, task: UnknownTask) -> None:
        try:
            # retry_timeout_sec=LOOKUP_TIMEOUT_S — 1차(sonnet)가 벤더 장애·unsupported·timeout 으로
            # 죽으면 같은 예산으로 2차(opus, `C1Config.retry_models[PLACE_FACT_LOOKUP]`)를 한 번
            # 더 부른다(뒤에서 도는 조회라 두 번 합쳐 길어져도 턴을 막지 않는다). 2차도 없으면(미설정)
            # 게이트웨이가 종전처럼 1회만 시도한다.
            result = self._worker.lookup(task.place, task.fields, task.on, task.trace_id, task.now,
                                          timeout_sec=LOOKUP_TIMEOUT_S, retry_timeout_sec=LOOKUP_TIMEOUT_S)
            # 이전 기록은 저장소에서 바로 읽는다 — 읽기가 실패하면 쌓아 둔 값을 못 찾음으로 덮지 않게 아무것도 쓰지 않는다(밖 except)
            prev = self._store.get(task.poi_id, task.now)
            if result.is_fallback:  # 시한·형식·출처 없음 — 저장하지 않고 다음에 물으면 다시 찾는다
                if task.proactive and prev is None:
                    # 미리 찾기는 같은 곳을 다음 후보 답마다 다시 사지 않게 '찾아본 칸 없음' 표지만 남긴다 — 물은 조회는 찾아본 칸이
                    # 없어 종전처럼 바로 다시 찾는다(블로그뿐인 곳이 하루 몫을 혼자 다 쓰던 것, 2026-11-08 검토)
                    self._store.put(FactRecord(task.poi_id, None, task.now, task.now + MISS_TTL, ()))
                log.info("unknown_handling lookup_failed trace=%s reason=%s proactive=%s", task.trace_id, result.error, task.proactive)
                return
            facts = result.value if isinstance(result.value, PlaceFacts) and result.value.any() else None
            self._store.put(_next_record(task, prev, facts))
            log.info("unknown_handling lookup_done trace=%s found=%s source=%s proactive=%s", task.trace_id, facts is not None,
                     facts.source_host if facts else "-", task.proactive)
        except Exception as e:  # noqa: BLE001 — 뒤에서 도는 일이라 위로 던질 곳이 없다. 사유만 남긴다
            log.warning("unknown_handling lookup_error trace=%s error=%s", task.trace_id, type(e).__name__)
        finally:
            with self._lock:
                self._inflight.discard(task.poi_id)

    def _prefetch_later(self, task: PrefetchTask) -> None:
        """미리 찾기를 뒤로 넘긴다 — 등록 정보 조회(DB)도 뒤에서 돌아 이번 턴은 아무것도 기다리지 않는다. 오늘 몫을 다 썼으면 그 조회도
        내지 않는다(몫이 찬 뒤에도 후보 답마다 DB·백엔드를 부르던 것, 2026-11-08 검토)."""
        if not task.poi_ids:
            return
        with self._lock:
            if self._proactive[0] == task.now.date() and self._proactive[1] >= PROACTIVE_DAILY_CAP:
                return
        try:
            self._submit(self._prefetch, task)
        except Exception as e:  # noqa: BLE001 — 풀이 닫혔다 등. 미리 찾기는 빠져도 답은 같다
            log.warning("unknown_handling prefetch_submit_failed error=%s", type(e).__name__)

    def _prefetch(self, task: PrefetchTask) -> None:
        """기록이 아직 없는 곳만 빈 칸과 그곳의 지역을 묻고, 빈 칸이 있는 곳을 미리 찾기 몫으로 낸다. 기록이 있는 곳(찾음·못 찾음·표지)은
        건드리지 않는다 — 묵은 값을 새로 찾는 일은 사용자가 물을 때만 한다(미리 찾기의 못 찾음이 찾은 기록 위에 얹혀 사용자 재조회를
        막던 것, 2026-11-08 검토). 저장소 읽기가 실패하면 아무것도 내지 않는다."""
        try:
            due = tuple(poi_id for poi_id in task.poi_ids if self._store.get(poi_id, task.now) is None)
            gaps = task.gaps(due) if due else {}
            started = sum(self._request(UnknownTask(poi_id, place, fields, task.on, task.trace_id, task.now, proactive=True))
                          for poi_id, (place, fields) in gaps.items() if poi_id in due and fields)
            log.info("unknown_handling prefetch trace=%s shown=%d due=%d gaps=%d started=%d", task.trace_id, len(task.poi_ids),
                     len(due), len(gaps), started)
        except Exception as e:  # noqa: BLE001 — 뒤에서 도는 일이라 위로 던질 곳이 없다(등록 정보 조회 실패 등). 사유만 남긴다
            log.warning("unknown_handling prefetch_error trace=%s error=%s", task.trace_id, type(e).__name__)


def _next_record(task: UnknownTask, prev: FactRecord | None, facts: PlaceFacts | None) -> FactRecord:
    """조회 결과로 저장할 기록 — 쌓기 규칙(2026-11-08).

    - 찾았다: 한 조회의 값으로 덮는다(출처 칸이 하나라 두 조회의 값을 섞지 않는다). 전에 찾은 칸을 잃었으면 "찾아봤다"에서 빼 다음 물음에
      다시 찾는다(덮인 기록이 그 칸을 7일간 미확인으로 굳히지 않게)
    - 하나도 못 건졌고 쌓아 둔 값이 있다: 값은 두고(지우지 않고 쌓는다) 다시 찾을 때만 하루 뒤로 늦춘다(앞당기지 않는다) — 찾은 날은 그
      값의 날이라 그대로라 오래되면 답에서 빠지고(`_usable`), 그래도 하루 안에는 다시 사지 않는다(90일 넘은 값 위에서 매 물음 재조회가 돌던
      것, 2026-11-08 검토). 이번에 찾아본 칸은 "찾아봤다"에 더한다
    - 그 밖(처음 못 찾음·못 찾음 위의 못 찾음): 찾아본 날을 지금으로 한 못 찾음 — 하루를 막는다
    """
    if facts is not None:
        lost = {f for f in FIELDS if prev is not None and prev.facts is not None and getattr(prev.facts, f) and not getattr(facts, f)}
        return FactRecord(task.poi_id, facts, task.now, task.now + FOUND_TTL, tuple(f for f in task.fields if f not in lost))
    if prev is not None and prev.facts is not None:
        return replace(prev, expires_at=max(prev.expires_at, task.now + MISS_TTL),
                       searched=tuple(f for f in FIELDS if f in prev.searched or f in task.fields))
    return FactRecord(task.poi_id, None, task.now, task.now + MISS_TTL, task.fields)
