"""KB-1 을 죽은 벡터 검색에서 실제 일정 컨텍스트로 (TRIP-972).

정본(`planb-rag-design.md` §9 개정 ③)이 **"KB-1 구조화 DB 조회 … 1단계는 세 KB 모두
`VectorStorePort` 동형"** 이라고 적어 뒀다. 그 1단계가 끝났는데(#744 로 `/replan` 배선
완료) 벡터 검색이 그대로 남아 매 요청 **구조적으로 0건**을 돌려주고 있었다:
적재 문서 0 · `src/` 에 쓰는 코드 0 · 질의가 `"{uuid} {날짜} {enum} 영향 슬롯"` 이라
한국어 문서와 임베딩 공간에서 붙지 못한다.

증명하는 것:
  ① 원 일정이 **실제로 프롬프트에 닿는다** — 이걸 안 보면 "배선했는데 아무 효과 없음"이다
  ② 이름은 풀에서 오고, 풀 밖 id 는 건너뛴다 (INV-1 — 모델이 낯선 id 를 장소로 읽지 않게)
  ③ 시각을 담지 않는다 (INV-3 집행 — 담으면 게이트가 근거 문장을 통째로 비운다)
  ④ KB-1 검색을 안 한다 — 임베딩 질의가 2종, `retrieved` 에 SCHEDULE 키 없음
  ⑤ 배선이 `/replan` 의 `current_slots` 를 실어 보낸다
"""

from __future__ import annotations

import re

import pytest

from trippilot.agents.planb.rag import (
    PlanBAgent,
    PlanBRagRequest,
    _current_itinerary,
)
from trippilot.domain.common import PoiId
from trippilot.domain.kb import KbKind
from trippilot.domain.llm import TypedResult
from trippilot.llm_gateway.gates.reflection_template import _TIME_EXPR

from tests.fakes.fake_embedding import FakeEmbedding
from tests.fakes.in_memory_vector_store import InMemoryVectorStore
from tests.test_planb_rag import _SMALL, _pool as _planb_pool, _request as _planb_req


class _SpyWorker:
    """`AlternativeSelectionInput` 을 붙잡는다 — 프롬프트 재료를 직접 본다."""

    def __init__(self) -> None:
        self.inputs: list = []

    def select(self, pool, spec, trace_id, now, **kw):
        self.inputs.append(spec)
        first = next(iter(pool.pois)).poi_id
        return TypedResult(
            value={"selected": [{"poi_id": str(first), "score": 0.9}]},
            is_fallback=False, error=None, call_record=None,
        )


class _SpyEmbedding(FakeEmbedding):
    def __init__(self, dim: int) -> None:
        super().__init__(dim=dim)
        self.batches: list = []

    def embed_batch(self, texts):
        self.batches.append(tuple(texts))
        return super().embed_batch(texts)


def _run(slot_ids=(), pool_ids=("p1", "p2", "p3"), reasons=None):
    pool = _planb_pool(*pool_ids)
    spy, emb = _SpyWorker(), _SpyEmbedding(dim=_SMALL)
    base = _planb_req(pool)
    request = PlanBRagRequest(
        **{**{f.name: getattr(base, f.name) for f in base.__dataclass_fields__.values()},
           "current_slot_ids": tuple(PoiId(s) for s in slot_ids),
           **({"affected_reasons": reasons} if reasons else {})}
    )
    result = PlanBAgent(emb, InMemoryVectorStore(), alternative_worker=spy).run(request)
    return result, spy, emb


# ── ① 원 일정이 프롬프트에 닿는다 ──────────────────────────────────────


def test_current_itinerary_reaches_the_prompt() -> None:
    """이 단언이 없으면 배선해 놓고 아무 효과가 없어도 초록이다."""
    _, spy, _ = _run(slot_ids=("p1", "p2"))

    assert len(spy.inputs) == 1
    ctx = spy.inputs[0].schedule_context
    assert "[현재 일정]" in ctx, ctx
    assert "1. p1" in ctx and "2. p2" in ctx, ctx  # 순서가 살아 있다


def test_empty_slots_leave_the_context_to_the_reasons() -> None:
    """`/alternatives` 경로는 원 일정을 안 보낸다 — 원래 추천 이유만 남는다."""
    _, spy, _ = _run(reasons={"p1": "조용한 카페라 추천"})
    ctx = spy.inputs[0].schedule_context

    assert "[현재 일정]" not in ctx
    assert "조용한 카페라 추천" in ctx


# ── ② 이름은 풀에서, 풀 밖은 건너뛴다 ─────────────────────────────────


def test_unknown_ids_are_skipped_not_rendered() -> None:
    """풀 밖 id 를 프롬프트에 흘리면 모델이 그것을 장소로 읽는다 (INV-1)."""
    assert "유령" not in _current_itinerary_of(("p1", "유령", "p2"))
    assert _current_itinerary_of(("유령1", "유령2")) == ""  # 전부 풀 밖 → 블록 자체가 없다


def _current_itinerary_of(slot_ids):
    pool = _planb_pool("p1", "p2", "p3")
    base = _planb_req(pool)
    request = PlanBRagRequest(
        **{**{f.name: getattr(base, f.name) for f in base.__dataclass_fields__.values()},
           "current_slot_ids": tuple(PoiId(s) for s in slot_ids)}
    )
    return _current_itinerary(request)


# ── ③ 시각을 담지 않는다 (INV-3) ──────────────────────────────────────


# 게이트(`_TIME_EXPR`)를 그대로 빌려 쓰면 **이 테스트가 공허해진다** — 실측(2026-09-26)
# 에서 그 정규식은 `09:00~10:00` 을 통과시킨다(잡는 것은 `\d+분`·`\d+시간`·
# `오전/오후 \d+시`뿐). 처음에 빌려 썼다가 역검증에서 "시각을 섞어도 안 잡힌다"로
# 드러났다. 여기서는 **콜론 시각까지** 직접 막는다.
_CLOCK = re.compile(r"\d{1,2}\s*:\s*\d{2}")


def test_no_time_of_day_in_the_rendered_itinerary() -> None:
    """원 일정 시각이 프롬프트에 새면 아무도 못 막는다 — 게이트가 콜론 형식을 놓친다.

    그리고 그 값은 이 대안에 대해 어셈블리가 검증한 시각이 아니라 **다른 슬롯의
    시각**이라, 근거 문장에 실리면 INV-2 위반이다. 재료 쪽에서 막는 것이 유일한 방어다.
    """
    _, spy, _ = _run(slot_ids=("p1", "p2", "p3"))
    ctx = spy.inputs[0].schedule_context

    assert _CLOCK.search(ctx) is None, ctx          # 09:00 류
    assert _TIME_EXPR.search(ctx) is None, ctx      # 오후 2시·30분 류 (게이트가 잡는 것)


# ── ④ KB-1 을 검색하지 않는다 ─────────────────────────────────────────


def test_embedding_batch_has_two_queries_not_three() -> None:
    """KB-1 질의가 사라져 배치가 3 → 2 종이다."""
    _, _, emb = _run(slot_ids=("p1",))
    assert emb.batches and len(emb.batches[0]) == 2, emb.batches


def test_retrieved_has_no_schedule_key() -> None:
    """0 을 싣는 것도 거짓이다 — "찾았는데 없었다"와 "찾지 않는다"는 다른 사실이다."""
    result, _, _ = _run(slot_ids=("p1",))
    assert KbKind.SCHEDULE.value not in result.retrieved
    assert set(result.retrieved) == {KbKind.PERSONA.value, KbKind.SITUATION.value}
