"""PlanBAgent RAG 파이프라인 골격 (planb-rag-design.md §3, epics S6.1의 1단계).

```
[1] Retrieve  KB-1 일정 · KB-3 상황 · KB-2 페르소나  (kb_retrieval)
[2] Augment   closed-set 후보 목록 + 검색 컨텍스트 조립
[3] Generate  llm.select_alternatives — C1 GatewayFacade 경유 (L-3)
              게이트웨이 미주입/실패 → 규칙 랭킹 폴백 (INV-4 — reason·거리 신호, TRIP-532)
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
- LLM: `alternative_gateway`는 `GatewayFacade | None`. 주입되면
  `AlternativeSelectionWorker`(TRIP-331 — 프롬프트 yaml·`AlternativeSelectionGate`와
  4종 세트)를 경유해 호출하고, 미주입·실패 시 규칙 랭킹으로 돈다 (INV-4).
- 솔버: `Alternative`를 그대로 `solve` 입력으로 넘기면 되도록 poi_id 목록만 담았다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType

from trippilot.agents.planb.kb_retrieval import (
    DEFAULT_TOP_K,
    retrieve_persona,
    retrieve_schedule,
    retrieve_situation,
)
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.llm_gateway.workers.alternative_selection import (
    AlternativeSelectionInput,
    AlternativeSelectionWorker,
)
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.kb import KbHit, KbKind
from trippilot.domain.llm import AlternativePick, CandidatePool, ScoredPoi
from trippilot.domain.poi import PoiCategory
from trippilot.domain.trigger import TriggerParams
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort
from trippilot.solver_engine.config import RAIN_OUTDOOR
from trippilot.solver_engine.travel import haversine_km

_ALTERNATIVE_LABELS = ("A", "B", "C", "D", "E")

# 규칙 폴백의 reason → 후순위 카테고리 (TRIP-532). 배정을 바꾸려면 여기만 고친다.
# 분기 키는 TriggerKind 가 아니라 **reason** — MANUAL 트리거도 사유("비 와서")를 따라간다.
# delay·fatigue 는 거리 오름차순이 곧 규칙이라 항목이 없고, closed·canceled·none 은 중립
# (닫힌 곳은 excluded 로 이미 빠진다 — 없는 신호로 순위를 지어내지 않는다).
_DEMOTED_BY_REASON: Mapping[str, frozenset[PoiCategory]] = MappingProxyType(
    {"weather": RAIN_OUTDOOR}  # 솔버의 우천 판정표(TRIP-383)와 같은 기준 — 두 경로가 같은 판단
)


@dataclass(frozen=True, slots=True)
class PlanBRagConfig:
    """검색·제안 파라미터 (하드코딩 금지).

    `top_k` 는 planb-rag-design §9 미결 #4 — 2026-09-01 실측으로 확정(근거는
    `kb_retrieval.DEFAULT_TOP_K`). `max_alternatives` 는 미결 #5, 아직 잠정값이다.
    """

    top_k: int = DEFAULT_TOP_K
    max_alternatives: int = 3  # 미결 #5 — UX 확정 시 조정
    # 유사도 하한 (planb-rag-design §9 미결 #3 "데이터 쌓인 후 캘리브레이션").
    # top_k 는 "몇 건까지"이고 이건 "얼마나 닮아야"다 — 버킷이 작으면(delay·none 은
    # KB 에 2건뿐) top_k 를 채우려 무관 문서를 긁어오는데, 그걸 막는다.
    #
    # **비율 컷을 기본으로 쓴다.** 절대값은 임베딩 모델에 종속이라(코사인 분포가 모델마다
    # 다르다) 모델을 바꾸면 조용히 잘못 자른다 — 팀은 provider 전환을 전제하고 있다
    # (2026-08-22 "provider 를 바꾸면 전량 재적재"). 비율은 그 전환에도 유효하다.
    # 절대 하한은 비율의 구멍을 막는 바닥이다: 최고점 자체가 낮은(= 아무것도 안 닮은)
    # 질의에서 비율만 쓰면 잡음을 그대로 통과시킨다.
    #
    # 실측(KB 24건 × 질의 6종, KURE-v1): 컷 없음 정밀도 0.708·무관 7건
    #   → 비율 0.85 = 0.944·무관 1건 / 절대 0.50 = 1.000·무관 0건(단 모델 종속)
    min_score_ratio: float = 0.85  # 최고점 대비. 1.0 = 최고점만, 0.0 = 컷 없음
    min_score: float = 0.0  # 절대 바닥. 코사인은 음수가 나므로 0 은 "음수 컷"을 뜻한다
    # 요청 예산 중 LLM 호출에 줄 몫 (BR-U4-04 "요청 예산의 절반 이하").
    # 나머지는 검색·풀 조립·직렬화 몫이다.
    llm_budget_share: float = 0.5

    def __post_init__(self) -> None:
        if self.top_k < 1:
            raise ValueError("top_k ≥ 1")
        if not 0.0 < self.llm_budget_share <= 1.0:
            raise ValueError("llm_budget_share ∈ (0, 1]")
        # 코사인 범위는 [-1, 1] — 음수가 실제로 난다(intent_router 가 max(score, 0) 로 흡수).
        if not -1.0 <= self.min_score <= 1.0:
            raise ValueError("min_score ∈ [-1, 1]")
        if not 0.0 <= self.min_score_ratio <= 1.0:
            raise ValueError("min_score_ratio ∈ [0, 1]")
        if not 1 <= self.max_alternatives <= len(_ALTERNATIVE_LABELS):
            raise ValueError(f"max_alternatives ∈ [1, {len(_ALTERNATIVE_LABELS)}]")


@dataclass(frozen=True, slots=True)
class SavedPlace:
    """사용자가 저장한 장소 1건 (TRIP-512) — 백엔드 `saved_place` 의 봉투 표현.

    **후보 자격과 무관**하다(INV-1은 `closed_set_filter` 소유). 풀 안에서의 우선순위와
    LLM 컨텍스트에만 쓰인다. frozen 인 이유: `PlanBRagRequest` 가 frozen 이라 담기는
    값도 해시 가능해야 한다(dict 를 담으면 결정론 비교·PBT 가 깨진다).
    """

    poi_id: str
    name: str = ""


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
    # 대체 대상 슬롯의 원래 추천 이유 (TRIP-516 — 백엔드 visit_slot.placement_reason).
    # **참조 텍스트**다: 후보 자격과 무관(INV-1은 closed_set_filter 소유), LLM이
    # "원래 취지를 잇는 대안"을 고르게 하는 컨텍스트로만 쓰인다. 키는 평문 poi_id 문자열.
    affected_reasons: Mapping[str, str] = field(default_factory=dict)
    # 사용자가 저장한 장소 (TRIP-512) — 백엔드가 요청 봉투에 실어 보낸다.
    # 항목은 {"poi_id": str, "name": str}. **후보 자격과 무관**(INV-1은 closed_set_filter
    # 소유) — 풀 안에서의 우선순위(_rule_ranking 2단)와 LLM persona_context 에만 쓰인다.
    # KB-2 벡터 검색 결과와 합쳐지며, 같은 poi_id 면 봉투가 이긴다(백엔드가 정본).
    saved_places: tuple["SavedPlace", ...] = ()
    # 이 요청의 시간 예산 (RequestMetaSchema.deadline_ms). LLM 호출 마감을 여기서
    # 유도한다 — 게이트웨이 기본 2.5s 는 즉답성 feature 기준이라 상위 티어에는 짧다
    # (실측 gpt-5.6-sol 5.1s → 100% 타임아웃). None 이면 게이트웨이 기본.
    deadline_ms: int | None = None


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
        # gateway 주입 = LLM 단계 활성화 — 워커(4종 세트) 경유로만 호출한다 (TRIP-331)
        self._worker = (
            AlternativeSelectionWorker(alternative_gateway)
            if alternative_gateway is not None
            else None
        )
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
        ranked_refs, reasons, used_llm, why = self._select(request, context, available)
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
                # LLM이 낸 근거(사용자 표시 1문장)가 있으면 그대로, 없으면 출처 표기
                rationale=reasons.get(str(poi_id)) or self._rationale(request, used_llm),
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
            hits = fn(query, self._embedding, self._store, top_k=self._cfg.top_k)
        except Exception as e:
            return (), f"retrieve_{kb.value.lower()}_error: {type(e).__name__}: {e}"
        return self._cut(hits, kb)

    def _cut(self, hits: Sequence[KbHit], kb: KbKind) -> tuple[tuple[KbHit, ...], str]:
        """유사도 하한 미달을 버리고, 버린 건수를 노트로 남긴다.

        **노트가 이 기구의 절반이다.** 컷 결과가 0건이면 `retrieved` 숫자만 줄고
        아무 흔적이 안 남는데, 백엔드는 `retrieved=0` 을 "KB 미적재"로 읽기로 돼 있다
        (ai-backend-alternatives-연동-설계 §3). 그러면 "적재 안 됨"·"질의 무매칭"·
        "임계 미달"이 한 숫자로 뭉개진다. 응답 스키마를 안 바꾸고 셋을 가르는 길은
        `notes` 뿐이라 여기에 싣는다.

        노트 접두어를 `retrieve_` 로 쓰지 않는다 — 그건 검색이 **터진** 경우의 접두어이고
        (`retrieve_*_error`), 정상 동작인 컷과 섞이면 소비 측이 장애로 읽는다.
        """
        if not hits:
            return (), ""
        # ratio 0 은 "비율 컷 없음"이다. `top * 0 = 0` 을 그대로 쓰면 최고점과 무관하게
        # 0 이 하한이 돼 음수 코사인을 자른다 — 끄려던 것이 안 꺼진다.
        relative = (
            hits[0].score * self._cfg.min_score_ratio
            if self._cfg.min_score_ratio > 0
            else float("-inf")
        )
        floor = max(relative, self._cfg.min_score)
        kept = tuple(h for h in hits if h.score >= floor)
        dropped = len(hits) - len(kept)
        if not dropped:
            return kept, ""
        return kept, f"kb_score_cut_{kb.value.lower()}: {dropped}/{len(hits)}건 (하한 {floor:.3f})"

    # [3] Generate — LLM 선택. 미주입·실패·형태 이상은 전부 규칙 랭킹으로 (INV-4)
    def _select(
        self,
        request: PlanBRagRequest,
        context: RagContext,
        available: tuple[PoiId, ...],
    ) -> tuple[tuple[str, ...], Mapping[str, str], bool, str]:
        """반환: (참조 순열, {참조: LLM 근거}, LLM 사용 여부, 폴백 사유)."""
        saved_refs = _saved_refs(request.saved_places, context.persona)
        rule_ranked, rule_note = _rule_ranking(
            saved_refs, request.pool, available, request.reason
        )

        def _why(cause: str) -> str:  # 폴백 사유 + 규칙 랭킹이 뭘 했는지 (침묵 조정 금지)
            return f"{cause} · {rule_note}" if rule_note else cause

        if self._worker is None:
            return rule_ranked, {}, False, _why("alternative_gateway_absent")
        try:
            result = self._worker.select(
                request.pool,
                AlternativeSelectionInput(
                    trigger_kind=request.trigger.kind.value,
                    reason=request.reason,
                    schedule_context=_with_reasons(
                        _join(context.schedule), request.affected_reasons),
                    situation_context=_join(context.situation),
                    persona_context=_join_persona(context.persona, request.saved_places),
                    max_alternatives=self._cfg.max_alternatives,
                    excluded_poi_ids=request.excluded_poi_ids,
                ),
                request.trace_id,
                request.now,
                timeout_sec=self._llm_timeout(request),
            )
        except Exception as e:  # 설정 버그(프롬프트 미등록 등)도 Plan-B를 죽이지 않는다
            return rule_ranked, {}, False, _why(f"alternative_error: {type(e).__name__}: {e}")
        if result.is_fallback:
            return rule_ranked, {}, False, _why(f"alternative_fallback: {result.error}")
        picked = _as_refs(result.value)
        if picked is None:
            return rule_ranked, {}, False, _why("alternative_bad_shape")
        selected, reasons = picked
        if not selected:
            return rule_ranked, {}, False, _why("alternative_empty")
        return selected, reasons, True, ""

    def _llm_timeout(self, request: PlanBRagRequest) -> float | None:
        """요청 예산 → LLM 호출 마감. 예산이 없으면 게이트웨이 기본에 맡긴다.

        게이트웨이 기본(2.5s)은 즉답성 feature 기준이라 ALTERNATIVE_SELECTION 이
        쓰는 상위 티어에는 짧다 — 실측 `gpt-5.6-sol` 5.1s. 그대로 두면 LLM 경로가
        **항상** 타임아웃해 규칙 폴백만 나가고, 모델을 올린 효과가 0이 된다.
        응답은 200 이라 증상이 안 보인다.
        """
        if not request.deadline_ms or request.deadline_ms <= 0:
            return None
        return request.deadline_ms / 1000.0 * self._cfg.llm_budget_share

    def _rationale(self, request: PlanBRagRequest, used_llm: bool) -> str:
        source = "llm_select_alternatives" if used_llm else "rule_ranking"
        return f"{request.trigger.kind.value}/{request.reason} · {source}"


# ── 질의 조립 (Augment 재료) ────────────────────────────────────────────


def _schedule_query(request: PlanBRagRequest) -> str:
    return (
        f"{request.trigger.schedule_id} {request.trigger.affected_date.isoformat()} "
        f"{request.trigger.kind.value} 영향 슬롯"
    )


# reason 은 영문 enum 값이라 한국어 KB 문서와 임베딩 공간에서 잘 붙지 않는다. 특히
# "none" 은 사실상 빈 토큰이라 MANUAL/none 질의가 자기 문서를 top6 안에 1건도
# 못 올렸다 — 한국어로 치환하면 3건. 6개 질의 전체 정밀도 0.750 → 0.833
# (2026-09-01 실측, KB 49건 × KURE-v1. 악화된 질의는 없다).
_REASON_KO: Mapping[str, str] = MappingProxyType(
    {
        "weather": "날씨 악화",
        "closed": "휴무·폐점",
        "delay": "지연",
        "canceled": "예약 취소",
        "fatigue": "피로",
        "none": "사용자 요청 교체",
    }
)


def _situation_query(request: PlanBRagRequest) -> str:
    reason = _REASON_KO.get(request.reason, request.reason)
    return f"{request.trigger.kind.value} {reason} 상황"


def _persona_query(request: PlanBRagRequest) -> str:
    # KB-2 도 같은 매핑을 쓴다 — 오늘은 저장 장소가 봉투(TRIP-512)로 오고 이 검색이
    # 보조라 체감이 없지만, 한국어 메모·리뷰가 적재되는 순간 KB-3 과 같은 증상이 난다.
    reason = _REASON_KO.get(request.reason, request.reason)
    return f"{reason} {request.trigger.kind.value} 대안 선호"


def _saved_refs(
    saved_places: Sequence["SavedPlace"], persona_hits: Sequence[KbHit]
) -> tuple[str, ...]:
    """저장 장소 poi_id 순열 — 봉투(TRIP-512) 우선, 뒤에 KB-2 검색 히트.

    봉투는 백엔드 `saved_place` 의 정본이라 앞에 둔다. 벡터 KB-2 는 메모·리뷰 데이터가
    생길 때를 위한 경로로 남겨 두고, 지금은 봉투가 비었을 때만 실질적으로 일한다.
    중복은 첫 등장 순서로 접는다(결정론).
    """
    refs: list[str] = []
    seen: set[str] = set()
    for item in saved_places:
        ref = item.poi_id
        if ref and ref not in seen:
            seen.add(ref)
            refs.append(ref)
    for hit in persona_hits:
        if hit.poi_ref and hit.poi_ref not in seen:
            seen.add(hit.poi_ref)
            refs.append(hit.poi_ref)
    return tuple(refs)


def _join_saved(saved_places: Sequence["SavedPlace"]) -> str:
    """봉투 저장 장소 → 프롬프트 줄. 이름이 없으면 poi_id 로 대신한다."""
    return "\n".join(
        f"- 저장한 장소 — {item.name or item.poi_id}"
        for item in saved_places
        if item.poi_id
    )


def _join_persona(hits: Sequence[KbHit], saved_places: Sequence["SavedPlace"]) -> str:
    """LLM persona_context — 봉투 줄이 먼저, 그 뒤 KB-2 검색 발췌."""
    return "\n".join(part for part in (_join_saved(saved_places), _join(hits)) if part)


def _join(hits: Sequence[KbHit]) -> str:
    return "\n".join(f"- {h.text}" for h in hits)


def _with_reasons(schedule_context: str, reasons: Mapping[str, str]) -> str:
    """원래 추천 이유(TRIP-516)를 일정 컨텍스트 앞에 붙인다 — 결정론(poi_id 정렬).

    대안이 원래 취지("조용한 카페라 추천")를 이어가게 하는 재료. 규칙 랭킹 폴백
    경로에는 영향 없음 — LLM 프롬프트 컨텍스트 전용.
    """
    if not reasons:
        return schedule_context
    lines = "\n".join(
        f"- {poi_id}: {text}" for poi_id, text in sorted(reasons.items()))
    block = f"[원래 추천 이유]\n{lines}"
    return f"{block}\n{schedule_context}" if schedule_context else block


# ── 랭킹·형태 검증 ──────────────────────────────────────────────────────


def _rule_ranking(
    saved_refs: Sequence[str],
    pool: CandidatePool,
    available: tuple[PoiId, ...],
    reason: str,
) -> tuple[tuple[str, ...], str]:
    """규칙 폴백 랭킹 — 결정론, 외부 호출 0. 반환: (참조 순열, 조정 기록).

    planb-rag-design §7 의 "규칙 점수(카테고리+거리+평점)" 를 가용 데이터로 옮긴 정렬 키:
      ⓪ reason 신호 — `_DEMOTED_BY_REASON` 의 카테고리를 **뒤로** (제외 아님: 대안 0 보다
         야외라도 제안하는 편이 낫다)
      ① 저장 장소 우선 (§3 [2]) — 봉투(TRIP-512) ⊕ KB-2 검색 히트.
         단 ⓪이 앞선다: 비 오는 날 야외는 저장이어도 뒤
      ② 앵커까지 직선거리 오름차순 (haversine) — 풀에 anchor 가 없으면 생략
    안정 정렬이라 동률은 풀 순서를 유지한다(결정론). 평점은 범위 밖 — `rating` 이 실
    어댑터에서 항상 None(백엔드 미제공). 실경로(TMAP)는 장애 경로에 새 장애 모드를
    더하므로 쓰지 않는다 — 폴백은 계산만으로 항상 돌아야 한다 (INV-4).
    페르소나 히트가 풀 자격을 만드는 게 아니라 **풀 안에서의 우선순위만** 바꾼다 (INV-1).
    """
    demoted = _DEMOTED_BY_REASON.get(reason, frozenset())
    poi_by_id = {p.poi_id: p for p in pool.pois}
    saved = set(saved_refs)
    anchor = pool.anchor

    def _key(poi_id: PoiId) -> tuple[bool, bool, float]:
        poi = poi_by_id[poi_id]
        distance = haversine_km(anchor, poi.coord) if anchor is not None else 0.0
        return (poi.category in demoted, str(poi_id) not in saved, distance)

    ranked = sorted(available, key=_key)
    demoted_count = sum(1 for p in ranked if poi_by_id[p].category in demoted)
    note = f"rule_ranking: {reason} 신호로 야외 {demoted_count}건 후순위" if demoted_count else ""
    return tuple(str(p) for p in ranked), note


def _as_refs(value: object) -> tuple[tuple[str, ...], Mapping[str, str]] | None:
    """게이트 산출물 → (참조 순열, {참조: 근거}). 인식 못 하는 형태는 None (폴백 신호).

    정식 산출물은 `AlternativeSelectionGate`의 `AlternativePick` 시퀀스 — LLM이 낸
    선호 순서를 그대로 쓴다 (같은 산출물이면 같은 순열 — 결정론).
    점수형(`ScoredPoi`) 산출물도 호환 유지: 점수 내림차순(동점은 poi_id 사전순).
    """
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return None
    items = list(value)
    if all(isinstance(x, AlternativePick) for x in items):
        return tuple(str(p.poi_id) for p in items), {str(p.poi_id): p.reason for p in items}
    if not all(isinstance(x, ScoredPoi) for x in items):
        return None
    ordered = sorted(items, key=lambda s: (-s.score, str(s.poi_id)))
    return tuple(str(s.poi_id) for s in ordered), {}
