"""KB-5 장소 지식 — 풀 전원 조회와 문서 조립 (TRIP 장소 지식).

증명하는 것 (실 LLM·실 벡터·실 API 0):
  ① 풀 밖 POI 의 문서는 안 온다 — 검색이 `item_ids` 로 좁혀진다 (INV-1)
  ② 문서가 없는 후보는 칸 자체가 안 생긴다 — 빈 칸을 결격으로 읽지 않게
  ③ `source_ref` 가 없으면 조용히 문서 없이 돈다 (캐시 과도기)
  ④ 스토어가 죽어도 예외가 안 올라온다 — 사유만 남는다 (INV-4)
  ⑤ INV-3 — 소요시간 필드는 문서에 안 들어간다
"""

from __future__ import annotations

from datetime import datetime, timezone

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from trippilot.agents.planb.kb_retrieval import index_documents
from trippilot.agents.planb.place_knowledge import fetch_place_knowledge
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.kb import KbKind
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.llm_gateway.workers.alternative_selection import (
    AlternativeSelectionInput,
    build_alternative_selection_vars,
)
from trippilot.poi_curation.place_docs import intro_text, make_doc

_NOW = datetime(2026, 9, 19, tzinfo=timezone.utc)


def _poi(pid: str, name: str, ref: str | None) -> Poi:
    return Poi(
        poi_id=PoiId(pid), name=name, category=PoiCategory.SIGHT,
        coord=GeoPoint(37.28, 127.01), open_hours=(), avg_cost=None, rating=None,
        quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None, source_ref=ref,
    )


def _wired(*docs):
    embedding, store = FakeEmbedding(), InMemoryVectorStore()
    if docs:
        index_documents(docs, embedding, store)
    return embedding, store


# ── ① 풀 밖은 안 온다 ────────────────────────────────────────────────


def test_documents_outside_the_pool_never_come_back() -> None:
    """풀 밖 POI 의 문서가 올라오면 모델에게 닫힌 집합 밖을 권하는 셈이다 (INV-1).

    게이트가 뒤에서 잡긴 하지만, 잡히기 전에 **프롬프트에 실린다**는 게 문제다 —
    모델이 그걸 읽고 그쪽으로 기운 다음 드롭되면 호출 한 번이 통째로 버려진다.
    """
    inside = make_doc("wiki", "ref-in", "수원 화성은 경기도 수원시에 있는 성곽이다.")
    outside = make_doc("wiki", "ref-out", "풀 밖 장소에 대한 아주 긴 설명 문서입니다.")
    embedding, store = _wired(inside, outside)

    got, note = fetch_place_knowledge(
        [_poi("p1", "수원화성", "ref-in")], "우천 상황", embedding, store
    )

    assert note == ""
    assert set(got) == {"ref-in"}, "풀 밖 문서가 올라왔다"


# ── ② 없는 칸은 안 만든다 ────────────────────────────────────────────


def test_candidate_without_a_document_gets_no_empty_column() -> None:
    """문서 없는 후보에 빈 칸을 남기면 모델이 그 공백을 결격으로 읽는다.

    원천 커버리지가 균일하지 않아(위키백과 실측 문화 25% ↔ 카페 2.5%) 문서 없는
    후보가 다수인 구간이 **정상**이다. 그걸 결격으로 보이게 하면 안 된다.
    """
    pois = (_poi("p1", "수원화성", "ref-in"), _poi("p2", "이름없는곳", "ref-none"))
    pool = CandidatePool(
        poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=_NOW
    )
    inp = AlternativeSelectionInput(
        trigger_kind="WEATHER", reason="weather",
        schedule_context="", situation_context="", persona_context="",
        max_alternatives=3, place_knowledge={"ref-in": "성곽이다."},
    )

    lines = build_alternative_selection_vars(pool, inp)["candidates"].splitlines()

    assert lines[0].endswith("| 성곽이다.")
    assert lines[1].endswith("| 이름없는곳"), "빈 칸이 생겼다"


# ── ③④ 없어도·죽어도 돈다 ───────────────────────────────────────────


def test_pois_without_source_ref_just_get_no_documents() -> None:
    """`source_ref` 가 없으면 조인 키가 없다 — 조용히 문서 없이 돈다.

    백엔드가 그 필드를 안 실어 보내던 시절의 캐시 항목이 TTL(24시간) 동안 섞인다.
    """
    embedding, store = _wired(make_doc("wiki", "ref-in", "긴 설명 문서가 여기 있습니다."))

    got, note = fetch_place_knowledge(
        [_poi("p1", "옛 캐시", None)], "우천 상황", embedding, store
    )

    assert got == {} and note == ""


def test_store_failure_degrades_instead_of_raising() -> None:
    """장소 지식은 부가 정보다 — 없으면 종전대로 도는 것이 정상이지 실패가 아니다.

    다만 **침묵하지 않는다**(INV-4): 사유를 돌려주고 호출측이 notes 에 남긴다.
    """
    class _Dead:
        def search(self, *a, **k):
            raise RuntimeError("vector store down")

    got, note = fetch_place_knowledge(
        [_poi("p1", "수원화성", "ref-in")], "우천 상황", FakeEmbedding(), _Dead()
    )

    assert got == {}
    assert "place_knowledge_unavailable" in note


# ── ⑤ INV-3 ─────────────────────────────────────────────────────────


def test_duration_fields_never_reach_the_document() -> None:
    """소요시간은 어느 경로로도 나가지 않는다 (INV-3).

    문서에 있으면 모델이 인용하고, 그 문장이 사용자 노출 `reason` 으로 나간다.
    """
    text = intro_text("국립중앙박물관", "문화시설", {
        "usefee": "무료", "spendtime": "2시간", "parkingculture": "가능",
    })

    assert "2시간" not in text and "spendtime" not in text
    assert "무료" in text  # 다른 필드는 살아 있다 — 통째로 막은 게 아니다


# ── ⑥ 상한 절단은 조용히 일어나지 않는다 (INV-4) ────────────────────────


def test_상한을_넘으면_절단을_노트로_남긴다() -> None:
    """상한 위에서는 문서를 받는 후보와 못 받는 후보가 **유사도 순**으로 갈린다.

    이 모듈이 없애려던 편향이 거기서 되살아난다. 없앨 수 없으니 보이게 한다 —
    노트가 없으면 "문서 커버리지가 원래 낮다"와 "우리가 잘랐다"가 구별되지 않는다.
    """
    from trippilot.agents.planb.place_knowledge import MAX_DOCS

    n = MAX_DOCS + 5
    docs = [make_doc("wiki", f"ref-{i}", f"{i}번 장소는 경기도 수원시에 있는 곳이다.")
            for i in range(n)]
    embedding, store = _wired(*docs)
    pois = tuple(_poi(f"p{i}", f"장소{i}", f"ref-{i}") for i in range(n))
    pool = CandidatePool(
        poi_ids=frozenset(p.poi_id for p in pois), pois=pois, generated_at=_NOW
    )

    got, note = fetch_place_knowledge(pool.pois, "우천 상황", embedding, store)

    assert len(got) == MAX_DOCS  # 예산은 지킨다
    assert note.startswith("place_knowledge_truncated:")
    assert f"{MAX_DOCS}곳 채택" in note


def test_상한_이내면_노트가_없다() -> None:
    """정상 경로에 노트가 붙으면 소비 측이 장애로 읽는다 (`_cut` 과 같은 규율)."""
    docs = [make_doc("wiki", f"ref-{i}", f"{i}번 장소는 경기도 수원시에 있는 곳이다.")
            for i in range(3)]
    embedding, store = _wired(*docs)
    pois = tuple(_poi(f"p{i}", f"장소{i}", f"ref-{i}") for i in range(3))

    got, note = fetch_place_knowledge(pois, "우천 상황", embedding, store)

    assert len(got) == 3
    assert note == ""


# ── ⑦ 호출측이 준 벡터를 쓰면 다시 임베딩하지 않는다 ──────────────────────


class _CountingEmbedding:
    """embed 호출 횟수를 세는 래퍼 — FakeEmbedding 에는 카운터가 없다.

    `hasattr` 로 세는 척하면 단언이 조용히 무동작이 된다(실제로 한 번 그렇게 썼다).
    """

    def __init__(self, inner) -> None:
        self._inner, self.embed_calls = inner, 0
        self.dim, self.model_id = inner.dim, inner.model_id

    def embed(self, text: str):
        self.embed_calls += 1
        return self._inner.embed(text)

    def embed_batch(self, texts):
        return self._inner.embed_batch(texts)


def test_벡터를_받으면_질의를_다시_임베딩하지_않는다() -> None:
    """단건 임베딩 실측 168ms — KB 넷이 각자 부르면 0.67초가 예산에서 그냥 나간다."""
    doc = make_doc("wiki", "ref-1", "수원 화성은 경기도 수원시에 있는 성곽이다.")
    embedding, store = _wired(doc)
    spy = _CountingEmbedding(embedding)
    pois = (_poi("p1", "수원화성", "ref-1"),)
    vector = embedding.embed("우천 상황")  # 스파이 밖에서 미리 만든다

    got, _ = fetch_place_knowledge(pois, "우천 상황", spy, store, vector=vector)

    assert got  # 벡터를 넘겨도 검색은 정상 동작한다
    assert spy.embed_calls == 0  # 한 번도 다시 임베딩하지 않았다


def test_벡터를_안_주면_스스로_임베딩한다() -> None:
    """생략 가능한 인자라 기존 호출이 깨지면 안 된다 — 옛 경로가 그대로 도는지."""
    doc = make_doc("wiki", "ref-1", "수원 화성은 경기도 수원시에 있는 성곽이다.")
    embedding, store = _wired(doc)
    spy = _CountingEmbedding(embedding)

    got, _ = fetch_place_knowledge(
        (_poi("p1", "수원화성", "ref-1"),), "우천 상황", spy, store
    )

    assert got
    assert spy.embed_calls == 1
