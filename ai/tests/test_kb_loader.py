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

_SEED = Path(__file__).resolve().parent.parent / "data" / "planb_situation_kb.yaml"


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
