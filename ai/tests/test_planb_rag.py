"""U6-06(TRIP-247) — PlanBAgent RAG 골격: KB 3종 스키마·retrieve 3종·fake 파이프라인.

**FakeEmbedding의 한계 우회**: 해시 기반이라 의미 유사도가 없다. 따라서
- "같은 텍스트 → top1" 성질만 FakeEmbedding으로 쓰고,
- 순위·임계 시나리오는 `_ScriptedEmbedding`(2차원 단위벡터, 각도로 코사인 지정) +
  InMemoryVectorStore **직접 주입**으로 구성한다 (test_intent_router.py와 같은 방식).

**LLM 단계**: `ALTERNATIVE_SELECTION`용 프롬프트 yaml·출구 게이트가 아직 없어(보고 항목)
실물 GatewayFacade + FakeLlm + 스텁 렌더러 + 게이트 대역으로 계약만 검증한다.
게이트 대역은 **일부러 closed-set 필터를 하지 않는다** — 파이프라인 자체의 INV-1 관문
(`closed_set_filter`)이 살아 있는지 보기 위해서다.
"""

from __future__ import annotations

import json
import math
from datetime import date, datetime, timezone

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from trippilot.agents.planb.kb_retrieval import (
    KB_COLLECTIONS,
    KbIndexError,
    collection_for,
    index_documents,
    retrieve_persona,
    retrieve_schedule,
    retrieve_situation,
)
from trippilot.agents.planb.rag import (
    Alternative,
    PlanBRagConfig,
    PlanBRagPipeline,
    PlanBRagRequest,
    PlanBRagResult,
    _DEMOTED_BY_REASON,
    _persona_query,
    _rule_ranking,
    closed_set_filter,
)
from trippilot.llm_gateway.config import C1Config
from trippilot.llm_gateway.gates.base import GateOutcome
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId, TraceId
from trippilot.domain.kb import KbDocument, KbHit, KbKind
from trippilot.domain.llm import CandidatePool, ModelTier, ScoredPoi
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.domain.prompt import PromptRef
from trippilot.domain.trigger import TriggerKind, TriggerParams
from trippilot.solver_engine.config import RAIN_OUTDOOR
from trippilot.solver_engine.travel import haversine_km

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.fake_llm import FailingLlm, FakeLlm
from tests.fakes.in_memory_trace import InMemoryTrace
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from tests.generators.poi import candidate_pools

_NOW = datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc)
_TID = TraceId("t-planb")
_CFG = C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"})
_SMALL = 8  # PBT용 임베딩 차원 — 1024 가우시안을 매 예제마다 뽑으면 느리다


# ── 테스트 대역·헬퍼 ────────────────────────────────────────────────────


class _ScriptedEmbedding:
    """각도 → 2차원 단위벡터. 코사인 = 두 각도 차의 cos — 순위를 정확히 조준한다."""

    dim = 2
    _FAR = 3.0

    def __init__(self, angles: dict[str, float]) -> None:
        self._angles = angles

    def embed(self, text: str) -> tuple[float, ...]:
        theta = self._angles.get(text, self._FAR)
        return (math.cos(theta), math.sin(theta))

    def embed_batch(self, texts):
        return tuple(self.embed(t) for t in texts)


class _BrokenStore:
    """search가 항상 터지는 스토어 — INV-4(예외 미전파) 검증용."""

    def upsert(self, collection, item_id, vector, payload) -> None:  # pragma: no cover
        raise RuntimeError("store down (fake)")

    def search(self, collection, vector, top_k):
        raise RuntimeError("store down (fake)")

    def delete(self, collection, item_id) -> None:  # pragma: no cover
        raise RuntimeError("store down (fake)")


class _StubRenderer:
    """PromptRenderer 대역 — prompts/alternative_selection.yaml 미등록 상태를 대신한다."""

    def render(self, feature, variables):
        rendered = f"{feature.value}|" + "|".join(f"{k}={v}" for k, v in sorted(variables.items()))
        return rendered, PromptRef(
            prompt_id=f"stub/{feature.value.lower()}.yaml",
            version="0.0.0-stub",
            feature=feature.value,
        )


class _AlternativeGate:
    """ALTERNATIVE_SELECTION 게이트 대역 — {"selected": [{poi_id, score}]} → ScoredPoi 튜플.

    **closed-set 필터를 하지 않는다** (실 게이트와 다른 점, 의도적):
    파이프라인의 INV-1 관문이 실제로 일하고 있는지 보려면 오염된 산출물이 통과해야 한다.
    """

    def apply(self, raw_text, pool, *, feature, trace_id, now) -> GateOutcome:
        try:
            data = json.loads(raw_text)
            selected = tuple(
                ScoredPoi(poi_id=PoiId(x["poi_id"]), score=float(x["score"]), is_llm_score=True)
                for x in data["selected"]
            )
        except Exception as e:
            return GateOutcome(value=None, drop_event=None, error=f"parse_error: {e}")
        return GateOutcome(value=selected, drop_event=None, error=None)


class _ShapeGate:
    """산출물 형태가 계약과 다른 게이트 (문자열 목록) — bad_shape 경로용."""

    def apply(self, raw_text, pool, *, feature, trace_id, now) -> GateOutcome:
        return GateOutcome(value=("p1", "p2"), drop_event=None, error=None)


def _gateway(canned: str, gate) -> GatewayFacade:
    return GatewayFacade(FakeLlm(canned=canned), _StubRenderer(), gate, _CFG, InMemoryTrace())


def _select_gw(*pairs: tuple[str, float]) -> GatewayFacade:
    body = {"selected": [{"poi_id": p, "score": s} for p, s in pairs]}
    return _gateway(json.dumps(body), _AlternativeGate())


def _poi(pid: str) -> Poi:
    return Poi(
        poi_id=PoiId(pid),
        name=pid,
        category=PoiCategory.CAFE,
        coord=GeoPoint(37.5, 127.0),
        open_hours=(),
        avg_cost=None,
        rating=None,
        quality=DataQuality.FULL,
        source=PoiSource.SEED,
        confidence=None,
    )


def _pool(*ids: str) -> CandidatePool:
    pois = tuple(_poi(i) for i in ids)
    return CandidatePool(
        poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=_NOW
    )


def _request(
    pool: CandidatePool,
    *,
    excluded: frozenset[PoiId] = frozenset(),
    reason: str = "weather",
) -> PlanBRagRequest:
    return PlanBRagRequest(
        trigger=TriggerParams(
            kind=TriggerKind.WEATHER,
            schedule_id=ScheduleId("sched-1"),
            affected_date=date(2026, 8, 8),
            payload={"pop": 80},
        ),
        reason=reason,
        pool=pool,
        trace_id=_TID,
        now=_NOW,
        excluded_poi_ids=excluded,
    )


def _doc(kb: KbKind, doc_id: str, text: str, poi_ref: str | None = None) -> KbDocument:
    return KbDocument(kb=kb, doc_id=doc_id, text=text, poi_ref=poi_ref, metadata={})


# ── KB 스키마 ───────────────────────────────────────────────────────────


def test_kb_document_rejects_empty_id_and_text() -> None:
    with pytest.raises(ValueError):
        _doc(KbKind.PERSONA, "", "본문")
    with pytest.raises(ValueError):
        _doc(KbKind.PERSONA, "d1", "   ")


def test_kb_collections_cover_three_kinds_and_are_distinct() -> None:
    """KB 3종 ↔ collection 1:1. `persona`는 FD 지정 초기 collection을 재사용한다."""
    assert set(KB_COLLECTIONS) == set(KbKind)
    assert len(set(KB_COLLECTIONS.values())) == 3
    assert collection_for(KbKind.PERSONA) == "persona"


# ── 적재 ────────────────────────────────────────────────────────────────


def test_index_documents_routes_each_kb_to_its_collection() -> None:
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    docs = [
        _doc(KbKind.SCHEDULE, "s1", "14시 한강공원 슬롯"),
        _doc(KbKind.PERSONA, "p1", "저장한 을지로 카페", poi_ref="poi-1"),
        _doc(KbKind.SITUATION, "t1", "강수확률 80%"),
    ]
    assert index_documents(docs, emb, store) == 3
    assert len(retrieve_schedule("14시 한강공원 슬롯", emb, store)) == 1
    assert len(retrieve_persona("저장한 을지로 카페", emb, store)) == 1
    assert len(retrieve_situation("강수확률 80%", emb, store)) == 1


def test_index_documents_rejects_duplicate_doc_id_in_same_kb() -> None:
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    docs = [_doc(KbKind.PERSONA, "p1", "가"), _doc(KbKind.PERSONA, "p1", "나")]
    with pytest.raises(KbIndexError):
        index_documents(docs, emb, store)


def test_index_documents_rejects_dim_mismatch() -> None:
    """BR-AF-09 — 차원 위반은 조용히 넘기지 않는다."""

    class _WrongDim:
        """dim은 4라고 주장하면서 5차원 벡터를 반환하는 임베딩."""

        dim = 4

        def embed(self, text: str) -> tuple[float, ...]:
            return (0.1, 0.2, 0.3, 0.4, 0.5)

        def embed_batch(self, texts):
            return tuple(self.embed(t) for t in texts)

    store = InMemoryVectorStore()
    with pytest.raises(KbIndexError):
        index_documents([_doc(KbKind.PERSONA, "p1", "가")], _WrongDim(), store)


def test_index_documents_empty_is_noop() -> None:
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    assert index_documents([], emb, store) == 0


# ── retrieve ────────────────────────────────────────────────────────────


def test_retrieve_on_empty_kb_returns_empty() -> None:
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    assert retrieve_schedule("아무거나", emb, store) == ()
    assert retrieve_persona("아무거나", emb, store) == ()
    assert retrieve_situation("아무거나", emb, store) == ()


def test_retrieve_with_nonpositive_top_k_or_blank_query_returns_empty() -> None:
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    index_documents([_doc(KbKind.PERSONA, "p1", "가")], emb, store)
    assert retrieve_persona("가", emb, store, top_k=0) == ()
    assert retrieve_persona("   ", emb, store) == ()


def test_retrieve_isolates_collections() -> None:
    """SCHEDULE에 실린 문서는 PERSONA 검색에 절대 나오지 않는다 (collection 분리)."""
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    index_documents([_doc(KbKind.SCHEDULE, "s1", "동일 본문")], emb, store)
    assert len(retrieve_schedule("동일 본문", emb, store)) == 1
    assert retrieve_persona("동일 본문", emb, store) == ()


def test_retrieve_orders_by_score_and_honors_top_k() -> None:
    angles = {"질의": 0.0, "가까움": 0.1, "중간": 0.6, "멂": 1.2}
    emb = _ScriptedEmbedding(angles)
    store = InMemoryVectorStore()
    index_documents(
        [
            _doc(KbKind.PERSONA, "far", "멂"),
            _doc(KbKind.PERSONA, "near", "가까움"),
            _doc(KbKind.PERSONA, "mid", "중간"),
        ],
        emb,
        store,
    )
    hits = retrieve_persona("질의", emb, store, top_k=2)
    assert [h.doc_id for h in hits] == ["near", "mid"]
    assert hits[0].score >= hits[1].score


def test_retrieve_drops_payload_from_another_kb() -> None:
    """collection 오염 방어 — payload의 kb 라벨이 다르면 매칭 대상이 아니다."""
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    vector = emb.embed("오염")
    store.upsert(
        collection_for(KbKind.PERSONA),
        "bad",
        vector,
        {"kb": KbKind.SCHEDULE.value, "text": "오염", "poi_ref": "poi-x", "metadata": {}},
    )
    assert retrieve_persona("오염", emb, store) == ()


# ── closed-set 관문 (INV-1) ─────────────────────────────────────────────


def test_closed_set_filter_partitions_by_pool_and_excluded() -> None:
    pool = _pool("p1", "p2", "p3")
    kept, dropped = closed_set_filter(
        ["p1", "ghost", "p2", "p1", "p3"], pool, frozenset({PoiId("p3")})
    )
    assert kept == (PoiId("p1"), PoiId("p2"))  # 중복은 첫 등장으로 접힘
    assert dropped == ("ghost", "p3")


# ── 파이프라인 ──────────────────────────────────────────────────────────


def test_pipeline_without_gateway_falls_back_deterministically() -> None:
    """게이트웨이 미주입 → 단계 스킵 + 규칙 랭킹 (INV-4, 사유 명시)."""
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    pipeline = PlanBRagPipeline(emb, store)
    result = pipeline.run(_request(_pool("p1", "p2", "p3", "p4")))
    assert result.is_fallback is True
    assert result.fallback_level == 1
    assert any("alternative_gateway_absent" in n for n in result.notes)  # note 합성(TRIP-532) 대응
    assert [a.label for a in result.alternatives] == ["A", "B", "C"]  # max_alternatives=3
    again = pipeline.run(_request(_pool("p1", "p2", "p3", "p4")))
    assert again == result  # 결정론


def test_pipeline_ranks_persona_hits_first_but_only_inside_pool() -> None:
    """KB-2 저장 장소가 대안 1순위 — 단, 풀 안에서의 우선순위만 바꾼다 (INV-1)."""
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    pool = _pool("p1", "p2", "p3")
    request = _request(pool)
    query = _persona_query(request)
    index_documents(
        [
            # 풀 밖 POI를 가리키는 페르소나 문서 — 후보가 되면 안 된다
            _doc(KbKind.PERSONA, "saved-ghost", query, poi_ref="ghost"),
            _doc(KbKind.PERSONA, "saved-p3", query + " 카페", poi_ref="p3"),
        ],
        emb,
        store,
    )
    result = PlanBRagPipeline(emb, store).run(request)
    picked = [str(p) for a in result.alternatives for p in a.poi_ids]
    # 저장 장소 p3가 1순위로 올라오고, 풀 밖 ghost는 아예 등장하지 않는다
    assert picked == ["p3", "p1", "p2"]
    assert result.retrieved[KbKind.PERSONA.value] == 2
    assert result.dropped_out_of_pool == ()  # 랭킹 단계에서 이미 배제 — 드롭 기록 대상 아님


def test_pipeline_with_gateway_uses_llm_selection() -> None:
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    pool = _pool("p1", "p2", "p3")
    pipeline = PlanBRagPipeline(
        emb, store, alternative_gateway=_select_gw(("p3", 0.9), ("p1", 0.5))
    )
    result = pipeline.run(_request(pool))
    assert result.is_fallback is False
    assert result.fallback_level == 0
    assert result.notes == ()
    assert [str(p) for a in result.alternatives for p in a.poi_ids] == ["p3", "p1"]


def test_pipeline_drops_llm_selection_outside_pool() -> None:
    """게이트 대역이 오염 산출물을 통과시켜도 파이프라인 관문이 잡는다 (INV-1)."""
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    pool = _pool("p1", "p2")
    pipeline = PlanBRagPipeline(
        emb, store, alternative_gateway=_select_gw(("ghost", 0.9), ("p2", 0.4))
    )
    result = pipeline.run(_request(pool))
    assert result.dropped_out_of_pool == ("ghost",)
    assert any(n.startswith("out_of_pool_dropped") for n in result.notes)
    assert [str(p) for a in result.alternatives for p in a.poi_ids] == ["p2"]


def test_pipeline_falls_back_when_all_llm_picks_dropped() -> None:
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    pipeline = PlanBRagPipeline(
        emb, store, alternative_gateway=_select_gw(("ghost1", 0.9), ("ghost2", 0.4))
    )
    result = pipeline.run(_request(_pool("p1", "p2")))
    assert result.is_fallback is True
    assert "all_selected_dropped → rule_ranking" in result.notes
    assert [str(p) for a in result.alternatives for p in a.poi_ids] == ["p1", "p2"]


def test_pipeline_falls_back_on_llm_failure_and_bad_shape() -> None:
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    pool = _pool("p1")
    failing = GatewayFacade(
        FailingLlm(), _StubRenderer(), _AlternativeGate(), _CFG, InMemoryTrace()
    )
    result = PlanBRagPipeline(emb, store, alternative_gateway=failing).run(_request(pool))
    assert result.is_fallback is True
    assert any(n.startswith("alternative_fallback") for n in result.notes)

    shaped = _gateway("{}", _ShapeGate())
    result2 = PlanBRagPipeline(emb, store, alternative_gateway=shaped).run(_request(pool))
    assert "alternative_bad_shape" in result2.notes
    assert [str(p) for a in result2.alternatives for p in a.poi_ids] == ["p1"]


def test_pipeline_empty_pool_reports_no_candidates() -> None:
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    result = PlanBRagPipeline(emb, store).run(_request(_pool()))
    assert result.alternatives == ()
    assert result.empty_reason == "no_candidates"
    assert result.fallback_level == 2


def test_pipeline_excluded_pois_are_not_candidates() -> None:
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    result = PlanBRagPipeline(emb, store).run(
        _request(_pool("p1", "p2"), excluded=frozenset({PoiId("p1")}))
    )
    assert [str(p) for a in result.alternatives for p in a.poi_ids] == ["p2"]


def test_pipeline_never_raises_on_store_failure() -> None:
    """INV-4 — 어떤 실패든 결과 상태값으로 수렴하고 사유가 남는다."""
    result = PlanBRagPipeline(FakeEmbedding(dim=_SMALL), _BrokenStore()).run(
        _request(_pool("p1"))
    )
    # retrieve는 KB별로 감싸져 있어 파이프라인 자체는 계속 진행한다
    assert len([n for n in result.notes if n.startswith("retrieve_")]) == 3
    assert [str(p) for a in result.alternatives for p in a.poi_ids] == ["p1"]


def test_result_serialization_has_no_time_or_duration_fields() -> None:
    """INV-2(시각 없음) · INV-3(소요시간 미표시) — 출력 스키마에 자리 자체가 없다."""
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    payload = PlanBRagPipeline(emb, store).run(_request(_pool("p1", "p2"))).to_dict()
    blob = json.dumps(payload, ensure_ascii=False)
    for forbidden in ("duration", "start_at", "end_at", "start_time", "end_time"):
        assert forbidden not in blob


def test_result_rejects_silent_empty() -> None:
    with pytest.raises(ValueError):
        PlanBRagResult(
            alternatives=(),
            is_fallback=True,
            fallback_level=1,
            notes=(),
            retrieved={},
            dropped_out_of_pool=(),
            empty_reason=None,
        )
    with pytest.raises(ValueError):  # is_fallback ⇔ fallback_level ≥ 1
        PlanBRagResult(
            alternatives=(Alternative(label="A", poi_ids=(PoiId("p1"),), rationale="r"),),
            is_fallback=False,
            fallback_level=1,
            notes=(),
            retrieved={},
            dropped_out_of_pool=(),
        )


def test_config_validates_bounds() -> None:
    with pytest.raises(ValueError):
        PlanBRagConfig(top_k=0)
    with pytest.raises(ValueError):
        PlanBRagConfig(max_alternatives=0)


# ── PBT ─────────────────────────────────────────────────────────────────

_kb_docs = st.lists(
    st.builds(
        KbDocument,
        kb=st.sampled_from(list(KbKind)),
        doc_id=st.text(min_size=1, max_size=6),
        text=st.text(min_size=1, max_size=12).filter(lambda s: s.strip()),
        poi_ref=st.one_of(st.none(), st.text(min_size=1, max_size=6)),
        metadata=st.just({}),
    ),
    max_size=8,
).map(lambda ds: list({(d.kb, d.doc_id): d for d in ds}.values()))


@given(documents=_kb_docs)
@settings(max_examples=60, deadline=None)
def test_pbt_retrieve_stays_inside_requested_kb_and_is_deterministic(documents) -> None:
    """KB-P1: retrieve 결과는 ① 항상 요청 KB 소속 ② 그 KB에 적재된 문서만
    ③ 같은 입력이면 같은 결과 (결정론) ④ top_k 상한 준수."""
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    index_documents(documents, emb, store)
    fns = {
        KbKind.SCHEDULE: retrieve_schedule,
        KbKind.PERSONA: retrieve_persona,
        KbKind.SITUATION: retrieve_situation,
    }
    for kb, fn in fns.items():
        expected = {d.doc_id for d in documents if d.kb is kb}
        hits = fn("질의 텍스트", emb, store, top_k=3)
        assert all(h.kb is kb for h in hits)
        assert {h.doc_id for h in hits} <= expected
        assert len(hits) <= 3
        assert hits == fn("질의 텍스트", emb, store, top_k=3)


@given(pool=candidate_pools(), refs=st.lists(st.text(min_size=1, max_size=6), max_size=10))
@settings(max_examples=80, deadline=None)
def test_pbt_closed_set_filter_partition(pool, refs) -> None:
    """KB-P2: closed_set_filter는 풀 멤버십으로 완전 분할하고 중복을 만들지 않는다."""
    kept, dropped = closed_set_filter(refs, pool)
    assert all(pool.contains(p) for p in kept)
    assert all(not pool.contains(PoiId(r)) for r in dropped)
    assert len(set(kept)) == len(kept)
    assert set(map(str, kept)) | set(dropped) == {r for r in refs if r}


@given(pool=candidate_pools(), documents=_kb_docs)
@settings(max_examples=60, deadline=None)
def test_pbt_pipeline_output_always_inside_pool(pool, documents) -> None:
    """KB-P3(INV-1): 어떤 KB 내용이 들어와도 산출 대안의 POI는 전부 closed-set 안이다."""
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    index_documents(documents, emb, store)
    result = PlanBRagPipeline(emb, store).run(_request(pool))
    picked = [p for a in result.alternatives for p in a.poi_ids]
    assert all(pool.contains(p) for p in picked)
    assert len(result.alternatives) <= PlanBRagConfig().max_alternatives
    assert result.alternatives or result.empty_reason is not None


@given(
    doc=st.builds(
        KbDocument,
        kb=st.sampled_from(list(KbKind)),
        doc_id=st.text(min_size=1, max_size=6),
        text=st.text(min_size=1, max_size=12).filter(lambda s: s.strip()),
        poi_ref=st.one_of(st.none(), st.text(min_size=1, max_size=6)),
        metadata=st.just({"k": "v"}),
    ),
    score=st.floats(-1, 1, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=60, deadline=None)
def test_pbt_kb_types_roundtrip(doc, score) -> None:
    """KB-P4: KB 타입은 from_dict(to_dict(x)) == x (U5-P10 패턴)."""
    assert KbDocument.from_dict(doc.to_dict()) == doc
    hit = KbHit(
        kb=doc.kb,
        doc_id=doc.doc_id,
        score=score,
        text=doc.text,
        poi_ref=doc.poi_ref,
        metadata=dict(doc.metadata),
    )
    assert KbHit.from_dict(hit.to_dict()) == hit


# ── 원래 추천 이유 주입 (TRIP-516 — placement_reason 재사용) ────────────


class _RecordingLlm(FakeLlm):
    """마지막 프롬프트를 기록 — 컨텍스트 주입 검증용."""

    def __init__(self, canned: str) -> None:
        super().__init__(canned=canned)
        self.last_prompt: str | None = None

    def invoke(self, request):
        self.last_prompt = request.prompt
        return super().invoke(request)


def _recording_select_gw(*pairs: tuple[str, float]) -> tuple[GatewayFacade, "_RecordingLlm"]:
    body = {"selected": [{"poi_id": p, "score": s} for p, s in pairs]}
    llm = _RecordingLlm(json.dumps(body))
    return GatewayFacade(llm, _StubRenderer(), _AlternativeGate(), _CFG, InMemoryTrace()), llm


def test_affected_reasons_reach_llm_prompt():
    """원래 추천 이유가 LLM 프롬프트의 일정 컨텍스트에 실린다 (결정론 — poi_id 정렬)."""
    import dataclasses

    pool = _pool("p1", "p2")
    gateway, llm = _recording_select_gw(("p1", 0.9))
    pipeline = PlanBRagPipeline(
        FakeEmbedding(dim=8), InMemoryVectorStore(), alternative_gateway=gateway)
    request = dataclasses.replace(
        _request(pool),
        affected_reasons={"p1": "조용한 카페라 추천했던 곳"})
    result = pipeline.run(request)
    assert result.fallback_level == 0
    assert llm.last_prompt is not None
    assert "[원래 추천 이유]" in llm.last_prompt
    assert "조용한 카페라 추천했던 곳" in llm.last_prompt


def test_without_reasons_prompt_has_no_reason_block():
    """미지정(기본) — 프롬프트에 이유 블록이 없다 (하위호환 회귀 가드)."""
    pool = _pool("p1", "p2")
    gateway, llm = _recording_select_gw(("p1", 0.9))
    pipeline = PlanBRagPipeline(
        FakeEmbedding(dim=8), InMemoryVectorStore(), alternative_gateway=gateway)
    pipeline.run(_request(pool))
    assert llm.last_prompt is not None
    assert "[원래 추천 이유]" not in llm.last_prompt


# ── TRIP-532 규칙 폴백 — reason 신호 (카테고리 강등·거리 정렬) ───────────
#
# 정렬 키 = (야외인가[reason=weather 일 때만], 저장 장소 아닌가, 앵커까지 거리).
# 외부 호출 0 — RAIN_OUTDOOR 상수 + KB-2 히트 + haversine 뿐이다.

_ANCHOR = GeoPoint(37.50, 127.00)


def _poi_at(pid: str, category: PoiCategory, lat_off: float) -> Poi:
    """앵커에서 위도 오프셋만큼 떨어진 POI — 거리 순위를 정확히 조준한다."""
    return Poi(
        poi_id=PoiId(pid), name=pid, category=category,
        coord=GeoPoint(_ANCHOR.lat + lat_off, _ANCHOR.lng),
        open_hours=(), avg_cost=None, rating=None,
        quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None,
    )


def _pool_at(*pois: Poi) -> CandidatePool:
    return CandidatePool(
        poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=_NOW,
        anchor=_ANCHOR, radius_km=10.0,
    )


def _fallback_picks(pool: CandidatePool, reason: str) -> tuple[list[str], PlanBRagResult]:
    """게이트웨이 미주입 → 규칙 랭킹 폴백. (선택 순열, 결과)."""
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    result = PlanBRagPipeline(emb, store).run(_request(pool, reason=reason))
    return [str(p) for a in result.alternatives for p in a.poi_ids], result


def test_fallback_weather_demotes_outdoor_even_if_nearest() -> None:
    """대조군(TRIP-532) — 비 사유 폴백에서 야외(RAIN_OUTDOOR)는 가장 가까워도 뒤로.

    보완 전 코드에서는 **실패한다** (풀 순서만 봤다) — 빨강을 확인하고 구현으로 초록.
    """
    pool = _pool_at(
        _poi_at("nature-0", PoiCategory.NATURE, 0.001),     # 최근접이지만 야외
        _poi_at("act-1", PoiCategory.ACTIVITY, 0.002),      # 야외
        _poi_at("cafe-2", PoiCategory.CAFE, 0.010),
        _poi_at("culture-3", PoiCategory.CULTURE, 0.020),
        _poi_at("sight-4", PoiCategory.SIGHT, 0.030),       # 중립 — 강등 대상 아님
    )
    picked, _ = _fallback_picks(pool, "weather")
    assert picked == ["cafe-2", "culture-3", "sight-4"]  # max 3 — 야외 2곳은 밀려남


def test_fallback_weather_demotes_saved_outdoor_behind_unsaved_indoor() -> None:
    """비 + 야외면 저장 장소여도 뒤로 — ⓪(상황)이 ①(저장)보다 앞선다."""
    pool = _pool_at(
        _poi_at("nature-saved", PoiCategory.NATURE, 0.001),
        _poi_at("cafe-plain", PoiCategory.CAFE, 0.030),
    )
    store, emb = InMemoryVectorStore(), FakeEmbedding(dim=_SMALL)
    request = _request(pool, reason="weather")
    index_documents(
        [_doc(KbKind.PERSONA, "saved-n", _persona_query(request), poi_ref="nature-saved")],
        emb, store,
    )
    result = PlanBRagPipeline(emb, store).run(request)
    picked = [str(p) for a in result.alternatives for p in a.poi_ids]
    assert picked == ["cafe-plain", "nature-saved"]


@pytest.mark.parametrize("reason", ["delay", "fatigue"])
def test_fallback_delay_fatigue_rank_by_distance(reason: str) -> None:
    """시간·체력 사유 → 앵커에서 가까운 순. 풀 순서·poi_id 와 무관하다."""
    pool = _pool_at(
        _poi_at("far-z", PoiCategory.CAFE, 0.030),
        _poi_at("mid-a", PoiCategory.NATURE, 0.020),   # 야외지만 강등 없음 (weather 아님)
        _poi_at("near-m", PoiCategory.CULTURE, 0.001),
    )
    picked, _ = _fallback_picks(pool, reason)
    assert picked == ["near-m", "mid-a", "far-z"]


@pytest.mark.parametrize("reason", ["closed", "canceled", "none"])
def test_fallback_neutral_reasons_apply_no_category_demotion(reason: str) -> None:
    """중립 사유 — 야외 강등 없음. 없는 신호로 순위를 지어내지 않는다 (거리만)."""
    pool = _pool_at(
        _poi_at("cafe-far", PoiCategory.CAFE, 0.020),
        _poi_at("nature-near", PoiCategory.NATURE, 0.001),
    )
    picked, _ = _fallback_picks(pool, reason)
    assert picked == ["nature-near", "cafe-far"]  # 야외가 가까우면 야외가 먼저


def test_fallback_without_anchor_keeps_pool_order() -> None:
    """anchor 없는 풀 — 거리 키만 생략하고 죽지 않는다 (안정 정렬 → 풀 순서 유지)."""
    picked, _ = _fallback_picks(_pool("p2", "p1", "p3"), "delay")  # _pool 은 anchor=None
    assert picked == ["p2", "p1", "p3"]


def test_fallback_note_records_demotion_count() -> None:
    """폴백이 뭘 했는지 notes 에 남는다 — 조용한 조정 금지 (INV-4)."""
    pool = _pool_at(
        _poi_at("nature-0", PoiCategory.NATURE, 0.001),
        _poi_at("cafe-1", PoiCategory.CAFE, 0.010),
    )
    _, result = _fallback_picks(pool, "weather")
    assert any("후순위" in n and "1건" in n for n in result.notes), result.notes


# ── TRIP-532 규칙 폴백 PBT — RANK-P1 순열 보존(INV-1) · RANK-P2 weather 분할 · RANK-P3 결정론
#
# `_rule_ranking` 을 직접 친다 — 파이프라인 경유는 max_alternatives=3 으로 잘라 순열 전체가
# 안 보인다. 순수 정렬 함수라 fake 조차 필요 없다 (외부 호출 0, D37).
# 오라클: 정렬 키를 재계산하지 않는다 (동어반복 금지). 대신 출력에서 관찰 가능한 불변식만 —
# "집합 보존"·"층 분할(플래그 열이 단조)"·"같은 입력 두 번 == 같은 출력" 으로 판정한다.

_RANK_REASONS = st.one_of(
    st.sampled_from(["weather", "delay", "fatigue", "closed", "canceled", "none", ""]),
    st.text(max_size=8),  # 모르는 사유 — 없는 신호로 순위를 지어내면 안 된다
)
_PLACEABLE = [c for c in PoiCategory if c is not PoiCategory.STAY]  # STAY 는 후보 풀 밖(내부 전용)


def _saved_refs_for(pool: CandidatePool) -> st.SearchStrategy[tuple[str, ...]]:
    """저장 장소 참조 순열 — 풀 안·풀 밖·빈 문자열이 섞인 적대적 재료.

    `_rule_ranking` 은 이제 참조 문자열을 받는다 (TRIP-512 — 봉투 ⊕ KB-2 히트를
    `_saved_refs` 가 미리 합쳐 넘긴다). 풀 밖 참조는 순위를 만들 수도, 새 id 를 낳을
    수도 없어야 한다 (INV-1).
    """
    inside = st.sampled_from(sorted(map(str, pool.poi_ids))) if pool.poi_ids else st.nothing()
    ref = st.one_of(inside, st.text(min_size=1, max_size=6))
    return st.lists(ref, max_size=4).map(tuple)


@st.composite
def _anchored_cases(draw, *, distinct_offsets: bool = False):
    """anchor 있는 풀 + KB-2 히트 + `available` 순열. → (pool, hits, available).

    위도 오프셋 0.001~0.05 (양수만 — 거리는 오프셋에 단조), 카테고리는 STAY 제외 전분포.
    `distinct_offsets` 는 결정론 속성용 — 거리 동률이면 풀 순서가 tie-break 라 순서 독립이
    성립하지 않으므로 동률을 미리 줄인다 (부동소수 반올림 동률은 호출 측 `assume` 으로 거른다).
    """
    n = draw(st.integers(min_value=1, max_value=8))
    offsets = draw(
        st.lists(st.floats(0.001, 0.05, allow_nan=False), min_size=n, max_size=n,
                 unique=distinct_offsets)
    )
    cats = draw(st.lists(st.sampled_from(_PLACEABLE), min_size=n, max_size=n))
    pool = _pool_at(*(_poi_at(f"p{i}", c, o) for i, (c, o) in enumerate(zip(cats, offsets))))
    hits = draw(_saved_refs_for(pool))
    available = tuple(draw(st.permutations([p.poi_id for p in pool.pois])))
    return pool, hits, available


@st.composite
def _ranking_inputs(draw):
    """RANK-P1 재료 — anchor 없는 전국 풀(`candidate_pools`, STAY 포함) 과 anchor 풀 양쪽.

    `available` 은 풀의 임의 부분집합·임의 순서 (파이프라인의 excluded 제외분을 일반화).
    """
    if draw(st.booleans()):
        pool = draw(candidate_pools())
        ids = sorted(pool.poi_ids, key=str)
        available = tuple(draw(st.lists(st.sampled_from(ids), unique=True))) if ids else ()
    else:
        pool, _, full = draw(_anchored_cases())
        available = tuple(draw(st.lists(st.sampled_from(list(full)), unique=True)))
    hits = draw(_saved_refs_for(pool))
    return pool, hits, available, draw(_RANK_REASONS)


@given(case=_ranking_inputs())
@settings(max_examples=80, deadline=None)
def test_pbt_rule_ranking_is_a_permutation_of_available(case) -> None:
    """RANK-P1(INV-1): 어떤 풀·사유·저장 장소 참조에도 출력은 `available` 의 순열이다.

    집합 같음·길이 같음·중복 없음. 풀 밖 참조가 있어도 새 id 가 생기지 않는다.
    덤으로 note 의 강등 건수는 실제 건수와 같아야 한다 — 조용한 조정도, 부풀린 기록도 금지.
    """
    pool, hits, available, reason = case
    ranked, note = _rule_ranking(hits, pool, available, reason)

    assert sorted(ranked) == sorted(str(p) for p in available)
    assert len(ranked) == len(available)
    assert len(set(ranked)) == len(ranked)
    assert all(pool.contains(PoiId(r)) for r in ranked)

    demoted = _DEMOTED_BY_REASON.get(reason, frozenset())
    by_id = {p.poi_id: p for p in pool.pois}
    n_demoted = sum(1 for p in available if by_id[p].category in demoted)
    assert bool(note) == (n_demoted > 0), (note, n_demoted)
    if note:
        assert f"{n_demoted}건" in note


@given(case=_anchored_cases())
@settings(max_examples=60, deadline=None)
def test_pbt_rule_ranking_weather_puts_every_non_outdoor_before_every_outdoor(case) -> None:
    """RANK-P2: reason=weather 면 비야외 전원 < 야외(RAIN_OUTDOOR) 전원 — 입력 순서·저장 무관.

    판정은 "야외 플래그 열이 단조(False…True)" 다. 야외가 가장 가까워도, 저장 장소여도
    뒤로 간다 (⓪ 상황 > ① 저장). 각 층 안에서는 저장이 비저장보다 앞 (② 키 순서 보존).
    """
    pool, hits, available = case
    ranked, _ = _rule_ranking(hits, pool, available, "weather")
    by_id = {str(p.poi_id): p for p in pool.pois}

    outdoor_flags = [by_id[r].category in RAIN_OUTDOOR for r in ranked]
    assert outdoor_flags == sorted(outdoor_flags), ranked

    saved = {h for h in hits if h}
    for tier in (False, True):
        unsaved_flags = [
            r not in saved for r in ranked if (by_id[r].category in RAIN_OUTDOOR) is tier
        ]
        assert unsaved_flags == sorted(unsaved_flags), (tier, ranked)


@given(reason=_RANK_REASONS.filter(lambda r: r not in _DEMOTED_BY_REASON))
@settings(max_examples=40, deadline=None)
def test_pbt_rule_ranking_non_weather_reasons_let_nearest_outdoor_come_first(reason) -> None:
    """RANK-P2 반례: weather 아닌 사유에서는 분할이 강제되지 않는다 — 야외가 최근접이면 1위."""
    pool = _pool_at(
        _poi_at("nature-near", PoiCategory.NATURE, 0.001),
        _poi_at("cafe-far", PoiCategory.CAFE, 0.020),
    )
    ranked, note = _rule_ranking((), pool, tuple(p.poi_id for p in pool.pois), reason)
    assert ranked == ("nature-near", "cafe-far")
    assert note == ""  # 강등 0건이면 기록도 없다


@given(case=_anchored_cases(distinct_offsets=True), reason=_RANK_REASONS, data=st.data())
@settings(max_examples=60, deadline=None)
def test_pbt_rule_ranking_is_deterministic_and_independent_of_input_order(
    case, reason, data
) -> None:
    """RANK-P3: 같은 입력 두 번 → 같은 출력. 거리가 전부 다르면 `available` 순서와 무관.

    거리 동률은 안정 정렬의 풀 순서 tie-break 라 순서 독립이 성립하지 않으므로 `assume` 으로
    거른다 — 그 경우는 RANK-P1 이 순열 보존을 따로 보장한다.
    """
    pool, hits, available = case
    distances = [haversine_km(pool.anchor, p.coord) for p in pool.pois]
    assume(len(set(distances)) == len(distances))
    shuffled = tuple(data.draw(st.permutations(available)))

    first = _rule_ranking(hits, pool, available, reason)
    assert first == _rule_ranking(hits, pool, available, reason)
    assert first == _rule_ranking(hits, pool, shuffled, reason)
    assert first == _rule_ranking(hits, pool, tuple(p.poi_id for p in pool.pois), reason)


def test_situation_query_translates_reason_to_korean() -> None:
    """영문 reason 이 질의에 남으면 한국어 KB 문서와 붙지 않는다 (2026-09-01 실측).

    특히 `none` 은 임베딩상 빈 토큰이라 MANUAL/none 질의가 자기 문서를 top6 안에
    한 건도 못 올렸다. 매핑이 빠져도 예외 없이 조용히 검색 품질만 떨어지는
    무증상 회귀라, 질의 문자열 자체를 못 박는다.
    """
    from trippilot.agents.planb.rag import _REASON_KO, _situation_query

    pool = _pool()
    for reason in ("weather", "closed", "delay", "canceled", "fatigue", "none"):
        query = _situation_query(_request(pool, reason=reason))
        assert reason not in query, f"{reason}: 영문 reason 이 질의에 남았다"
        assert _REASON_KO[reason] in query
    # 미지 reason 은 원문 통과 — 계약이 넓어져도 질의가 비지 않는다 (INV-4).
    assert "unknown" in _situation_query(_request(pool, reason="unknown"))
