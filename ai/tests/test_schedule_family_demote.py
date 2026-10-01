"""FAM — 같은 장소 계열 강등 (TRIP-1181 · ScheduleAgent ②‴ 뒤·②′ 앞).

QA 6회차: '황령산 전망대'(1일차) + '황령산'(2일차), 서울 '남산공원'·'남산골한옥마을'·
'남산 팔각정' 같은 날. 사용자 결정(2026-10-02): 단지 안 다른 명소도 하루·여행 1곳 —
대표 외는 **점수 강등**(배제 아님).

증명하는 것 (실 API 0 — 점수는 FakeLlm, 어셈블리는 규칙 그리디를 1차로 승격한 퍼사드):
  ① 쌍 판정 — 좌표 ≤5m · 포함 ≤1.5km · 한글 2자+ 접두 ≤700m, 도시명 접두 오탐 없음, 맛집·카페 제외
  ② 점수순 스타 — 사슬로 번지지 않는다, 고정 블록·앞 일자 배치분이 대표
  ③ 강등이 **배치를 바꾼다** — 남산 3곳 같은 날, 황령산 다른 날(excluded 경유·풀 밖 조회)
  ④ 강등이지 배제가 아니다 — 후보 집합·순서·개수 불변, 대표 점수 불변, > 0 유지 (INV-1)
  ⑤ 다른 강등과 겹칠 때의 합성 규칙
  ⑥ generate 에만 — 플래그 off(replan)면 점수가 한 글자도 안 바뀐다
  ⑦ 조회 실패는 그 축만 건너뛰고 관측 / 결정론 / 상위 N 한정
  ⑧ 차선책 — 이미 배치된 계열은 후순위
  ⑨ 배선 — generate 와이어는 켜고 replan 은 끈다, poi_db 를 끊으면 운다
"""

from __future__ import annotations

import json
import random
from dataclasses import replace
from datetime import date, datetime

from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.agents.schedule.agent import (
    ScheduleAgent,
    demoted_score,
    pick_slot_alternatives,
)
from trippilot.agents.schedule.budget import OrchestratorConfig
from trippilot.agents.schedule.family import (
    family_followers,
    normalize_name,
    same_family,
)
from trippilot.domain.common import GeoPoint, PoiId, Rejection, RejectionKind
from trippilot.domain.itinerary import FixedBlock, TimeWindow
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.domain.poi_curation import CandidatePoolRequest
from trippilot.llm_gateway.gates.scoring import ClosedSetGate
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.workers.preference import PreferenceScoringWorker
from trippilot.poi_curation.config import M7Config
from trippilot.poi_curation.pool_builder import CandidatePoolBuilder
from trippilot.ports.place_existence_port import ExistenceStatus

from tests.fakes.fake_clock import FakeClock
from tests.fakes.fake_existence import FakeExistence
from tests.fakes.fake_llm import FakeLlm
from tests.fakes.in_memory_poi import InMemoryPoi
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.test_schedule_agent import _scored, _solution, _task
from tests.test_schedule_coordinator import (
    _ANCHOR,
    _C1CFG,
    _KST,
    _NOW,
    _AssemblyProvider,
    _Renderer,
    _Sink,
    _request,
)

_CFG = OrchestratorConfig()
_F, _P = _CFG.existence_demote_factor, _CFG.existence_demote_penalty
_D1 = date(2026, 8, 5)   # 수
_D2 = date(2026, 8, 6)   # 목
_M = 1 / 111_000         # 위도 1m (도)


def _named(pid: str, name: str, north_m: float = 0.0, east_m: float = 0.0,
           category: PoiCategory = PoiCategory.SIGHT, open_hours=()) -> Poi:
    return Poi(
        poi_id=PoiId(pid), name=name, category=category,
        coord=GeoPoint(_ANCHOR.lat + north_m * _M, _ANCHOR.lng + east_m * _M / 0.79),
        open_hours=open_hours, avg_cost=None, rating=4.0, quality=DataQuality.FULL,
        source=PoiSource.SEED, confidence=None,
    )


# ── ① 쌍 판정 ───────────────────────────────────────────────────────


def test_이름_정규화는_괄호_접미와_앞머리_시도_토큰을_뗀다() -> None:
    assert normalize_name("남산공원(서울)") == "남산공원"
    assert normalize_name("부산 영화의 전당") == "영화의전당"
    assert normalize_name("서울 우정총국") == "우정총국"
    assert normalize_name("서울숲") == "서울숲"  # 한 토큰 이름은 깎지 않는다
    assert normalize_name("동대문디자인플라자(DDP)") == "동대문디자인플라자"


def test_좌표_5m_이내는_이름이_달라도_계열이다() -> None:
    a = _named("a", "황령산 전망대", category=PoiCategory.NIGHT_VIEW)
    assert same_family(a, _named("b", "봉수대", north_m=4, category=PoiCategory.NATURE))
    assert not same_family(a, _named("c", "봉수대", north_m=30))


def test_포함관계는_1_5km_까지() -> None:
    a = _named("a", "황령산")
    assert same_family(a, _named("b", "황령산 전망대", north_m=1_400))
    assert not same_family(a, _named("c", "황령산 전망대", north_m=1_600))


def test_한글_2자_접두는_700m_까지() -> None:
    a = _named("a", "남산공원(서울)")
    assert same_family(a, _named("b", "남산 팔각정", north_m=650))
    assert not same_family(a, _named("c", "남산 팔각정", north_m=750))
    # 접두 1자는 계열이 아니다
    assert not same_family(_named("d", "창덕궁"), _named("e", "창경궁", north_m=100))


def test_도시명_접두로는_묶이지_않는다() -> None:
    """수작업 판정 오탐 사례 — 띄어 쓴 것도 붙여 쓴 것도."""
    pairs = [("서울 우정총국", "서울 운현궁"), ("부산시립미술관", "부산영화촬영스튜디오"),
             ("대구제일교회", "대구화교협회"), ("대전교통문화연수원", "대전엑스포과학공원")]
    for x, y in pairs:
        assert not same_family(_named("a", x), _named("b", y, north_m=200)), (x, y)


def test_기관_범용_접두로는_묶이지_않는다() -> None:
    """리뷰 probe — '국립'·'한국'·'중앙'·'조선' 은 단지가 아니라 운영 주체·수식어다."""
    pairs = [("국립현대미술관 서울", "국립민속박물관", 350),
             ("국립고궁박물관", "국립현대미술관", 509),
             ("대전 중앙시장", "중앙로지하상가", 428),
             ("한국은행 화폐박물관", "한국전통문화전당", 300),
             ("조선왕릉 선릉", "조선호텔", 300)]
    for x, y, m in pairs:
        assert not same_family(_named("a", x), _named("b", y, north_m=m)), (x, y)
    # 접두를 떼도 남는 공통부가 있으면 그대로 계열이다
    assert same_family(_named("a", "국립중앙박물관"),
                       _named("b", "국립중앙박물관 어린이박물관", north_m=100))
    assert same_family(_named("a", "국립경주박물관"), _named("b", "국립경주박물관 월지관", north_m=50))


def test_음식_골목은_맛집처럼_계열에서_뺀다() -> None:
    """TourAPI 가 액티비티로 주는 먹자골목 — 실 덤프에서 '자갈치 크루즈'·DDP 를 눌렀다."""
    alley = _named("a", "부산 자갈치 양곱창 골목", category=PoiCategory.ACTIVITY)
    assert not same_family(alley, _named("b", "자갈치 크루즈", north_m=200))
    chicken = _named("c", "서울 동대문 닭한마리 골목", category=PoiCategory.ACTIVITY)
    assert not same_family(chicken, _named("d", "동대문디자인플라자(DDP)", north_m=400))
    market = _named("e", "국제시장 먹자골목", category=PoiCategory.ACTIVITY)
    assert not same_family(market, _named("f", "국제시장", north_m=50))


def test_맛집_카페가_낀_쌍은_계열이_아니다() -> None:
    """식당 밀집은 정상 — 같은 건물(좌표 동일)이어도 묶지 않는다."""
    food = _named("a", "대전갈비집", category=PoiCategory.FOOD)
    assert not same_family(food, _named("b", "대전 별리달리돈까스", category=PoiCategory.FOOD))
    assert not same_family(food, _named("c", "대전갈비집 별관"))
    cafe = _named("d", "남산 카페", category=PoiCategory.CAFE)
    assert not same_family(cafe, _named("e", "남산공원"))


# ── ② 점수순 스타 ───────────────────────────────────────────────────


def test_사슬로_번지지_않는다() -> None:
    """A~B(600m), B~C(600m), A≁C(1.2km) — 스타면 C 는 새 대표, union-find 면 강등됐다."""
    a = _named("a", "강화산성 남문")
    b = _named("b", "강화산성 북문", north_m=600)
    c = _named("c", "강화산성 서문", north_m=1_200)
    assert same_family(a, b) and same_family(b, c) and not same_family(a, c)
    assert family_followers((), (a, b, c)) == {PoiId("b"): PoiId("a")}


def test_남산_3곳은_최고점_하나가_대표다() -> None:
    park = _named("n1", "남산공원(서울)")
    hanok = _named("n2", "남산골한옥마을", north_m=330)
    pavilion = _named("n3", "남산 팔각정", east_m=260)
    assert family_followers((), (park, hanok, pavilion)) == {
        PoiId("n2"): PoiId("n1"), PoiId("n3"): PoiId("n1")}


def test_앵커는_점수와_무관하게_대표다() -> None:
    pavilion = _named("n3", "남산 팔각정", east_m=260)
    park = _named("n1", "남산공원(서울)")
    assert family_followers((pavilion,), (park,)) == {PoiId("n1"): PoiId("n3")}


_NAMES = ("남산공원", "남산골한옥마을", "남산 팔각정", "황령산", "황령산 전망대", "경복궁",
          "서울 운현궁", "서울 우정총국", "해운대해수욕장", "해운대 관광특구", "광안리")


@st.composite
def _scene(draw):
    n = draw(st.integers(1, 10))
    pois = tuple(
        _named(f"p{i}", draw(st.sampled_from(_NAMES)),
               draw(st.integers(-1_500, 1_500)), draw(st.integers(-1_500, 1_500)),
               draw(st.sampled_from([PoiCategory.SIGHT, PoiCategory.NATURE, PoiCategory.FOOD])))
        for i in range(n)
    )
    k = draw(st.integers(0, min(2, n)))
    return pois[:k], pois[k:]


@given(_scene())
@settings(max_examples=200, deadline=None)
def test_스타_불변식(scene) -> None:
    """계열원은 자기 대표와 직접 맞고, 앵커 아닌 대표끼리는 서로 맞지 않는다."""
    anchors, ranked = scene
    out = family_followers(anchors, ranked)
    by_id = {p.poi_id: p for p in anchors + ranked}
    leaders = [p for p in ranked if p.poi_id not in out]
    for follower, leader in out.items():
        assert same_family(by_id[follower], by_id[leader])
        assert leader not in out  # 대표는 계열원이 아니다
    for i, x in enumerate(leaders):
        assert not any(same_family(x, a) for a in anchors)
        assert not any(same_family(x, y) for y in leaders[:i])


# ── ③ 강등이 배치를 바꾼다 (에이전트 경유) ────────────────────────────


def _scores(**by_id: float) -> str:
    return json.dumps({"scores": [{"poiId": k, "score": v, "reason": "r"}
                                  for k, v in by_id.items()]})


def _agent(scores: dict[str, float], *, poi_db=None, existence=None):
    trace, sink = InMemoryTrace(), _Sink()
    gateway = GatewayFacade(FakeLlm(_scores(**scores)), _Renderer(), ClosedSetGate(),
                            _C1CFG, trace)
    agent = ScheduleAgent(
        PreferenceScoringWorker(gateway), _AssemblyProvider(trace, sink, primary=True),
        FakeClock(), trace, existence=existence, poi_db=poi_db,
    )
    return agent, trace, sink


def _pool(pois, day: date = _D1):
    req = _request(days=(day,))
    return CandidatePoolBuilder(InMemoryPoi(pois), M7Config()).build(
        CandidatePoolRequest(anchor=req.anchor, dates=req.days, budget=req.budget,
                             transport=req.transport), _NOW)


def _gen_request(day: date = _D1, *, family: bool = True, end_hour: int = 12, **over):
    req = _request(days=(day,), **over)
    return replace(req, family_demote=family, day_window=TimeWindow(
        start=datetime(day.year, day.month, day.day, 9, 0, tzinfo=_KST),
        end=datetime(day.year, day.month, day.day, end_hour, 0, tzinfo=_KST)))


def _placed(outcome) -> list[str]:
    return [str(s.poi_id) for d in outcome.solution.days for s in d.slots]


def _fed(sink) -> dict[str, float]:
    return {str(c.poi_id): c.score for c in sink.problems[0].candidates}


_NAMSAN = (
    _named("n1", "남산공원(서울)"),
    _named("n2", "남산골한옥마을", north_m=330),
    _named("n3", "남산 팔각정", east_m=260),
    _named("o1", "경복궁", north_m=900),
    _named("o2", "덕수궁", east_m=900),
    _named("o3", "종묘", north_m=-900),
)
_NAMSAN_SCORES = {"n1": 0.95, "n2": 0.9, "n3": 0.85, "o1": 0.7, "o2": 0.7, "o3": 0.7}
_NAMSAN_IDS = {"n1", "n2", "n3"}


def test_남산_3곳이_같은_날_하나만_남는다() -> None:
    pool = _pool(_NAMSAN)
    base = _agent(_NAMSAN_SCORES)[0].run(_task(pool, request=_gen_request(family=False)))
    assert len(set(_placed(base)) & _NAMSAN_IDS) >= 2  # 전제: 강등 없으면 몰린다

    agent, _, sink = _agent(_NAMSAN_SCORES)
    outcome = agent.run(_task(pool, request=_gen_request()))

    assert set(_placed(outcome)) & _NAMSAN_IDS == {"n1"}
    fed = _fed(sink)
    assert fed["n1"] == 0.95  # 대표는 그대로
    assert fed["n2"] == demoted_score(0.9, factor=_F, penalty=_P)
    assert fed["n3"] == demoted_score(0.85, factor=_F, penalty=_P)


_HWANG = (
    # 1일차(수)만 여는 전망대 — 2일차(목) 풀에서 빠진다 → 좌표·이름은 poi_db 로만 안다
    _named("hv", "황령산 전망대", category=PoiCategory.NIGHT_VIEW,
           open_hours=(OpenHour(_D1.weekday(), 9 * 60, 22 * 60),)),
    _named("hm", "황령산", north_m=2),
    _named("o1", "경복궁", north_m=900),
    _named("o2", "덕수궁", east_m=900),
    _named("o3", "종묘", north_m=-900),
)
_HWANG_SCORES = {"hm": 0.95, "o1": 0.7, "o2": 0.7, "o3": 0.7}


def _day2(poi_db):
    pool = _pool(_HWANG, _D2)
    assert PoiId("hv") not in pool.poi_ids  # 전제: 앞 일자 배치분이 풀 밖이다
    agent, trace, sink = _agent(_HWANG_SCORES, poi_db=poi_db)
    req = _gen_request(_D2, excluded=frozenset({PoiId("hv")}))
    return agent.run(_task(pool, request=req)), trace, sink


def test_다른_날_황령산은_excluded_를_조회해_강등된다() -> None:
    outcome, trace, sink = _day2(InMemoryPoi(_HWANG))

    assert "hm" not in _placed(outcome)
    assert _fed(sink)["hm"] == demoted_score(0.95, factor=_F, penalty=_P)
    reasons = [e.reason for e in trace.of_type(FallbackEvent) if e.stage == "family"]
    assert reasons == ["family_demoted:1/families=1/anchors=1"]


def test_poi_db_가_없으면_앞_일자_축만_빠진다() -> None:
    """풀 밖 excluded 의 좌표를 모른다 — 강등 없이 진행하고 그 사실을 관측한다."""
    outcome, trace, sink = _day2(None)

    assert "hm" in _placed(outcome)
    assert _fed(sink)["hm"] == 0.95
    reasons = [e.reason for e in trace.of_type(FallbackEvent) if e.stage == "family"]
    assert "family_anchor_unresolved:1" in reasons
    assert outcome.degradations == ()  # 관측이지 강등이 아니다


class _BrokenLookup(InMemoryPoi):
    def lookup_by_ids(self, ids):  # noqa: ANN001
        raise TimeoutError("poi lookup timed out")


class _SlowLookup(InMemoryPoi):
    """조회 한 번에 30s — 전체 시한(20s)을 넘긴다. `clock` 은 에이전트 생성 뒤 꽂는다."""
    clock: FakeClock

    def lookup_by_ids(self, ids):  # noqa: ANN001
        self.clock.advance(30_000)
        return super().lookup_by_ids(ids)


def test_조회가_시한을_넘기면_overrun_을_남긴다() -> None:
    """⓪ 과 같은 시한 규율 — 찾은 값은 쓰되, 늦은 이유가 관측에 남아야 한다."""
    pool = _pool(_HWANG, _D2)
    slow = _SlowLookup(_HWANG)
    agent, trace, sink = _agent(_HWANG_SCORES, poi_db=slow)
    slow.clock = agent._clock
    agent.run(_task(pool, request=_gen_request(_D2, excluded=frozenset({PoiId("hv")}))))

    assert _fed(sink)["hm"] == demoted_score(0.95, factor=_F, penalty=_P)  # 찾은 값은 쓴다
    reasons = [e.reason for e in trace.of_type(FallbackEvent) if e.stage == "family"]
    assert any(r.startswith("overrun:spent=30000ms>available=") for r in reasons), reasons


def test_계열_판정이_터져도_일정은_나간다(monkeypatch) -> None:
    """부가 단계 격리 (INV-4) — ⑥ 차선책과 같은 규약: 강등 없이 진행하고 관측한다."""
    import trippilot.agents.schedule.agent as agent_mod

    def boom(*_a, **_k):
        raise ValueError("boom")

    monkeypatch.setattr(agent_mod, "family_followers", boom)
    agent, trace, sink = _agent(_NAMSAN_SCORES)
    outcome = agent.run(_task(_pool(_NAMSAN), request=_gen_request()))

    assert outcome.solution is not None and outcome.degradations == ()
    assert _fed(sink) == _NAMSAN_SCORES
    reasons = [e.reason for e in trace.of_type(FallbackEvent) if e.stage == "family"]
    assert reasons == ["family_error: ValueError: boom"]


def test_조회_실패는_그_축만_건너뛰고_관측한다() -> None:
    outcome, trace, sink = _day2(_BrokenLookup(_HWANG))

    assert outcome.solution is not None and outcome.degradations == ()
    assert _fed(sink)["hm"] == 0.95
    reasons = [e.reason for e in trace.of_type(FallbackEvent) if e.stage == "family"]
    assert any(r.startswith("family_anchor_lookup_error: TimeoutError") for r in reasons)


def test_고정_블록이_대표다() -> None:
    """필수방문 '남산 팔각정'(최저점)이 있으면 최고점 '남산공원'도 강등된다."""
    pool = _pool(_NAMSAN)
    block = FixedBlock(poi_id=PoiId("n3"), reason="user_fixed", window=TimeWindow(
        start=datetime(2026, 8, 5, 9, 0, tzinfo=_KST), end=datetime(2026, 8, 5, 10, 0, tzinfo=_KST)))
    agent, _, sink = _agent(_NAMSAN_SCORES)
    agent.run(_task(pool, request=_gen_request(fixed_blocks=(block,))))

    fed = _fed(sink)
    assert fed["n1"] == demoted_score(0.95, factor=_F, penalty=_P)
    assert fed["n2"] == demoted_score(0.9, factor=_F, penalty=_P)
    assert sink.problems[0].fixed_blocks == (block,)  # 고정 블록은 손대지 않는다 (HC3)


# ── ④ 강등이지 배제가 아니다 ────────────────────────────────────────


@st.composite
def _scored_scene(draw):
    n = draw(st.integers(1, 8))
    pois = tuple(
        _named(f"p{i}", draw(st.sampled_from(_NAMES)),
               draw(st.integers(-800, 800)), draw(st.integers(-800, 800)))
        for i in range(n)
    )
    scores = {f"p{i}": draw(st.floats(0.01, 1.0)) for i in range(n)}
    return pois, scores


@given(_scored_scene())
@settings(max_examples=40, deadline=None)
def test_후보_집합_순서_개수는_그대로고_점수는_양수를_유지한다(scene) -> None:
    pois, scores = scene
    pool = _pool(pois)
    rounded = {k: round(v, 2) for k, v in scores.items()}
    off_agent, _, off = _agent(rounded)
    off_agent.run(_task(pool, request=_gen_request(family=False)))
    on_agent, _, on = _agent(rounded)
    on_agent.run(_task(pool, request=_gen_request()))

    before, after = off.problems[0].candidates, on.problems[0].candidates
    assert [c.poi_id for c in after] == [c.poi_id for c in before]  # INV-1
    for b, a in zip(before, after):
        assert a.score in (b.score, demoted_score(b.score, factor=_F, penalty=_P))
        assert (a.score > 0) == (b.score > 0)
    # 최고점 후보는 언제나 대표다
    top = min(before, key=lambda c: (-c.score, str(c.poi_id)))
    assert dict((c.poi_id, c.score) for c in after)[top.poi_id] == top.score


# ── ⑤ 다른 강등과의 합성 ────────────────────────────────────────────


def test_합성_규칙_거절_뒤_계열_뒤_지도() -> None:
    """각 강등은 자기 단계 진입 점수에 한 번씩 — 하한은 factor² × 원점수 (> 0, 배제 아님).

    ②‴ 거절(뺄셈) → 계열 `demoted_score` → ②′ 지도 미검출 `demoted_score`. 거절로 0 이하가
    되면 이후 강등은 건드리지 않는다(`demoted_score` 의 0 이하 규칙).
    """
    pool = _pool(_NAMSAN)
    req = replace(_gen_request(), rejections=(
        Rejection(poi_id=PoiId("n2"), kind=RejectionKind.SWAPPED_OUT, count=1),))
    agent, _, sink = _agent(_NAMSAN_SCORES, existence=FakeExistence(
        {PoiId("n2"): ExistenceStatus.NOT_FOUND, PoiId("n3"): ExistenceStatus.NOT_FOUND}))
    agent.run(_task(pool, request=req))

    fed = _fed(sink)
    rejected = 0.9 - _CFG.rejection_demote_swapped[0]
    assert fed["n2"] == demoted_score(demoted_score(rejected, factor=_F, penalty=_P),
                                      factor=_F, penalty=_P)
    assert fed["n3"] == demoted_score(demoted_score(0.85, factor=_F, penalty=_P),
                                      factor=_F, penalty=_P)
    assert fed["n3"] >= _F * _F * 0.85 > 0


def test_지도_검증_상한이_계열_복제본에_낭비되지_않는다() -> None:
    """②′ 앞이라야 한다 — 상위 3건 검증이 n1·n2·n3(같은 공원)이 아니라 n1·o1·o2 를 본다."""
    pool = _pool(_NAMSAN)
    fake = FakeExistence()
    agent, _, _ = _agent(_NAMSAN_SCORES, existence=fake)
    agent._cfg = replace(_CFG, existence_verify_top_n=3)
    agent.run(_task(pool, request=_gen_request()))

    assert [str(p) for p in fake.queried_ids] == ["n1", "o1", "o2"]


# ── ⑥ generate 에만 ─────────────────────────────────────────────────


def test_플래그_off_면_점수가_그대로다() -> None:
    pool = _pool(_NAMSAN)
    agent, trace, sink = _agent(_NAMSAN_SCORES)
    agent.run(_task(pool, request=_gen_request(family=False)))

    assert _fed(sink) == _NAMSAN_SCORES
    assert not [e for e in trace.of_type(FallbackEvent) if e.stage == "family"]


def test_요청_기본값은_off_다() -> None:
    assert _request().family_demote is False


# ── ⑦ 결정론 · 상위 N ──────────────────────────────────────────────


def test_같은_입력_두_번이면_같은_결과() -> None:
    pool = _pool(_NAMSAN)
    runs = []
    for _ in range(2):
        agent, trace, sink = _agent(_NAMSAN_SCORES)
        outcome = agent.run(_task(pool, request=_gen_request()))
        runs.append((_fed(sink), _placed(outcome), outcome.slot_alternatives,
                     [e.reason for e in trace.of_type(FallbackEvent)]))
    assert runs[0] == runs[1]


def test_풀_순서를_섞어도_같은_강등() -> None:
    pool = _pool(_NAMSAN)
    shuffled = list(pool.pois)
    random.Random(7).shuffle(shuffled)
    outs = []
    for p in (pool, replace(pool, pois=tuple(shuffled))):
        agent, _, sink = _agent(_NAMSAN_SCORES)
        agent.run(_task(p, request=_gen_request()))
        outs.append(_fed(sink))
    assert outs[0] == outs[1]


def test_OR_프리필터_60위_밖_계열원도_판정한다() -> None:
    """상한이 프리필터와 같으면(60) 강등된 자리로 61위 밑이 판정 없이 올라온다 — 리뷰 실측
    '남산예장공원'(강등 전 61위)이 '남산공원'과 같은 날 들어갔다. 기본 상한은 그보다 넉넉하다.
    """
    fillers = tuple(_named(f"s{i:02d}", f"spot-{i:02d}", north_m=(i // 8) * 40,
                           east_m=(i % 8) * 40 + 300) for i in range(62))
    pool = _pool((_named("n1", "남산공원(서울)"), _named("n2", "남산골한옥마을", north_m=330),
                  *fillers))
    scores = {"n1": 0.95, "n2": 0.5, **{f"s{i:02d}": 0.8 for i in range(62)}}
    agent, _, sink = _agent(scores)
    agent.run(_task(pool, request=_gen_request()))

    assert _fed(sink)["n2"] == demoted_score(0.5, factor=_F, penalty=_P)  # 강등 전 64위


def test_점수_상위_N_밖은_판정하지_않는다() -> None:
    """상한의 의미 — 상위 N 밖의 계열원은 건드리지 않는다(풀 상한 5,000 에서 비교 횟수를 묶는다)."""
    pool = _pool(_NAMSAN)
    agent, _, sink = _agent(_NAMSAN_SCORES)
    agent._cfg = replace(_CFG, family_demote_top_n=2)  # n1, n2 만
    agent.run(_task(pool, request=_gen_request()))

    fed = _fed(sink)
    assert fed["n2"] == demoted_score(0.9, factor=_F, penalty=_P)
    assert fed["n3"] == 0.85


# ── ⑧ 차선책 ────────────────────────────────────────────────────────


def test_차선책은_이미_배치된_계열을_후순위로() -> None:
    pool = _pool(_NAMSAN)
    sol = _solution(_D1, (PoiId("n1"),))
    cands = _scored(_NAMSAN_SCORES)

    off = pick_slot_alternatives(sol, cands, pool)
    on = pick_slot_alternatives(sol, cands, pool, family_anchors=())

    key = f"{_D1.isoformat()}#n1"
    assert [str(a.poi_id) for a in off[key]][:1] == ["n2"]  # 전제: 계열이 1순위였다
    assert all(str(a.poi_id).startswith("o") for a in on[key])


def test_차선책은_앞_일자_계열도_후순위로() -> None:
    pool = _pool(_HWANG, _D2)
    sol = _solution(_D2, (PoiId("o1"),))
    cands = _scored(_HWANG_SCORES)
    hv = next(p for p in _HWANG if p.poi_id == PoiId("hv"))

    on = pick_slot_alternatives(sol, cands, pool, family_anchors=(hv,))
    off = pick_slot_alternatives(sol, cands, pool)
    key = f"{_D2.isoformat()}#o1"
    assert [str(a.poi_id) for a in off[key]][0] == "hm"  # 전제: 최고점이라 1순위였다
    assert "hm" not in [str(a.poi_id) for a in on[key]]  # 대체 후보 2곳이 먼저 찬다


# ── ⑨ 배선 — generate 만 켜고, poi_db 를 끊으면 운다 ─────────────────

from fastapi.testclient import TestClient  # noqa: E402

from tests.test_replan_via_planb import _app_with_spy, _body  # noqa: E402
from tests.test_schedule_fixed_poi_index import (  # noqa: E402
    _ANCHOR as _WIRE_ANCHOR,
    _client,
    _request as _wire_request,
)

_W1 = date(2026, 10, 25)  # 일 — 1일차
_W2 = date(2026, 10, 26)  # 월 — 2일차 (BE 2단계 생성의 2차 호출)


def _wire_poi(pid: str, name: str, north_m: float, east_m: float = 0.0,
              open_hours=()) -> Poi:
    return replace(_named(pid, name, open_hours=open_hours), coord=GeoPoint(
        _WIRE_ANCHOR.lat + north_m * _M, _WIRE_ANCHOR.lng + east_m * _M / 0.79))


_WIRE_POIS = (
    # 1일차(일)만 여는 전망대 — 2일차 풀 밖. 좌표·이름은 ScheduleAgent 의 poi_db 로만 안다.
    _wire_poi("hv", "황령산 전망대", 0, open_hours=(OpenHour(_W1.weekday(), 9 * 60, 22 * 60),)),
    _wire_poi("hm", "황령산", 2),  # 앵커 바로 옆 = 규칙 점수 최고
    _wire_poi("o1", "경복궁", 400),
    _wire_poi("o2", "덕수궁", 0, 400),
    _wire_poi("o3", "종묘", -400),
    _wire_poi("o4", "창덕궁", 0, -400),
)


def _wire_day2(excluded: list[str]) -> list[str]:
    body = _wire_request((_W2,), [])
    body["excluded_poi_ids"] = excluded
    body["time_windows"] = [{"date": _W2.isoformat(), "start": "09:00", "end": "12:00"}]
    with _client(InMemoryPoi(_WIRE_POIS)) as client:
        response = client.post("/ai/v1/itinerary/generate", json=body)
    assert response.status_code == 200, response.text
    return [s["poi_id"] for d in response.json()["days"] for s in d["slots"]]


def test_generate_와이어_2차_호출에서_앞_일자_계열이_빠진다() -> None:
    """BE 2단계 생성 흉내 — 2차 호출이 '황령산 전망대' id 만 안다(풀 밖).

    합성 루트에서 ScheduleAgent 의 `poi_db=` 를 끊으면 이 테스트가 운다(조회 축이 빠진다).
    """
    assert "hm" in _wire_day2([])  # 전제: 계열을 모르면 최고점이라 배치된다
    assert "hm" not in _wire_day2(["hv"])


def test_replan_경로는_계열_강등을_켜지_않는다() -> None:
    app, spy = _app_with_spy()
    with TestClient(app, raise_server_exceptions=False) as client:
        client.post("/ai/v1/planb/replan", json=_body())
    assert len(spy.tasks) == 1
    assert spy.tasks[0].request.family_demote is False
