"""KB-5 장소 지식 청킹 — 문장 단위 조각 + 맞은 조각 보여 주기 (2026-10-18)."""

from __future__ import annotations

from datetime import datetime, timezone

from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from trippilot.agents.planb.kb_retrieval import index_documents
from trippilot.agents.planb.place_knowledge import MAX_DOC_CHARS, fetch_place_knowledge
from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.poi_curation import chunking as c

_S = "성산일출봉은 제주도 동쪽 끝의 화산이다."
# 160자를 넘는 한 조각 — 표시 상한이 조각을 자르지 않는지 본다.
_RAIN = ("비가 오면 정상까지 오르는 나무 계단이 미끄러워 탐방로 일부가 통제되고, 강풍 특보가 내려지면 정상부 출입이 전면 "
         "금지된다. 이런 날에는 우뭇개 해안 쪽 해녀의 집이나 매표소 옆 성산일출봉 홍보관을 먼저 둘러보는 편이 낫다고 "
         "관리소는 안내한다. 매표소 앞 주차장은 비가 와도 평소처럼 운영된다.")


def test_sentences_split_on_end_marks_not_on_decimals() -> None:
    assert c.split_sentences("높이는 182.5m 이다. 길이는 3.5km 다! 정말?  그렇다.") == [
        "높이는 182.5m 이다.", "길이는 3.5km 다!", "정말?", "그렇다."]


def test_chunks_follow_sentence_boundaries_overlap_one_sentence_and_stay_under_the_cap() -> None:
    sentences = [f"{i}번째 문장은 성산일출봉의 서로 다른 사실 하나를 말한다." for i in range(12)]
    chunks = c.chunk_section(" ".join(sentences))
    assert len(chunks) >= 3
    assert all(len(x) <= c.MAX_CHARS for x in chunks)
    assert all(x.endswith(".") for x in chunks)  # 문장 중간에서 안 잘린다
    for a, b in zip(chunks, chunks[1:]):
        assert b.startswith(c.split_sentences(a)[-1])  # 앞 조각의 마지막 문장이 다음 조각 첫 문장
    covered = " ".join(chunks)
    assert all(s in covered for s in sentences)  # 빠지는 문장이 없다


def test_a_sentence_longer_than_the_cap_is_split_on_spaces() -> None:
    chunks = c.chunk_section("가나다 " * 200)
    assert chunks and all(len(x) <= c.MAX_CHARS for x in chunks)
    # 공백 없이 쉼표로만 이어진 목록(실측 '동물원' 절 400자)도 상한을 넘지 않는다
    listing = c.chunk_section(",".join(["붉은여우"] * 120))
    assert listing and all(len(x) <= c.MAX_CHARS for x in listing)


def test_document_chunks_carry_section_heading_stable_ids_and_the_cap() -> None:
    row = {"doc_id": "wiki:123", "poi_ref": "123", "title": "성산일출봉", "url": "u", "license": "CC BY-SA 4.0",
           "sections": [{"heading": "개요", "text": _S},
                        {"heading": "관람", "text": "매표소는 07:00 에 연다. 비가 오면 계단이 미끄럽다."}]}
    docs = c.chunk_document(row)
    assert [d.doc_id for d in docs] == ["wiki:123#0", "wiki:123#1"]
    assert docs[1].text.startswith("관람: ") and docs[1].poi_ref == "123"
    assert docs[1].metadata["section"] == "관람" and docs[1].metadata["license"] == "CC BY-SA 4.0"
    assert c.chunk_document(row) == docs  # 결정론 — 재적재가 같은 id·본문을 낸다
    many = {**row, "sections": [{"heading": f"절{i}", "text": _S} for i in range(c.MAX_CHUNKS_PER_DOC + 5)]}
    assert len(c.chunk_document(many)) == c.MAX_CHUNKS_PER_DOC
    assert c.base_ids(docs) == {"wiki:123"}


# ── 검색 — 장소마다 **맞은 조각**이 붙는다 ──────────────────────────────

class _RainEmbedding:
    """'비'가 든 글은 한 축, 아니면 다른 축 — 의미 유사도를 결정론으로 흉내 낸다."""

    model_id, dim = "fake-rain", 2

    def embed(self, text: str) -> tuple[float, ...]:
        return (1.0, 0.0) if "비" in text else (0.0, 1.0)

    def embed_batch(self, texts):
        return tuple(self.embed(t) for t in texts)


def _poi(ref: str) -> Poi:
    return Poi(poi_id=PoiId(f"p-{ref}"), name="성산일출봉", category=PoiCategory.NATURE,
               coord=GeoPoint(33.45, 126.94), open_hours=(), avg_cost=None, rating=None,
               quality=DataQuality.FULL, source=PoiSource.SEED, confidence=None, source_ref=ref)


def test_the_chunk_that_matches_the_situation_is_shown_not_the_opening() -> None:
    row = {"doc_id": "wiki:123", "poi_ref": "123",
           "sections": [{"heading": "개요", "text": _S + " 높이는 182m 이다."},
                        {"heading": "관람", "text": _RAIN}]}
    embedding, store = _RainEmbedding(), InMemoryVectorStore()
    index_documents(c.chunk_document(row), embedding, store)
    got, note = fetch_place_knowledge([_poi("123")], "비 오는 날 상황", embedding, store)
    assert note == ""
    # 종전엔 앞 160자(개요)가 붙었다 — 이제 맞은 조각, 그 앞에 "이곳이 무엇인지" 말하는 도입부 첫 문장(2026-10-19 실측)
    head = c.split_sentences(_S)[0][:100]
    assert got["123"].startswith(f"{head} … {_RAIN[:40]}"), got
    assert "관람: " not in got["123"]  # 절 제목은 떼고 본문만 잇는다
    assert 160 < len(got["123"]) <= MAX_DOC_CHARS
    got, _ = fetch_place_knowledge([_poi("123")], "맑은 날 상황", embedding, store)
    assert got["123"].startswith("개요: ")


def test_legacy_whole_document_still_serves_until_its_chunks_arrive() -> None:
    """배포 롤아웃 직후·적재 예산에 밀린 문서 — 조각이 아직 없으면 옛 통문서가 붙는다(리뷰: 빼면 KB-5 가 빈다).
    조각이 들어오면 더 맞는 쪽이 이긴다(적재가 끝난 문서의 통문서는 `load_kb` 가 지운다)."""
    from trippilot.poi_curation.place_docs import make_doc
    embedding, store = _RainEmbedding(), InMemoryVectorStore()
    index_documents([make_doc("wiki", "123", "맑은 날 옛 통문서다. 성산일출봉은 화산이다.")], embedding, store)
    got, _ = fetch_place_knowledge([_poi("123")], "비 오는 날", embedding, store)
    assert got["123"].startswith("맑은 날 옛 통문서다")
    index_documents(c.chunk_document({"doc_id": "wiki:123", "poi_ref": "123",
                                      "sections": [{"heading": "관람", "text": _RAIN}]}), embedding, store)
    got, _ = fetch_place_knowledge([_poi("123")], "비 오는 날", embedding, store)
    assert got["123"].startswith("관람: 비가 오면")


def test_closing_quotes_stay_and_quoted_periods_do_not_split() -> None:
    assert c.split_sentences('그는 "좋다." 라고 말했다. 이곳은 "작은 섬." 이라는 별명이 있다. 끝.') == [
        '그는 "좋다." 라고 말했다.', '이곳은 "작은 섬." 이라는 별명이 있다.', "끝."]
    assert c.split_sentences("(1990년 지정.) 다음 문장이다.") == ["(1990년 지정.)", "다음 문장이다."]


def test_chunk_vectors_round_trip_and_hash_changes_with_text(tmp_path) -> None:
    docs = c.chunk_document({"doc_id": "wiki:1", "poi_ref": "1", "sections": [{"heading": "개요", "text": _S}]})
    p = tmp_path / "x.vectors.json.gz"
    c.dump_chunk_vectors(p, docs, "m", [(0.5, -0.25)], provenance={"engine": "t"})
    v = c.load_chunk_vectors(p)
    assert (v.model, v.dim, len(v)) == ("m", 2, 1)
    assert v.hash_of(docs[0].doc_id) == c.text_hash(docs[0].text) and v.vector(docs[0].doc_id) == (0.5, -0.25)
    assert v.hash_of("wiki:404#0") is None
    assert c.text_hash(docs[0].text) != c.text_hash(docs[0].text + " ")
    assert c.vectors_path(tmp_path / "place_corpus_wiki.jsonl.gz").name == "place_corpus_wiki.vectors.json.gz"


def test_overview_uses_its_own_longer_chunk_size_and_wiki_keeps_the_default() -> None:
    """관광공사 개요는 300자 목표·400 상한(벡터 파일이 GitHub 상한 안에 들어가게, 표시 상한 300자와 같게) —
    같은 본문이라도 위키는 종전 200·280 그대로다(2026-10-19)."""
    body = " ".join(f"이곳은 {i}번째로 소개하는 볼거리이며 주변 경관이 아름답고 계절마다 다른 모습을 보여 준다." for i in range(12))
    over = c.chunk_document({"doc_id": "overview:1", "poi_ref": "1", "sections": [{"heading": "개요", "text": body}]})
    wiki = c.chunk_document({"doc_id": "wiki:1", "poi_ref": "1", "sections": [{"heading": "개요", "text": body}]})
    assert all(len(d.text) - len("개요: ") <= 400 for d in over)
    assert all(len(d.text) - len("개요: ") <= c.MAX_CHARS for d in wiki)
    assert len(over) < len(wiki)
    assert max(len(d.text) - len("개요: ") for d in over) > c.TARGET_CHARS + 40  # 실제로 더 긴 조각을 만든다


def test_vectors_are_written_as_a_small_header_and_a_separate_binary_body(tmp_path) -> None:
    """본체를 base64 로 머리 JSON 에 넣으면 읽을 때 파일 크기의 6배 넘게 쓴다(70MB → 454MB, 2026-10-20) —
    머리와 fp16 본체를 따로 쓰고, 옛 한 파일 형식도 계속 읽는다."""
    import base64
    import gzip
    import json
    import struct

    docs = c.chunk_document({"doc_id": "wiki:1", "poi_ref": "1", "sections": [{"heading": "개요", "text": _S}]})
    p = tmp_path / "x.vectors.json.gz"
    c.dump_chunk_vectors(p, docs, "m", [(0.5, -0.25)])
    head = json.loads(gzip.decompress(p.read_bytes()))
    assert "f16_b64" not in head and (tmp_path / head["f16"]).exists()
    assert c.load_chunk_vectors(p).vector(docs[0].doc_id) == (0.5, -0.25)
    old = tmp_path / "old.vectors.json.gz"
    old.write_bytes(gzip.compress(json.dumps({**head, "f16": None, "f16_b64": base64.b64encode(
        struct.pack("<2e", 0.5, -0.25)).decode()}).encode()))
    assert c.load_chunk_vectors(old).vector(docs[0].doc_id) == (0.5, -0.25)


def test_large_vector_bodies_are_split_into_shards_under_the_file_limit(tmp_path, monkeypatch) -> None:
    """관광공사 개요 전량(약 5만 조각)이면 fp16 본체가 100MB 안팎 — GitHub 파일 한도(100MB, LFS 없음)에 닿는다.
    본체를 조각 수로 나눠 쓰고, 다시 쓸 때 줄어든 몫의 옛 파일은 지운다(이미지에 낡은 파일이 구워지지 않게)."""
    import gzip
    import json

    monkeypatch.setattr(c, "F16_SHARD_CHUNKS", 2)
    docs = [c.chunk_document({"doc_id": f"wiki:{i}", "poi_ref": str(i),
                              "sections": [{"heading": "개요", "text": _S}]})[0] for i in range(5)]
    vecs = [(i / 8, -i / 8) for i in range(5)]
    p = tmp_path / "x.vectors.json.gz"
    c.dump_chunk_vectors(p, docs, "m", vecs)
    head = json.loads(gzip.decompress(p.read_bytes()))
    assert head["f16"] == ["x.vectors.f16.0.gz", "x.vectors.f16.1.gz", "x.vectors.f16.2.gz"]
    v = c.load_chunk_vectors(p)
    assert [v.vector(d.doc_id) for d in docs] == vecs
    c.dump_chunk_vectors(p, docs[:1], "m", vecs[:1])  # 한 몫이면 종전 이름 하나 — 위키 파일은 그대로다
    assert json.loads(gzip.decompress(p.read_bytes()))["f16"] == "x.vectors.f16.gz"
    assert sorted(f.name for f in tmp_path.iterdir()) == ["x.vectors.f16.gz", "x.vectors.json.gz"]


def test_empty_vectors_still_round_trip(tmp_path) -> None:
    """빈 코퍼스도 머리·본체를 쓰고 0건으로 읽힌다 — 나눠 쓰기 간격이 0 이 되어 죽던 회귀(리뷰 2026-10-22)."""
    p = tmp_path / "x.vectors.json.gz"
    c.dump_chunk_vectors(p, [], "m", [])
    assert len(c.load_chunk_vectors(p)) == 0

