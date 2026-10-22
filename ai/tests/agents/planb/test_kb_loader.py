"""TRIP-427 — KB seed 로더 + 상황 KB seed 파일 실적재 검증.

증명하는 것 (임베딩·스토어 전부 fake — 실 호출 0, D37):
  ① load_kb_documents — 구조 검증(루트 kb 단일 라벨·doc_id 유일·text 필수·
     poi_ref/metadata 형태), 위반은 KbLoadError로 시끄럽게 (조용한 스킵 금지)
  ② seed 파일(data/planb_situation_kb.yaml) — 파싱·적재 왕복: 전건 SITUATION,
     index_documents 건수 일치, 동일 텍스트 질의로 해당 문서가 1위 회수
     (FakeEmbedding은 동일 텍스트 매칭 전용 — 의미 유사도는 실키 스모크 소관)
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from trippilot.agents.planb.kb_retrieval import (
    KbLoadError,
    index_documents,
    load_kb_documents,
    load_kb_file,
    retrieve,
)
from trippilot.domain.kb import KbKind

_SEED = Path(__file__).resolve().parents[3] / "data" / "planb_situation_kb.yaml"


def _data(**over: object) -> dict:
    data = {
        "kb": "SITUATION",
        "documents": [
            {"doc_id": "d1", "text": "우천 시 실내 대안", "metadata": {"reasons": ["weather"]}},
            {"doc_id": "d2", "text": "휴무 시 인접 대안", "poi_ref": "some-poi"},
        ],
    }
    data.update(over)
    return data


# ── ① 구조 검증 ──────────────────────────────────────────────────────


def test_load_valid_structure() -> None:
    docs = load_kb_documents(_data())
    assert [d.doc_id for d in docs] == ["d1", "d2"]
    assert all(d.kb is KbKind.SITUATION for d in docs)
    assert docs[0].metadata == {"reasons": ["weather"]}
    assert docs[0].poi_ref is None and docs[1].poi_ref == "some-poi"


@pytest.mark.parametrize(
    "broken, match",
    [
        ({"kb": "날씨"}, "kb 라벨"),
        ({"kb": None}, "kb 라벨"),
        ({"documents": []}, "documents"),
        ({"documents": "not-a-list"}, "documents"),
        ({"documents": [{"text": "id 없음"}]}, "doc_id 누락"),
        ({"documents": [{"doc_id": "d", "text": "a"}, {"doc_id": "d", "text": "b"}]}, "중복"),
        ({"documents": [{"doc_id": "d"}]}, "text 누락"),
        ({"documents": [{"doc_id": "d", "text": "   "}]}, "비어있음"),
        ({"documents": [{"doc_id": "d", "text": "a", "poi_ref": 7}]}, "poi_ref"),
        ({"documents": [{"doc_id": "d", "text": "a", "metadata": "x"}]}, "metadata"),
    ],
)
def test_broken_structure_raises_loudly(broken: dict, match: str) -> None:
    with pytest.raises(KbLoadError, match=match):
        load_kb_documents(_data(**broken))


def test_non_mapping_root_raises() -> None:
    with pytest.raises(KbLoadError, match="루트"):
        load_kb_documents(["not", "a", "mapping"])


# ── ② seed 파일 실적재 왕복 ──────────────────────────────────────────


def test_seed_file_loads_and_indexes() -> None:
    docs = load_kb_file(_SEED, yaml.safe_load)
    assert len(docs) >= 10, "상황 KB seed가 빈약함 — 문서 유실 여부 확인"
    assert all(d.kb is KbKind.SITUATION for d in docs)
    embedding, store = FakeEmbedding(dim=32), InMemoryVectorStore()
    assert index_documents(docs, embedding, store) == len(docs)


def test_seed_document_retrievable_by_own_text() -> None:
    docs = load_kb_file(_SEED, yaml.safe_load)
    embedding, store = FakeEmbedding(dim=32), InMemoryVectorStore()
    index_documents(docs, embedding, store)
    target = docs[0]
    hits = retrieve(KbKind.SITUATION, target.text, embedding, store, top_k=3)
    assert hits and hits[0].doc_id == target.doc_id
    assert hits[0].text == target.text  # payload 왕복 보존


# 모델이 후보 줄(`poi_id | 카테고리 | 상호명`)로 판별할 수 **없는** 축. seed 가 이런 축으로
# 고르라고 하면 모델은 상호명 기억으로 지어내고, 그 창작이 게이트 없는 `rationale` 로
# 사용자에게 나간다(seed 헤더 작성 기준 (2)).
#
# **완전한 목록은 불가능하다** — 넓게 잡고 과잉 거부를 감수한다(`edit_translation` 게이트의
# `_TIME_KEY_TOKENS` 와 같은 판단). 여기 걸리면 문서를 카테고리 축으로 고쳐 쓰면 되고,
# 그 비용은 조용히 지어낸 rationale 이 나가는 것보다 훨씬 싸다.
_UNJUDGEABLE_AXES = {
    "거리·좌표": ("가까운 대안", "가까운 곳", "근처 ", "도보 구간", "같은 방향",
                "역방향", "동선", "숙소 방향", "인접 일정", "반경", "km", "미터"),
    # 배치·시각은 어셈블리 소유다 (INV-2) — 워커는 후보만 고른다.
    "시각·순서": ("앞으로 당기", "뒤로 미루", "순서 조정", "시간대를", "여유 시간으로",
                "시 이후로", "분 이내", "먼저 방문"),
    # 풀 영업일 필터가 이미 판다 (기준 1).
    "영업시간": ("영업시간", "오픈 시간", "라스트오더", "마감 시간"),
    # 슬롯 수·체류는 솔버 소유.
    "슬롯·체류": ("슬롯 수를", "체류 시간을", "머무는 시간을"),
    # 프롬프트에 없는 값들.
    "기타": ("입장료", "가격대", "혼잡도", "좌석 수", "대기 시간", "평점", "리뷰 수"),
}


def test_seed_documents_only_use_axes_the_model_can_see() -> None:
    """seed 가 **모델이 볼 수 없는 축**으로 고르라고 하면 안 된다 (작성 기준 2).

    2026-09-12 실측: 25건 중 9건이 거리·시각·슬롯 수·영업시간을 지시하고 있었다. seed 가
    작성 기준보다 먼저 쓰였기 때문이다(TRIP-427 → 기준 TRIP-508). 규칙을 문서로만 두면
    또 어긋나므로 여기서 강제한다.

    거리·동선은 **이중으로** 걸린다 — 모델이 판별 못 하고, 규칙 랭킹이 이미 코드로
    집행한다(`_rule_ranking` 앵커 정렬 · 지시 사전의 `enforced_by: RANKING`).
    """
    docs = load_kb_file(_SEED, yaml.safe_load)
    offenders = [
        (d.doc_id, axis, word)
        for d in docs
        for axis, words in _UNJUDGEABLE_AXES.items()
        for word in words
        if word in d.text
    ]
    assert not offenders, "\n".join(
        f"{doc_id}: {axis} 축 — {word!r}" for doc_id, axis, word in offenders)


def test_unjudgeable_axis_guard_actually_catches_something() -> None:
    """가드가 무력해지지 않았는지 — 위반 문서를 넣으면 실제로 걸려야 한다."""
    bad = "휴무 상황에서는 현재 위치에서 가까운 곳을 우선한다."
    assert any(
        w in bad for words in _UNJUDGEABLE_AXES.values() for w in words)


def test_seed_covers_all_trigger_reasons() -> None:
    """대응 지식이 없는 reason은 검색 컨텍스트가 비어 LLM이 일반론만 하게 된다.

    `none` 이 빠져 있었다(2026-09-01 보강). `AlternativesRequest.reason` 의 **기본값**이
    `"none"` 이라 실제로 가장 자주 타는 경로인데, 그 문서가 전부 지워져도 이 가드는
    초록이었다. 계약(`rag.PlanBRagRequest.reason`)의 6종을 전부 건다.
    """
    docs = load_kb_file(_SEED, yaml.safe_load)
    covered = {r for d in docs for r in d.metadata.get("reasons", ())}
    assert {"weather", "closed", "delay", "canceled", "fully_booked",
            "fatigue", "none"} <= covered


# ── 적재 임베딩 마감 (배포 적재 단계 8초 실패, 2026-10-04) ──────────────────


def _load_kb_module():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[3] / "scripts" / "load_kb.py"
    spec = importlib.util.spec_from_file_location("load_kb_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_적재는_파드의_요청_경로_마감을_쓰지_않는다() -> None:
    """ai 파드 env 에는 요청 경로용 임베딩 마감이 (빈 값으로라도) 들어 있다 — `setdefault` 는
    키가 있으면 안 덮으므로 적재가 기본 5초로 돌았고, 64건 묶음(≈10초)이 첫 묶음에서 끊겼다."""
    load_kb = _load_kb_module()

    for pod_value in ("", "5"):
        env = {"TRIPPILOT_EMBEDDING_TIMEOUT_SEC": pod_value}
        load_kb._use_load_timeout(env)
        assert float(env["TRIPPILOT_EMBEDDING_TIMEOUT_SEC"]) == load_kb.LOAD_TIMEOUT_SEC

    env = {"TRIPPILOT_EMBEDDING_TIMEOUT_SEC": "600"}  # 더 긴 값은 존중한다(느린 로컬 머신)
    load_kb._use_load_timeout(env)
    assert env["TRIPPILOT_EMBEDDING_TIMEOUT_SEC"] == "600"


# ── 재적재 건너뛰기 — 존재가 아니라 내용으로 (Codex 리뷰) ───────────────────


def test_본문이나_payload_가_바뀐_문서는_기적재로_건너뛰지_않는다(monkeypatch) -> None:
    """종전엔 (collection, item_id) **존재**만 봐서, seed 에서 본문을 고쳐도 매 배포 적재가
    "기적재" 로 건너뛰고 옛 벡터·payload 가 영영 남았다. 같은 것만 건너뛴다(재개 이점 유지)."""
    import psycopg

    from tests.fakes.fake_embedding import FakeEmbedding
    from trippilot.agents.planb.kb_retrieval import collection_for
    from trippilot.domain.kb import KbDocument

    load_kb = _load_kb_module()
    embedding = FakeEmbedding(dim=8)
    same = KbDocument(KbKind.SITUATION, "same", "그대로인 본문", None, {"reasons": ["none"]})
    edited = KbDocument(KbKind.SITUATION, "edited", "고친 본문", None, {})
    relabeled = KbDocument(KbKind.SITUATION, "relabeled", "본문 그대로", None, {"reasons": ["delay"]})
    new = KbDocument(KbKind.SITUATION, "new", "새 문서", None, {})
    stored = {  # DB 에 jsonb 로 들어 있던 것 (psycopg 가 dict 로 돌려준다)
        "same": same.payload(),
        "edited": {**edited.payload(), "text": "고치기 전 본문"},
        "relabeled": {**relabeled.payload(), "metadata": {"reasons": ["weather"]}},
    }

    class _Conn:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, sql, params):
            collection, ids = params
            assert collection == collection_for(KbKind.SITUATION, embedding.model_id)
            rows = [(i, stored[i]) for i in ids if i in stored]
            return type("Rows", (), {"fetchall": lambda self: rows})()

    monkeypatch.setattr(psycopg, "connect", lambda url: _Conn())
    fresh = load_kb._skip_already_indexed([same, edited, relabeled, new], embedding, "fake")
    assert [d.doc_id for d in fresh] == ["edited", "relabeled", "new"]


# ── KB-5 원천 조각 적재 (2026-10-18 청킹) ─────────────────────────────────────────

def _rows(n_docs: int, sentences: int = 30):
    return [{"doc_id": f"wiki:{i}", "poi_ref": str(i), "license": "CC BY-SA 4.0",
             "sections": [{"heading": "개요", "text": " ".join(f"{i}번 장소 문장 {k}이다." for k in range(sentences))}]}
            for i in range(n_docs)]


class _CountingEmbedding:
    """FakeEmbedding + 호출 수 세기 + 호출마다 가짜 시계를 민다(예산이 **실제 일**로 닳게)."""

    def __init__(self, clock=None, per_call: float = 0.0) -> None:
        from tests.fakes.fake_embedding import FakeEmbedding

        self._inner, self.calls, self.texts = FakeEmbedding(dim=8), 0, 0
        self.model_id, self.dim = self._inner.model_id, 8
        self._clock, self._per_call = clock, per_call

    def embed(self, text):
        return self._inner.embed(text)

    def embed_batch(self, texts):
        self.calls += 1
        self.texts += len(texts)
        if self._clock is not None:
            self._clock[0] += self._per_call
        return self._inner.embed_batch(texts)


def test_corpus_load_stops_on_real_work_at_document_boundaries(monkeypatch) -> None:
    from tests.fakes.in_memory_vector_store import InMemoryVectorStore
    from trippilot.poi_curation.chunking import chunk_corpus

    load_kb = _load_kb_module()
    docs = chunk_corpus(_rows(6))
    clock = [0.0]
    monkeypatch.setattr("time.monotonic", lambda: clock[0])
    # 임베딩 요청은 문서 경계에서 INDEX_BATCH 를 채울 때 나간다 — 문서 하나(조각 3)마다 나가게 맞춘다
    monkeypatch.setattr("trippilot.agents.planb.kb_retrieval.INDEX_BATCH", 3)
    emb = _CountingEmbedding(clock, per_call=10.0)  # 임베딩 한 번에 10초
    count, done, embedded = load_kb._index_corpus(docs, emb, InMemoryVectorStore(), budget_sec=25)
    per_doc = len(docs) // 6
    assert embedded == count and emb.texts == count
    assert count % per_doc == 0 and 0 < count < len(docs)  # 일부만 — 그리고 문서가 반쯤 들어간 게 없다
    assert len(done) == count // per_doc


def _corpus_file(tmp_path, rows, *, vectors_for=None, emb=None):
    import gzip
    import json

    from trippilot.poi_curation.chunking import chunk_corpus, dump_chunk_vectors, vectors_path

    p = tmp_path / "place_corpus_wiki.jsonl.gz"
    with gzip.open(p, "wt", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    if vectors_for is not None:
        docs = chunk_corpus(vectors_for)
        dump_chunk_vectors(vectors_path(p), docs, emb.model_id, [emb.embed(d.text) for d in docs])
    return p


def test_precomputed_vectors_are_used_and_only_changed_chunks_are_embedded(tmp_path) -> None:
    from tests.fakes.in_memory_vector_store import InMemoryVectorStore
    from trippilot.agents.planb.kb_retrieval import collection_for
    from trippilot.domain.kb import KbKind

    load_kb = _load_kb_module()
    emb = _CountingEmbedding()
    rows = _rows(3)
    edited = [*rows[:2], {**rows[2], "sections": [{"heading": "개요", "text": "바뀐 본문이다. 새 문장이다."}]}]
    p = _corpus_file(tmp_path, edited, vectors_for=rows, emb=emb)  # 벡터는 바뀌기 전 원천으로 만들었다
    docs = load_kb._documents_of(p)
    store = InMemoryVectorStore()
    line = load_kb.load_corpus(p, docs, list(docs), emb, store)
    changed = [d for d in docs if d.doc_id.startswith("wiki:2#")]
    assert emb.texts == len(changed), line  # 바뀐 문서의 조각만 원격 임베딩
    assert f"원격 임베딩 {len(changed)}건" in line
    coll = collection_for(KbKind.POI_DESC, emb.model_id)
    assert {h.item_id for h in store.search(coll, emb.embed("x"), 10_000)} == {d.doc_id for d in docs}


def test_vectors_from_another_model_are_not_used(tmp_path) -> None:
    from tests.fakes.in_memory_vector_store import InMemoryVectorStore

    load_kb = _load_kb_module()
    emb = _CountingEmbedding()
    other = _CountingEmbedding()
    other.model_id = "other-model"
    p = _corpus_file(tmp_path, _rows(1), vectors_for=_rows(1), emb=other)
    docs = load_kb._documents_of(p)
    line = load_kb.load_corpus(p, docs, list(docs), emb, InMemoryVectorStore())
    assert emb.texts == len(docs) and "미리 계산 벡터 미사용" in line


def test_reload_removes_legacy_rows_stale_tail_chunks_and_rows_outside_the_corpus(tmp_path) -> None:
    from tests.fakes.in_memory_vector_store import InMemoryVectorStore
    from trippilot.agents.planb.kb_retrieval import collection_for
    from trippilot.domain.kb import KbKind

    load_kb = _load_kb_module()
    emb = _CountingEmbedding()
    store = InMemoryVectorStore()
    coll = collection_for(KbKind.POI_DESC, emb.model_id)
    for legacy in ("wiki:0", "wiki:9", "wiki:9#0", "wiki:0#39"):  # 옛 통문서 · 코퍼스 밖 장소 · 낡은 꼬리 조각
        store.upsert(coll, legacy, emb.embed(legacy), {"kb": "POI_DESC", "text": legacy})
    store.upsert(coll, "intro:5", emb.embed("i"), {"kb": "POI_DESC", "text": "i"})  # 다른 출처는 손대지 않는다
    p = _corpus_file(tmp_path, _rows(2))
    docs = load_kb._documents_of(p)
    load_kb.load_corpus(p, docs, list(docs), emb, store)
    left = {h.item_id for h in store.search(coll, emb.embed("x"), 10_000)}
    assert left == {d.doc_id for d in docs} | {"intro:5"}


def test_unchanged_reload_sends_no_ids_to_delete(tmp_path) -> None:
    """정리는 저장소에 **실제로 있는** 행 중에서 고른다 — 끝난 문서마다 꼬리 id(#n..#39)를 펼치면 관광공사 개요 전량에서
    약 95만 개 id 를 만들어 매 배포 DELETE 로 보냈다(적재 Job 피크 480MB 중 약 126MB, 한도 512Mi)."""
    from tests.fakes.in_memory_vector_store import InMemoryVectorStore

    class _Spy(InMemoryVectorStore):
        def __init__(self) -> None:
            super().__init__()
            self.deleted: list[int] = []

        def delete_many(self, collection, item_ids):
            self.deleted.append(len(list(item_ids)))
            return super().delete_many(collection, item_ids)

    load_kb = _load_kb_module()
    emb, store = _CountingEmbedding(), _Spy()
    p = _corpus_file(tmp_path, _rows(3))
    docs = load_kb._documents_of(p)
    load_kb.load_corpus(p, docs, list(docs), emb, store)
    store.deleted.clear()
    line = load_kb.load_corpus(p, docs, list(docs), emb, store)
    assert sum(store.deleted) == 0, (store.deleted, line)


def test_cleanup_covers_every_source_in_one_corpus_file(tmp_path) -> None:
    """한 파일에 출처가 둘 이상 섞여도 뒤쪽 출처의 통문서·낡은 꼬리를 지운다 — 첫 문서의 접두사만 보던 회귀(리뷰 2026-10-22)."""
    from tests.fakes.in_memory_vector_store import InMemoryVectorStore
    from trippilot.agents.planb.kb_retrieval import collection_for
    from trippilot.domain.kb import KbKind

    load_kb = _load_kb_module()
    emb, store = _CountingEmbedding(), InMemoryVectorStore()
    coll = collection_for(KbKind.POI_DESC, emb.model_id)
    for legacy in ("overview:1", "overview:1#39"):
        store.upsert(coll, legacy, emb.embed(legacy), {"kb": "POI_DESC", "text": legacy})
    over = {**_rows(2)[1], "doc_id": "overview:1"}
    p = _corpus_file(tmp_path, [_rows(1)[0], over])
    docs = load_kb._documents_of(p)
    load_kb.load_corpus(p, docs, list(docs), emb, store)
    left = {h.item_id for h in store.search(coll, emb.embed("x"), 10_000)}
    assert left == {d.doc_id for d in docs}, left - {d.doc_id for d in docs}


def test_partial_load_keeps_the_legacy_row_of_pending_documents(tmp_path, monkeypatch) -> None:
    from tests.fakes.in_memory_vector_store import InMemoryVectorStore
    from trippilot.agents.planb.kb_retrieval import collection_for
    from trippilot.domain.kb import KbKind

    load_kb = _load_kb_module()
    clock = [0.0]
    monkeypatch.setattr("time.monotonic", lambda: clock[0])
    monkeypatch.setattr("trippilot.agents.planb.kb_retrieval.INDEX_BATCH", 3)
    emb = _CountingEmbedding(clock, per_call=10.0)
    store = InMemoryVectorStore()
    coll = collection_for(KbKind.POI_DESC, emb.model_id)
    for i in range(6):
        store.upsert(coll, f"wiki:{i}", emb.embed(str(i)), {"kb": "POI_DESC", "text": str(i)})
    # 예산에 걸린 적재에서도 **끝난 문서**의 낡은 꼬리 조각은 지운다(코퍼스 밖 정리는 미완료라 안 돈다)
    store.upsert(coll, "wiki:0#39", emb.embed("old"), {"kb": "POI_DESC", "text": "old"})
    p = _corpus_file(tmp_path, _rows(6))
    docs = load_kb._documents_of(p)
    line = load_kb.load_corpus(p, docs, list(docs), emb, store, budget_sec=15)
    left = {h.item_id for h in store.search(coll, emb.embed("x"), 10_000)}
    loaded = {d.doc_id.split("#")[0] for d in docs if d.doc_id in left}
    assert loaded and len(loaded) < 6 and "다음 배포로" in line
    assert all(f"wiki:{i}" in left for i in range(6) if f"wiki:{i}" not in loaded)  # 아직 조각 없는 곳은 통문서 유지
    assert not any(b in left for b in loaded)  # 조각이 다 들어간 곳의 통문서는 지웠다
    assert "wiki:0" in loaded and "wiki:0#39" not in left


def test_default_seeds_exist_in_the_repo_and_load_the_chunk_corpus() -> None:
    from pathlib import Path

    load_kb = _load_kb_module()
    root = Path(__file__).resolve().parents[3]
    assert "data/place_corpus_wiki.jsonl.gz" in load_kb._DEFAULT_SEEDS
    missing = [s for s in load_kb._DEFAULT_SEEDS if not (root / s).is_file()]
    assert missing == [], "기본 seed 가 리포에 없다 — 배포 KB 적재 Job 이 매번 죽는다"
    assert len(load_kb._documents_of(root / "data/place_corpus_wiki.jsonl.gz")) > 5_000


def test_committed_place_vectors_cover_the_corpus() -> None:
    """코퍼스·청킹 규칙을 바꾸고 벡터를 다시 안 만들면 배포 적재가 그 조각을 운영 임베딩 파드로 돌린다(수 시간)."""
    from pathlib import Path

    from trippilot.poi_curation.chunking import load_chunk_vectors, text_hash, vectors_path

    load_kb = _load_kb_module()
    corpus = Path(__file__).resolve().parents[3] / "data/place_corpus_wiki.jsonl.gz"
    loaded = load_chunk_vectors(vectors_path(corpus))
    assert loaded is not None, "scripts/collect/build_place_vectors.py 로 만든다"
    assert loaded.model == "nlpai-lab/KURE-v1" and loaded.dim == 1024
    stale = [d.doc_id for d in load_kb._documents_of(corpus) if loaded.hash_of(d.doc_id) != text_hash(d.text)]
    assert stale == [], f"벡터가 낡은 조각 {len(stale)}개 — build_place_vectors.py 를 다시 돌려라"
