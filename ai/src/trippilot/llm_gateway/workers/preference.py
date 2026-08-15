"""PreferenceScoringWorker — 취향 점수화, 경량 티어·전 일자 공용 1회 (U4 FD §3).

점수는 수치만 산출한다 — 표시용 설명은 배치된 슬롯에 한해 EXPLANATION 워커
소유 (TRIP-374, ai-prompt-design.md §2.2).

흐름: ContextResolver 권한 재조회(D31) → 프롬프트 변수 조립(필드 최소화 G181,
좌표 미포함) → gateway.call. 폴백이면 TypedResult(is_fallback=True)를 그대로
반환 — 규칙 점수 실행은 호출측(U5)의 몫 (BR-U4-09).

병렬 청킹 (TRIP-378): 실측(TRIP-373·376) 점수 지연 ≈ 바닥 ~3s + 건당 ~0.2s
선형이라 큰 풀(실전 193건, 단일 호출 44.5s)은 단계 예산 14s 밖이다.
풀 > chunk_size(설정 20)면 poi_id 정렬 균등 분할 후 청크별 gateway.call을
스레드로 동시 실행하고 병합한다. 풀 ≤ chunk_size는 단일 호출 현행 경로 그대로.
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from trippilot.llm_gateway.context import ContextResolver
from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import PoiId, TraceId
from trippilot.domain.context import Principal, ResourceRef
from trippilot.domain.llm import CandidatePool, LlmFeature, ScoredPoi, TypedResult
from trippilot.domain.observability import ScoreChunkEvent
from trippilot.domain.persona import PersonaSummary

_COMPONENT = "c1.worker.preference"


def build_prompt_vars(pool: CandidatePool, persona: PersonaSummary) -> dict[str, str]:
    """프롬프트 변수 문자열화 — 결정론(poi_id 정렬), 좌표 미포함 (G181, PROMPT-P1).

    후보는 poi_id·카테고리·상호명만 — Poi의 coord·avg_cost 등은 넣지 않는다.
    """
    candidates = "\n".join(
        f"- {p.poi_id} | {p.category.value} | {p.name}"
        for p in sorted(pool.pois, key=lambda p: str(p.poi_id))
    )
    return {
        "taste_tags": ", ".join(t.value for t in persona.taste_tags) or "미설정",
        "companion": persona.companion.value,
        "budget": persona.budget.value,
        "candidates": candidates or "(후보 없음)",
    }


def plan_chunks(
    pool: CandidatePool, chunk_size: int, max_parallel: int
) -> tuple[CandidatePool, ...]:
    """poi_id 정렬 후 균등 분할 — 같은 풀이면 항상 같은 청크 구성 (결정론, TRIP-378).

    병렬수 N = ⌈풀 ÷ chunk_size⌉, 상한 max_parallel. 청크 크기 차는 최대 1 —
    가장 느린 청크가 벽시계를 정하므로 고정 크기 자투리(193건 → 20×9+13)가 아니라
    균형 분할(20×3+19×7)로 최대 청크를 키우지 않는다.
    """
    pois = tuple(sorted(pool.pois, key=lambda p: str(p.poi_id)))
    if not pois:
        return ()
    n = min(max_parallel, math.ceil(len(pois) / chunk_size))
    base, rem = divmod(len(pois), n)
    chunks: list[CandidatePool] = []
    start = 0
    for i in range(n):
        end = start + base + (1 if i < rem else 0)
        part = pois[start:end]
        start = end
        chunks.append(
            CandidatePool(
                poi_ids=frozenset(p.poi_id for p in part),
                pois=part,
                generated_at=pool.generated_at,
                anchor=pool.anchor,
                radius_km=pool.radius_km,
            )
        )
    return tuple(chunks)


class PreferenceScoringWorker:
    def __init__(self, gateway: GatewayFacade, resolver: ContextResolver) -> None:
        self._gateway = gateway
        self._resolver = resolver

    def score(
        self,
        pool: CandidatePool,
        persona_ref: ResourceRef,
        principal: Principal,
        trace_id: TraceId,
        now: datetime,
        *,
        timeout_sec: float | None = None,
    ) -> TypedResult[tuple[ScoredPoi, ...]]:
        # 권한 위반은 폴백이 아니라 즉시 예외 (D31 — 부분 성공 0)
        persona = self._resolver.resolve(principal, persona_ref)
        if not isinstance(persona, PersonaSummary):
            raise TypeError(
                f"persona_ref 재조회 결과가 PersonaSummary 아님: {type(persona).__name__}"
            )
        if len(pool.pois) <= self._gateway.config.score_chunk_size:
            # 풀 ≤ 청크 크기 — 단일 호출 현행 경로 그대로 (TRIP-378: 리허설 6~8건 무영향)
            return self._gateway.call(
                LlmFeature.PREFERENCE_SCORING,
                build_prompt_vars(pool, persona),
                pool,
                trace_id,
                now,
                # 호출측 단계 예산이 호출 타임아웃까지 관통 (TRIP-376) — 미지정이면
                # 게이트웨이 기본(2.5s)이라 실호출 바닥 ~3s에서 항상 잘린다.
                timeout_sec=timeout_sec,
            )
        return self._score_chunked(pool, persona, trace_id, now, timeout_sec)

    def _score_chunked(
        self,
        pool: CandidatePool,
        persona: PersonaSummary,
        trace_id: TraceId,
        now: datetime,
        timeout_sec: float | None,
    ) -> TypedResult[tuple[ScoredPoi, ...]]:
        """청크별 gateway.call 동시 실행 → 병합 (TRIP-378).

        - 스레드 안전성: 게이트웨이·렌더러·게이트는 호출 경로에 공유 가변 상태가
          없고(전부 읽기 전용 설정), LlmPort 어댑터의 openai/anthropic client는
          httpx 기반으로 클라이언트 재사용이 스레드 안전(각 SDK 공식 관례).
          trace.emit은 계약상 예외 불투과라 경쟁해도 호출을 깨지 않는다.
        - timeout_sec는 각 청크 호출에 **그대로 관통** — 청크가 작아져도 시한은
          단계 예산 기준이다 (TRIP-376 계약 유지).
        - 부분 실패: 성공 청크의 점수만 value에 싣고 is_fallback=False를 유지한다.
          실패 청크 POI는 value 부재로 드러나며(규칙 점수 보충은 호출측 몫,
          BR-U4-09), 부분 실패 사실은 error 문자열로 함께 싣는다 — TypedResult
          불변식(is_fallback=True → value=None)은 그대로다.
        - 전 청크 실패 = 단일 호출의 기존 폴백 신호와 동일 (INV-4 경로 불변).
        """
        cfg = self._gateway.config
        chunks = plan_chunks(pool, cfg.score_chunk_size, cfg.score_max_parallel)

        def _call(chunk: CandidatePool) -> TypedResult[tuple[ScoredPoi, ...]]:
            return self._gateway.call(
                LlmFeature.PREFERENCE_SCORING,
                build_prompt_vars(chunk, persona),
                chunk,  # 청크별 게이트는 그 청크의 부분집합 풀로 교차 (INV-1, 더 엄격)
                trace_id,
                now,
                timeout_sec=timeout_sec,
            )

        with ThreadPoolExecutor(max_workers=len(chunks)) as executor:
            results = tuple(executor.map(_call, chunks))  # 청크 순서 보존 (결정론)

        successes = [r for r in results if not r.is_fallback]
        failed = len(chunks) - len(successes)
        # 청킹 요약 관측 — 성공/실패 수를 침묵 없이 남긴다 (INV-4). 청크별 개별
        # 계측(LlmCallRecord·FallbackEvent)은 게이트웨이가 이미 발행했다.
        self._gateway.trace.emit(
            ScoreChunkEvent(
                trace_id=trace_id,
                occurred_at=now,
                component=_COMPONENT,
                feature=LlmFeature.PREFERENCE_SCORING.value,
                pool_size=len(pool.pois),
                chunk_count=len(chunks),
                success_count=len(successes),
                failure_count=failed,
            )
        )

        if not successes:
            first = results[0]
            return TypedResult(
                value=None,
                is_fallback=True,
                error=f"all_chunks_failed:{len(chunks)}: {first.error}",
                call_record=first.call_record,
            )

        # 병합 — 청크 순서(= poi_id 정렬 순) 그대로, 중복 poi_id는 첫 등장 우선
        # (결정론), 병합 후 전체 풀 기준 재검 (INV-1 2겹: 청크 게이트 + 여기)
        seen: set[PoiId] = set()
        merged: list[ScoredPoi] = []
        for result in successes:
            for sp in result.value or ():
                if sp.poi_id in seen or not pool.contains(sp.poi_id):
                    continue
                seen.add(sp.poi_id)
                merged.append(sp)
        return TypedResult(
            value=tuple(merged),
            is_fallback=False,
            error=(
                f"partial_chunks_failed:{failed}/{len(chunks)}" if failed else None
            ),
            call_record=successes[0].call_record,
        )
