"""PlanBAgent RAG 파이프라인 골격 (planb-rag-design.md §3, epics S6.1의 1단계).

```
[1] Retrieve  KB-1 일정 · KB-3 상황 · KB-2 페르소나  (kb_retrieval)
[2] Augment   closed-set 후보 목록 + 검색 컨텍스트 조립
[3] Generate  llm.select_alternatives — C1 GatewayFacade 경유 (L-3)
              게이트웨이 미주입/실패 → 규칙 랭킹 폴백 (INV-4)
[4] Validate  솔버 관문 (C2) — **본 단계 범위 밖**, 아래 "남긴 이음매" 참조
```

**INV-1 (closed-set)** — 구조로 막는다:
- KB 검색 결과(`KbHit.poi_ref`)도, LLM 산출물도 그 자체로는 후보가 아니다.
- 후보 id(`PoiId`)를 만드는 경로는 `closed_set_filter` **단 하나**이며, 이 함수는
  `CandidatePool` 인자 없이는 호출 자체가 불가능하다. 풀 밖 참조는 조용히 사라지지 않고
  `dropped_out_of_pool`로 결과에 실린다 (INV-4 — 침묵 실패 금지).

**INV-2 (솔버 검증값만)** — 본 파이프라인의 출력 `Alternative`에는 시각·순서 필드가 아예
없다. 제안(Proposal)만 만들고 배치·시각 확정은 4단 솔버 관문 몫 (agent-structure-v2 §2).

**INV-3** — 출력 계열 어디에도 소요시간 필드가 없다 (거리도 본 단계에서는 미산출).

**INV-4** — `run`은 예외를 밖으로 던지지 않는다. 어떤 실패든 결정론 폴백 결과로 수렴하고
`notes`에 어느 단계에서 왜 떨어졌는지가 남는다 (`IntentRouter`와 같은 계약).

**남긴 이음매 (실 pgvector·솔버 배선용)**
- 벡터 소스: `VectorStorePort`/`EmbeddingPort` 주입 — pgvector 어댑터로 교체해도 본 파일 무변.
- LLM: `alternative_gateway`는 `GatewayFacade | None`. `ALTERNATIVE_SELECTION`용 프롬프트
  yaml·출구 게이트가 아직 없어 운영 배선에서는 항상 `None`이며, 그때는 규칙 랭킹으로 돈다.
- 솔버: `Alternative`를 그대로 `solve` 입력으로 넘기면 되도록 poi_id 목록만 담았다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from trippilot.agents.planb.kb_retrieval import (
    DEFAULT_TOP_K,
    retrieve_persona,
    retrieve_schedule,
    retrieve_situation,
)
from trippilot.c1.gateway import GatewayFacade
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.kb import KbHit, KbKind
from trippilot.domain.llm import CandidatePool, LlmFeature, ScoredPoi
from trippilot.domain.trigger import TriggerParams
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort

_ALTERNATIVE_LABELS = ("A", "B", "C", "D", "E")


@dataclass(frozen=True, slots=True)
class PlanBRagConfig:
    """검색·제안 파라미터 (planb-rag-design §9 미결 #4·#5의 잠정값 — 하드코딩 금지)."""

    top_k: int = DEFAULT_TOP_K
    max_alternatives: int = 3  # 미결 #5 — UX 확정 시 조정

    def __post_init__(self) -> None:
        if self.top_k < 1:
            raise ValueError("top_k ≥ 1")
        if not 1 <= self.max_alternatives <= len(_ALTERNATIVE_LABELS):
            raise ValueError(f"max_alternatives ∈ [1, {len(_ALTERNATIVE_LABELS)}]")


@dataclass(frozen=True, slots=True)
class PlanBRagRequest:
    """Plan-B 1회 실행 입력 (agent-io-contracts §2.2 PlanBAgentInput의 1단계 부분집합).

    `pool`은 M7이 만든 closed-set 후보 풀 — 이것 없이는 대안이 존재할 수 없다 (INV-1).
    """

    trigger: TriggerParams
    reason: str  # weather|closed|delay|canceled|fatigue|none
    pool: CandidatePool
    trace_id: TraceId
    now: datetime
    excluded_poi_ids: frozenset[PoiId] = frozenset()  # 이미 방문·거절한 POI


@dataclass(frozen=True, slots=True)
class Alternative:
    """대안 1개 = closed-set POI 묶음 + 근거. **시각·순서 없음** (INV-2)."""

    label: str
    poi_ids: tuple[PoiId, ...]
    rationale: str

    def to_dict(self) -> dict:
        return {
            "label": self.label,
            "poi_ids": [str(p) for p in self.poi_ids],
            "rationale": self.rationale,
        }


@dataclass(frozen=True, slots=True)
class PlanBRagResult:
    """파이프라인 산출물. 실패도 예외가 아니라 상태값으로 수렴한다 (INV-4)."""

    alternatives: tuple[Alternative, ...]
    is_fallback: bool
    fallback_level: int  # 0=LLM 정상, 1=규칙 랭킹, 2=후보 0
    notes: tuple[str, ...]  # 폴백 사유·드롭 사유 — 비어 있으면 정상 경로
    retrieved: dict  # {KB 라벨: 검색 건수}
    dropped_out_of_pool: tuple[str, ...]  # closed-set 밖이라 버려진 참조 (INV-1 가시화)
    empty_reason: str | None = None  # 대안 0개 사유 (e16 문구 근거)

    def __post_init__(self) -> None:
        if self.fallback_level < 0:
            raise ValueError("fallback_level ≥ 0")
        if self.is_fallback != (self.fallback_level >= 1):
            raise ValueError("is_fallback ⇔ fallback_level ≥ 1")
        if not self.alternatives and self.empty_reason is None:
            raise ValueError("대안 0개면 empty_reason 필수 (침묵 실패 금지, INV-4)")

    def to_dict(self) -> dict:
        return {
            "alternatives": [a.to_dict() for a in self.alternatives],
            "is_fallback": self.is_fallback,
            "fallback_level": self.fallback_level,
            "notes": list(self.notes),
            "retrieved": dict(self.retrieved),
            "dropped_out_of_pool": list(self.dropped_out_of_pool),
            "empty_reason": self.empty_reason,
        }


@dataclass(frozen=True, slots=True)
class RagContext:
    """Retrieve 단계 산출물 — Augment에 들어갈 검색 컨텍스트."""

    schedule: tuple[KbHit, ...] = ()
    persona: tuple[KbHit, ...] = ()
    situation: tuple[KbHit, ...] = ()
    notes: tuple[str, ...] = ()

    def counts(self) -> dict:
        return {
            KbKind.SCHEDULE.value: len(self.schedule),
            KbKind.PERSONA.value: len(self.persona),
            KbKind.SITUATION.value: len(self.situation),
        }


def closed_set_filter(
    refs: Sequence[str],
    pool: CandidatePool,
    excluded: frozenset[PoiId] = frozenset(),
) -> tuple[tuple[PoiId, ...], tuple[str, ...]]:
    """**INV-1의 유일한 관문** — 임의의 참조 문자열 → 후보 `PoiId`.

    풀 안에 있고 제외 목록에 없는 것만 통과시키고, 나머지는 드롭 사유로 돌려준다.
    중복은 첫 등장 순서로 접는다(결정론). 이 함수를 거치지 않은 `PoiId`는
    파이프라인 어디에서도 만들어지지 않는다.
    """
    kept: list[PoiId] = []
    dropped: list[str] = []
    seen: set[str] = set()
    for ref in refs:
        if not ref or ref in seen:
            continue
        seen.add(ref)
        poi_id = PoiId(ref)
        if not pool.contains(poi_id) or poi_id in excluded:
            dropped.append(ref)
            continue
        kept.append(poi_id)
    return tuple(kept), tuple(dropped)


class PlanBRagPipeline:
    def __init__(
        self,
        embedding: EmbeddingPort,
        store: VectorStorePort,
        *,
        alternative_gateway: GatewayFacade | None = None,
        config: PlanBRagConfig | None = None,
    ) -> None:
        self._embedding = embedding
        self._store = store
        self._gateway = alternative_gateway
        self._cfg = config or PlanBRagConfig()

    # ── 공개 API ────────────────────────────────────────────────────────

    def run(self, request: PlanBRagRequest) -> PlanBRagResult:
        """트리거·컨텍스트 → 대안 제안. 예외를 던지지 않는다 (INV-4)."""
        try:
            return self._run(request)
        except Exception as e:  # 스토어·게이트웨이 어디가 터져도 결정론 폴백으로 수렴
            return PlanBRagResult(
                alternatives=(),
                is_fallback=True,
                fallback_level=2,
                notes=(f"pipeline_error: {type(e).__name__}: {e}",),
                retrieved={},
                dropped_out_of_pool=(),
                empty_reason="pipeline_error",
            )

    # ── 파이프라인 ──────────────────────────────────────────────────────

    def _run(self, request: PlanBRagRequest) -> PlanBRagResult:
        context = self.retrieve(request)
        notes = list(context.notes)

        # [2] Augment — 후보는 오직 closed-set 풀에서만 나온다 (INV-1)
        available = tuple(
            p.poi_id for p in request.pool.pois if p.poi_id not in request.excluded_poi_ids
        )
        if not available:
            return PlanBRagResult(
                alternatives=(),
                is_fallback=True,
                fallback_level=2,
                notes=tuple(notes),
                retrieved=context.counts(),
                dropped_out_of_pool=(),
                empty_reason="no_candidates",
            )

        # [3] Generate
        ranked_refs, used_llm, why = self._select(request, context, available)
        if why:
            notes.append(why)

        # closed-set 재검증 — LLM 산출물이든 규칙 산출물이든 예외 없이 통과시킨다
        kept, dropped = closed_set_filter(ranked_refs, request.pool, request.excluded_poi_ids)
        if dropped:
            notes.append(f"out_of_pool_dropped: {len(dropped)}")
        if not kept:  # 전량 드롭 → 규칙 랭킹으로 되돌린다 (LLM만 믿지 않는다)
            kept = available
            used_llm = False
            notes.append("all_selected_dropped → rule_ranking")

        alternatives = tuple(
            Alternative(
                label=_ALTERNATIVE_LABELS[i],
                poi_ids=(poi_id,),
                rationale=self._rationale(request, used_llm),
            )
            for i, poi_id in enumerate(kept[: self._cfg.max_alternatives])
        )
        fallback_level = 0 if used_llm else 1
        return PlanBRagResult(
            alternatives=alternatives,
            is_fallback=not used_llm,
            fallback_level=fallback_level,
            notes=tuple(notes),
            retrieved=context.counts(),
            dropped_out_of_pool=dropped,
            empty_reason=None,
        )

    # [1] Retrieve — KB 3종. 한 KB가 실패해도 나머지로 진행한다 (부분 성공 허용)
    def retrieve(self, request: PlanBRagRequest) -> RagContext:
        notes: list[str] = []
        schedule, note = self._safe_retrieve(
            retrieve_schedule, _schedule_query(request), KbKind.SCHEDULE
        )
        if note:
            notes.append(note)
        situation, note = self._safe_retrieve(
            retrieve_situation, _situation_query(request), KbKind.SITUATION
        )
        if note:
            notes.append(note)
        persona, note = self._safe_retrieve(
            retrieve_persona, _persona_query(request), KbKind.PERSONA
        )
        if note:
            notes.append(note)
        return RagContext(
            schedule=schedule, persona=persona, situation=situation, notes=tuple(notes)
        )

    def _safe_retrieve(self, fn, query: str, kb: KbKind) -> tuple[tuple[KbHit, ...], str]:
        try:
            return fn(query, self._embedding, self._store, top_k=self._cfg.top_k), ""
        except Exception as e:
            return (), f"retrieve_{kb.value.lower()}_error: {type(e).__name__}: {e}"

    # [3] Generate — LLM 선택. 미주입·실패·형태 이상은 전부 규칙 랭킹으로 (INV-4)
    def _select(
        self,
        request: PlanBRagRequest,
        context: RagContext,
        available: tuple[PoiId, ...],
    ) -> tuple[tuple[str, ...], bool, str]:
        rule_ranked = _rule_ranking(context.persona, available)
        if self._gateway is None:
            return rule_ranked, False, "alternative_gateway_absent"
        try:
            result = self._gateway.call(
                LlmFeature.ALTERNATIVE_SELECTION,
                _prompt_vars(request, context, available, self._cfg.max_alternatives),
                request.pool,
                request.trace_id,
                request.now,
            )
        except Exception as e:  # 설정 버그(프롬프트 미등록 등)도 Plan-B를 죽이지 않는다
            return rule_ranked, False, f"alternative_error: {type(e).__name__}: {e}"
        if result.is_fallback:
            return rule_ranked, False, f"alternative_fallback: {result.error}"
        selected = _as_refs(result.value)
        if selected is None:
            return rule_ranked, False, "alternative_bad_shape"
        if not selected:
            return rule_ranked, False, "alternative_empty"
        return selected, True, ""

    def _rationale(self, request: PlanBRagRequest, used_llm: bool) -> str:
        source = "llm_select_alternatives" if used_llm else "rule_ranking"
        return f"{request.trigger.kind.value}/{request.reason} · {source}"


# ── 질의 조립 (Augment 재료) ────────────────────────────────────────────


def _schedule_query(request: PlanBRagRequest) -> str:
    return (
        f"{request.trigger.schedule_id} {request.trigger.affected_date.isoformat()} "
        f"{request.trigger.kind.value} 영향 슬롯"
    )


def _situation_query(request: PlanBRagRequest) -> str:
    return f"{request.trigger.kind.value} {request.reason} 상황"


def _persona_query(request: PlanBRagRequest) -> str:
    return f"{request.reason} {request.trigger.kind.value} 대안 선호"


def _prompt_vars(
    request: PlanBRagRequest,
    context: RagContext,
    available: tuple[PoiId, ...],
    max_alternatives: int,
) -> Mapping[str, object]:
    """프롬프트 변수. 후보 목록은 풀에서만 온다 — 모델이 고를 수 있는 값 자체를 한정 (INV-1)."""
    return {
        "trigger_kind": request.trigger.kind.value,
        "reason": request.reason,
        "schedule_context": _join(context.schedule),
        "situation_context": _join(context.situation),
        "persona_context": _join(context.persona),
        "candidates": "\n".join(f"- {p}" for p in available),
        "max_alternatives": str(max_alternatives),
    }


def _join(hits: Sequence[KbHit]) -> str:
    return "\n".join(f"- {h.text}" for h in hits)


# ── 랭킹·형태 검증 ──────────────────────────────────────────────────────


def _rule_ranking(persona_hits: Sequence[KbHit], available: tuple[PoiId, ...]) -> tuple[str, ...]:
    """규칙 폴백 랭킹 — 결정론.

    정본(§3 [2])의 "저장 장소가 대안 1순위"를 그대로 옮긴다: KB-2 히트가 가리키는 POI 중
    **풀 안에 있는 것**을 검색 순서대로 앞에 두고, 나머지는 풀 순서로 뒤에 붙인다.
    페르소나 히트가 풀 자격을 만드는 게 아니라 **풀 안에서의 우선순위만** 바꾼다 (INV-1).
    """
    in_pool = set(available)
    ranked: list[str] = []
    seen: set[str] = set()
    for hit in persona_hits:
        ref = hit.poi_ref
        if ref and ref not in seen and PoiId(ref) in in_pool:
            seen.add(ref)
            ranked.append(ref)
    ranked.extend(str(p) for p in available if str(p) not in seen)
    return tuple(ranked)


def _as_refs(value: object) -> tuple[str, ...] | None:
    """게이트 산출물 → 참조 목록. 인식 못 하는 형태는 None (폴백 신호).

    `ALTERNATIVE_SELECTION` 출구 게이트가 아직 없어 산출물 타입이 확정 전이다.
    현재는 기존 게이트 산출 형태인 `ScoredPoi` 시퀀스를 받아 점수 내림차순
    (동점은 poi_id 사전순 — 결정론)으로 세운다.
    """
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return None
    items = list(value)
    if not all(isinstance(x, ScoredPoi) for x in items):
        return None
    ordered = sorted(items, key=lambda s: (-s.score, str(s.poi_id)))
    return tuple(str(s.poi_id) for s in ordered)
