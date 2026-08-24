"""smoke_planb 순수 로직 검증 — 실 호출 0건 (fake만, D37) (TRIP-507).

스크립트 본체(scripts/smoke_planb.py)는 pytest 대상이 아니다 — 실 pgvector·실 LLM은
사람이 손으로 실행할 때만 붙는다. 그 대신 **스크립트가 소유한 순수 로직**과, 스모크
단언들이 딛고 있는 **구조적 전제**를 여기서 fake 데이터로만 고정한다:

  ① `build_pool`     — 지역 필터·실내 우선·상한 8·부족 시 명시 실패
  ② `kb_documents`   — doc_id 유일·kb 라벨·풀 밖 참조 1건(INV-1 음성 픽스처)
  ③ `HashEmbedding`  — 결정론·1024차원(BR-AF-09)·서로 다른 텍스트 분리
  ④ **단언 공허성 회귀 방지** — 저장 장소를 풀 **하위**에서 뽑아 커플링을 끊었다.
     풀 상위와 겹치면 "KB-2 가 상위 2순위" 단언이 KB 검색 전멸에도 통과하므로,
     겹치지 않음을 속성으로 못 박는다. 검색이 죽으면 상위 2가 실제로 달라진다.
  ⑤ 폴백 사유 구분 — 게이트 드롭(③ 시나리오)과 LLM 장애(④ 시나리오)가 서로 다른
     노트를 남긴다. 한쪽 단언이 다른 쪽까지 삼키면 시나리오가 초록인 채 죽는다.

**실 호출 0건**: 벡터 스토어는 InMemoryVectorStore(fake), LLM은 스크립트가 가진
스텁(CannedLlm·FailingLlm), 임베딩은 HashEmbedding. psycopg·anthropic·openai는
import조차 되지 않는다. 시각은 tz-aware 고정값만 쓴다 (datetime.now 금지).
"""

from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from trippilot.agents.planb.kb_retrieval import index_documents
from trippilot.agents.planb.rag import PlanBRagRequest
from trippilot.domain.common import GeoPoint, PoiId, ScheduleId, TraceId
from trippilot.domain.kb import KbKind
from trippilot.domain.llm import CandidatePool
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.domain.prompt import PromptRef
from trippilot.domain.trigger import TriggerKind, TriggerParams
from trippilot.ports.llm_port import LlmRequest

from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from tests.generators.poi import candidate_pools, pois

# scripts/ 는 패키지가 아니다 — 스크립트와 같은 방식(동일 디렉토리 경로)으로 import
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from smoke_planb import (
    MIN_INDOOR,  # noqa: E402
    DIM,
    DOC_PREFIX,
    INDOOR,
    POOL_SIZE,
    CannedLlm,
    FailingLlm,
    HashEmbedding,
    build_embedding,
    build_pool,
    kb_documents,
    load_entries,
    pipeline,
)

_REGION = "제주시"
_OTHER = "서귀포시"
_NOW = datetime(2026, 8, 14, 3, 0, tzinfo=timezone.utc)  # tz-aware 고정 (FakeClock 대용)
_AFFECTED = date(2026, 8, 15)
_TID = TraceId("t-smoke-planb")
_OUTDOOR_CATS = tuple(c for c in PoiCategory if c.value not in INDOOR)
_INDOOR_CATS = tuple(c for c in PoiCategory if c.value in INDOOR)


# ── 헬퍼 ────────────────────────────────────────────────────────────────


def _poi(pid: str, category: PoiCategory) -> Poi:
    return Poi(
        poi_id=PoiId(pid),
        name=f"장소-{pid}",
        category=category,
        coord=GeoPoint(33.5, 126.5),
        open_hours=(),
        avg_cost=None,
        rating=None,
        quality=DataQuality.FULL,
        source=PoiSource.SEED,
        confidence=None,
    )


def _entry_list(region: str, prefix: str, cats) -> list[tuple[Poi, str | None]]:
    return [(_poi(f"{prefix}{i}", c), region) for i, c in enumerate(cats)]


def _jeju_entries(indoor: int = 5, outdoor: int = 3) -> tuple[tuple[Poi, str | None], ...]:
    """제주시 실내 n + 야외 m + 다른 지역·미상 지역 잡음."""
    entries = (
        _entry_list(_REGION, "in-", [_INDOOR_CATS[i % len(_INDOOR_CATS)] for i in range(indoor)])
        + _entry_list(_REGION, "out-", [_OUTDOOR_CATS[i % len(_OUTDOOR_CATS)] for i in range(outdoor)])
        + _entry_list(_OTHER, "sg-", (PoiCategory.CAFE, PoiCategory.NATURE))
        + [(_poi("none-0", PoiCategory.CAFE), None)]
    )
    return tuple(entries)


def _pool(indoor: int = 5, outdoor: int = 3) -> CandidatePool:
    return build_pool(_jeju_entries(indoor, outdoor), _REGION)


def _saved_refs(docs) -> list[str]:
    """KB-2 '저장 장소' 문서(풀 안)의 poi_ref — 풀 밖 음성 픽스처는 제외."""
    return [
        d.poi_ref
        for d in docs
        if d.doc_id.startswith(f"{DOC_PREFIX}-pref-") and not d.doc_id.endswith("-out")
    ]


def _request(pool: CandidatePool, excluded=frozenset()) -> PlanBRagRequest:
    """run()이 조립하는 요청과 같은 모양 — 단 date.today() 대신 고정 날짜."""
    return PlanBRagRequest(
        trigger=TriggerParams(
            TriggerKind.WEATHER, ScheduleId("smoke-planb-1"), _AFFECTED, {"pop": 80}
        ),
        reason="weather",
        pool=pool,
        trace_id=_TID,
        now=_NOW,
        excluded_poi_ids=excluded,
    )


def _indexed_store(pool: CandidatePool) -> InMemoryVectorStore:
    store = InMemoryVectorStore()
    index_documents(kb_documents(pool), HashEmbedding(), store)
    return store


class _DeadStore:
    """search가 항상 터지는 스토어 — pgvector 전면 장애 대역 (실 DB 없이 재현)."""

    def upsert(self, collection, item_id, vector, payload) -> None:  # pragma: no cover
        raise RuntimeError("store down (fake)")

    def search(self, collection, vector, top_k):
        raise RuntimeError("store down (fake)")

    def delete(self, collection, item_id) -> None:  # pragma: no cover
        pass


# ── ① build_pool ────────────────────────────────────────────────────────


def test_build_pool_다른_지역과_미상_지역을_제외한다():
    pool = _pool()
    assert {str(p.poi_id) for p in pool.pois} == {
        "in-0", "in-1", "in-2", "in-3", "in-4", "out-0", "out-1", "out-2"
    }


def test_build_pool_실내가_먼저_그다음_야외():
    """실내 5 + 야외 3 순서 — 폴백이 트리거(강수)를 보는지가 이 순서로 드러난다."""
    pool = _pool(indoor=5, outdoor=3)
    cats = [p.category.value in INDOOR for p in pool.pois]
    assert cats == [True] * 5 + [False] * 3


def test_build_pool_실내는_5곳_풀은_8곳이_상한():
    pool = _pool(indoor=9, outdoor=9)
    assert len(pool.pois) == POOL_SIZE == 8
    assert sum(1 for p in pool.pois if p.category.value in INDOOR) == 5
    # 상한은 입력 순서대로 앞에서 자른다 (결정론)
    assert [str(p.poi_id) for p in pool.pois] == [
        "in-0", "in-1", "in-2", "in-3", "in-4", "out-0", "out-1", "out-2"
    ]


def test_build_pool_실내가_상한_미만이면_야외가_자리를_채운다():
    """실내가 상한(5)에 못 미치면 남은 자리를 야외가 채운다. 다만 실내는 MIN_INDOOR
    이상이어야 한다 — 그 아래는 build_pool 이 아예 거부한다(아래 테스트)."""
    pool = _pool(indoor=MIN_INDOOR, outdoor=9)
    assert len(pool.pois) == 8
    assert [str(p.poi_id) for p in pool.pois][0] == "in-0"
    assert sum(1 for p in pool.pois if p.category.value in INDOOR) == MIN_INDOOR


def test_build_pool_실내가_MIN_INDOOR_미만이면_거부한다():
    """저장 장소(실내 하위 2곳)가 풀 상위 2곳과 겹치면 시나리오 ① 단언이 KB 검색 없이도
    통과한다 — 조용히 옛 결함으로 돌아가는 경로라 풀 생성 시점에 끊는다."""
    for n in range(MIN_INDOOR):
        with pytest.raises(SystemExit, match="리허설이 성립하지 않는다"):
            _pool(indoor=n, outdoor=9)


def test_build_pool_야외가_없으면_실내만으로_5곳():
    pool = _pool(indoor=7, outdoor=0)
    assert len(pool.pois) == 5  # 야외가 없으면 8을 채우지 않는다 (실내 상한 5 유지)


def test_build_pool_3곳_미만이면_조용히_줄이지_않고_SystemExit():
    with pytest.raises(SystemExit) as e:
        build_pool(_jeju_entries(indoor=1, outdoor=1), _REGION)
    assert _REGION in str(e.value)  # 어느 지역이 얇은지 메시지에 남는다


def test_build_pool_수집분에_없는_지역이면_SystemExit():
    with pytest.raises(SystemExit):
        build_pool(_jeju_entries(), "없는시")


def test_build_pool_풀_불변식_id인덱스와_tz():
    pool = _pool()
    assert pool.poi_ids == frozenset(p.poi_id for p in pool.pois)  # INV-1 인덱스 일치
    assert pool.generated_at.tzinfo is not None


@st.composite
def _shuffled_entries(draw):
    """(entries, 같은 원소의 임의 순열) — 순서 규칙이 입력 순서에 의존하지 않는지."""
    entries = draw(
        st.lists(
            st.tuples(pois(), st.sampled_from((_REGION, _OTHER, None))),
            max_size=14,
            unique_by=lambda e: str(e[0].poi_id),
        )
    )
    return tuple(entries), tuple(draw(st.permutations(entries)))


def _eligible(entries) -> list:
    """build_pool 과 같은 선별 규칙 — 지역 일치 + MINIMAL 제외.

    build_pool 은 실 풀 빌더(poi_curation/pool_builder.py)와 맞춰 MINIMAL 을 거른다
    (domain/poi.py 정본: "MINIMAL 은 후보 풀에서 제외(M7 필터)"). 테스트 가드가 이 규칙을
    같이 세지 않으면, MINIMAL 이 섞인 입력에서 build_pool 이 SystemExit 하는데 테스트는
    풀이 만들어질 거라 기대해 깨진다.
    """
    return [p for p, r in entries if r == _REGION and p.quality is not DataQuality.MINIMAL]


def _makes_pool(entries) -> bool:
    """build_pool 이 SystemExit 없이 풀을 만드는 조건 — 적격 3곳 이상 + 실내 MIN_INDOOR 이상."""
    here = _eligible(entries)
    return len(here) >= 3 and sum(1 for p in here if p.category.value in INDOOR) >= MIN_INDOOR


@settings(max_examples=60, suppress_health_check=[HealthCheck.too_slow])
@given(_shuffled_entries())
def test_build_pool_구조_규칙은_입력_순서와_무관하다(pair):
    """PBT — 뽑히는 POI는 입력 순서에 따라 달라지지만, 구성 규칙은 불변이다.

    품질 필터가 있다 — build_pool 은 MINIMAL 을 거른다(실 풀 빌더와 같은 규칙).
    리허설 풀은 M7 후보 풀을 흉내 내야 한다: 실서비스에 못 들어올 POI 로 리허설을
    돌면 초록이 의미를 잃는다.
    """
    entries, shuffled = pair
    here = _eligible(entries)
    if not _makes_pool(entries):
        for candidate in (entries, shuffled):
            with pytest.raises(SystemExit):
                build_pool(candidate, _REGION)
        return

    shapes = []
    for candidate in (entries, shuffled):
        pool = build_pool(candidate, _REGION)
        ids = {str(p.poi_id) for p in pool.pois}
        assert ids <= {str(p.poi_id) for p in here}  # 지역 밖은 절대 안 들어온다
        assert len(pool.pois) <= POOL_SIZE
        flags = [p.category.value in INDOOR for p in pool.pois]
        assert flags == sorted(flags, reverse=True)  # 실내가 전부 앞 (순서 규칙)
        assert sum(flags) <= 5
        assert pool.poi_ids == frozenset(p.poi_id for p in pool.pois)
        shapes.append((len(pool.pois), sum(flags)))
    assert shapes[0] == shapes[1]  # 크기·실내 개수는 순열에 불변 (개수만으로 정해진다)


@settings(max_examples=30, suppress_health_check=[HealthCheck.too_slow])
@given(_shuffled_entries())
def test_build_pool_같은_입력이면_같은_풀(pair):
    entries, _ = pair
    if not _makes_pool(entries):
        return
    first, second = build_pool(entries, _REGION), build_pool(entries, _REGION)
    assert [str(p.poi_id) for p in first.pois] == [str(p.poi_id) for p in second.pois]
    assert first.generated_at == second.generated_at  # 모듈 상수 NOW — 호출마다 안 흔들린다


# ── ② kb_documents ──────────────────────────────────────────────────────


def test_kb_documents_구성과_kb_라벨():
    docs = kb_documents(_pool())
    assert [(d.kb, d.doc_id) for d in docs] == [
        (KbKind.SCHEDULE, f"{DOC_PREFIX}-sched-1"),
        (KbKind.SITUATION, f"{DOC_PREFIX}-situ-1"),
        (KbKind.PERSONA, f"{DOC_PREFIX}-pref-0"),
        (KbKind.PERSONA, f"{DOC_PREFIX}-pref-1"),
        (KbKind.PERSONA, f"{DOC_PREFIX}-pref-out"),
    ]
    assert all(d.doc_id.startswith(DOC_PREFIX) for d in docs)  # 실 collection 격리 접두
    assert all(d.text.strip() for d in docs)


def test_kb_documents_저장장소_문서만_poi_ref를_가진다():
    docs = kb_documents(_pool())
    assert [d.poi_ref for d in docs[:2]] == [None, None]  # KB-1·KB-3은 POI 참조 없음
    assert all(d.metadata == {"kind": "saved"} for d in docs[2:])


def test_kb_documents_풀_밖_저장장소가_정확히_한_건():
    """INV-1 음성 픽스처 — KB 히트가 후보 자격을 만들지 않음을 보려면 풀 밖 참조가 필요하다."""
    pool = _pool()
    docs = kb_documents(pool)
    outside = [d for d in docs if d.poi_ref and not pool.contains(PoiId(d.poi_ref))]
    assert [d.doc_id for d in outside] == [f"{DOC_PREFIX}-pref-out"]
    assert outside[0].poi_ref == "tourapi-000000"


def test_저장장소는_풀_상위와_겹치지_않는다__스모크_시나리오1_단언의_전제():
    """**이 서로소 성질이 깨지면 스모크 ① 단언이 공허해진다.**

    build_pool 은 풀을 `indoor[:5] + outdoor[:3]` 순으로 만든다. 저장 장소를 `indoor[:2]`
    로 뽑으면 저장 장소 == 풀 상위 2곳이 되어, "KB-2 저장 장소가 규칙 랭킹 상위 2순위"
    단언이 **KB 검색이 전멸해도 통과**한다(규칙 랭킹이 풀 순서로 떨어지므로).

    그래서 `saved_places` 는 `indoor[-2:]` — 풀 **하위** 실내 2곳을 고른다. 그러면 검색이
    죽었을 때 상위 2가 실제로 달라진다(아래 test_KB_검색이_전멸하면_… 이 그것을 재현).
    """
    pool = _pool()
    saved = set(_saved_refs(kb_documents(pool)))
    top2 = {str(p.poi_id) for p in pool.pois[:2]}
    assert saved and not (saved & top2)


def test_저장장소는_풀이_만들어졌다면_항상_2건():
    """실내가 얇은 지역은 `build_pool` 이 거부하므로(MIN_INDOOR), 풀이 만들어진 이상
    저장 장소는 언제나 2건이다 — 예전처럼 '1건뿐이라 단언이 성립 안 함' 상태가 없다."""
    for n in (MIN_INDOOR, MIN_INDOOR + 1, 7):
        assert len(_saved_refs(kb_documents(_pool(indoor=n, outdoor=3)))) == 2


@settings(max_examples=40, suppress_health_check=[HealthCheck.too_slow])
@given(candidate_pools())
def test_kb_documents_doc_id는_어떤_풀에서도_유일하다(pool):
    docs = kb_documents(pool)
    assert len({d.doc_id for d in docs}) == len(docs)
    # 적재 시 doc_id 중복은 조용한 덮어쓰기가 되므로 index_documents가 먼저 막는다
    store = InMemoryVectorStore()
    assert index_documents(docs, HashEmbedding(), store) == len(docs)


@settings(max_examples=40, suppress_health_check=[HealthCheck.too_slow])
@given(_shuffled_entries())
def test_저장장소는_실내가_충분하면_풀_상위와_서로소(pair):
    """PBT — 위 예시 테스트를 임의 입력으로 확장.

    `saved_places` 는 실내 목록의 **뒤에서** 2곳을 고른다. 실내가 3곳 이하면 구조적으로
    겹치므로(n=3 은 1곳, n=2 는 완전히 같다) `build_pool` 이 `MIN_INDOOR` 로 아예 끊는다.
    따라서 풀이 만들어졌다면 서로소는 **조건 없이** 성립한다.
    """
    entries, _ = pair
    if not _makes_pool(entries):
        return
    pool = build_pool(entries, _REGION)
    saved = set(_saved_refs(kb_documents(pool)))
    top2 = {str(p.poi_id) for p in pool.pois[:2]}
    assert saved and not (saved & top2)


# ── ③ HashEmbedding ─────────────────────────────────────────────────────


@given(st.text(max_size=40))
def test_hash_embedding_같은_텍스트는_같은_벡터(text):
    emb = HashEmbedding()
    assert emb.embed(text) == emb.embed(text)
    assert emb.embed(text) == HashEmbedding().embed(text)  # 인스턴스가 달라도 같다


@given(st.text(max_size=40))
def test_hash_embedding_차원은_1024이고_단위벡터(text):
    """BR-AF-09 — kb_vectors.embedding은 vector(1024) 고정. 다르면 적재가 전량 실패한다."""
    vector = HashEmbedding().embed(text)
    assert len(vector) == HashEmbedding.dim == DIM == 1024
    assert abs(sum(x * x for x in vector) - 1.0) < 1e-9


@given(st.text(max_size=40), st.text(max_size=40))
def test_hash_embedding_다른_텍스트는_다른_벡터(a, b):
    if a == b:
        return
    assert HashEmbedding().embed(a) != HashEmbedding().embed(b)


@given(st.lists(st.text(max_size=20), max_size=5))
def test_hash_embedding_batch는_개별_embed와_같다(texts):
    emb = HashEmbedding()
    assert emb.embed_batch(texts) == tuple(emb.embed(t) for t in texts)


def test_DIM은_kb_vectors_DDL과_같다():
    """스크립트 상수와 컨테이너 DDL이 어긋나면 실행 시점에야 적재가 통째로 죽는다."""
    ddl = (Path(__file__).resolve().parents[1] / "docker/vector-init/01-kb-vectors.sql").read_text(
        encoding="utf-8"
    )
    assert f"vector({DIM})" in ddl


def test_build_embedding_env가_없으면_해시(monkeypatch):
    monkeypatch.delenv("EMBEDDING_MODEL", raising=False)
    assert isinstance(build_embedding(), HashEmbedding)  # 모델 로드 경로를 타지 않는다


def test_build_embedding_모델_미설치를_조용히_넘기지_않는다(monkeypatch):
    """EMBEDDING_MODEL을 줬는데 해시로 되돌아가면 '검색 품질을 봤다'고 착각한다."""
    if importlib.util.find_spec("sentence_transformers") is not None:
        pytest.skip("sentence-transformers 설치됨 — 실모델 로드는 스모크 전용(실 호출 0 유지)")
    monkeypatch.setenv("EMBEDDING_MODEL", "1")
    with pytest.raises(SystemExit) as e:
        build_embedding()
    assert "sentence-transformers" in str(e.value)  # 되살리는 명령을 그대로 안내한다


# ── ④ 단언 공허성 회귀 방지 (차단 결함 ① 재현) ──────────────────────────


def test_KB_적재가_정상이면_3종_모두_히트하고_에러노트가_없다():
    """스모크 ①의 보조 단언(=검색 성공 판정)이 정상 경로에서 실제로 통과하는지."""
    pool = _pool()
    result = pipeline(_indexed_store(pool), HashEmbedding(), None, None).run(_request(pool))
    assert result.retrieved == {"SCHEDULE": 1, "PERSONA": 3, "SITUATION": 1}
    assert not [n for n in result.notes if n.startswith("retrieve_")]
    # note 는 폴백 사유 + 규칙 랭킹 조정 기록의 합성("… · rule_ranking: …", TRIP-532) — 부분 일치
    assert any("alternative_gateway_absent" in n for n in result.notes)
    assert result.fallback_level == 1
    assert {str(a.poi_ids[0]) for a in result.alternatives[:2]} == set(
        _saved_refs(kb_documents(pool))
    )


def test_KB_검색이_전멸하면_상위2가_저장장소와_달라진다():
    """**차단 결함 ①이 고쳐졌다는 증거.**

    스토어가 통째로 죽어 KB 히트가 0건이면 규칙 랭킹은 풀 순서를 그대로 낸다. 저장 장소가
    풀 **하위**이므로 상위 2개는 저장 장소와 달라진다 → 스모크 ①의 "KB-2 가 상위 2순위"
    단언이 **검색 실패를 실제로 잡는다**.

    수정 전에는 저장 장소 == 풀 상위 2곳이라 검색이 전멸해도 그 단언이 통과했다.
    이 테스트가 깨진다면 커플링이 되살아난 것이다.
    """
    pool = _pool()
    result = pipeline(_DeadStore(), HashEmbedding(), None, None).run(_request(pool))
    assert result.retrieved == {"SCHEDULE": 0, "PERSONA": 0, "SITUATION": 0}
    assert sorted(n.split(":")[0] for n in result.notes if n.startswith("retrieve_")) == [
        "retrieve_persona_error",
        "retrieve_schedule_error",
        "retrieve_situation_error",
    ]
    # ↓ 검색 전멸 시 상위 2가 저장 장소와 다르다 — 단언이 더는 공허하지 않다
    assert {str(a.poi_ids[0]) for a in result.alternatives[:2]} != set(
        _saved_refs(kb_documents(pool))
    )


# ── ⑤ 폴백 사유 구분 (차단 결함 ②) ─────────────────────────────────────


def _llm_request() -> LlmRequest:
    return LlmRequest(
        model_id="fake-model",
        prompt="프롬프트",
        prompt_ref=PromptRef(
            prompt_id="prompts/alternative_selection.yaml",
            version="1.0.0",
            feature="ALTERNATIVE_SELECTION",
        ),
        max_tokens=128,
        temperature=1.0,
    )


def test_CannedLlm은_주어진_raw_text만_돌려준다():
    """시나리오 3(환각 주입)의 계약 — 응답을 가공하면 게이트가 볼 것이 달라진다."""
    canned = json.dumps({"selections": [{"poiId": "tourapi-000000", "reason": "환각"}]})
    response = CannedLlm(canned).invoke(_llm_request())
    assert response.raw_text == canned and response.model_id == "fake-model"


def test_FailingLlm은_반드시_예외를_던진다():
    """시나리오 4(장애 주입)의 계약 — 조용히 성공하면 그 시나리오가 통과한 채 죽는다."""
    with pytest.raises(RuntimeError):
        FailingLlm().invoke(_llm_request())


def test_풀_밖_id_응답은_게이트_드롭_사유로_남는다():
    """스모크 시나리오 3 — 폴백 사유가 gate_dropped_all 이고 llm_error가 아님을 함께 고정한다."""
    pool = _pool()
    ghost = json.dumps({"selections": [{"poiId": "tourapi-000000", "reason": "환각"}]})
    result = pipeline(
        _indexed_store(pool), HashEmbedding(), CannedLlm(ghost), "fake-model"
    ).run(_request(pool))
    assert result.fallback_level == 1
    assert any("gate_dropped_all" in n for n in result.notes), result.notes
    assert not any("llm_error" in n for n in result.notes)  # 시나리오 4와 사유가 겹치지 않는다
    for alt in result.alternatives:  # INV-1 — 환각 id는 산출물에 없다
        assert all(pool.contains(pid) for pid in alt.poi_ids)


def test_LLM_장애는_llm_error_사유로_남는다():
    """스모크 시나리오 4 — 시나리오 3과 같은 fallback_level 1이지만 사유 문자열이 다르다."""
    pool = _pool()
    result = pipeline(
        _indexed_store(pool), HashEmbedding(), FailingLlm(), "fake-model"
    ).run(_request(pool))
    assert result.fallback_level == 1
    assert any("llm_error" in n for n in result.notes), result.notes
    assert not any("gate_dropped_all" in n for n in result.notes)


def test_파싱_불가_응답은_parse_error로_구분된다():
    """게이트 스키마가 드리프트하면 시나리오 3이 여기로 새어 든다 — 사유가 갈리는지 못 박는다."""
    pool = _pool()
    result = pipeline(
        _indexed_store(pool), HashEmbedding(), CannedLlm("이건 JSON이 아니다"), "fake-model"
    ).run(_request(pool))
    assert result.fallback_level == 1
    assert any("parse_error" in n for n in result.notes), result.notes
    assert not any("gate_dropped_all" in n for n in result.notes)


# ── 입력 적재 (fake 픽스처만 — 실 수집분 미사용) ────────────────────────


def _proposal_doc(*specs) -> dict:
    return {
        "proposals": [
            {"poi": _poi(pid, cat).to_dict(), "region": region} for pid, cat, region in specs
        ]
    }


def _sqlite_db(path: Path, *specs) -> Path:
    conn = sqlite3.connect(path)
    conn.execute(
        "create table proposal (provisional_id text, name text, category text, "
        "lat real, lng real, quality text, region text)"
    )
    conn.executemany(
        "insert into proposal values (?, ?, ?, ?, ?, ?, ?)",
        [(pid, f"장소-{pid}", cat.value, 33.5, 126.5, "FULL", region) for pid, cat, region in specs],
    )
    conn.commit()
    conn.close()
    return path


def test_load_entries_JSON이_sqlite보다_우선(tmp_path, monkeypatch):
    js = tmp_path / "proposals.json"
    js.write_text(json.dumps(_proposal_doc(("j0", PoiCategory.CAFE, _REGION))), encoding="utf-8")
    monkeypatch.setenv("COLLECTED_POIS", str(js))
    monkeypatch.setenv(
        "COLLECTED_POIS_DB", str(_sqlite_db(tmp_path / "db.sqlite", ("s0", PoiCategory.CAFE, _REGION)))
    )
    assert [str(p.poi_id) for p, _ in load_entries()] == ["j0"]


def test_load_entries_sqlite_행을_Poi로_매핑한다(tmp_path, monkeypatch):
    """수집 sqlite 스키마 계약 — 컬럼이 바뀌면 스모크는 실행 시점에야 죽는다."""
    monkeypatch.delenv("COLLECTED_POIS", raising=False)
    monkeypatch.setenv(
        "COLLECTED_POIS_DB",
        str(_sqlite_db(tmp_path / "db.sqlite", ("s0", PoiCategory.CULTURE, _REGION))),
    )
    (poi, region), = load_entries()
    assert (str(poi.poi_id), poi.category, region) == ("s0", PoiCategory.CULTURE, _REGION)
    assert poi.source is PoiSource.SEED and poi.rating is None


def test_load_entries_수집분이_없으면_SystemExit(tmp_path, monkeypatch):
    monkeypatch.delenv("COLLECTED_POIS", raising=False)
    monkeypatch.delenv("COLLECTED_POIS_DB", raising=False)
    monkeypatch.chdir(tmp_path)  # 기본값 collected_pois.db 가 없는 곳에서
    with pytest.raises(SystemExit):
        load_entries()
